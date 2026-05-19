import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { uploadDirAbsolute } from "@/lib/env";

export async function GET(_: Request, context: { params: Promise<{ path: string[] }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { path: parts } = await context.params;
  const filename = parts.join("/");
  const absolutePath = path.join(uploadDirAbsolute, filename);

  try {
    const data = await fs.readFile(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    const contentType =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
            ? "image/webp"
            : "application/octet-stream";

    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
      },
    });
  } catch {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
}
