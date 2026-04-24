import path from "node:path";

import { PrismaClient } from "@prisma/client";

declare global {
  var __pharmacyPrisma: PrismaClient | undefined;
}

const rawUrl = process.env.DATABASE_URL ?? `file:${path.resolve(process.cwd(), "prisma", "dev.db")}`;

// 绝对路径（file:/app/data/dev.db）直接使用，相对路径基于项目根目录解析
const databaseUrl = rawUrl.startsWith("file:/")
  ? rawUrl
  : rawUrl.startsWith("file:")
    ? `file:${path.resolve(process.cwd().endsWith(path.join("app", "web")) ? path.resolve(process.cwd(), "..", "..") : process.cwd(), rawUrl.replace("file:", ""))}`
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
