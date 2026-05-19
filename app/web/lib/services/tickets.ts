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
  generateTicketKnowledgeDraftWithModel,
  type TicketKnowledgeMaterialForModel,
} from "@/lib/openai";
import { appendConversationMessage } from "@/lib/services/conversations";
import { upsertKnowledgeItem } from "@/lib/services/knowledge";
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
      return "人工客服";
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

export function canAccessTicket(input: {
  role: UserRole;
  userId: string;
  userDepartmentName?: string | null;
  ticket: {
    status: TicketStatus;
    createdByUserId: string;
    claimedByUserId?: string | null;
    escalatedToDept?: string | null;
    escalatedToUserId?: string | null;
  };
}) {
  if (input.role === "staff") {
    return input.ticket.createdByUserId === input.userId;
  }

  if (input.ticket.status === "closed" || input.ticket.claimedByUserId === input.userId) {
    return true;
  }

  if (!input.userDepartmentName && input.ticket.status === "pending_claim") {
    return true;
  }

  if (input.ticket.status !== "escalated") {
    return false;
  }

  if (input.ticket.escalatedToUserId === input.userId) {
    return true;
  }

  if (input.userDepartmentName && input.ticket.escalatedToDept === input.userDepartmentName) {
    return true;
  }

  return (
    !input.userDepartmentName && !input.ticket.escalatedToDept && !input.ticket.escalatedToUserId
  );
}

function baseTicketWhere(
  params: Pick<TicketListParams, "role" | "userId" | "userDepartmentName">
): Prisma.TicketWhereInput {
  if (params.role === "staff") {
    return { createdByUserId: params.userId };
  }

  // 一级客服（无部门）看待认领工单；二级专家只看升级到自己部门/自己的工单。
  const conditions: Prisma.TicketWhereInput[] = [
    { claimedByUserId: params.userId },
    { status: "closed" },
  ];

  if (!params.userDepartmentName) {
    conditions.push({ status: "pending_claim" });
  }

  // escalated tickets visible to target department members or target user
  if (params.userDepartmentName) {
    conditions.push({ status: "escalated", escalatedToDept: params.userDepartmentName });
  }
  conditions.push({ status: "escalated", escalatedToUserId: params.userId });
  // escalated with no specific target (shouldn't happen, but fallback)
  conditions.push({ status: "escalated", escalatedToDept: null, escalatedToUserId: null });

  return { OR: conditions };
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
      status: "pending_claim",
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
    },
  });

  await prisma.ticketMessage.createMany({
    data: [
      {
        ticketId: ticket.id,
        senderRole: "system",
        messageType: "system",
        content: "系统已创建工单，等待人工客服认领。",
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
    title: "收到新的人工工单",
    message: `工单 ${ticket.ticketNo} 待认领：${ticket.title}`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetRoles: ["agent"],
  });

  return ticket;
}

export async function claimTicket(input: {
  ticketId: string;
  userId: string;
  userDisplayName: string;
  userDepartmentName?: string | null;
}) {
  const existing = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
  });

  if (!existing) {
    throw new Error("工单不存在");
  }

  if (existing.status === "pending_claim" && input.userDepartmentName) {
    throw new Error("二级专家客服不能认领待认领工单，请等待一级人工客服升级后处理");
  }

  if (existing.status === "escalated") {
    const matchedUser = existing.escalatedToUserId === input.userId;
    const matchedDept = Boolean(
      input.userDepartmentName && existing.escalatedToDept === input.userDepartmentName
    );
    const untargeted = !existing.escalatedToUserId && !existing.escalatedToDept;
    if (!matchedUser && !matchedDept && !untargeted) {
      throw new Error("当前工单未升级到你的部门或账号，不能认领");
    }
  }

  // Optimistic lock: only claim if status is pending_claim or escalated.
  const ticket = await prisma.ticket.update({
    where: {
      id: input.ticketId,
      status: { in: ["pending_claim", "escalated"] },
    },
    data: {
      status: "processing",
      claimedByUserId: input.userId,
    },
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId: input.ticketId,
      senderRole: "system",
      messageType: "system",
      content: `${input.userDisplayName} 已认领工单。`,
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
  targetUserId?: string;
}) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
  });

  if (!ticket) {
    throw new Error("工单不存在");
  }

  if (ticket.claimedByUserId !== input.senderUserId) {
    throw new Error("只有工单认领人才能升级工单");
  }

  const targetLabel = input.targetUserId ? `${input.targetDept} 的指定人员` : input.targetDept;

  const updated = await prisma.ticket.update({
    where: { id: input.ticketId },
    data: {
      status: "escalated",
      escalatedAt: new Date(),
      escalatedToDept: input.targetDept,
      escalatedToUserId: input.targetUserId ?? null,
      // Clear claim so target can re-claim
      claimedByUserId: null,
    },
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId: input.ticketId,
      senderRole: "system",
      messageType: "system",
      content: `${input.senderDisplayName} 已将工单升级至${targetLabel}。`,
    },
  });

  await broadcastTicketNotification({
    type: "ticket_escalated",
    title: "工单已升级",
    message: `工单 ${ticket.ticketNo} 已升级至${targetLabel}：${ticket.title}`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetRoles: ["agent"],
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
    throw new Error("确认解决前需要人工客服先提交处理方案");
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
    },
  });

  if (!ticket) {
    throw new Error("工单不存在");
  }

  return ticket.messages
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
        categoryL1: generated.categoryL1,
        categoryL2: generated.categoryL2,
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

