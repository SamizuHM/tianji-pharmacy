import { NextResponse } from "next/server";

import { FIXED_ASSISTANT_SUFFIX } from "@pharmacy/shared";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { askInConversation, getConversationMessages } from "@/lib/services/conversations";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation || conversation.userId !== user.id) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  const messages = await getConversationMessages(id);
  return NextResponse.json({ messages, fixedSuffix: FIXED_ASSISTANT_SUFFIX });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation || conversation.userId !== user.id) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  const body = (await request.json()) as { text?: string; attachments?: unknown[] };
  const askResult = await askInConversation({
    conversationId: id,
    text: body.text?.trim() ?? "",
    attachments: JSON.stringify(body.attachments ?? [])
  });

  return NextResponse.json({
    conversationId: id,
    assistantMessageId: askResult.assistantMessage.id,
    answer: askResult.assistantMessage.contentText,
    sourceType: askResult.result.sourceType,
    sourceLabel: askResult.result.sourceType === "kb" ? "知识库" : "大模型",
    retrievalDebug: askResult.result.retrievalDebug,
    imagePaths: askResult.result.imagePaths ?? []
  });
}

