import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { createManagedUser, listManagedUsers } from "@/lib/services/users";

const userSchema = z.object({
  username: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  password: z.string().optional(),
  role: z.enum(["staff", "department", "admin"]),
  departmentId: z.string().nullable().optional(),
  regionId: z.string().min(1, "区域不能为空"),
  enabled: z.boolean().optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  return NextResponse.json({ users: await listManagedUsers() });
}

export async function POST(request: Request) {
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
    const created = await createManagedUser(parsed.data);
    return NextResponse.json({ user: created });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建用户失败" },
      { status: 400 }
    );
  }
}
