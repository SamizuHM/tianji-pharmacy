import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { createConversation, getConversationList } from "@/lib/services/conversations";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const conversations = await getConversationList(user.id);
  return NextResponse.json({ conversations });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = (await request.json()) as { title?: string };
  const conversation = await createConversation(user.id, body.title);
  return NextResponse.json({ conversation });
}
