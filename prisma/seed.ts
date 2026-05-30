import "dotenv/config";

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { DEPARTMENTS, FIXED_USERS, REGIONS } from "@pharmacy/shared";

const prisma = new PrismaClient();

async function main() {
  const regionMap: Record<string, string> = {};
  for (const region of REGIONS) {
    const record = await prisma.region.upsert({
      where: { name: region.name },
      update: { code: region.code, description: region.description },
      create: { name: region.name, code: region.code, description: region.description },
    });
    regionMap[region.name] = record.id;
  }

  // Create departments for each region
  // Key: "regionName/deptName" → department id
  const FALLBACK_DEPT_NAME = "其他部门";
  const regionDepts = DEPARTMENTS.filter((d) => d.name !== FALLBACK_DEPT_NAME);
  const fallbackDept = DEPARTMENTS.find((d) => d.name === FALLBACK_DEPT_NAME);

  const departmentMap: Record<string, string> = {};

  // 全局"其他部门"——不绑定区域，可管辖全域工单
  if (fallbackDept) {
    const existing = await prisma.department.findFirst({
      where: { name: fallbackDept.name, regionId: null },
    });
    const record = existing
      ? await prisma.department.update({
          where: { id: existing.id },
          data: { description: fallbackDept.description },
        })
      : await prisma.department.create({
          data: { name: fallbackDept.name, description: fallbackDept.description, regionId: null },
        });
    for (const regionName of Object.keys(regionMap)) {
      departmentMap[`${regionName}/${fallbackDept.name}`] = record.id;
    }
  }

  // 其他部门按区域创建
  for (const regionName of Object.keys(regionMap)) {
    for (const dept of regionDepts) {
      const regionId = regionMap[regionName];
      const existing = await prisma.department.findFirst({
        where: { name: dept.name, regionId },
      });
      const record = existing
        ? await prisma.department.update({
            where: { id: existing.id },
            data: { description: dept.description },
          })
        : await prisma.department.create({
            data: { name: dept.name, description: dept.description, regionId },
          });
      departmentMap[`${regionName}/${dept.name}`] = record.id;
    }
  }

  // Assign demo users: department users go to 武汉 region, staff/admin get regionId for 武汉
  const defaultRegionName = "武汉";
  for (const user of FIXED_USERS) {
    const passwordHash = await bcrypt.hash(user.password, 10);
    const departmentId = user.department
      ? departmentMap[`${defaultRegionName}/${user.department}`]
      : null;
    const regionId = regionMap[defaultRegionName] ?? null;
    await prisma.user.upsert({
      where: { username: user.username },
      update: {
        displayName: user.displayName,
        passwordHash,
        role: user.role,
        departmentId,
        regionId,
      },
      create: {
        username: user.username,
        displayName: user.displayName,
        passwordHash,
        role: user.role,
        departmentId,
        regionId,
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
