import {
  MessageRole,
  MessageSourceType,
  Prisma,
  TicketPriority,
  TicketStatus,
  UserRole,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { broadcastTicketNotification, getPendingTicketCounts } from "@/lib/notifications/server";
import {
  classifyTicketDepartmentWithModel,
  generateTicketKnowledgeDraftWithModel,
  type TicketKnowledgeMaterialForModel,
} from "@/lib/openai";
import { appendConversationMessage } from "@/lib/services/conversations";
import { overwriteKnowledgeItem, upsertQaKnowledgeDocument } from "@/lib/services/knowledge";
import type { AttachmentItem } from "@pharmacy/shared";
import { getAttachmentItems, safeJsonParse } from "@/lib/utils";
import { buildTicketNo, truncateText } from "@/lib/utils";

export type TicketStatusGroup =
  | "all"
  | "pending"
  | "processing"
  | "escalated"
  | "resolved"
  | "closed";

export type TicketListParams = {
  role: UserRole;
  userId: string;
  userDepartmentName?: string | null;
  userRegionId?: string | null;
  status?: TicketStatus | "all";
  statusGroup?: TicketStatusGroup;
  q?: string;
  page?: number;
  pageSize?: number;
};

export type TicketListResult = Awaited<ReturnType<typeof listTickets>>;

export type TicketKnowledgeMaterial = {
  id: string;
  source: "conversation" | "ticket";
  messageId: string;
  role: MessageRole;
  sourceType: MessageSourceType | "ticket";
  roleLabel: string;
  sourceLabel: string;
  contentText: string;
  attachments: ReturnType<typeof getAttachmentItems>;
  createdAt: Date;
};

const statusGroups: Record<Exclude<TicketStatusGroup, "all">, TicketStatus[]> = {
  pending: ["pending_claim"],
  processing: ["processing"],
  escalated: ["escalated"],
  resolved: ["resolved"],
  closed: ["closed"],
};

const FALLBACK_DEPARTMENT_NAME = "其他部门";
const DEPARTMENT_CONFIDENCE_THRESHOLD = 0.3;

type AssignableDepartment = {
  id: string;
  name: string;
  regionId: string | null;
  users: Array<{ id: string; displayName: string }>;
};

const CATEGORY_DEPARTMENT_MAP: Record<string, string> = {
  医保政策: "医保办",
  商品库存: "营运部",
  系统操作: "营运部",
  合规政策: "营运部",
  用药咨询: "营运部",
};

const KEYWORD_DEPARTMENT_MAP: Array<{ pattern: RegExp; department: string }> = [
  { pattern: /培训|学习|考试|入职培训|业务学习|带教/, department: "培训部" },
  { pattern: /人事|考勤|排班|请假|加班|薪资|社保|公积金|离职|入职/, department: "人事部" },
  { pattern: /财务|结算|发票|报销|对账|收款|付款|税/, department: "财务部" },
  { pattern: /医保|统筹|刷卡|报销比例|医保目录/, department: "医保办" },
  { pattern: /采购|供应商|进货|订货|补货|退货给供应商/, department: "采购部" },
];

function classifyDepartmentByRules(text: string, category: string): string | null {
  for (const { pattern, department } of KEYWORD_DEPARTMENT_MAP) {
    if (pattern.test(text)) {
      return department;
    }
  }
  const mapped = CATEGORY_DEPARTMENT_MAP[category];
  if (mapped) {
    return mapped;
  }
  return null;
}

function clampPage(value: number | undefined) {
  return Math.max(1, Number.isFinite(value ?? 1) ? Number(value ?? 1) : 1);
}

function clampPageSize(value: number | undefined) {
  const size = Number.isFinite(value ?? 10) ? Number(value ?? 10) : 10;
  return Math.min(50, Math.max(5, size));
}

function deriveTags(text: string) {
  return Array.from(
    new Set(
      text
        .split(/[，。；、,\s（）()]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).slice(0, 5);
}

function deriveTicketCategory(text: string) {
  if (/医保|报销|统筹|刷卡/.test(text)) {
    return "医保政策";
  }
  if (/库存|效期|价格|商品|批次/.test(text)) {
    return "商品库存";
  }
  if (/系统|收银|小票|打印|数据库|登录|异常/.test(text)) {
    return "系统操作";
  }
  if (/处方|执业药师|合规|监管/.test(text)) {
    return "合规政策";
  }
  return "用药咨询";
}

function deriveTicketPriority(text: string): TicketPriority {
  if (/急|高烧|失败|异常|无法|投诉|风险|错误|过期/.test(text)) {
    return "high";
  }
  if (/咨询|怎么|如何|是否|可以/.test(text)) {
    return "medium";
  }
  return "low";
}

function roleLabel(role: MessageRole) {
  switch (role) {
    case "user":
      return "药店工作人员";
    case "assistant":
      return "系统大模型";
    case "agent":
      return "部门人员";
    case "system":
      return "系统";
    default:
      return role;
  }
}

function sourceLabel(sourceType: MessageSourceType | "ticket") {
  switch (sourceType) {
    case "kb":
      return "知识库回复";
    case "llm":
      return "大模型回复";
    case "manual":
      return "人工回复";
    case "system":
      return "系统消息";
    case "ticket":
      return "工单消息";
    default:
      return sourceType;
  }
}

function normalizeMaterialIds(ids: string[]) {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

function tagsFromDraft(question: string, tags: string[]) {
  return Array.from(new Set([...tags, ...deriveTags(question)])).slice(0, 5);
}

async function findAssignableDepartment(input: {
  departmentName: string;
  preferredRegionId?: string | null;
  departmentId?: string | null;
}): Promise<{
  department: AssignableDepartment;
  user: { id: string; displayName: string };
} | null> {
  async function findCandidates(name: string) {
    if (input.departmentId) {
      const department = await prisma.department.findUnique({
        where: { id: input.departmentId },
        include: {
          users: {
            where: { role: "department", enabled: true },
            select: { id: true, displayName: true },
            orderBy: { displayName: "asc" },
          },
        },
      });
      return department && department.name === name ? [department] : [];
    }

    return prisma.department.findMany({
      where: {
        name,
        users: { some: { role: "department", enabled: true } },
      },
      include: {
        users: {
          where: { role: "department", enabled: true },
          select: { id: true, displayName: true },
          orderBy: { displayName: "asc" },
        },
      },
      orderBy: [{ regionId: "asc" }, { name: "asc" }],
    });
  }

  async function pick(name: string) {
    const candidates = await findCandidates(name);
    const ordered = [...candidates].sort((a, b) => {
      const aLocal = input.preferredRegionId && a.regionId === input.preferredRegionId ? 0 : 1;
      const bLocal = input.preferredRegionId && b.regionId === input.preferredRegionId ? 0 : 1;
      return aLocal - bLocal;
    });
    const department = ordered.find((item) => Array.isArray(item.users) && item.users.length > 0);
    const user = department?.users[0];
    return department && user ? { department, user } : null;
  }

  return (
    (await pick(input.departmentName)) ??
    (input.departmentName === FALLBACK_DEPARTMENT_NAME
      ? null
      : await pick(FALLBACK_DEPARTMENT_NAME))
  );
}

export function canAccessTicket(input: {
  role: UserRole;
  userId: string;
  userDepartmentName?: string | null;
  userRegionId?: string | null;
  ticket: {
    status: TicketStatus;
    createdByUserId: string;
    claimedByUserId?: string | null;
    escalatedToDept?: string | null;
    escalatedToUserId?: string | null;
    regionId?: string | null;
  };
}) {
  if (input.role === "staff") {
    return input.ticket.createdByUserId === input.userId;
  }

  if (input.role === "admin") {
    return true;
  }

  if (input.role !== "department") {
    return false;
  }

  // 区域校验：部门人员只能操作本区域的工单（"其他部门"除外）
  if (input.ticket.claimedByUserId === input.userId) {
    return true;
  }

  if (!input.userDepartmentName) {
    return false;
  }

  if (
    (input.ticket.status === "pending_claim" || input.ticket.status === "escalated") &&
    input.ticket.escalatedToDept === input.userDepartmentName
  ) {
    return true;
  }

  if (
    input.ticket.status === "closed" &&
    input.ticket.escalatedToDept === input.userDepartmentName
  ) {
    return true;
  }

  return false;
}

function baseTicketWhere(
  params: Pick<TicketListParams, "role" | "userId" | "userDepartmentName" | "userRegionId">
): Prisma.TicketWhereInput {
  if (params.role === "staff") {
    return { createdByUserId: params.userId };
  }

  if (params.role === "admin") {
    return {};
  }

  if (params.role !== "department" || !params.userDepartmentName) {
    return { id: "__no_visible_tickets__" };
  }

  // "其他部门"不受区域限制，所有区域的其他部门人员都能看到
  return {
    OR: [
      { claimedByUserId: params.userId },
      {
        status: { in: ["pending_claim", "escalated"] },
        escalatedToDept: params.userDepartmentName,
      },
      { status: "closed", escalatedToDept: params.userDepartmentName },
    ],
  };
}

export async function classifyTicketDepartment(input: {
  question: string;
  aiAnswerSnapshot: string;
  category: string;
  regionId?: string | null;
}) {
  const allDepartments = await prisma.department.findMany({
    select: { name: true, description: true, regionId: true },
    orderBy: { name: "asc" },
  });

  const departments = allDepartments.filter(
    (dept, index, array) => array.findIndex((item) => item.name === dept.name) === index
  );

  const departmentNames = new Set(departments.map((d) => d.name));
  const fallbackDepartment =
    departments.find((dept) => dept.name === FALLBACK_DEPARTMENT_NAME) ?? departments[0];

  if (!fallbackDepartment) {
    return {
      departmentName: FALLBACK_DEPARTMENT_NAME,
      confidence: 0,
      reason: "系统未配置部门，使用默认兜底部门",
    };
  }

  // 预查本区域各部门的可用用户，用于后续兜底判断
  const regionDeptUserCounts: Record<string, number> = {};
  if (input.regionId) {
    const regionDepts = await prisma.department.findMany({
      where: { regionId: input.regionId },
      select: { id: true, name: true },
    });
    for (const dept of regionDepts) {
      const count = await prisma.user.count({
        where: { departmentId: dept.id, role: "department", enabled: true },
      });
      regionDeptUserCounts[dept.name] = count;
    }
  }

  function hasLocalUsers(deptName: string): boolean {
    // "其他部门"是全局的，始终可用
    if (deptName === FALLBACK_DEPARTMENT_NAME) return true;
    // 没有区域限制时默认可用
    if (!input.regionId) return true;
    return Boolean(deptName);
  }

  const ruleMatch = classifyDepartmentByRules(input.question, input.category);
  if (ruleMatch && departmentNames.has(ruleMatch)) {
    if (hasLocalUsers(ruleMatch)) {
      return {
        departmentName: ruleMatch,
        confidence: 0.95,
        reason: `关键词/分类规则匹配：${input.category} → ${ruleMatch}`,
      };
    }
    // 本区域没有该部门的用户，兜底到其他部门
    return {
      departmentName: FALLBACK_DEPARTMENT_NAME,
      confidence: 0.95,
      reason: `关键词匹配${ruleMatch}，但本区域无可用人员，兜底到${FALLBACK_DEPARTMENT_NAME}`,
    };
  }

  try {
    const classified = await classifyTicketDepartmentWithModel({
      ...input,
      departments: departments.map((d) => ({ name: d.name, description: d.description })),
    });
    const matched = departments.find((dept) => dept.name === classified.departmentName);
    if (!matched || classified.confidence < DEPARTMENT_CONFIDENCE_THRESHOLD) {
      return {
        departmentName: fallbackDepartment.name,
        confidence: classified.confidence || 0,
        reason: classified.reason || "模型置信度不足，使用兜底部门",
      };
    }
    // 本区域没有该部门的用户，兜底到其他部门
    if (!hasLocalUsers(classified.departmentName)) {
      return {
        departmentName: FALLBACK_DEPARTMENT_NAME,
        confidence: classified.confidence,
        reason: `模型匹配${classified.departmentName}，但本区域无可用人员，兜底到${FALLBACK_DEPARTMENT_NAME}`,
      };
    }
    return classified;
  } catch {
    return {
      departmentName: fallbackDepartment.name,
      confidence: 0,
      reason: "模型分发失败，使用兜底部门",
    };
  }
}

function buildTicketWhere(params: TicketListParams): Prisma.TicketWhereInput {
  const and: Prisma.TicketWhereInput[] = [baseTicketWhere(params)];
  const q = params.q?.trim();

  if (params.status && params.status !== "all") {
    and.push({ status: params.status });
  } else if (params.statusGroup && params.statusGroup !== "all") {
    and.push({ status: { in: statusGroups[params.statusGroup] } });
  }

  if (q) {
    and.push({
      OR: [
        { ticketNo: { contains: q } },
        { title: { contains: q } },
        { latestUserQuestion: { contains: q } },
        { category: { contains: q } },
        { createdBy: { displayName: { contains: q } } },
      ],
    });
  }

  return and.length === 1 ? and[0] : { AND: and };
}

export async function createTicketFromConversation(input: {
  createdByUserId: string;
  conversationId: string;
}) {
  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: input.conversationId },
    orderBy: { createdAt: "asc" },
  });

  const latestUser = [...messages].reverse().find((item) => item.role === "user");
  const latestAssistant = [...messages].reverse().find((item) => item.role === "assistant");
  const latestUserAttachments = getAttachmentItems(latestUser?.attachmentsJson);

  if (!latestUser) {
    throw new Error("当前会话缺少可用于转人工的用户问题");
  }

  const title = truncateText(latestUser.contentText, 32);
  const category = deriveTicketCategory(latestUser.contentText);
  const tags = deriveTags(latestUser.contentText);

  const creator = await prisma.user.findUnique({
    where: { id: input.createdByUserId },
    select: { regionId: true },
  });

  const departmentRouting = await classifyTicketDepartment({
    question: latestUser.contentText,
    aiAnswerSnapshot: latestAssistant?.contentText ?? "",
    category,
    regionId: creator?.regionId,
  });
  const assignment = await findAssignableDepartment({
    departmentName: departmentRouting.departmentName,
    preferredRegionId: creator?.regionId,
  });
  const routedDepartmentName = assignment?.department.name ?? departmentRouting.departmentName;
  const conversationSnapshot = JSON.stringify(
    messages.map((item) => ({
      id: item.id,
      role: item.role,
      sourceType: item.sourceType,
      contentText: item.contentText,
      attachmentsJson: item.attachmentsJson,
      retrievalDebugJson: item.retrievalDebugJson,
      createdAt: item.createdAt.toISOString(),
    }))
  );

  const ticket = await prisma.ticket.create({
    data: {
      ticketNo: buildTicketNo(),
      status: assignment ? "processing" : "pending_claim",
      priority: deriveTicketPriority(latestUser.contentText),
      createdByUserId: input.createdByUserId,
      conversationId: input.conversationId,
      title,
      category,
      tagsJson: tags.length ? JSON.stringify(tags) : null,
      latestUserQuestion: latestUser.contentText,
      inputMode: latestUserAttachments.length
        ? latestUser.contentText
          ? "mixed"
          : "image"
        : "text",
      aiAnswerSnapshot: latestAssistant?.contentText ?? "",
      conversationSnapshot,
      escalatedAt: new Date(),
      escalatedToDept: routedDepartmentName,
      escalatedToUserId: assignment?.user.id ?? null,
      claimedByUserId: assignment?.user.id ?? null,
      regionId: creator?.regionId ?? null,
    },
  });

  await prisma.ticketMessage.createMany({
    data: [
      {
        ticketId: ticket.id,
        senderRole: "system",
        messageType: "system",
        content: assignment
          ? `系统已将工单分配至${routedDepartmentName}，处理人：${assignment.user.displayName}。`
          : `系统已将工单分发至${routedDepartmentName}，暂无可用处理人。`,
      },
      ...messages.map((message) => {
        const attachments = getAttachmentItems(message.attachmentsJson);
        let allAttachments = attachments;
        if (message.role === "assistant" && message.retrievalDebugJson) {
          const debug = safeJsonParse<{ imagePaths?: string[] }>(message.retrievalDebugJson, {});
          if (debug.imagePaths?.length) {
            const kbImages: AttachmentItem[] = debug.imagePaths.map((path) => ({
              name: path.split("/").pop() ?? path,
              path,
              mimeType: "image/png",
              size: 0,
            }));
            allAttachments = [...attachments, ...kbImages];
          }
        }
        return {
          ticketId: ticket.id,
          senderRole: message.role,
          senderUserId: message.role === "user" ? input.createdByUserId : undefined,
          messageType: allAttachments.length ? ("image" as const) : ("text" as const),
          content: message.contentText,
          attachments: allAttachments.length ? JSON.stringify(allAttachments) : undefined,
        };
      }),
    ],
  });

  await broadcastTicketNotification({
    type: "ticket_created",
    title: "收到新的部门工单",
    message: assignment
      ? `工单 ${ticket.ticketNo} 已分配至${assignment.user.displayName}：${ticket.title}`
      : `工单 ${ticket.ticketNo} 已分发至${routedDepartmentName}：${ticket.title}`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetRoles: assignment ? undefined : ["department"],
    targetUserIds: assignment ? [assignment.user.id] : undefined,
  });

  return ticket;
}

export async function claimTicket(input: {
  ticketId: string;
  userId: string;
  userDisplayName: string;
  userDepartmentName?: string | null;
  userRegionId?: string | null;
}) {
  const existing = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
  });

  if (!existing) {
    throw new Error("工单不存在");
  }

  if (!input.userDepartmentName) {
    throw new Error("当前账号未绑定部门，不能认领工单");
  }

  if (existing.status !== "pending_claim" && existing.status !== "escalated") {
    throw new Error("当前工单不可认领");
  }

  if (existing.escalatedToDept !== input.userDepartmentName) {
    throw new Error("当前工单未分发到你的部门，不能认领");
  }

  // 区域校验：只能认领本区域的工单（"其他部门"除外）
  const isFallbackDept = input.userDepartmentName === FALLBACK_DEPARTMENT_NAME;
  if (
    !isFallbackDept &&
    input.userRegionId &&
    existing.regionId &&
    input.userRegionId !== existing.regionId
  ) {
    throw new Error("不能认领其他区域的工单");
  }

  const ticket = await prisma.ticket.update({
    where: {
      id: input.ticketId,
      status: { in: ["pending_claim", "escalated"] },
      escalatedToDept: input.userDepartmentName,
    },
    data: {
      status: "processing",
      claimedByUserId: input.userId,
      firstRespondedAt: existing.firstRespondedAt ?? new Date(),
    },
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId: input.ticketId,
      senderRole: "system",
      messageType: "system",
      content: `${input.userDisplayName} 已认领${input.userDepartmentName}工单。`,
    },
  });

  await broadcastTicketNotification({
    type: "ticket_claimed",
    title: "工单已被认领",
    message: `工单 ${ticket.ticketNo} 已被 ${input.userDisplayName} 认领`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetUserIds: [ticket.createdByUserId],
  });

  return ticket;
}

