import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { escalateTicket } from "@/lib/services/tickets";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "human_l1") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as { targetDept?: string; targetUserId?: string };

  if (!body.targetDept?.trim()) {
    return NextResponse.json({ error: "请选择升级目标部门" }, { status: 400 });
  }

  try {
    const ticket = await escalateTicket({
      ticketId: id,
      senderUserId: user.id,
      senderDisplayName: user.displayName,
      targetDept: body.targetDept.trim(),
      targetUserId: body.targetUserId?.trim() || undefined
    });
    return NextResponse.json({ ticket });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "升级失败" }, { status: 400 });
  }
}
