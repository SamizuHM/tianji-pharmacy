import { vi } from "vitest";

function createMockModel() {
  return {
    create: vi.fn(),
    createMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
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
  department: createMockModel(),
  session: createMockModel(),
  user: createMockModel(),
  importJob: createMockModel(),
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
};

// Mock Prisma Client — 确保测试永不连接真实数据库
vi.mock("@/lib/db", () => ({
  prisma,
}));

// Mock 环境变量 — 避免 import 时读取文件系统
vi.mock("@/lib/env", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost/test",
    OPENAI_BASE_URL: "http://localhost:9999/v1",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "test-model",
    RETRIEVAL_TOP_K: 5,
    RERANK_TOP_N: 3,
    KB_HIT_THRESHOLD: 0.7,
    MAX_CONTEXT_TURNS: 4,
    UPLOAD_DIR: "/tmp/test-uploads",
    SERVICE_HOTLINE: "test-hotline",
    QDRANT_URL: "http://localhost:6333",
    EMBEDDING_SERVICE_URL: "http://localhost:8001/embed",
    RERANK_SERVICE_URL: "http://localhost:8001/rerank",
    ML_SERVICE_URL: "http://localhost:8001",
    SESSION_TTL_HOURS: 72,
  },
  repoRoot: "/tmp/test-repo",
  uploadDirAbsolute: "/tmp/test-uploads",
}));

// Mock Next.js cookies() — Next.js 15 返回 Promise
vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      has: vi.fn(() => false),
    })
  ),
}));

// Mock Next.js redirect — 抛出特殊错误以供断言
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