export async function listTickets(params: TicketListParams) {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const where = buildTicketWhere(params);
  const roleWhere = baseTicketWhere(params);

  const [items, total, all, pending, processing, escalated, resolved, closed, myTickets] =
    await Promise.all([
      prisma.ticket.findMany({
        where,
        include: {
          createdBy: true,
          closedBy: true,
          claimedBy: true,
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.ticket.count({ where }),
      prisma.ticket.count({ where: roleWhere }),
      prisma.ticket.count({ where: { AND: [roleWhere, { status: "pending_claim" }] } }),
      prisma.ticket.count({ where: { AND: [roleWhere, { status: "processing" }] } }),
      prisma.ticket.count({ where: { AND: [roleWhere, { status: "escalated" }] } }),
      prisma.ticket.count({ where: { AND: [roleWhere, { status: "resolved" }] } }),
      prisma.ticket.count({ where: { AND: [roleWhere, { status: "closed" }] } }),
      prisma.ticket.count({
        where: { AND: [roleWhere, { claimedByUserId: params.userId, status: { not: "closed" } }] },
      }),
    ]);

  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      all,
      pending,
      processing,
      escalated,
      resolved,
      closed,
      myTickets,
    },
  };
}

export async function getTicketDetail(ticketId: string) {
  return prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      createdBy: true,
      closedBy: true,
      claimedBy: true,
      escalatedToUser: true,
      resolutionSubmittedBy: true,
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          senderUser: true,
        },
      },
      knowledgeDrafts: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          generatedBy: true,
        },
      },
    },
  });
}

