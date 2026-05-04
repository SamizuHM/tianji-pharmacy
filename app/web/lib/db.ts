import { PrismaClient } from "@prisma/client";

declare global {
  var __pharmacyPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__pharmacyPrisma ??
  new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__pharmacyPrisma = prisma;
}
