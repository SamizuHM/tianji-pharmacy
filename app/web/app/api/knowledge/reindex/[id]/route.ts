import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ ok: false, message: "最小版本暂未单条重建索引，请使用全量导入。" }, { status: 501 });
}

