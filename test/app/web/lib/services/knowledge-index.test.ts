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
    getCollections: vi.fn().mockResolvedValue({ collections: [] }),
    createCollection: vi.fn(),
  },
  ensureQdrantWriteReady: vi.fn(),
  ensureCollection: vi.fn(),
}));

import { buildStablePointId, drainKnowledgeIndexTasks } from "@/lib/services/knowledge-index";

describe("knowledge-index service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildStablePointId", () => {
    it("返回有效 UUID 格式", () => {
      const id = buildStablePointId("test-input");
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("确定性：相同输入相同输出", () => {
      const a = buildStablePointId("same-input");
      const b = buildStablePointId("same-input");
      expect(a).toBe(b);
    });

    it("不同输入不同输出", () => {
      const a = buildStablePointId("input-a");
      const b = buildStablePointId("input-b");
      expect(a).not.toBe(b);
    });
  });

  describe("drainKnowledgeIndexTasks", () => {
    it("无待处理任务时返回空结果", async () => {
      prisma.knowledgeIndexTask.findMany.mockResolvedValue([]);

      const result = await drainKnowledgeIndexTasks({ limit: 10 });

      expect(result.scanned).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("处理待处理任务", async () => {
      const task = {
        id: "task-1",
        taskType: "delete",
        status: "pending",
        chunkId: "chunk-1",
        pointId: "point-1",
        payloadJson: null,
        retryCount: 0,
        availableAt: new Date(),
        knowledgeItemId: "ki-1",
      };

      prisma.knowledgeIndexTask.findMany.mockResolvedValue([task]);
      // claimPendingTask 使用 updateMany，需要返回 count > 0
      prisma.knowledgeIndexTask.updateMany.mockResolvedValue({ count: 1 });
      prisma.knowledgeIndexTask.update.mockResolvedValue(task);

      const result = await drainKnowledgeIndexTasks({ limit: 10 });

      expect(result.completed).toBe(1);
    });
  });
});
