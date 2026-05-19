import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { getRuntimeSettings, updateRuntimeSettings } from "@/lib/services/settings";

const settingsSchema = z.object({
  retrievalTopK: z.coerce.number().int().min(1).max(50),
  rerankTopN: z.coerce.number().int().min(1).max(50),
  kbHitThreshold: z.coerce.number().min(0).max(1),
  maxContextTurns: z.coerce.number().int().min(1).max(20),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  return NextResponse.json({ settings: await getRuntimeSettings() });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const parsed = settingsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "设置参数不合法" }, { status: 400 });
  }

  if (parsed.data.rerankTopN > parsed.data.retrievalTopK) {
    return NextResponse.json({ error: "重排数量不能大于召回数量" }, { status: 400 });
  }

  const settings = await updateRuntimeSettings(parsed.data);
  return NextResponse.json({ settings });
}
