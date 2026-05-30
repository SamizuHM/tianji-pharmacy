import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { updateRegion, deleteRegion } from "@/lib/services/regions";

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  code: z.string().trim().optional(),
  description: z.string().trim().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }

  try {
    const { id } = await params;
    const region = await updateRegion(id, parsed.data);
    return NextResponse.json({ region });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新区域失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  try {
    const { id } = await params;
    await deleteRegion(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除区域失败" },
      { status: 400 }
    );
  }
}
