import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";

import { prisma } from "@/lib/db";
import { isHubeiCityName } from "@/lib/knowledge-scope";

export type UserInput = {
  username: string;
  displayName: string;
  password?: string;
  role: UserRole;
  departmentId?: string | null;
  cityName?: string | null;
  enabled?: boolean;
};

function normalizeDepartmentId(input: Pick<UserInput, "role" | "departmentId">) {
  if (input.role === "department") {
    if (!input.departmentId) {
      throw new Error("部门人员必须选择所属部门");
    }
    return input.departmentId;
  }
  return null;
}

async function normalizeStoreId(input: Pick<UserInput, "role" | "cityName">) {
  if (input.role !== "staff") {
    return null;
  }
  const cityName = input.cityName?.trim();
  if (!cityName) {
    return null;
  }
  if (!isHubeiCityName(cityName)) {
    throw new Error("药店工作人员所属城市必须为湖北省内城市");
  }

  const existingStore = await prisma.store.findFirst({
    where: { name: `${cityName}默认门店`, cityName },
  });
  const store =
    existingStore ??
    (await prisma.store.create({
      data: {
        name: `${cityName}默认门店`,
        cityName,
        provinceName: "湖北",
      },
    }));
  return store.id;
}

export async function listManagedUsers() {
  return prisma.user.findMany({
    include: { department: true, store: true },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
}

export async function createManagedUser(input: UserInput) {
  if (!input.password?.trim()) {
    throw new Error("新建用户必须设置密码");
  }

  return prisma.user.create({
    data: {
      username: input.username.trim(),
      displayName: input.displayName.trim(),
      passwordHash: await bcrypt.hash(input.password, 10),
      role: input.role,
      departmentId: normalizeDepartmentId(input),
      storeId: await normalizeStoreId(input),
      enabled: input.enabled ?? true,
    },
    include: { department: true, store: true },
  });
}

export async function updateManagedUser(userId: string, input: UserInput) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      username: input.username.trim(),
      displayName: input.displayName.trim(),
      ...(input.password?.trim() ? { passwordHash: await bcrypt.hash(input.password, 10) } : {}),
      role: input.role,
      departmentId: normalizeDepartmentId(input),
      storeId: await normalizeStoreId(input),
      enabled: input.enabled ?? true,
    },
    include: { department: true, store: true },
  });
}

export async function deleteManagedUser(userId: string) {
  return prisma.user.delete({ where: { id: userId } });
}
