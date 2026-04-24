import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { replyTicket } from "@/lib/services/tickets";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as { content?: string; attachments?: unknown[] };

  const message = await replyTicket({
    ticketId: id,
    senderRole: user.role === "staff" ? "user" : user.role,
    senderUserId: user.id,
    content: body.content?.trim() || "补充了附件说明",
    attachments: body.attachments?.length ? JSON.stringify(body.attachments) : undefined
  });

  return NextResponse.json({ message });
}

