import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { canAccessTicket, deleteTicket, getTicketDetail } from "@/lib/services/tickets";

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

  if (
    !canAccessTicket({
      role: user.role,
      userId: user.id,
      userDepartmentName: user.department?.name ?? null,
      userRegionId: user.regionId ?? null,
      ticket,
    })
  ) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  return NextResponse.json({ ticket });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    await deleteTicket({ ticketId: id, userId: user.id, userRole: user.role });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除失败" },
      { status: 400 }
    );
  }
}
