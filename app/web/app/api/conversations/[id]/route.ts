import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getConversationDetail, softDeleteConversation } from "@/lib/services/conversations";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const conversation = await getConversationDetail(id);
  if (!conversation || conversation.userId !== user.id || conversation.deletedAt) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  await softDeleteConversation({
    conversationId: id,
    userId: user.id,
  });

  return NextResponse.json({ success: true });
}
