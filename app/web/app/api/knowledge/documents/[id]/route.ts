import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getKnowledgeDocumentDetail } from "@/lib/services/knowledge";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "只有管理员可以管理知识库" }, { status: 403 });
  }

  const { id } = await params;
  const document = await getKnowledgeDocumentDetail(id);
  if (!document) {
    return NextResponse.json({ error: "知识文档不存在" }, { status: 404 });
  }

  return NextResponse.json({ document });
}