export async function replyTicket(input: {
  ticketId: string;
  senderRole: MessageRole;
  senderUserId: string;
  content: string;
  attachments?: string;
}) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
  });

  if (!ticket) {
    throw new Error("工单不存在");
  }

  if (ticket.status === "closed") {
    throw new Error("工单已关闭，不能继续追加回复");
  }

  const message = await prisma.ticketMessage.create({
    data: {
      ticketId: input.ticketId,
      senderRole: input.senderRole,
      senderUserId: input.senderUserId,
      messageType: input.attachments ? "image" : "text",
      content: input.content,
      attachments: input.attachments,
    },
  });

  // Transition pending_claim/escalated to processing when a human replies
  if (
    input.senderRole === "agent" &&
    (ticket.status === "pending_claim" || ticket.status === "escalated")
  ) {
    await prisma.ticket.update({
      where: { id: input.ticketId },
      data: {
        status: "processing",
        claimedByUserId: ticket.claimedByUserId ?? input.senderUserId,
        firstRespondedAt: ticket.firstRespondedAt ?? new Date(),
      },
    });
  } else if (input.senderRole === "agent") {
    await prisma.ticket.update({
      where: { id: input.ticketId },
      data: {
        firstRespondedAt: ticket.firstRespondedAt ?? new Date(),
      },
    });
  }

  if (ticket.conversationId) {
    await appendConversationMessage({
      conversationId: ticket.conversationId,
      role: input.senderRole,
      sourceType: "manual",
      contentText: input.content,
      attachmentsJson: input.attachments ?? null,
    });
  }

  await broadcastTicketNotification({
    type: "ticket_replied",
    title: "工单有新回复",
    message:
      input.senderRole === "user"
        ? `工单 ${ticket.ticketNo} 有新的门店补充说明`
        : `工单 ${ticket.ticketNo} 有新的人工处理回复`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetUserIds:
      input.senderRole === "user"
        ? ticket.claimedByUserId
          ? [ticket.claimedByUserId]
          : []
        : [ticket.createdByUserId],
  });

  return message;
}

