import { prisma } from "@/lib/db";

export async function listRegions() {
  return prisma.region.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function createRegion(input: { name: string; code?: string; description?: string }) {
  return prisma.region.create({
    data: {
      name: input.name.trim(),
      code: input.code?.trim() || null,
      description: input.description?.trim() || null,
    },
  });
}

export async function updateRegion(
  id: string,
  input: { name?: string; code?: string; description?: string; sortOrder?: number }
) {
  return prisma.region.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.code !== undefined ? { code: input.code?.trim() || null } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });
}

export async function deleteRegion(id: string) {
  return prisma.region.delete({ where: { id } });
}
