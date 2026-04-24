import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { createSession, roleHome } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const body = (await request.json()) as { username?: string; password?: string };

  if (!body.username || !body.password) {
    return NextResponse.json({ error: "用户名和密码不能为空" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { username: body.username }
  });

  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }

  await createSession(user.id);

  return NextResponse.json({
    ok: true,
    role: user.role,
    redirectTo: roleHome(user.role)
  });
}

