import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { failStream, getStaleStreamIds, isStreamActive } from "@/lib/active-streams";
import { prisma } from "@/lib/db";
import { getConversationDetail } from "@/lib/services/conversations";

const STREAM_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟

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

  // 清理超时的流：active-streams 中超时但 DB 仍是 streaming 的消息标记为 failed
  const staleIds = getStaleStreamIds(STREAM_TIMEOUT_MS);
  for (const staleId of staleIds) {
    await prisma.chatMessage
      .update({
        where: { id: staleId },
        data: { status: "failed" },
      })
      .catch(() => undefined);
    failStream(staleId);
  }

  // 查找会话中最后一条 streaming 状态的助手消息
  const streamingMessage = await prisma.chatMessage.findFirst({
    where: {
      conversationId: id,
      role: "assistant",
      status: "streaming",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!streamingMessage) {
    return NextResponse.json({});
  }

  // 检查后端进程是否还在运行
  const active = isStreamActive(streamingMessage.id);

  return NextResponse.json({
    streamingMessageId: streamingMessage.id,
    contentText: streamingMessage.contentText,
    sourceType: streamingMessage.sourceType,
    active,
  });
}
