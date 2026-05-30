import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";

vi.mock("@/lib/retrieval/ml-service", () => ({
  embedMultimodal: vi.fn().mockResolvedValue({
    vectors: [[0.1, 0.2, 0.3]],
  }),
}));

vi.mock("@/lib/openai", () => ({
  generateHypotheticalQuestionsWithModel: vi
    .fn()
    .mockResolvedValue([
      "没带处方能买安定吗",
      "地西泮无处方销售规定是什么",
      "苯二氮䓬类管控药品怎么销售",
    ]),
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

import {
  buildHypotheticalQuestionsJsonByChunkId,
  buildStablePointId,
  drainKnowledgeIndexTasks,
  prepareKnowledgeChunkUpsertTasks,
} from "@/lib/services/knowledge-index";
import { embedMultimodal } from "@/lib/retrieval/ml-service";

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

  describe("prepareKnowledgeChunkUpsertTasks", () => {
    it("为 QA 原问题、chunk 原文和 HQ 变体生成多条向量写入任务", async () => {
      const result = await prepareKnowledgeChunkUpsertTasks([
        {
          knowledgeItemId: "ki-1",
          chunkId: "chunk-1",
          chunkIndex: 0,
          chunkText: "问题：没带处方能买安定吗？\n答案：安定即地西泮，属于苯二氮䓬类管控药品。",
          sourceFile: "管控政策.md",
          businessCategory: "用药",
          scopeLevel: "city",
          cityName: "武汉",
          knowledgeItem: {
            question: "安定无处方能销售吗？",
            answer: "不能无处方销售。",
            categoryL1: "用药",
            categoryL2: "处方管控",
          },
        },
      ]);

      expect(result.length).toBeGreaterThan(2);
      expect(result[0].pointId).toBe(buildStablePointId("chunk-1"));
      expect(result[0].retrievalBasisType).toBe("question");
      expect(result[1].retrievalBasisType).toBe("chunk");
      expect(result.slice(2).every((task) => task.retrievalBasisType === "hq")).toBe(true);
      expect(buildHypotheticalQuestionsJsonByChunkId(result).get("chunk-1")).toContain(
        "没带处方能买安定吗"
      );
      expect(embedMultimodal).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining("安定无处方") }),
          expect.objectContaining({ text: expect.stringContaining("地西泮") }),
        ])
      );
    });
  });
});
