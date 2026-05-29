import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const updateSchema = z.object({
  regionId: z.string().nullable().optional(),
  description: z.string().trim().optional(),
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
    const department = await prisma.department.update({
      where: { id },
      data: {
        ...(parsed.data.regionId !== undefined ? { regionId: parsed.data.regionId || null } : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description?.trim() || null }
          : {}),
      },
      include: { region: true },
    });
    return NextResponse.json({ department });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新部门失败" },
      { status: 400 }
    );
  }
}
