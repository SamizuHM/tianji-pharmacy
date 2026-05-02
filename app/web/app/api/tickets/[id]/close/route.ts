import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { closeTicketWithKnowledgeWriteback } from "@/lib/services/tickets";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "staff") {
    return NextResponse.json({ error: "只有药店工作人员可以关闭工单" }, { status: 403 });
  }

  const { id } = await context.params;

  try {
    const ticket = await closeTicketWithKnowledgeWriteback({
      ticketId: id,
      closedByUserId: user.id
    });
    return NextResponse.json({ ticket });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "关闭失败" }, { status: 400 });
  }
}
