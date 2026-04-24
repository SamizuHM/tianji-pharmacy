import dayjs from "dayjs";

import { prisma } from "@/lib/db";

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
    human2Closed
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
    const ticketCreatedCount = tickets.filter((item) => dayjs(item.createdAt).format("MM-DD") === day).length;
    const ticketClosedCount = tickets.filter((item) => item.closedAt && dayjs(item.closedAt).format("MM-DD") === day).length;

    return {
      day,
      questionCount,
      kbHitCount,
      ticketCreatedCount,
      ticketClosedCount
    };
  });
}