export async function escalateTicket(input: {
  ticketId: string;
  senderUserId: string;
  senderDisplayName: string;
  targetDept: string;
  targetDepartmentId?: string | null;
}) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
  });

  if (!ticket) {
    throw new Error("工单不存在");
  }

  if (ticket.claimedByUserId !== input.senderUserId) {
    throw new Error("只有工单认领人才能转派工单");
  }

  // 优先在本区域查找目标部门，找不到则尝试全局部门
  const assignment = await findAssignableDepartment({
    departmentName: input.targetDept,
    preferredRegionId: ticket.regionId,
    departmentId: input.targetDepartmentId,
  });
  const department = ticket.regionId
    ? await prisma.department.findFirst({
        where: {
          name: input.targetDept,
          OR: [{ regionId: ticket.regionId }, { regionId: null }],
        },
      })
    : await prisma.department.findFirst({
        where: { name: input.targetDept },
      });

  if (!assignment) {
    throw new Error("目标部门不存在");
  }

  // 检查目标部门在工单所属区域是否有可用用户，没有则兜底到"其他部门"
  void department;
  let actualTargetDept = assignment.department.name;
  if (input.targetDept !== FALLBACK_DEPARTMENT_NAME && ticket.regionId) {
    const targetRegionDept = await prisma.department.findFirst({
      where: { name: input.targetDept, regionId: ticket.regionId },
      select: { id: true },
    });
    if (targetRegionDept) {
      const userCount = await prisma.user.count({
        where: { departmentId: targetRegionDept.id, role: "department", enabled: true },
      });
      if (userCount === 0) {
        actualTargetDept = assignment.department.name;
      }
    }
  }

  const targetLabel = `${actualTargetDept}（${assignment.user.displayName}）`;

  const updated = await prisma.ticket.update({
    where: { id: input.ticketId },
    data: {
      status: "processing",
      escalatedAt: new Date(),
      escalatedToDept: actualTargetDept,
      escalatedToUserId: assignment.user.id,
      claimedByUserId: assignment.user.id,
    },
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId: input.ticketId,
      senderRole: "system",
      messageType: "system",
      content: `${input.senderDisplayName} 已将工单转派至${targetLabel}。`,
    },
  });

  await broadcastTicketNotification({
    type: "ticket_escalated",
    title: "工单已转派",
    message: `工单 ${ticket.ticketNo} 已转派至${targetLabel}：${ticket.title}`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetRoles: undefined,
    targetUserIds: [assignment.user.id],
  });

  return updated;
}

