import { getCurrentUser } from "@/lib/auth/session";
import { createNotificationStream } from "@/lib/notifications/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("未登录", { status: 401 });
  }

  const stream = await createNotificationStream({
    userId: user.id,
    role: user.role
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
