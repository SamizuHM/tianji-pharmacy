import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json({ tickets: [], knowledge: [], conversations: [], messages: [] });
  }

  const ticketRoleWhere =
    user.role === "staff"
      ? { createdByUserId: user.id }
      : {
          OR: [
            ...(user.department ? [] : [{ status: "pending_claim" as const }]),
            { claimedByUserId: user.id },
            ...(user.department
              ? [{ status: "escalated" as const, escalatedToDept: user.department.name }]
              : [{ status: "escalated" as const, escalatedToDept: null, escalatedToUserId: null }]),
            { status: "escalated" as const, escalatedToUserId: user.id },
            { status: "closed" as const },
          ],
        };

  const [tickets, knowledge, conversations, messages] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        AND: [
          ticketRoleWhere,
          {
            OR: [
              { ticketNo: { contains: q } },
              { title: { contains: q } },
              { latestUserQuestion: { contains: q } },
              { category: { contains: q } },
            ],
          },
        ],
      },
      select: {
        id: true,
        ticketNo: true,
        title: true,
        status: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
    prisma.knowledgeItem.findMany({
      where: {
        status: "published",
        OR: [
          { question: { contains: q } },
          { answer: { contains: q } },
          { categoryL1: { contains: q } },
          { categoryL2: { contains: q } },
          { sourceFile: { contains: q } },
        ],
      },
      select: {
        id: true,
        question: true,
        categoryL1: true,
        categoryL2: true,
        hitCount: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
    user.role === "staff"
      ? prisma.conversation.findMany({
          where: {
            userId: user.id,
            deletedAt: null,
            title: { contains: q },
          },
          select: {
            id: true,
            title: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 6,
        })
      : Promise.resolve([]),
    user.role === "staff"
      ? prisma.chatMessage.findMany({
          where: {
            conversation: {
              userId: user.id,
              deletedAt: null,
            },
            contentText: { contains: q },
          },
          select: {
            id: true,
            conversationId: true,
            role: true,
            sourceType: true,
            contentText: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 6,
        })
      : Promise.resolve([]),
  ]);

  return NextResponse.json({ tickets, knowledge, conversations, messages });
}
