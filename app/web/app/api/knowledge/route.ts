import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { collectKnowledgeSourceFiles, importKnowledgeFromFiles, upsertKnowledgeItem } from "@/lib/services/knowledge";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const items = await prisma.knowledgeItem.findMany({
    orderBy: { createdAt: "desc" },
    take: 200
  });
  const jobs = await prisma.importJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 20
  });

  return NextResponse.json({ items, jobs });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  // 手动新增知识条目
  if (contentType.includes("application/json")) {
    const body = await request.json();
    const { categoryL1, categoryL2, question, answer, imagePaths } = body as {
      categoryL1?: string;
      categoryL2?: string;
      question?: string;
      answer?: string;
      imagePaths?: string[];
    };

    if (!question?.trim() || !answer?.trim()) {
      return NextResponse.json({ error: "问题和答案不能为空" }, { status: 400 });
    }

    const item = await upsertKnowledgeItem({
      categoryL1: categoryL1 || "手动录入",
      categoryL2: categoryL2 || "手动新增",
      question: question.trim(),
      answer: answer.trim(),
      tags: Array.from(new Set(question.split(/[，。；、\s]+/).filter(Boolean))).slice(0, 5),
      sourceType: "manual",
      docType: "manual",
      imagePaths: imagePaths ?? [],
      originalText: `${question}\n${answer}`,
      normalizedText: `${question}\n${answer}`,
      chunkTexts: [`问题：${question}\n答案：${answer}`]
    });

    return NextResponse.json({ ok: true, item: { id: item.id } });
  }

  // 全量导入
  const files = await collectKnowledgeSourceFiles();
  const result = await importKnowledgeFromFiles(files);
  return NextResponse.json(result);
}
