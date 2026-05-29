import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { createSession, roleHome } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  let body: { username?: string; password?: string };

  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "请求数据格式错误" }, { status: 400 });
  }

  if (!body.username || !body.password) {
    return NextResponse.json({ error: "用户名和密码不能为空" }, { status: 400 });
  }

  let user;
  try {
    user = await prisma.user.findUnique({
      where: { username: body.username },
    });
  } catch (error) {
    console.error("[auth] login database unavailable", error);
    return NextResponse.json({ error: "登录服务暂时不可用，请确认数据库已启动" }, { status: 503 });
  }

  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }

  if (user.enabled === false) {
    return NextResponse.json({ error: "账号已被禁用，请联系管理员" }, { status: 403 });
  }

  try {
    await createSession(user.id);
  } catch (error) {
    console.error("[auth] create session failed", error);
    return NextResponse.json({ error: "登录会话创建失败，请稍后重试" }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    role: user.role,
    redirectTo: roleHome(user.role),
  });
}
