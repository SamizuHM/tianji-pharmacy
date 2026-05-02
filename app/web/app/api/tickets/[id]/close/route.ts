import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { closeTicket } from "@/lib/services/tickets";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "staff") {
    return NextResponse.json({ error: "只有药店工作人员可以关闭工单" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as { resolutionText?: string };

  try {
    const ticket = await closeTicket({
      ticketId: id,
      closedByUserId: user.id,
      resolutionText: body.resolutionText?.trim() || undefined
    });
    return NextResponse.json({ ticket });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "关闭失败" }, { status: 400 });
  }
}
