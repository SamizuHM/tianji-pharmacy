import { FIXED_ASSISTANT_SUFFIX } from "@pharmacy/shared";

import { prisma } from "@/lib/db";
import { retrieveAnswer } from "@/lib/services/retrieval";
import { truncateText } from "@/lib/utils";

export async function createConversation(userId: string, initialQuestion?: string) {
  return prisma.conversation.create({
    data: {
      userId,
      title: truncateText(initialQuestion || "新会话", 30)
    }
  });
}

export async function getConversationList(userId: string) {
  return prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" }
  });
}

export async function getConversationMessages(conversationId: string) {
  return prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" }
  });
}

export async function askInConversation(input: {
  conversationId: string;
  text: string;
  attachments: string;
}) {
  const attachments = JSON.parse(input.attachments) as Array<{ path: string }>;
  const inputMode = input.text && attachments.length ? "mixed" : input.text ? "text" : "image";

  const userMessage = await prisma.chatMessage.create({
    data: {
      conversationId: input.conversationId,
      role: "user",
      sourceType: "system",
      contentText: input.text || "用户上传了图片",
      attachmentsJson: input.attachments
    }
  });

  const result = await retrieveAnswer({
    conversationId: input.conversationId,
    question: input.text,
    imagePaths: attachments.map((item) => item.path)
  });

  const assistantText = `${result.answer}\n\n${FIXED_ASSISTANT_SUFFIX}`;

  const assistantMessage = await prisma.chatMessage.create({
    data: {
      conversationId: input.conversationId,
      role: "assistant",
      sourceType: result.sourceType,
      contentText: assistantText,
      retrievalDebugJson: JSON.stringify(result.retrievalDebug)
    }
  });

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: {
      title: truncateText(input.text || "图片问题", 30)
    }
  });

  return {
    userMessage,
    assistantMessage,
    inputMode,
    result
  };
}

