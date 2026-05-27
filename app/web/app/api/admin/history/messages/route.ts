import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const messages = await prisma.chatMessage.findMany({
    include: {
      conversation: {
        include: { user: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ messages });
}
