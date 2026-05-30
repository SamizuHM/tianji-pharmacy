import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { deleteManagedUser, updateManagedUser } from "@/lib/services/users";

const userSchema = z.object({
  username: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  password: z.string().optional(),
  role: z.enum(["staff", "department", "admin"]),
  departmentId: z.string().nullable().optional(),
  cityName: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const parsed = userSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "用户参数不合法" }, { status: 400 });
  }

  try {
    const { id } = await context.params;
    const updated = await updateManagedUser(id, parsed.data);
    return NextResponse.json({ user: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新用户失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const { id } = await context.params;
  if (id === user.id) {
    return NextResponse.json({ error: "不能删除当前登录账号" }, { status: 400 });
  }

  try {
    await deleteManagedUser(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除用户失败" },
      { status: 400 }
    );
  }
}
