import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { createRegion, listRegions } from "@/lib/services/regions";

const regionSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().optional(),
  description: z.string().trim().optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  return NextResponse.json({ regions: await listRegions() });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const parsed = regionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }

  try {
    const region = await createRegion(parsed.data);
    return NextResponse.json({ region });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建区域失败" },
      { status: 400 }
    );
  }
}
