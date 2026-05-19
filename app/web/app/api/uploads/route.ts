import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { saveUploadedFile } from "@/lib/uploads";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((item): item is File => item instanceof File);

  if (!files.length) {
    return NextResponse.json({ error: "未选择文件" }, { status: 400 });
  }

  const saved = [];

  for (const file of files) {
    saved.push(await saveUploadedFile(file));
  }

  return NextResponse.json({ files: saved });
}
