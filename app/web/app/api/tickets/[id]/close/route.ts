import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { closeTicket } from "@/lib/services/tickets";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "human_l1" && user.role !== "human_l2")) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as { resolutionText?: string };

  if (!body.resolutionText?.trim()) {
    return NextResponse.json({ error: "请填写处理结论" }, { status: 400 });
  }

  const ticket = await closeTicket({
    ticketId: id,
    senderRole: user.role,
    senderUserId: user.id,
    resolutionText: body.resolutionText.trim()
  });

  return NextResponse.json({ ticket });
}

