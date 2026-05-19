import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { resolveTicket } from "@/lib/services/tickets";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "staff") {
    return NextResponse.json({ error: "只有药店工作人员可以确认问题解决" }, { status: 403 });
  }

  const { id } = await context.params;

  try {
    const ticket = await resolveTicket({
      ticketId: id,
      resolvedByUserId: user.id,
    });
    return NextResponse.json({ ticket });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "确认失败" },
      { status: 400 }
    );
  }
}
