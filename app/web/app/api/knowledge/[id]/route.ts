import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { COLLECTION_NAME, qdrant } from "@/lib/retrieval/qdrant";
import { updateKnowledgeItem } from "@/lib/services/knowledge";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { categoryL1, categoryL2, question, answer, imagePaths } = body as {
    categoryL1?: string;
    categoryL2?: string;
    question?: string;
    answer?: string;
    imagePaths?: string[];
  };

  if (!question?.trim() || !answer?.trim()) {
    return NextResponse.json({ error: "问题和答案不能为空" }, { status: 400 });
  }

  const item = await updateKnowledgeItem(id, {
    categoryL1: categoryL1 || "手动录入",
    categoryL2: categoryL2 || "手动新增",
    question: question.trim(),
    answer: answer.trim(),
    imagePaths: imagePaths ?? []
  });

  return NextResponse.json({ ok: true, item: { id: item.id } });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;

  const item = await prisma.knowledgeItem.findUnique({
    where: { id },
    include: { chunks: true }
  });

  if (!item) {
    return NextResponse.json({ error: "知识条目不存在" }, { status: 404 });
  }

  // 删除 Qdrant 中的向量点
  const pointIds = item.chunks.map((chunk) => chunk.qdrantPointId);
  if (pointIds.length) {
    try {
      await qdrant.delete(COLLECTION_NAME, {
        wait: true,
        points: pointIds
      });
    } catch {
      // Qdrant 点可能已不存在
    }
  }

  // 删除数据库记录（级联删除 chunks）
  await prisma.knowledgeItem.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
