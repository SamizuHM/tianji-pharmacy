import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";

import { prisma } from "@/lib/db";

export type UserInput = {
  username: string;
  displayName: string;
  password?: string;
  role: UserRole;
  departmentId?: string | null;
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

export async function listManagedUsers() {
  return prisma.user.findMany({
    include: { department: true },
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
      enabled: input.enabled ?? true,
    },
    include: { department: true },
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
      enabled: input.enabled ?? true,
    },
    include: { department: true },
  });
}

export async function deleteManagedUser(userId: string) {
  return prisma.user.delete({ where: { id: userId } });
}
