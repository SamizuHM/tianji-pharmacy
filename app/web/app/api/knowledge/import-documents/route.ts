import path from "node:path";

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { uploadDirAbsolute } from "@/lib/env";
import { sanitizeChunkingConfig } from "@/lib/services/document-chunking";
import { importKnowledgeFromFiles } from "@/lib/services/knowledge";
import { saveUploadedFile } from "@/lib/uploads";

const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".txt",
  ".md",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "只有管理员可以导入知识库" }, { status: 403 });
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((item): item is File => item instanceof File);
  const chunkingConfigRaw = String(formData.get("chunkingConfig") ?? "");
  const businessCategory = String(formData.get("businessCategory") ?? "").trim();
  const answerPolicy = String(formData.get("answerPolicy") ?? "").trim();
  const scopeLevel = String(formData.get("scopeLevel") ?? "").trim();

  let chunkingConfig;
  try {
    chunkingConfig = sanitizeChunkingConfig(
      chunkingConfigRaw ? JSON.parse(chunkingConfigRaw) : undefined
    );
  } catch {
    return NextResponse.json({ error: "切片配置格式不正确" }, { status: 400 });
  }

  if (!files.length) {
    return NextResponse.json({ error: "请选择要导入的文档" }, { status: 400 });
  }

  const unsupported = files.filter(
    (file) => !SUPPORTED_DOCUMENT_EXTENSIONS.has(path.extname(file.name).toLowerCase())
  );
  if (unsupported.length) {
    return NextResponse.json(
      {
        error: `仅支持 doc、docx、txt、md、pdf、图片：${unsupported.map((file) => file.name).join("、")}`,
      },
      { status: 400 }
    );
  }

  const filePaths: string[] = [];
  const sourceFileNameByPath: Record<string, string> = {};

  for (const file of files) {
    const saved = await saveUploadedFile(file);
    const absolutePath = path.resolve(uploadDirAbsolute, saved.path);
    filePaths.push(absolutePath);
    sourceFileNameByPath[absolutePath] = saved.name;
  }

  const result = await importKnowledgeFromFiles(filePaths, {
    sourceFileNameByPath,
    uploadedByUserId: user.id,
    chunkingConfig,
    businessCategory: businessCategory || undefined,
    answerPolicy:
      answerPolicy === "kb_only" || answerPolicy === "allow_llm_fallback"
        ? answerPolicy
        : undefined,
    scopeLevel:
      scopeLevel === "province" ||
      scopeLevel === "city" ||
      scopeLevel === "district" ||
      scopeLevel === "store" ||
      scopeLevel === "national"
        ? scopeLevel
        : undefined,
  });
  return NextResponse.json(result);
}