export async function submitResolution(input: {
  ticketId: string;
  userId: string;
  resolutionText: string;
}) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
  });

  if (!ticket) {
    throw new Error("工单不存在");
  }

  if (ticket.status === "closed") {
    throw new Error("工单已关闭");
  }

  if (ticket.claimedByUserId !== input.userId) {
    throw new Error("只有当前认领人可以提交处理方案");
  }

  const updated = await prisma.ticket.update({
    where: { id: input.ticketId },
    data: {
      resolutionText: input.resolutionText,
      resolutionSubmittedAt: new Date(),
      resolutionSubmittedByUserId: input.userId,
    },
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId: input.ticketId,
      senderRole: "system",
      messageType: "system",
      content: "处理方案已提交，等待药店工作人员确认关闭。",
    },
  });

  await broadcastTicketNotification({
    type: "ticket_resolution_submitted",
    title: "工单处理方案已提交",
    message: `工单 ${ticket.ticketNo} 的处理方案已提交，等待确认关闭`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetUserIds: [ticket.createdByUserId],
  });

  return updated;
}

export async function resolveTicket(input: { ticketId: string; resolvedByUserId: string }) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
  });

  if (!ticket) {
    throw new Error("工单不存在");
  }

  if (ticket.status === "closed") {
    throw new Error("工单已关闭");
  }

  if (ticket.status === "resolved") {
    throw new Error("工单已确认解决");
  }

  if (ticket.createdByUserId !== input.resolvedByUserId) {
    throw new Error("只有提交工单的药店工作人员可以确认问题已解决");
  }

  if (!ticket.resolutionText || !ticket.resolutionSubmittedAt) {
    throw new Error("确认解决前需要部门人员先提交处理方案");
  }

  const updated = await prisma.ticket.update({
    where: { id: input.ticketId },
    data: {
      status: "resolved",
    },
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId: input.ticketId,
      senderRole: "system",
      messageType: "system",
      content: "药店工作人员已确认问题解决，客服可以整理待入库知识。",
    },
  });

  if (ticket.claimedByUserId) {
    await broadcastTicketNotification({
      type: "ticket_resolved",
      title: "工单问题已确认解决",
      message: `工单 ${ticket.ticketNo} 已确认解决，请整理待入库知识`,
      ticketId: ticket.id,
      ticketNo: ticket.ticketNo,
      targetUserIds: [ticket.claimedByUserId],
    });
  }

  return updated;
}

