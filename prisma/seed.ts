import "dotenv/config";

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { DEPARTMENTS, FIXED_USERS } from "@pharmacy/shared";

const prisma = new PrismaClient();

async function main() {
  const departmentMap: Record<string, string> = {};
  for (const dept of DEPARTMENTS) {
    const record = await prisma.department.upsert({
      where: { name: dept.name },
      update: { description: dept.description },
      create: { name: dept.name, description: dept.description },
    });
    departmentMap[dept.name] = record.id;
  }

  for (const user of FIXED_USERS) {
    const passwordHash = await bcrypt.hash(user.password, 10);
    const departmentId = user.department ? departmentMap[user.department] : null;
    await prisma.user.upsert({
      where: { username: user.username },
      update: {
        displayName: user.displayName,
        passwordHash,
        role: user.role,
        departmentId,
      },
      create: {
        username: user.username,
        displayName: user.displayName,
        passwordHash,
        role: user.role,
        departmentId,
      },
    });
  }

  const settings = {
    RETRIEVAL_TOP_K: process.env.RETRIEVAL_TOP_K ?? "8",
    RERANK_TOP_N: process.env.RERANK_TOP_N ?? "5",
    KB_HIT_THRESHOLD: process.env.KB_HIT_THRESHOLD ?? "0.72",
    MAX_CONTEXT_TURNS: process.env.MAX_CONTEXT_TURNS ?? "6",
  };

  for (const [key, value] of Object.entries(settings)) {
    await prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
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
