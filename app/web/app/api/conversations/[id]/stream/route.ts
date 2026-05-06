import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getConversationDetail } from "@/lib/services/conversations";
import { subscribeStream } from "@/lib/active-streams";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const conversation = await getConversationDetail(id);
  if (!conversation || conversation.userId !== user.id || conversation.deletedAt) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  const messageId = new URL(request.url).searchParams.get("messageId");
  if (!messageId) {
    return NextResponse.json({ error: "缺少 messageId" }, { status: 400 });
  }

  const subscription = subscribeStream(messageId);
  if (!subscription) {
    // 流已经不存在（可能已完成或超时），返回空流
    return new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
        controller.close();
      }
    }), {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform"
      }
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // 先发送已有的 buffer 内容
      for (const delta of subscription.existingDeltas) {
        controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: delta })}\n\n`));
      }

      // 订阅后续 delta
      subscription.onDelta((delta) => {
        try {
          controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: delta })}\n\n`));
        } catch {
          // 客户端断开
        }
      });

      subscription.onDone(() => {
        try {
          controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
          controller.close();
        } catch {
          // 已关闭
        }
      });
    },
    cancel() {
      subscription.unsubscribe();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform"
    }
  });
}
