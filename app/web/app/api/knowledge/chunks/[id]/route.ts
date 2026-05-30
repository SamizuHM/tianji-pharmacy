import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const chunk = await prisma.knowledgeChunk.findUnique({
    where: { id },
    include: {
      document: {
        select: {
          title: true,
          scopeLevel: true,
          cityName: true,
        },
      },
    },
  });

  if (!chunk) {
    return NextResponse.json({ error: "知识片段不存在" }, { status: 404 });
  }

  if (user.role !== "admin") {
    const userWithStore = await prisma.user.findUnique({
      where: { id: user.id },
      include: { store: true },
    });
    const scopeLevel = chunk.scopeLevel ?? chunk.document?.scopeLevel ?? "common";
    const cityName = chunk.cityName ?? chunk.document?.cityName ?? null;
    const visible =
      scopeLevel === "common" || (cityName && cityName === userWithStore?.store?.cityName);
    if (!visible) {
      return NextResponse.json({ error: "无权限查看该知识片段" }, { status: 403 });
    }
  }

  return NextResponse.json({
    chunk: {
      id: chunk.id,
      chunkText: chunk.chunkText,
      sourceFile: chunk.sourceFile,
      scopeLevel: chunk.scopeLevel ?? chunk.document?.scopeLevel ?? "common",
      cityName: chunk.cityName ?? chunk.document?.cityName ?? null,
      documentTitle: chunk.document?.title ?? null,
    },
  });
}
