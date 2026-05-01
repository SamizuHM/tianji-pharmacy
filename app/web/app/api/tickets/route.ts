import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { createTicketFromConversation, listTickets, type TicketStatusGroup } from "@/lib/services/tickets";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") as
    | "pending_l1"
    | "processing_l1"
    | "pending_l2"
    | "processing_l2"
    | "closed"
    | "all"
    | null;
  const statusGroup = searchParams.get("statusGroup") as TicketStatusGroup | null;
  const assignee = searchParams.get("assignee") as "human_l1" | "human_l2" | "all" | null;

  const result = await listTickets({
    role: user.role,
    userId: user.id,
    status: status ?? "all",
    statusGroup: statusGroup ?? "all",
    assignee: assignee ?? "all",
    q: searchParams.get("q") ?? undefined,
    page: Number(searchParams.get("page") ?? 1),
    pageSize: Number(searchParams.get("pageSize") ?? 10)
  });

  return NextResponse.json(result);
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
