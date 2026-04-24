import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getTicketDetail } from "@/lib/services/tickets";

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

  return NextResponse.json({ ticket });
}

