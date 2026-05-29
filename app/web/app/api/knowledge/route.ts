import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { normalizeScopeInput } from "@/lib/knowledge-scope";
import {
  collectKnowledgeSourceFiles,
  importKnowledgeFromFiles,
  listKnowledgeItems,
  upsertQaKnowledgeDocument,
} from "@/lib/services/knowledge";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const result = await listKnowledgeItems({
    q: searchParams.get("q") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    status:
      (searchParams.get("status") as "draft" | "published" | "archived" | "all" | null) ?? "all",
    page: Number(searchParams.get("page") ?? 1),
    pageSize: Number(searchParams.get("pageSize") ?? 10),
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "只有管理员可以管理知识库" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  // 手动新增知识条目
  if (contentType.includes("application/json")) {
    const body = await request.json();
    const {
      categoryL1,
      categoryL2,
      question,
      answer,
      imagePaths,
      status,
      scopeTarget,
      scopeLevel,
      cityName,
    } = body as {
      categoryL1?: string;
      categoryL2?: string;
      question?: string;
      answer?: string;
      imagePaths?: string[];
      status?: "draft" | "published";
      scopeTarget?: string;
      scopeLevel?: "common" | "city";
      cityName?: string | null;
    };

    if (!question?.trim() || !answer?.trim()) {
      return NextResponse.json({ error: "问题和答案不能为空" }, { status: 400 });
    }
    const scope = normalizeScopeInput({ scopeTarget, scopeLevel, cityName });
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: 400 });
    }

    const item = await upsertQaKnowledgeDocument({
      categoryL1: categoryL1 || "手动录入",
      categoryL2: categoryL2 || "手动新增",
      question: question.trim(),
      answer: answer.trim(),
      status: status ?? "published",
      tags: Array.from(new Set(question.split(/[，。；、\s]+/).filter(Boolean))).slice(0, 5),
      sourceType: "manual_qa",
      docType: "manual_qa",
      imagePaths: imagePaths ?? [],
      scopeLevel: scope.scopeLevel,
      cityName: scope.cityName,
    });

    return NextResponse.json({ ok: true, item: { id: item.id } });
  }

  // 全量导入
  const files = await collectKnowledgeSourceFiles();
  const result = await importKnowledgeFromFiles(files);
  return NextResponse.json(result);
}
