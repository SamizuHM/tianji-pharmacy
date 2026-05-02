import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { generateTicketKnowledgeDraft, getTicketDetail } from "@/lib/services/tickets";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "agent") {
    return NextResponse.json({ error: "只有客服可以生成待入库内容" }, { status: 403 });
  }

  const { id } = await context.params;
  const ticket = await getTicketDetail(id);
  if (!ticket) {
    return NextResponse.json({ error: "工单不存在" }, { status: 404 });
  }
  const userDepartmentName = user.department?.name ?? null;
  const canAccess =
    ticket.status === "pending_claim" ||
    ticket.claimedByUserId === user.id ||
    ticket.escalatedToUserId === user.id ||
    (ticket.status === "escalated" && ticket.escalatedToDept === userDepartmentName);
  if (!canAccess) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const body = (await request.json()) as { selectedMaterialIds?: string[] };
  if (!body.selectedMaterialIds?.length) {
    return NextResponse.json({ error: "请选择有效对话内容" }, { status: 400 });
  }

  try {
    const draft = await generateTicketKnowledgeDraft({
      ticketId: id,
      generatedByUserId: user.id,
      selectedMaterialIds: body.selectedMaterialIds
    });
    return NextResponse.json({ draft });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成失败" }, { status: 400 });
  }
}
