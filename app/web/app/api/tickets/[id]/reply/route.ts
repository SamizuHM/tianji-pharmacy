import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { canAccessTicket, getTicketDetail, replyTicket } from "@/lib/services/tickets";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const ticket = await getTicketDetail(id);
  if (!ticket) {
    return NextResponse.json({ error: "工单不存在" }, { status: 404 });
  }
  if (!canAccessTicket({
    role: user.role,
    userId: user.id,
    userDepartmentName: user.department?.name ?? null,
    ticket
  })) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const body = (await request.json()) as { content?: string; attachments?: unknown[] };
  try {
    const message = await replyTicket({
      ticketId: id,
      senderRole: user.role === "staff" ? "user" : user.role,
      senderUserId: user.id,
      content: body.content?.trim() || "补充了附件说明",
      attachments: body.attachments?.length ? JSON.stringify(body.attachments) : undefined
    });

    return NextResponse.json({ message });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "回复失败" }, { status: 400 });
  }
}
