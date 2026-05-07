import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { createAssistantGenerationStream } from "@/lib/services/chat-generation";
import { getAttachmentItems } from "@/lib/utils";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as { contentText?: string };
  const contentText = body.contentText?.trim() ?? "";

  const userMessage = await prisma.chatMessage.findUnique({
    where: { id },
    include: { conversation: true }
  });

  if (!userMessage || userMessage.conversation.deletedAt || userMessage.role !== "user") {
    return NextResponse.json({ error: "用户消息不存在" }, { status: 404 });
  }

  if (user.role === "staff" && userMessage.conversation.userId !== user.id) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  if (userMessage.status === "streaming") {
    return NextResponse.json({ error: "消息正在生成，不能编辑" }, { status: 409 });
  }

  const attachments = getAttachmentItems(userMessage.attachmentsJson);
  if (!contentText && attachments.length === 0) {
    return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
  }

  const streamingCount = await prisma.chatMessage.count({
    where: {
      conversationId: userMessage.conversationId,
      role: "assistant",
      status: "streaming"
    }
  });
  if (streamingCount > 0) {
    return NextResponse.json({ error: "当前有回复正在生成，请稍后再编辑" }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.chatMessage.update({
      where: { id: userMessage.id },
      data: {
        contentText: contentText || "用户上传了图片"
      }
    }),
    prisma.chatMessage.deleteMany({
      where: {
        conversationId: userMessage.conversationId,
        createdAt: { gt: userMessage.createdAt }
      }
    })
  ]);

  return createAssistantGenerationStream({
    mode: "continue",
    conversationId: userMessage.conversationId,
    text: contentText,
    attachments,
    userMessageId: userMessage.id,
    userMessageCreatedAt: userMessage.createdAt
  });
}