export async function getTicketKnowledgeMaterials(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: { senderUser: true },
      },
      resolutionSubmittedBy: true,
    },
  });

  if (!ticket) {
    throw new Error("工单不存在");
  }

  const materials: TicketKnowledgeMaterial[] = ticket.messages
    .filter((message) => message.senderRole !== "system")
    .map((message) => {
      const attachments = getAttachmentItems(message.attachments);
      return {
        id: `ticketMessage:${message.id}`,
        source: "ticket" as const,
        messageId: message.id,
        role: message.senderRole,
        sourceType: "ticket" as const,
        roleLabel: message.senderUser?.displayName || roleLabel(message.senderRole),
        sourceLabel: sourceLabel(
          message.senderRole === "assistant"
            ? "llm"
            : message.senderRole === "agent"
              ? "manual"
              : "ticket"
        ),
        contentText: message.content,
        attachments,
        createdAt: message.createdAt,
      } satisfies TicketKnowledgeMaterial;
    });

  // Include the resolution text as a selectable material
  if (ticket.resolutionText && ticket.resolutionSubmittedAt) {
    materials.push({
      id: `ticketResolution:${ticket.id}`,
      source: "ticket" as const,
      messageId: ticket.id,
      role: "agent",
      sourceType: "ticket" as const,
      roleLabel: ticket.resolutionSubmittedBy?.displayName || "部门人员",
      sourceLabel: "处理方案",
      contentText: ticket.resolutionText,
      attachments: [],
      createdAt: ticket.resolutionSubmittedAt,
    });
  }

  return materials;
}

