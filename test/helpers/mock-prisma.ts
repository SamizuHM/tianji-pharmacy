import { vi } from "vitest";

function createMockModel() {
  return {
    create: vi.fn(),
    createMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  };
}

export type MockPrismaClient = ReturnType<typeof createMockPrisma>["prisma"];

export function createMockPrisma() {
  const prisma = {
    conversation: createMockModel(),
    chatMessage: createMockModel(),
    ticket: createMockModel(),
    ticketMessage: createMockModel(),
    ticketKnowledgeDraft: createMockModel(),
    knowledgeItem: createMockModel(),
    knowledgeChunk: createMockModel(),
    knowledgeIndexTask: createMockModel(),
    appSetting: createMockModel(),
    session: createMockModel(),
    user: createMockModel(),
    importJob: createMockModel(),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  return { prisma };
}

export function resetMockPrisma(prisma: MockPrismaClient) {
  for (const model of Object.values(prisma)) {
    if (
      typeof model === "object" &&
      model !== null &&
      "$transaction" in prisma &&
      model !== prisma
    ) {
      for (const method of Object.values(model)) {
        if (typeof method === "function" && "mockClear" in method) {
          method.mockClear();
        }
      }
    }
  }
  prisma.$transaction.mockClear();
}
