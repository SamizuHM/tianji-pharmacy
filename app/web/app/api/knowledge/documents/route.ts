import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { listKnowledgeDocuments } from "@/lib/services/knowledge";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "只有管理员可以管理知识库" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const result = await listKnowledgeDocuments({
    q: searchParams.get("q") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    status:
      (searchParams.get("status") as "draft" | "published" | "archived" | "all" | null) ?? "all",
    page: Number(searchParams.get("page") ?? 1),
    pageSize: Number(searchParams.get("pageSize") ?? 10),
  });

  return NextResponse.json(result);
}
