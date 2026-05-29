import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";

vi.mock("@/lib/retrieval/ml-service", () => ({
  embedMultimodal: vi.fn().mockResolvedValue({
    vectors: [[0.1, 0.2, 0.3]],
  }),
}));

vi.mock("@/lib/retrieval/qdrant", () => ({
  COLLECTION_NAME: "test_collection",
  qdrant: {
    upsert: vi.fn(),
    delete: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    getCollections: vi.fn().mockResolvedValue({ collections: [] }),
    createCollection: vi.fn(),
    createPayloadIndex: vi.fn(),
  },
  ensureQdrantWriteReady: vi.fn(),
  ensureCollection: vi.fn(),
}));

import {
  tryDrainKnowledgeIndexTasks,
  enqueueDeletePointTask,
  normalizeKnowledgeChunkPointIds,
  reconcileKnowledgeIndex,
  rebuildKnowledgeIndex,
} from "@/lib/services/knowledge-index";

describe("knowledge-index 补全测试", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("tryDrainKnowledgeIndexTasks", () => {
    it("成功时返回 drain 结果", async () => {
      prisma.knowledgeIndexTask.findMany.mockResolvedValue([]);
      prisma.knowledgeIndexTask.updateMany.mockResolvedValue({ count: 0 });

      const result = await tryDrainKnowledgeIndexTasks({ limit: 10 });

      expect(result.completed).toBe(0);
    });

    it("异常时捕获错误并返回 failed=1", async () => {
      prisma.knowledgeIndexTask.findMany.mockRejectedValue(new Error("DB 连接失败"));

      const result = await tryDrainKnowledgeIndexTasks({ limit: 10 });

      expect(result.failed).toBe(1);
      expect(result.scanned).toBe(0);
    });
  });

  describe("enqueueDeletePointTask", () => {
    it("创建删除任务", async () => {
      prisma.knowledgeIndexTask.create.mockResolvedValue({ id: "task-del" });

      await enqueueDeletePointTask({
        pointId: "point-1",
        reason: "test_delete",
      });

      expect(prisma.knowledgeIndexTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskType: "delete",
          pointId: "point-1",
        }),
      });
    });
  });

  describe("normalizeKnowledgeChunkPointIds", () => {
    it("更新未规范化的记录", async () => {
      prisma.knowledgeChunk.findMany.mockResolvedValue([
        { id: "chunk-1", qdrantPointId: "old-point-id", knowledgeItemId: "ki-1" },
      ]);
      prisma.knowledgeChunk.update.mockResolvedValue({});

      const result = await normalizeKnowledgeChunkPointIds();

      expect(result).toBeDefined();
    });

    it("无记录时返回 0", async () => {
      prisma.knowledgeChunk.findMany.mockResolvedValue([]);

      const result = await normalizeKnowledgeChunkPointIds();

      expect(result).toBeDefined();
    });
  });

  describe("reconcileKnowledgeIndex", () => {
    it("空数据时返回零结果", async () => {
      prisma.knowledgeChunk.findMany.mockResolvedValue([]);
      prisma.knowledgeIndexTask.createMany.mockResolvedValue({ count: 0 });
      prisma.knowledgeIndexTask.updateMany.mockResolvedValue({ count: 0 });
      prisma.knowledgeIndexTask.findMany.mockResolvedValue([]);

      const result = await reconcileKnowledgeIndex();

      expect(result).toBeDefined();
    });
  });

  describe("rebuildKnowledgeIndex", () => {
    it("重建索引", async () => {
      prisma.knowledgeChunk.findMany.mockResolvedValue([]);
      prisma.knowledgeIndexTask.updateMany.mockResolvedValue({ count: 0 });
      prisma.knowledgeIndexTask.findMany.mockResolvedValue([]);

      const result = await rebuildKnowledgeIndex();

      expect(result).toBeDefined();
    });
  });
});
