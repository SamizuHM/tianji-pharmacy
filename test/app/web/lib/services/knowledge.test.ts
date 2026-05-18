import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";

vi.mock("@/lib/retrieval/ml-service", () => ({
  parseDocument: vi.fn().mockResolvedValue({ items: [], rawText: "" }),
}));

vi.mock("@/lib/services/knowledge-index", () => ({
  prepareKnowledgeChunkUpsertTasks: vi.fn().mockResolvedValue([]),
  tryDrainKnowledgeIndexTasks: vi.fn(),
  enqueueDeletePointTask: vi.fn(),
  enqueueUpsertTasksForChunkIds: vi.fn(),
  buildStablePointId: vi.fn((id: string) => `stable-${id}`),
}));

import {
  upsertKnowledgeItem,
  getKnowledgeSummary,
  deleteKnowledgeItem,
} from "@/lib/services/knowledge";
import { buildKnowledgeItem, buildKnowledgeChunk } from "../../../../helpers/factories";

describe("knowledge service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("upsertKnowledgeItem", () => {
    it("创建新知识项", async () => {
      const ki = buildKnowledgeItem();
      prisma.knowledgeItem.findFirst.mockResolvedValue(null);
      prisma.knowledgeItem.create.mockResolvedValue(ki);
      prisma.knowledgeChunk.deleteMany.mockResolvedValue({ count: 0 });
      prisma.knowledgeChunk.createMany.mockResolvedValue({ count: 1 });
      prisma.knowledgeIndexTask.createMany.mockResolvedValue({ count: 1 });
      prisma.knowledgeItem.findUniqueOrThrow.mockResolvedValue(ki);

      const result = await upsertKnowledgeItem({
        categoryL1: "用药咨询",
        categoryL2: "",
        question: "测试问题",
        answer: "测试答案",
        tags: ["标签"],
        sourceType: "manual",
        originalText: "原文",
        normalizedText: "标准化文本",
        chunkTexts: ["分块1"],
      });

      expect(prisma.knowledgeItem.findFirst).toHaveBeenCalled();
      expect(prisma.knowledgeItem.create).toHaveBeenCalled();
    });
  });

  describe("getKnowledgeSummary", () => {
    it("返回统计数据", async () => {
      // getKnowledgeSummary 有 8 个并行查询
      prisma.knowledgeItem.count
        .mockResolvedValueOnce(100)  // total
        .mockResolvedValueOnce(5)    // imageCount
        .mockResolvedValueOnce(3)    // todayCreated
        .mockResolvedValueOnce(60)   // published
        .mockResolvedValueOnce(30)   // draft
        .mockResolvedValueOnce(10);  // archived
      prisma.knowledgeItem.aggregate
        .mockResolvedValueOnce({ _sum: { hitCount: 500 } })   // hitSum
        .mockResolvedValueOnce({ _sum: { hitCount: 50 } });   // recentHits

      const result = await getKnowledgeSummary();

      expect(result.total).toBe(100);
      expect(result.published).toBe(60);
      expect(result.draft).toBe(30);
      expect(result.archived).toBe(10);
    });
  });

  describe("deleteKnowledgeItem", () => {
    it("不存在时抛错", async () => {
      prisma.knowledgeItem.findUnique.mockResolvedValue(null);

      await expect(deleteKnowledgeItem("non-existent")).rejects.toThrow();
    });

    it("存在时删除并清理", async () => {
      const ki = buildKnowledgeItem();
      const chunk = buildKnowledgeChunk();
      prisma.knowledgeItem.findUnique.mockResolvedValue({ ...ki, chunks: [chunk] });
      prisma.knowledgeIndexTask.createMany.mockResolvedValue({ count: 1 });
      prisma.$transaction.mockImplementation(async (fn: Function) => fn(prisma));
      prisma.knowledgeChunk.deleteMany.mockResolvedValue({ count: 1 });
      prisma.knowledgeItem.delete.mockResolvedValue(ki);

      await deleteKnowledgeItem("ki-1");

      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});
