import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { escalateTicket } from "@/lib/services/tickets";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "department") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as { targetDept?: string; targetDepartmentId?: string };

  if (!body.targetDept?.trim()) {
    return NextResponse.json({ error: "请选择转派目标部门" }, { status: 400 });
  }

  try {
    const ticket = await escalateTicket({
      ticketId: id,
      senderUserId: user.id,
      senderDisplayName: user.displayName,
      targetDept: body.targetDept.trim(),
      targetDepartmentId: body.targetDepartmentId?.trim() || null,
      userDepartmentName: user.department?.name ?? null,
    });
    return NextResponse.json({ ticket });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "转派失败" },
      { status: 400 }
    );
  }
}
