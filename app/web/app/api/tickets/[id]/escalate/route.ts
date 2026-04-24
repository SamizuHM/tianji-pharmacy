import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { escalateTicket } from "@/lib/services/tickets";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "human_l1") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const { id } = await context.params;
  const ticket = await escalateTicket({
    ticketId: id,
    senderUserId: user.id
  });

  return NextResponse.json({ ticket });
}