export async function closeTicketWithKnowledgeWriteback(input: {
  ticketId: string;
  closedByUserId: string;
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
    existingTicket.createdByUserId === input.closedByUserId ||
    existingTicket.claimedByUserId === input.closedByUserId;

  if (!canClose) {
    throw new Error("只有提交工单的药店工作人员或当前处理客服可以关闭工单");
  }

  if (existingTicket.status !== "resolved") {
    throw new Error("药店工作人员确认问题解决后才能关闭工单");
  }

  if (!existingTicket.resolutionText) {
    throw new Error("关闭工单需要人工客服先提交处理方案");
  }

  const draft = existingTicket.knowledgeDrafts[0];
  if (!draft || existingTicket.knowledgeStatus !== "pending_writeback") {
    throw new Error("客服尚未生成待入库内容，不能关闭写回知识库");
  }

  const tags = tagsFromDraft(draft.question, JSON.parse(draft.tagsJson || "[]") as string[]);
  const imagePaths = JSON.parse(draft.imagePathsJson || "[]") as string[];
  const item = await upsertKnowledgeItem({
    categoryL1: draft.categoryL1,
    categoryL2: draft.categoryL2,
    question: draft.question,
    answer: draft.answer,
    tags,
    sourceType: "manual_ticket",
    sourceTicketId: existingTicket.id,
    docType: "manual_ticket",
    imagePath: imagePaths[0] ?? null,
    imagePaths,
    originalText: `${draft.question}\n${draft.answer}`,
    normalizedText: `${draft.question}\n${draft.answer}`,
    chunkTexts: [`问题：${draft.question}\n答案：${draft.answer}`],
  });

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
        content: "工单已关闭，客服生成的优质答案已写回知识库。",
      },
    });

    return updated;
  });

  if (ticket.conversationId) {
    await appendConversationMessage({
      conversationId: ticket.conversationId,
      role: "system",
      sourceType: "system",
      contentText: "工单已关闭，优质答案已写回知识库。",
    });
  }

  await broadcastTicketNotification({
    type: "ticket_closed",
    title: "工单已关闭",
    message: `工单 ${ticket.ticketNo} 已完成处理并写回知识库`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetRoles: ["agent"],
    targetUserIds: [ticket.createdByUserId, ticket.claimedByUserId].filter(Boolean) as string[],
  });

  return ticket;
}

export { getPendingTicketCounts };
