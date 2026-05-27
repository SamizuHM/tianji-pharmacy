import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { bulkUpdateKnowledgeItems } from "@/lib/services/knowledge";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "只有管理员可以批量管理知识库" }, { status: 403 });
  }

  const body = (await request.json()) as {
    ids?: string[];
    action?: "publish" | "archive" | "delete";
  };

  if (!body.action || !["publish", "archive", "delete"].includes(body.action)) {
    return NextResponse.json({ error: "批量操作类型不正确" }, { status: 400 });
  }

  const result = await bulkUpdateKnowledgeItems({
    ids: Array.isArray(body.ids) ? body.ids : [],
    action: body.action,
  });

  return NextResponse.json(result);
}
