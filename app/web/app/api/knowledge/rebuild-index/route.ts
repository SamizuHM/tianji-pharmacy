import { NextResponse } from "next/server";

import { rebuildKnowledgeIndex } from "@/lib/services/knowledge-index";

export async function POST() {
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
