import { NextRequest, NextResponse } from "next/server";

import { KnowledgeIndexTaskStatus } from "@prisma/client";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { tryDrainKnowledgeIndexTasks } from "@/lib/services/knowledge-index";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { taskIds } = await request.json();
  if (!Array.isArray(taskIds) || !taskIds.length) {
    return NextResponse.json({ error: "请提供要重试的任务 ID" }, { status: 400 });
  }

  const result = await prisma.knowledgeIndexTask.updateMany({
    where: {
      id: { in: taskIds },
      status: KnowledgeIndexTaskStatus.failed,
    },
    data: {
      status: KnowledgeIndexTaskStatus.pending,
      retryCount: 0,
      lastError: null,
      availableAt: new Date(),
    },
  });

  await tryDrainKnowledgeIndexTasks({ limit: Math.max(20, result.count * 2) });

  return NextResponse.json({ retried: result.count });
}
