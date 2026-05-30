import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { normalizeScopeInput } from "@/lib/knowledge-scope";
import {
  deleteKnowledgeDocument,
  getKnowledgeDocumentDetail,
  updateKnowledgeDocumentMetadata,
} from "@/lib/services/knowledge";

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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "只有管理员可以管理知识库" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as {
    title?: string;
    businessCategory?: string;
    scopeLevel?: string;
    cityName?: string | null;
    status?: "draft" | "published" | "archived";
  };
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "文档标题不能为空" }, { status: 400 });
  }
  const scope = normalizeScopeInput({
    scopeLevel: body.scopeLevel,
    cityName: body.cityName,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: 400 });
  }

  try {
    const document = await updateKnowledgeDocumentMetadata(id, {
      title: body.title,
      businessCategory: body.businessCategory || "通用",
      scopeLevel: scope.scopeLevel,
      cityName: scope.cityName,
      status: body.status,
    });
    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新知识文档失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "只有管理员可以管理知识库" }, { status: 403 });
  }

  const { id } = await params;
  try {
    await deleteKnowledgeDocument(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除知识文档失败" },
      { status: 400 }
    );
  }
}
