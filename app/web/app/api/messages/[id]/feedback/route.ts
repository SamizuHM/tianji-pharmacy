import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as { feedback?: "helpful" | "unhelpful" | null };

  if (body.feedback && !["helpful", "unhelpful"].includes(body.feedback)) {
    return NextResponse.json({ error: "反馈类型不正确" }, { status: 400 });
  }

  const message = await prisma.chatMessage.findUnique({
    where: { id },
    include: { conversation: true }
  });

  if (!message || message.role !== "assistant") {
    return NextResponse.json({ error: "消息不存在" }, { status: 404 });
  }

  if (user.role === "staff" && message.conversation.userId !== user.id) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const updated = await prisma.chatMessage.update({
    where: { id },
    data: {
      feedback: body.feedback ?? null
    }
  });

  return NextResponse.json({ message: updated });
}
