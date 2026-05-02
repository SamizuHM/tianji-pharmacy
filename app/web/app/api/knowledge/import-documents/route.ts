import path from "node:path";

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { uploadDirAbsolute } from "@/lib/env";
import { importKnowledgeFromFiles } from "@/lib/services/knowledge";
import { saveUploadedFile } from "@/lib/uploads";

const SUPPORTED_WORD_EXTENSIONS = new Set([".doc", ".docx"]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((item): item is File => item instanceof File);

  if (!files.length) {
    return NextResponse.json({ error: "请选择 Word 文档" }, { status: 400 });
  }

  const unsupported = files.filter((file) => !SUPPORTED_WORD_EXTENSIONS.has(path.extname(file.name).toLowerCase()));
  if (unsupported.length) {
    return NextResponse.json({ error: `仅支持 .doc/.docx：${unsupported.map((file) => file.name).join("、")}` }, { status: 400 });
  }

  const filePaths: string[] = [];
  const sourceFileNameByPath: Record<string, string> = {};

  for (const file of files) {
    const saved = await saveUploadedFile(file);
    const absolutePath = path.resolve(uploadDirAbsolute, saved.path);
    filePaths.push(absolutePath);
    sourceFileNameByPath[absolutePath] = saved.name;
  }

  const result = await importKnowledgeFromFiles(filePaths, { sourceFileNameByPath });
  return NextResponse.json(result);
}
