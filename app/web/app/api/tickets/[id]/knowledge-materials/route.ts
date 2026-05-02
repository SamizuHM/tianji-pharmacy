import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getTicketDetail, getTicketKnowledgeMaterials } from "@/lib/services/tickets";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const ticket = await getTicketDetail(id);
  if (!ticket) {
    return NextResponse.json({ error: "工单不存在" }, { status: 404 });
  }

  if (user.role === "staff" && ticket.createdByUserId !== user.id) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  if (user.role === "agent") {
    const userDepartmentName = user.department?.name ?? null;
    const canAccess =
      ticket.status === "pending_claim" ||
      ticket.status === "closed" ||
      ticket.claimedByUserId === user.id ||
      ticket.escalatedToUserId === user.id ||
      (ticket.status === "escalated" && ticket.escalatedToDept === userDepartmentName);
    if (!canAccess) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }
  }

  const materials = await getTicketKnowledgeMaterials(id);
  return NextResponse.json({ materials });
}
