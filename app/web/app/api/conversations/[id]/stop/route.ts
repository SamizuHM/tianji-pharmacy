import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { failStream } from "@/lib/active-streams";
import { prisma } from "@/lib/db";
import { getConversationDetail } from "@/lib/services/conversations";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const conversation = await getConversationDetail(id);
  if (!conversation || conversation.userId !== user.id || conversation.deletedAt) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  const streamingMessage = await prisma.chatMessage.findFirst({
    where: { conversationId: id, role: "assistant", status: "streaming" },
    orderBy: { createdAt: "desc" }
  });

  if (!streamingMessage) {
    return NextResponse.json({ error: "没有正在生成的消息" }, { status: 404 });
  }

  await prisma.chatMessage.update({
    where: { id: streamingMessage.id },
    data: { status: "completed" }
  });

  failStream(streamingMessage.id);

  return NextResponse.json({ messageId: streamingMessage.id });
}
