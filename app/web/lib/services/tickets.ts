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
  status?: TicketStatus | "all";
  statusGroup?: TicketStatusGroup;
  assignee?: UserRole | "all";
  q?: string;
  page?: number;
  pageSize?: number;
};

export type TicketListResult = Awaited<ReturnType<typeof listTickets>>;

const statusGroups: Record<Exclude<TicketStatusGroup, "all">, TicketStatus[]> = {
  pending: ["pending_l1", "pending_l2"],
  processing: ["processing_l1", "processing_l2"],
  escalated: ["pending_l2", "processing_l2"],
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

function baseTicketWhere(params: Pick<TicketListParams, "role" | "userId">): Prisma.TicketWhereInput {
  if (params.role === "staff") {
    return { createdByUserId: params.userId };
  }

  if (params.role === "human_l1") {
    return { OR: [{ currentAssigneeRole: "human_l1" }, { status: "closed" }] };
  }

  return { OR: [{ currentAssigneeRole: "human_l2" }, { status: "closed", escalatedAt: { not: null } }] };
}

function buildTicketWhere(params: TicketListParams): Prisma.TicketWhereInput {
  const and: Prisma.TicketWhereInput[] = [baseTicketWhere(params)];
  const q = params.q?.trim();

  if (params.status && params.status !== "all") {
    and.push({ status: params.status });
  } else if (params.statusGroup && params.statusGroup !== "all") {
    and.push({ status: { in: statusGroups[params.statusGroup] } });
  }

  if (params.assignee && params.assignee !== "all") {
    and.push({ currentAssigneeRole: params.assignee });
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
      status: "pending_l1",
      priority: deriveTicketPriority(latestUser.contentText),
      currentAssigneeRole: "human_l1",
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
        content: "系统已创建工单，默认流转至人工处理1。"
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
    message: `工单 ${ticket.ticketNo} 已进入人工处理1待办：${ticket.title}`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetRoles: ["human_l1"]
  });

  return ticket;
}

export async function listTickets(params: TicketListParams) {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const where = buildTicketWhere(params);
  const roleWhere = baseTicketWhere(params);

  const [items, total, all, pending, processing, escalated, closed, human_l1, human_l2] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: {
        createdBy: true,
        closedBy: true
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.ticket.count({ where }),
    prisma.ticket.count({ where: roleWhere }),
    prisma.ticket.count({ where: { AND: [roleWhere, { status: { in: statusGroups.pending } }] } }),
    prisma.ticket.count({ where: { AND: [roleWhere, { status: { in: statusGroups.processing } }] } }),
    prisma.ticket.count({ where: { AND: [roleWhere, { status: { in: statusGroups.escalated } }] } }),
    prisma.ticket.count({ where: { AND: [roleWhere, { status: "closed" }] } }),
    prisma.ticket.count({ where: { AND: [roleWhere, { currentAssigneeRole: "human_l1", status: { not: "closed" } }] } }),
    prisma.ticket.count({ where: { AND: [roleWhere, { currentAssigneeRole: "human_l2", status: { not: "closed" } }] } })
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
      human_l1,
      human_l2
    }
  };
}

export async function getTicketDetail(ticketId: string) {
  return prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      createdBy: true,
      closedBy: true,
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

  if (input.senderRole === "human_l1" || input.senderRole === "human_l2") {
    const nextStatus = input.senderRole === "human_l1" ? "processing_l1" : "processing_l2";
    await prisma.ticket.update({
      where: { id: input.ticketId },
      data: {
        status: nextStatus,
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
    targetRoles: input.senderRole === "user" ? [ticket.currentAssigneeRole] : undefined,
    targetUserIds: input.senderRole === "user" ? undefined : [ticket.createdByUserId]
  });

  return message;
}

export async function escalateTicket(input: {
  ticketId: string;
  senderUserId: string;
}) {
  const ticket = await prisma.ticket.update({
    where: { id: input.ticketId },
    data: {
      status: "pending_l2",
      currentAssigneeRole: "human_l2",
      escalatedAt: new Date()
    }
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId: input.ticketId,
      senderRole: "system",
      messageType: "system",
      content: "系统已将工单升级至人工处理2。"
    }
  });

  await broadcastTicketNotification({
    type: "ticket_escalated_l2",
    title: "工单已升级到人工2",
    message: `工单 ${ticket.ticketNo} 已升级到人工处理2：${ticket.title}`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetRoles: ["human_l2"]
  });

  return ticket;
}

export async function closeTicket(input: {
  ticketId: string;
  senderRole: MessageRole;
  senderUserId: string;
  resolutionText: string;
  attachments?: string;
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

  const ticket = await prisma.ticket.update({
    where: { id: input.ticketId },
    data: {
      status: "closed",
      resolutionText: input.resolutionText,
      closedByUserId: input.senderUserId,
      closedAt: new Date()
    }
  });

  await prisma.ticketMessage.createMany({
    data: [
      {
        ticketId: input.ticketId,
        senderRole: input.senderRole,
        senderUserId: input.senderUserId,
        messageType: input.attachments ? "image" : "text",
        content: input.resolutionText,
        attachments: input.attachments
      },
      {
        ticketId: input.ticketId,
        senderRole: "system",
        messageType: "system",
        content: `工单已由 ${input.senderRole === "human_l1" ? "人工处理1" : "人工处理2"} 关闭，并写回知识库。`
      }
    ]
  });

  if (ticket.conversationId) {
    await appendConversationMessage({
      conversationId: ticket.conversationId,
      role: input.senderRole,
      sourceType: "manual",
      contentText: input.resolutionText,
      attachmentsJson: input.attachments ?? null
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
    resolution: input.resolutionText,
    imagePaths
  });

  await broadcastTicketNotification({
    type: "ticket_closed",
    title: "工单已关闭",
    message: `工单 ${ticket.ticketNo} 已完成处理并关闭`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    targetRoles: ["human_l1", "human_l2"],
    targetUserIds: [ticket.createdByUserId]
  });

  return ticket;
}

export { getPendingTicketCounts };
