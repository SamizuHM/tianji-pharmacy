import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const themeSchema = z.object({
  theme: z.enum(["blue", "light"]).optional(),
  colorMode: z.enum(["light", "dark", "system"]).optional(),
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

  if (!parsed.data.theme && !parsed.data.colorMode) {
    return NextResponse.json({ error: "没有可更新的主题参数" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(parsed.data.theme ? { sidebarTheme: parsed.data.theme } : {}),
      ...(parsed.data.colorMode ? { colorMode: parsed.data.colorMode } : {}),
    },
  });

  return NextResponse.json(parsed.data);
}
