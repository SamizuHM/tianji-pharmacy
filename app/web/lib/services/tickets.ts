import { MessageRole, Prisma, TicketPriority, TicketStatus, UserRole } from "@prisma/client";

import { prisma } from "@/lib/db";
import { broadcastTicketNotification, getPendingTicketCounts } from "@/lib/notifications/server";
import { appendConversationMessage } from "@/lib/services/conversations";
import { writeTicketResolutionToKnowledge } from "@/lib/services/knowledge";
import { getAttachmentItems, getAttachmentPaths } from "@/lib/utils";
import { buildTicketNo, truncateText } from "@/lib/utils";

export type TicketStatusGroup = "all" | "pending" | "processing" | "escalated" | "closed";

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

const statusGroups: Record<Exclude<TicketStatusGroup, "all">, TicketStatus[]> = {
  pending: ["pending_claim"],
  processing: ["processing"],
  escalated: ["escalated"],
  closed: ["closed"]
};

function clampPage(value: number | undefined) {
  return Math.max(1, Number.isFinite(value ?? 1) ? Number(value ?? 1) : 1);
}

function clampPageSize(value: number | undefined) {
  const size = Number.isFinite(value ?? 10) ? Number(value ?? 10) : 10;
  return Math.min(50, Math.max(5, size));
}

function deriveTags(text: string) {
  return Array.from(new Set(text.split(/[，。；、,\s（）()]+/).map((item) => item.trim()).filter(Boolean))).slice(0, 5);
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

function baseTicketWhere(params: Pick<TicketListParams, "role" | "userId" | "userDepartmentName">): Prisma.TicketWhereInput {
  if (params.role === "staff") {
    return { createdByUserId: params.userId };
  }

  // human_l1: can see pending_claim (to claim), their own claimed, escalated to their dept/person, and closed
  const conditions: Prisma.TicketWhereInput[] = [
    { status: "pending_claim" },
    { claimedByUserId: params.userId },
    { status: "closed" }
  ];

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
        { createdBy: { displayName: { contains: q } } }
      ]
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
    orderBy: { createdAt: "desc" },
    take: 6
  });

  const latestUser = messages.find((item) => item.role === "user");
  const latestAssistant = messages.find((item) => item.role === "assistant");
  const latestUserAttachments = getAttachmentItems(latestUser?.attachmentsJson);

  if (!latestUser || !latestAssistant) {
    throw new Error("当前会话缺少可用于转人工的问答内容");
  }

  const title = truncateText(latestUser.contentText, 32);
  const category = deriveTicketCategory(latestUser.contentText);
  const tags = deriveTags(latestUser.contentText);
  const conversationSnapshot = messages
    .reverse()
    .map((item) => `${item.role}: ${item.contentText}`)
    .join("\n");

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
      inputMode: latestUserAttachments.length ? (latestUser.contentText ? "mixed" : "image") : "text",
      aiAnswerSnapshot: latestAssistant.contentText,
      conversationSnapshot
    }
  });

  await prisma.ticketMessage.createMany({
    data: [
      {
        ticketId: ticket.id,
        senderRole: "system",
        messageType: "system",
        content: "系统已创建工单，等待人工客服认领。"
      },
      {
        ticketId: ticket.id,
        senderRole: "user",
        senderUserId: input.createdByUserId,
        messageType: latestUserAttachments.length ? "image" : "text",
        content: latestUser.contentText,
        attachments: latestUserAttachments.length ? JSON.stringify(latestUserAttachments) : undefined
      }
    ]
  });

  await broadcastTicketNotification({
    type: "ticket_created",
    title: "收到新的人工工单",
    message: `工单 ${ticket.ticketNo} 待认领：${ticket.title}`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetRoles: ["human_l1"]
  });

  return ticket;
}

export async function claimTicket(input: {
  ticketId: string;
  userId: string;
  userDisplayName: string;
}) {
  // Optimistic lock: only claim if status is pending_claim or escalated
  const ticket = await prisma.ticket.update({
    where: {
      id: input.ticketId,
      status: { in: ["pending_claim", "escalated"] }
    },
    data: {
      status: "processing",
      claimedByUserId: input.userId
    }
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId: input.ticketId,
      senderRole: "system",
      messageType: "system",
      content: `${input.userDisplayName} 已认领工单。`
    }
  });

  await broadcastTicketNotification({
    type: "ticket_claimed",
    title: "工单已被认领",
    message: `工单 ${ticket.ticketNo} 已被 ${input.userDisplayName} 认领`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetUserIds: [ticket.createdByUserId]
  });

  return ticket;
}

