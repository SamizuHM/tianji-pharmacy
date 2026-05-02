import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { submitResolution } from "@/lib/services/tickets";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "agent") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as { resolutionText?: string };

  if (!body.resolutionText?.trim()) {
    return NextResponse.json({ error: "请填写处理方案" }, { status: 400 });
  }

  try {
    const ticket = await submitResolution({
      ticketId: id,
      userId: user.id,
      resolutionText: body.resolutionText.trim()
    });
    return NextResponse.json({ ticket });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "提交失败" }, { status: 400 });
  }
}
