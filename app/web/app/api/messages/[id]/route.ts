import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getAttachmentItems, safeJsonParse } from "@/lib/utils";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const message = await prisma.chatMessage.findUnique({
    where: { id },
    include: { conversation: true }
  });

  if (!message || message.conversation.deletedAt) {
    return NextResponse.json({ error: "消息不存在" }, { status: 404 });
  }

  if (user.role === "staff" && message.conversation.userId !== user.id) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  if (message.status === "streaming") {
    return NextResponse.json({ error: "消息正在生成，不能删除" }, { status: 409 });
  }

  await prisma.chatMessage.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as { contentText?: string; imagePaths?: string[] };
  const contentText = body.contentText?.trim() ?? "";

  const message = await prisma.chatMessage.findUnique({
    where: { id },
    include: { conversation: true }
  });

  if (!message || message.conversation.deletedAt) {
    return NextResponse.json({ error: "消息不存在" }, { status: 404 });
  }

  if (user.role === "staff" && message.conversation.userId !== user.id) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  if (message.status === "streaming") {
    return NextResponse.json({ error: "消息正在生成，不能编辑" }, { status: 409 });
  }

  const attachments = getAttachmentItems(message.attachmentsJson);
  if (!contentText && message.role !== "assistant" && attachments.length === 0) {
    return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
  }

  let retrievalDebugJson = message.retrievalDebugJson;
  if (message.role === "assistant" && Array.isArray(body.imagePaths)) {
    const debugPayload = safeJsonParse<{
      debug?: Array<{ question: string; sourceFile?: string | null; rerankScore: number }>;
      imagePaths?: string[];
    }>(message.retrievalDebugJson, {});
    retrievalDebugJson = JSON.stringify({
      ...debugPayload,
      imagePaths: body.imagePaths.filter((item) => typeof item === "string")
    });
  }

  const updated = await prisma.chatMessage.update({
    where: { id },
    data: {
      contentText: contentText || (message.role === "user" ? "用户上传了图片" : ""),
      retrievalDebugJson
    }
  });

  return NextResponse.json({ message: updated });
}