function selectTicketMaterials(
  materials: TicketKnowledgeMaterial[],
  selectedMaterialIds: string[]
) {
  const ids = normalizeMaterialIds(selectedMaterialIds);
  const selected = materials.filter((material) => ids.includes(material.id));
  if (!selected.length) {
    throw new Error("请选择用于入库的有效对话内容");
  }

  const hasQuestion = selected.some(
    (material) => material.role === "user" && material.contentText.trim()
  );
  const hasAnswer = selected.some(
    (material) => material.role !== "user" && material.contentText.trim()
  );
  if (!hasQuestion || !hasAnswer) {
    throw new Error("请至少选择一条用户问题和一条有效回答");
  }

  return selected;
}

export async function generateTicketKnowledgeDraft(input: {
  ticketId: string;
  generatedByUserId: string;
  selectedMaterialIds: string[];
}) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
  });

  if (!ticket) {
    throw new Error("工单不存在");
  }

  if (ticket.status === "closed") {
    throw new Error("工单已关闭，不能重新生成待入库内容");
  }

  if (ticket.status !== "resolved") {
    throw new Error("药店工作人员确认问题解决后，客服才能生成待入库内容");
  }

  const materials = await getTicketKnowledgeMaterials(input.ticketId);
  const selected = selectTicketMaterials(materials, input.selectedMaterialIds);
  const imagePaths = Array.from(
    new Set(selected.flatMap((material) => material.attachments.map((item) => item.path)))
  );
  const modelMaterials: TicketKnowledgeMaterialForModel[] = selected.map((material) => ({
    id: material.id,
    roleLabel: material.roleLabel,
    sourceLabel: material.sourceLabel,
    contentText: material.contentText,
    createdAt: material.createdAt.toISOString(),
    imagePaths: material.attachments.map((item) => item.path),
  }));
  const generated = await generateTicketKnowledgeDraftWithModel({
    ticketNo: ticket.ticketNo,
    title: ticket.title,
    materials: modelMaterials,
  });
  const tags = tagsFromDraft(generated.question, generated.tags);

  const draft = await prisma.$transaction(async (tx) => {
    const created = await tx.ticketKnowledgeDraft.create({
      data: {
        ticketId: ticket.id,
        selectedMaterialsJson: JSON.stringify(selected.map((material) => material.id)),
        question: generated.question,
        answer: generated.answer,
        tagsJson: tags.length ? JSON.stringify(tags) : null,
        imagePathsJson: imagePaths.length ? JSON.stringify(imagePaths) : null,
        generatedByUserId: input.generatedByUserId,
        confirmedAt: new Date(),
      },
      include: { generatedBy: true },
    });

    await tx.ticket.update({
      where: { id: ticket.id },
      data: { knowledgeStatus: "pending_writeback" },
    });

    return created;
  });

  return draft;
}

function extractKbHitInfo(snapshot: string): { knowledgeItemId: string; chunkId: string } | null {
  try {
    const messages = JSON.parse(snapshot) as Array<{
      sourceType?: string;
      retrievalDebugJson?: string;
    }>;
    const kbMessage = [...messages]
      .reverse()
      .find((m) => m.sourceType === "kb" && m.retrievalDebugJson);
    if (!kbMessage || !kbMessage.retrievalDebugJson) return null;
    const debug = JSON.parse(kbMessage.retrievalDebugJson) as {
      debug?: Array<{ knowledgeItemId?: string; chunkId?: string }>;
    };
    const hit = debug.debug?.find((d) => d.knowledgeItemId && d.chunkId);
    if (!hit?.knowledgeItemId || !hit?.chunkId) return null;
    return { knowledgeItemId: hit.knowledgeItemId, chunkId: hit.chunkId };
  } catch {
    return null;
  }
}

