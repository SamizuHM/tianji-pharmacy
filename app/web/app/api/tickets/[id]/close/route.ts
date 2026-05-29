import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { closeTicketWithKnowledgeWriteback } from "@/lib/services/tickets";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "staff" && user.role !== "department" && user.role !== "admin")) {
    return NextResponse.json(
      { error: "只有药店工作人员、部门人员或管理员可以关闭工单" },
      { status: 403 }
    );
  }

  const { id } = await context.params;

  let existingKnowledgeItemId: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    if (body.existingKnowledgeItemId && typeof body.existingKnowledgeItemId === "string") {
      existingKnowledgeItemId = body.existingKnowledgeItemId;
    }
  } catch {
    // no body or invalid JSON — default to create new
  }

  try {
    const ticket = await closeTicketWithKnowledgeWriteback({
      ticketId: id,
      closedByUserId: user.id,
      closedByRole: user.role,
      existingKnowledgeItemId,
    });
    return NextResponse.json({ ticket });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "关闭失败" },
      { status: 400 }
    );
  }
}
