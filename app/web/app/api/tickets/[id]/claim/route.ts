import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { claimTicket } from "@/lib/services/tickets";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "agent") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const { id } = await context.params;
  try {
    const ticket = await claimTicket({
      ticketId: id,
      userId: user.id,
      userDisplayName: user.displayName
    });
    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "认领失败";
    if (message.includes("Record to update not found") || message.includes("工单已被") || message.includes("No record was found")) {
      return NextResponse.json({ error: "工单已被其他人认领" }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
