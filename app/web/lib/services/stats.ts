import dayjs from "dayjs";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

function clampPage(value: number | undefined) {
  return Math.max(1, Number.isFinite(value ?? 1) ? Number(value ?? 1) : 1);
}

function clampPageSize(value: number | undefined) {
  const size = Number.isFinite(value ?? 10) ? Number(value ?? 10) : 10;
  return Math.min(50, Math.max(5, size));
}

export async function getStatsSummary() {
  const [totalQuestions, kbHits, llmAnswers, totalTickets, closedTickets, human1Closed, human2Closed, transferCount] =
    await Promise.all([
      prisma.chatMessage.count({ where: { role: "user" } }),
      prisma.chatMessage.count({ where: { role: "assistant", sourceType: "kb" } }),
      prisma.chatMessage.count({ where: { role: "assistant", sourceType: "llm" } }),
      prisma.ticket.count(),
      prisma.ticket.count({ where: { status: "closed" } }),
      prisma.ticket.count({ where: { status: "closed", closedBy: { role: "human_l1" } } }),
      prisma.ticket.count({ where: { status: "closed", closedBy: { role: "human_l2" } } }),
      prisma.ticket.count()
    ]);

  return {
    totalQuestions,
    kbHits,
    llmAnswers,
    transferCount,
    totalTickets,
    closedTickets,
    human1Closed,
    human2Closed,
    kbHitRate: totalQuestions ? kbHits / totalQuestions : 0,
    closedRate: totalTickets ? closedTickets / totalTickets : 0
  };
}

export async function getTrendData() {
  const since = dayjs().subtract(6, "day").startOf("day").toDate();
  const messages = await prisma.chatMessage.findMany({
    where: {
      createdAt: {
        gte: since
      }
    },
    select: {
      role: true,
      sourceType: true,
      createdAt: true
    }
  });

  const tickets = await prisma.ticket.findMany({
    where: {
      createdAt: {
        gte: since
      }
    },
    select: {
      createdAt: true,
      status: true,
      closedAt: true
    }
  });

  const days = Array.from({ length: 7 }, (_, index) => dayjs().subtract(6 - index, "day").format("MM-DD"));

  return days.map((day) => {
    const questionCount = messages.filter((item) => item.role === "user" && dayjs(item.createdAt).format("MM-DD") === day).length;
    const kbHitCount = messages.filter(
      (item) => item.role === "assistant" && item.sourceType === "kb" && dayjs(item.createdAt).format("MM-DD") === day
    ).length;
    const llmAnswerCount = messages.filter(
      (item) => item.role === "assistant" && item.sourceType === "llm" && dayjs(item.createdAt).format("MM-DD") === day
    ).length;
    const ticketCreatedCount = tickets.filter((item) => dayjs(item.createdAt).format("MM-DD") === day).length;
    const ticketClosedCount = tickets.filter((item) => item.closedAt && dayjs(item.closedAt).format("MM-DD") === day).length;

    return {
      day,
      questionCount,
      kbHitCount,
      llmAnswerCount,
      ticketCreatedCount,
      ticketClosedCount
    };
  });
}

export async function listHistoryMessages(params: { q?: string; page?: number; pageSize?: number } = {}) {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const q = params.q?.trim();
  const where: Prisma.ChatMessageWhereInput = q
    ? {
        OR: [
          { contentText: { contains: q } },
          { conversation: { title: { contains: q } } },
          { conversation: { user: { displayName: { contains: q } } } }
        ]
      }
    : {};

  const [items, total] = await Promise.all([
    prisma.chatMessage.findMany({
      where,
      include: {
        conversation: {
          include: { user: true }
        }
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.chatMessage.count({ where })
  ]);

  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function listHistoryTickets(params: { q?: string; page?: number; pageSize?: number } = {}) {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const q = params.q?.trim();
  const where: Prisma.TicketWhereInput = q
    ? {
        OR: [
          { ticketNo: { contains: q } },
          { title: { contains: q } },
          { latestUserQuestion: { contains: q } },
          { category: { contains: q } },
          { createdBy: { displayName: { contains: q } } }
        ]
      }
    : {};

  const [items, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: { createdBy: true, closedBy: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.ticket.count({ where })
  ]);

  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
