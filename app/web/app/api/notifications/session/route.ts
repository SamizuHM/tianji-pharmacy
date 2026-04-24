import { NextResponse } from "next/server";

import { getCurrentUser, getSessionToken } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { ensureNotificationServer } from "@/lib/notifications/server";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  const token = await getSessionToken();
  if (!user || !token) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  await ensureNotificationServer();

  const url = new URL(request.url);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${url.hostname}:${env.NOTIFICATION_WS_PORT}?token=${encodeURIComponent(token)}`;

  return NextResponse.json({
    wsUrl,
    role: user.role
  });
}
