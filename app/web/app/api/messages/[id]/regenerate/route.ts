import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { createAssistantGenerationStream } from "@/lib/services/chat-generation";
import { getAttachmentItems } from "@/lib/utils";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const assistantMessage = await prisma.chatMessage.findUnique({
    where: { id },
    include: { conversation: true }
  });

  if (!assistantMessage || assistantMessage.conversation.deletedAt || assistantMessage.role !== "assistant") {
    return NextResponse.json({ error: "助手消息不存在" }, { status: 404 });
  }

  if (user.role === "staff" && assistantMessage.conversation.userId !== user.id) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  if (assistantMessage.status === "streaming") {
    return NextResponse.json({ error: "当前消息正在生成" }, { status: 409 });
  }

  const streamingCount = await prisma.chatMessage.count({
    where: {
      conversationId: assistantMessage.conversationId,
      role: "assistant",
      status: "streaming"
    }
  });
  if (streamingCount > 0) {
    return NextResponse.json({ error: "当前有回复正在生成，请稍后再重新生成" }, { status: 409 });
  }

  const userMessage = await prisma.chatMessage.findFirst({
    where: {
      conversationId: assistantMessage.conversationId,
      role: "user",
      createdAt: { lte: assistantMessage.createdAt }
    },
    orderBy: { createdAt: "desc" }
  });

  if (!userMessage) {
    return NextResponse.json({ error: "未找到可用于重新生成的用户问题" }, { status: 400 });
  }

  return createAssistantGenerationStream({
    mode: "regenerate",
    conversationId: assistantMessage.conversationId,
    text: userMessage.contentText === "用户上传了图片" ? "" : userMessage.contentText,
    attachments: getAttachmentItems(userMessage.attachmentsJson),
    userMessageId: userMessage.id,
    userMessageCreatedAt: userMessage.createdAt,
    assistantMessageId: assistantMessage.id
  });
}
