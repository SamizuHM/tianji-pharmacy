import path from "node:path";

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { uploadDirAbsolute } from "@/lib/env";
import { parseDocument } from "@/lib/retrieval/ml-service";
import {
  chunkPlainText,
  chunkQaItems,
  sanitizeChunkingConfig,
} from "@/lib/services/document-chunking";
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
    return NextResponse.json({ error: "只有管理员可以预览知识库切片" }, { status: 403 });
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((item): item is File => item instanceof File);
  const chunkingConfigRaw = String(formData.get("chunkingConfig") ?? "");

  if (!files.length) {
    return NextResponse.json({ error: "请选择要预览的文档" }, { status: 400 });
  }

  let chunkingConfig;
  try {
    chunkingConfig = sanitizeChunkingConfig(
      chunkingConfigRaw ? JSON.parse(chunkingConfigRaw) : undefined
    );
  } catch {
    return NextResponse.json({ error: "切片配置格式不正确" }, { status: 400 });
  }

  const unsupported = files.filter(
    (file) => !SUPPORTED_DOCUMENT_EXTENSIONS.has(path.extname(file.name).toLowerCase())
  );
  if (unsupported.length) {
    return NextResponse.json(
      { error: `不支持的文件类型：${unsupported.map((file) => file.name).join("、")}` },
      { status: 400 }
    );
  }

  const previews = [];
  for (const file of files.slice(0, 5)) {
    const saved = await saveUploadedFile(file);
    const filePath = path.resolve(uploadDirAbsolute, saved.path);
    const parsed = await parseDocument(filePath);
    const extractedText = parsed.items
      .map((item) => item.normalizedText || item.originalText || item.chunkTexts.join("\n"))
      .join("\n\n");

    const chunks =
      chunkingConfig.rule.mode === "qa" && parsed.items.length > 1
        ? chunkQaItems(parsed.items, chunkingConfig)
        : chunkPlainText(extractedText, chunkingConfig);

    previews.push({
      fileName: saved.name,
      totalChunks: chunks.length,
      chunks: chunks.slice(0, 8).map((chunk, index) => ({
        index,
        text: chunk.text,
        sectionPath: chunk.sectionPath ?? null,
      })),
    });
  }

  return NextResponse.json({ previews, chunkingConfig });
}
