import fs from "node:fs/promises";
import path from "node:path";

import { nanoid } from "nanoid";

import { uploadDirAbsolute } from "@/lib/env";

export async function ensureUploadDir() {
  await fs.mkdir(uploadDirAbsolute, { recursive: true });
}

export async function saveUploadedFile(file: File) {
  await ensureUploadDir();
  const buffer = Buffer.from(await file.arrayBuffer());
  const extension = path.extname(file.name) || ".png";
  const filename = `${Date.now()}-${nanoid(6)}${extension}`;
  const absolutePath = path.join(uploadDirAbsolute, filename);
  await fs.writeFile(absolutePath, buffer);

  return {
    name: file.name,
    path: filename,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  };
}
