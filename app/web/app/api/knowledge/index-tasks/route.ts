import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const documentId = searchParams.get("documentId");
  const status = searchParams.get("status");

  const where: Record<string, unknown> = {};
  if (status && status !== "all") {
    where.status = status;
  }
  if (documentId) {
    const chunkIds = await prisma.knowledgeChunk.findMany({
      where: { documentId },
      select: { id: true },
    });
    where.chunkId = { in: chunkIds.map((c) => c.id) };
  }

  const [tasks, statusCounts] = await Promise.all([
    prisma.knowledgeIndexTask.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        taskType: true,
        status: true,
        knowledgeItemId: true,
        chunkId: true,
        retryCount: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.knowledgeIndexTask.groupBy({
      by: ["status"],
      _count: { status: true },
    }),
  ]);

  return NextResponse.json({
    tasks,
    summary: Object.fromEntries(statusCounts.map((item) => [item.status, item._count.status])),
  });
}
