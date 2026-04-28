import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { deleteKnowledgeItem, updateKnowledgeItem } from "@/lib/services/knowledge";

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

  try {
    await deleteKnowledgeItem(id);
  } catch (error) {
    if (error instanceof Error && error.message === "知识条目不存在") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  return NextResponse.json({ ok: true });
}
