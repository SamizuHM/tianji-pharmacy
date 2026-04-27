import path from "node:path";

import { PrismaClient } from "@prisma/client";

declare global {
  var __pharmacyPrisma: PrismaClient | undefined;
}

const rawUrl = process.env.DATABASE_URL ?? "file:./dev.db";

// 绝对路径（file:/app/data/dev.db）直接使用。
// 相对 SQLite 路径按 Prisma CLI 语义解析：基于 schema 所在目录（<repo>/prisma）。
const repoRoot = process.cwd().endsWith(path.join("app", "web")) ? path.resolve(process.cwd(), "..", "..") : process.cwd();
const prismaDir = path.resolve(repoRoot, "prisma");
const databaseUrl = rawUrl.startsWith("file:/")
  ? rawUrl
  : rawUrl.startsWith("file:")
    ? `file:${path.resolve(prismaDir, rawUrl.replace("file:", ""))}`
    : rawUrl;

export const prisma =
  globalThis.__pharmacyPrisma ??
  new PrismaClient({
    datasources: databaseUrl
      ? {
          db: { url: databaseUrl }
        }
      : undefined
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__pharmacyPrisma = prisma;
}
