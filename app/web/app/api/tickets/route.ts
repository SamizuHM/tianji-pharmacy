import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { createTicketFromConversation, listTickets } from "@/lib/services/tickets";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") as "pending_l1" | "pending_l2" | "closed" | "all" | null;

  const tickets = await listTickets({
    role: user.role,
    userId: user.id,
    status: status ?? "all"
  });

  return NextResponse.json({ tickets });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = (await request.json()) as { conversationId?: string };
  if (!body.conversationId) {
    return NextResponse.json({ error: "缺少会话编号" }, { status: 400 });
  }

  const ticket = await createTicketFromConversation({
    createdByUserId: user.id,
    conversationId: body.conversationId
  });

  return NextResponse.json({ ticket });
}