export async function listTickets(params: TicketListParams) {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const where = buildTicketWhere(params);
  const roleWhere = baseTicketWhere(params);

  const [items, total, all, pending, processing, escalated, closed, myTickets] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: {
        createdBy: true,
        closedBy: true,
        claimedBy: true
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.ticket.count({ where }),
    prisma.ticket.count({ where: roleWhere }),
    prisma.ticket.count({ where: { AND: [roleWhere, { status: "pending_claim" }] } }),
    prisma.ticket.count({ where: { AND: [roleWhere, { status: "processing" }] } }),
    prisma.ticket.count({ where: { AND: [roleWhere, { status: "escalated" }] } }),
    prisma.ticket.count({ where: { AND: [roleWhere, { status: "closed" }] } }),
    prisma.ticket.count({ where: { AND: [roleWhere, { claimedByUserId: params.userId, status: { not: "closed" } }] } })
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
      closed,
      myTickets
    }
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
          senderUser: true
        }
      }
    }
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
    where: { id: input.ticketId }
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
      attachments: input.attachments
    }
  });

  // Transition pending_claim/escalated to processing when a human replies
  if ((input.senderRole === "human_l1" || input.senderRole === "human_l2") &&
      (ticket.status === "pending_claim" || ticket.status === "escalated")) {
    await prisma.ticket.update({
      where: { id: input.ticketId },
      data: {
        status: "processing",
        claimedByUserId: ticket.claimedByUserId ?? input.senderUserId,
        firstRespondedAt: ticket.firstRespondedAt ?? new Date()
      }
    });
  } else if (input.senderRole === "human_l1" || input.senderRole === "human_l2") {
    await prisma.ticket.update({
      where: { id: input.ticketId },
      data: {
        firstRespondedAt: ticket.firstRespondedAt ?? new Date()
      }
    });
  }

  if (ticket.conversationId) {
    await appendConversationMessage({
      conversationId: ticket.conversationId,
      role: input.senderRole,
      sourceType: "manual",
      contentText: input.content,
      attachmentsJson: input.attachments ?? null
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
    targetUserIds: input.senderRole === "user"
      ? (ticket.claimedByUserId ? [ticket.claimedByUserId] : [])
      : [ticket.createdByUserId]
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
    where: { id: input.ticketId }
  });

  if (!ticket) {
    throw new Error("工单不存在");
  }

  if (ticket.claimedByUserId !== input.senderUserId) {
    throw new Error("只有工单认领人才能升级工单");
  }

  const targetLabel = input.targetUserId
    ? `${input.targetDept} 的指定人员`
    : input.targetDept;

  const updated = await prisma.ticket.update({
    where: { id: input.ticketId },
    data: {
      status: "escalated",
      escalatedAt: new Date(),
      escalatedToDept: input.targetDept,
      escalatedToUserId: input.targetUserId ?? null,
      // Clear claim so target can re-claim
      claimedByUserId: null
    }
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId: input.ticketId,
      senderRole: "system",
      messageType: "system",
      content: `${input.senderDisplayName} 已将工单升级至${targetLabel}。`
    }
  });

  await broadcastTicketNotification({
    type: "ticket_escalated",
    title: "工单已升级",
    message: `工单 ${ticket.ticketNo} 已升级至${targetLabel}：${ticket.title}`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetRoles: ["human_l1"]
  });

  return updated;
}

export async function submitResolution(input: {
  ticketId: string;
  userId: string;
  resolutionText: string;
}) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId }
  });

  if (!ticket) {
    throw new Error("工单不存在");
  }

  if (ticket.status === "closed") {
    throw new Error("工单已关闭");
  }

  const updated = await prisma.ticket.update({
    where: { id: input.ticketId },
    data: {
      resolutionText: input.resolutionText,
      resolutionSubmittedAt: new Date(),
      resolutionSubmittedByUserId: input.userId
    }
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId: input.ticketId,
      senderRole: "system",
      messageType: "system",
      content: "处理方案已提交，等待药店工作人员确认关闭。"
    }
  });

  await broadcastTicketNotification({
    type: "ticket_resolution_submitted",
    title: "工单处理方案已提交",
    message: `工单 ${ticket.ticketNo} 的处理方案已提交，等待确认关闭`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetUserIds: [ticket.createdByUserId]
  });

  return updated;
}

export async function closeTicket(input: {
  ticketId: string;
  closedByUserId: string;
  resolutionText?: string;
}) {
  const existingTicket = await prisma.ticket.findUnique({
    where: { id: input.ticketId }
  });

  if (!existingTicket) {
    throw new Error("工单不存在");
  }

  if (existingTicket.status === "closed") {
    throw new Error("工单已关闭");
  }

  const resolutionText = input.resolutionText || existingTicket.resolutionText;
  if (!resolutionText) {
    throw new Error("关闭工单需要处理方案，请等待人工客服提交");
  }

  const ticket = await prisma.ticket.update({
    where: { id: input.ticketId },
    data: {
      status: "closed",
      resolutionText,
      closedByUserId: input.closedByUserId,
      closedAt: new Date()
    }
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId: input.ticketId,
      senderRole: "system",
      messageType: "system",
      content: "药店工作人员已确认关闭工单，处理方案已写回知识库。"
    }
  });

  if (ticket.conversationId) {
    await appendConversationMessage({
      conversationId: ticket.conversationId,
      role: "system",
      sourceType: "system",
      contentText: `工单已关闭。处理方案：${resolutionText}`
    });
  }

  const ticketMessages = await prisma.ticketMessage.findMany({
    where: { ticketId: ticket.id },
    select: { attachments: true }
  });

  const imagePaths = Array.from(
    new Set(ticketMessages.flatMap((message) => getAttachmentPaths(message.attachments)))
  );

  await writeTicketResolutionToKnowledge({
    ticketId: ticket.id,
    question: ticket.latestUserQuestion,
    contextSummary: ticket.conversationSnapshot,
    resolution: resolutionText,
    imagePaths
  });

  await broadcastTicketNotification({
    type: "ticket_closed",
    title: "工单已关闭",
    message: `工单 ${ticket.ticketNo} 已完成处理并关闭`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetRoles: ["human_l1"],
    targetUserIds: [ticket.createdByUserId, ticket.claimedByUserId].filter(Boolean) as string[]
  });

  return ticket;
}

export { getPendingTicketCounts };
