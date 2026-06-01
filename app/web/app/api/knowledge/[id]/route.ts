import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import {
  deleteKnowledgeItem,
  getKnowledgeItemDetail,
  updateKnowledgeItem,
} from "@/lib/services/knowledge";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "只有管理员可以管理知识库" }, { status: 403 });
  }

  const { id } = await params;
  const item = await getKnowledgeItemDetail(id);

  if (!item) {
    return NextResponse.json({ error: "知识条目不存在" }, { status: 404 });
  }

  return NextResponse.json({ item });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "只有管理员可以管理知识库" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { question, answer, imagePaths, status } = body as {
    question?: string;
    answer?: string;
    imagePaths?: string[];
    status?: "draft" | "published" | "archived";
  };

  if (!question?.trim() || !answer?.trim()) {
    return NextResponse.json({ error: "问题和答案不能为空" }, { status: 400 });
  }

  const item = await updateKnowledgeItem(id, {
    question: question.trim(),
    answer: answer.trim(),
    imagePaths: imagePaths ?? [],
    status,
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
  if (user.role !== "admin") {
    return NextResponse.json({ error: "只有管理员可以管理知识库" }, { status: 403 });
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
