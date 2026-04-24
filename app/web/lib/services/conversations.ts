import { MessageSourceType, MessageRole } from "@prisma/client";

import { prisma } from "@/lib/db";
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
    where: {
      userId,
      deletedAt: null
    },
    orderBy: { updatedAt: "desc" }
  });
}

export async function getConversationDetail(conversationId: string) {
  return prisma.conversation.findUnique({
    where: { id: conversationId }
  });
}

export async function getConversationMessages(conversationId: string) {
  return prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" }
  });
}

export async function appendConversationMessage(input: {
  conversationId: string;
  role: MessageRole;
  sourceType: MessageSourceType;
  contentText: string;
  attachmentsJson?: string | null;
  retrievalDebugJson?: string | null;
}) {
  return prisma.chatMessage.create({
    data: {
      conversationId: input.conversationId,
      role: input.role,
      sourceType: input.sourceType,
      contentText: input.contentText,
      attachmentsJson: input.attachmentsJson ?? null,
      retrievalDebugJson: input.retrievalDebugJson ?? null
    }
  });
}

export async function refreshConversationTitle(conversationId: string, inputText: string) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      title: truncateText(inputText || "图片问题", 30)
    }
  });
}

export async function softDeleteConversation(input: { conversationId: string; userId: string }) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      userId: input.userId,
      deletedAt: null
    }
  });

  if (!conversation) {
    throw new Error("会话不存在");
  }

  return prisma.conversation.update({
    where: { id: input.conversationId },
    data: {
      deletedAt: new Date()
    }
  });
}
