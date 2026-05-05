import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const themeSchema = z.object({
  theme: z.enum(["blue", "light"])
});

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const parsed = themeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "主题参数不合法" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { sidebarTheme: parsed.data.theme }
  });

  return NextResponse.json({ theme: parsed.data.theme });
}
