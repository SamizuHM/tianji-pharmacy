import { MessageRole, Prisma, TicketStatus, UserRole } from "@prisma/client";

import { prisma } from "@/lib/db";
import { broadcastTicketNotification, getPendingTicketCounts } from "@/lib/notifications/server";
import { writeTicketResolutionToKnowledge } from "@/lib/services/knowledge";
import { buildTicketNo, truncateText } from "@/lib/utils";

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

  if (!latestUser || !latestAssistant) {
    throw new Error("当前会话缺少可用于转人工的问答内容");
  }

  const title = truncateText(latestUser.contentText, 32);
  const conversationSnapshot = messages
    .reverse()
    .map((item) => `${item.role}: ${item.contentText}`)
    .join("\n");

  const ticket = await prisma.ticket.create({
    data: {
      ticketNo: buildTicketNo(),
      status: "pending_l1",
      currentAssigneeRole: "human_l1",
      createdByUserId: input.createdByUserId,
      conversationId: input.conversationId,
      title,
      latestUserQuestion: latestUser.contentText,
      inputMode: latestUser.attachmentsJson ? (latestUser.contentText ? "mixed" : "image") : "text",
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
        messageType: latestUser.attachmentsJson ? "image" : "text",
        content: latestUser.contentText,
        attachments: latestUser.attachmentsJson ?? undefined
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

export async function listTickets(params: {
  role: UserRole;
  userId: string;
  status?: TicketStatus | "all";
}) {
  const where: Prisma.TicketWhereInput =
    params.role === "staff"
      ? { createdByUserId: params.userId }
      : params.role === "human_l1"
        ? { OR: [{ currentAssigneeRole: "human_l1" }, { status: "closed" }] }
        : { currentAssigneeRole: "human_l2" };

  return prisma.ticket.findMany({
    where: {
      ...where,
      ...(params.status && params.status !== "all" ? { status: params.status } : {})
    },
    include: {
      createdBy: true,
      closedBy: true
    },
    orderBy: { updatedAt: "desc" }
  });
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

  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId }
  });
  if (ticket) {
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
  }

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
      currentAssigneeRole: "human_l2"
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
}) {
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
        messageType: "text",
        content: input.resolutionText
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
    await prisma.chatMessage.create({
      data: {
        conversationId: ticket.conversationId,
        role: input.senderRole,
        sourceType: "manual",
        contentText: input.resolutionText
      }
    });
  }

  await writeTicketResolutionToKnowledge({
    ticketId: ticket.id,
    question: ticket.latestUserQuestion,
    contextSummary: ticket.conversationSnapshot,
    resolution: input.resolutionText
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
