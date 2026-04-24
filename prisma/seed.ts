import "dotenv/config";

import path from "node:path";

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { FIXED_USERS } from "@pharmacy/shared";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL ?? `file:${path.resolve(process.cwd(), "prisma", "dev.db")}`
    }
  }
});

async function main() {
  for (const user of FIXED_USERS) {
    const passwordHash = await bcrypt.hash(user.password, 10);
    await prisma.user.upsert({
      where: { username: user.username },
      update: {
        displayName: user.displayName,
        passwordHash,
        role: user.role
      },
      create: {
        username: user.username,
        displayName: user.displayName,
        passwordHash,
        role: user.role
      }
    });
  }

  const settings = {
    RETRIEVAL_TOP_K: process.env.RETRIEVAL_TOP_K ?? "8",
    RERANK_TOP_N: process.env.RERANK_TOP_N ?? "5",
    KB_HIT_THRESHOLD: process.env.KB_HIT_THRESHOLD ?? "0.72",
    MAX_CONTEXT_TURNS: process.env.MAX_CONTEXT_TURNS ?? "6"
  };

  for (const [key, value] of Object.entries(settings)) {
    await prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
