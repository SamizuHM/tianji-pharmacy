import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { rebuildKnowledgeIndex } from "@/lib/services/knowledge-index";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "只有管理员可以重建知识索引" }, { status: 403 });
  }

  try {
    const result = await rebuildKnowledgeIndex();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "重建索引失败" },
      { status: 500 }
    );
  }
}
