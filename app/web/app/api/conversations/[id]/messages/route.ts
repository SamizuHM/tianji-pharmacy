import { NextResponse } from "next/server";

import type { AttachmentItem } from "@pharmacy/shared";
import { FIXED_ASSISTANT_SUFFIX } from "@pharmacy/shared";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { createAssistantGenerationStream } from "@/lib/services/chat-generation";
import { getConversationDetail, getConversationMessages } from "@/lib/services/conversations";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const conversation = await getConversationDetail(id);
  if (!conversation || conversation.userId !== user.id || conversation.deletedAt) {
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
  const conversation = await getConversationDetail(id);
  if (!conversation || conversation.userId !== user.id || conversation.deletedAt) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  const body = (await request.json()) as { text?: string; attachments?: AttachmentItem[] };
  const text = body.text?.trim() ?? "";
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];

  if (!text && attachments.length === 0) {
    return NextResponse.json({ error: "请输入文字或上传图片后再发送" }, { status: 400 });
  }

  // 拒绝在 streaming 期间发新消息
  const streamingCount = await prisma.chatMessage.count({
    where: { conversationId: id, role: "assistant", status: "streaming" },
  });
  if (streamingCount > 0) {
    return NextResponse.json({ error: "当前有回复正在生成，请稍后再发送" }, { status: 409 });
  }

  return createAssistantGenerationStream({
    mode: "create",
    conversationId: id,
    text,
    attachments,
  });
}