export async function deleteTicket(input: {
  ticketId: string;
  userId: string;
  userRole: UserRole;
}) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
  });

  if (!ticket) {
    throw new Error("工单不存在");
  }

  if (input.userRole !== "admin" && ticket.createdByUserId !== input.userId) {
    throw new Error("只有发起人或管理员可以删除工单");
  }

  if (ticket.status !== "pending_claim") {
    throw new Error("只有待认领状态的工单可以删除");
  }

  await prisma.ticket.delete({ where: { id: input.ticketId } });
  return ticket;
}

export async function closeTicketWithKnowledgeWriteback(input: {
  ticketId: string;
  closedByUserId: string;
  closedByRole?: UserRole;
  existingKnowledgeItemId?: string;
}) {
  const existingTicket = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
    include: {
      knowledgeDrafts: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!existingTicket) {
    throw new Error("工单不存在");
  }

  if (existingTicket.status === "closed") {
    throw new Error("工单已关闭");
  }

  const canClose =
    input.closedByRole === "admin" ||
    existingTicket.createdByUserId === input.closedByUserId ||
    existingTicket.claimedByUserId === input.closedByUserId;

  if (!canClose) {
    throw new Error("只有提交工单的药店工作人员、当前部门处理人或管理员可以关闭工单");
  }

  if (existingTicket.status !== "resolved") {
    throw new Error("药店工作人员确认问题解决后才能关闭工单");
  }

  if (!existingTicket.resolutionText) {
    throw new Error("关闭工单需要部门人员先提交处理方案");
  }

  const draft = existingTicket.knowledgeDrafts[0];
  if (!draft || existingTicket.knowledgeStatus !== "pending_writeback") {
    throw new Error("客服尚未生成待入库内容，不能关闭写回知识库");
  }

  const tags = tagsFromDraft(draft.question, JSON.parse(draft.tagsJson || "[]") as string[]);
  const imagePaths = JSON.parse(draft.imagePathsJson || "[]") as string[];

  const kbHitInfo = existingTicket.conversationSnapshot
    ? extractKbHitInfo(existingTicket.conversationSnapshot)
    : null;

  const isOverwrite = Boolean(kbHitInfo);

  const item = isOverwrite
    ? await overwriteKnowledgeItem({
        knowledgeItemId: kbHitInfo!.knowledgeItemId,
        chunkId: kbHitInfo!.chunkId,
        question: draft.question,
        answer: draft.answer,
        tags,
        sourceTicketId: existingTicket.id,
        docType: "manual_ticket",
        imagePath: imagePaths[0] ?? null,
        imagePaths,
      })
    : await upsertQaKnowledgeDocument({
        question: draft.question,
        answer: draft.answer,
        tags,
        sourceType: "manual_ticket",
        sourceTicketId: existingTicket.id,
        docType: "manual_ticket",
        imagePath: imagePaths[0] ?? null,
        imagePaths,
      });

  const writebackMessage = isOverwrite
    ? "工单已关闭，客服改进的答案已更新到知识库。"
    : "工单已关闭，客服生成的优质答案已写回知识库。";

  const ticket = await prisma.$transaction(async (tx) => {
    await tx.ticketKnowledgeDraft.update({
      where: { id: draft.id },
      data: { writtenKnowledgeItemId: item.id },
    });

    const updated = await tx.ticket.update({
      where: { id: input.ticketId },
      data: {
        status: "closed",
        knowledgeStatus: "written",
        closedByUserId: input.closedByUserId,
        closedAt: new Date(),
      },
    });

    await tx.ticketMessage.create({
      data: {
        ticketId: input.ticketId,
        senderRole: "system",
        messageType: "system",
        content: writebackMessage,
      },
    });

    return updated;
  });

  if (ticket.conversationId) {
    await appendConversationMessage({
      conversationId: ticket.conversationId,
      role: "system",
      sourceType: "system",
      contentText: writebackMessage,
    });
  }

  await broadcastTicketNotification({
    type: "ticket_closed",
    title: "工单已关闭",
    message: `工单 ${ticket.ticketNo} 已完成处理并写回知识库`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetRoles: ["department"],
    targetUserIds: [ticket.createdByUserId, ticket.claimedByUserId].filter(Boolean) as string[],
  });

  return ticket;
}

export { getPendingTicketCounts };
