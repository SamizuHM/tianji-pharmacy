import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { buildKnowledgeItem } from "../../../../helpers/factories";

vi.mock("@/lib/retrieval/ml-service", () => ({
  parseDocument: vi.fn(),
}));

vi.mock("@/lib/services/knowledge-index", () => ({
  prepareKnowledgeChunkUpsertTasks: vi.fn().mockResolvedValue([]),
  tryDrainKnowledgeIndexTasks: vi.fn(),
  enqueueDeletePointTask: vi.fn(),
  enqueueUpsertTasksForChunkIds: vi.fn(),
  buildStablePointId: vi.fn((id: string) => `stable-${id}`),
}));

import {
  listKnowledgeItems,
  getKnowledgeItemDetail,
  recordKnowledgeHit,
  updateKnowledgeItem,
  bulkUpdateKnowledgeItems,
  importKnowledgeFromFiles,
} from "@/lib/services/knowledge";
import { parseDocument } from "@/lib/retrieval/ml-service";

describe("knowledge 补全测试", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listKnowledgeItems", () => {
    it("返回分页结果和分类选项", async () => {
      const items = [buildKnowledgeItem()];
      // listKnowledgeItems 使用 Promise.all: findMany, count, getKnowledgeSummary, findMany(categories)
      // getKnowledgeSummary 内部又有 8 个并行查询
      // 所有 count 和 aggregate 调用都需要 mock
      prisma.knowledgeItem.findMany
        .mockResolvedValueOnce(items) // items 查询
        .mockResolvedValueOnce([
          // categories 查询
          { categoryL1: "用药咨询", categoryL2: "感冒" },
          { categoryL1: "医保政策", categoryL2: null },
        ]);
      // count 会被多次调用：list的 count + getKnowledgeSummary 的 6 个 count
      prisma.knowledgeItem.count
        .mockResolvedValueOnce(1) // list 的 total count
        .mockResolvedValueOnce(10) // summary: total
        .mockResolvedValueOnce(2) // summary: imageCount
        .mockResolvedValueOnce(1) // summary: todayCreated
        .mockResolvedValueOnce(6) // summary: published
        .mockResolvedValueOnce(3) // summary: draft
        .mockResolvedValueOnce(1); // summary: archived
      prisma.knowledgeItem.aggregate
        .mockResolvedValueOnce({ _sum: { hitCount: 100 } })
        .mockResolvedValueOnce({ _sum: { hitCount: 10 } });

      const result = await listKnowledgeItems({ page: 1, pageSize: 10 });

      expect(result.items).toEqual(items);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.categoryOptions).toBeDefined();
    });

    it("按状态过滤", async () => {
      prisma.knowledgeItem.findMany
        .mockResolvedValueOnce([]) // items
        .mockResolvedValueOnce([]); // categories
      prisma.knowledgeItem.count
        .mockResolvedValueOnce(0) // list total
        .mockResolvedValueOnce(0) // summary: total
        .mockResolvedValueOnce(0) // summary: imageCount
        .mockResolvedValueOnce(0) // summary: todayCreated
        .mockResolvedValueOnce(0) // summary: published
        .mockResolvedValueOnce(0) // summary: draft
        .mockResolvedValueOnce(0); // summary: archived
      prisma.knowledgeItem.aggregate.mockResolvedValue({ _sum: { hitCount: 0 } });

      await listKnowledgeItems({ status: "published" });

      const findManyCall = prisma.knowledgeItem.findMany.mock.calls[0][0];
      expect(findManyCall.where.AND).toBeDefined();
      expect(findManyCall.where.AND).toEqual(expect.arrayContaining([{ status: "published" }]));
    });

    it("搜索查询过滤", async () => {
      prisma.knowledgeItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      prisma.knowledgeItem.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      prisma.knowledgeItem.aggregate.mockResolvedValue({ _sum: { hitCount: 0 } });

      await listKnowledgeItems({ q: "头痛" });

      const findManyCall = prisma.knowledgeItem.findMany.mock.calls[0][0];
      // buildKnowledgeWhere 把搜索条件放在 AND 数组内
      expect(findManyCall.where.AND).toBeDefined();
      const searchCondition = findManyCall.where.AND.find((c: Record<string, unknown>) => c.OR);
      expect(searchCondition).toBeDefined();
    });
  });

  describe("getKnowledgeItemDetail", () => {
    it("返回带 chunks 的详情", async () => {
      const item = { ...buildKnowledgeItem(), chunks: [] };
      prisma.knowledgeItem.findUnique.mockResolvedValue(item);

      const result = await getKnowledgeItemDetail("ki-1");

      expect(prisma.knowledgeItem.findUnique).toHaveBeenCalledWith({
        where: { id: "ki-1" },
        include: { chunks: { orderBy: { chunkIndex: "asc" } } },
      });
      expect(result).toEqual(item);
    });
  });

  describe("recordKnowledgeHit", () => {
    it("递增 hitCount 并更新 lastHitAt", async () => {
      prisma.knowledgeItem.update.mockResolvedValue(buildKnowledgeItem({ hitCount: 1 }));

      await recordKnowledgeHit("ki-1");

      expect(prisma.knowledgeItem.update).toHaveBeenCalledWith({
        where: { id: "ki-1" },
        data: {
          hitCount: { increment: 1 },
          lastHitAt: expect.any(Date),
        },
      });
    });
  });

  describe("updateKnowledgeItem", () => {
    it("不存在时抛错", async () => {
      prisma.knowledgeItem.findUnique.mockResolvedValue(null);

      await expect(
        updateKnowledgeItem("nonexistent", {
          categoryL1: "用药咨询",
          categoryL2: "",
          question: "新问题",
          answer: "新答案",
        })
      ).rejects.toThrow("知识条目不存在");
    });

    it("更新知识项", async () => {
      const existing = buildKnowledgeItem();
      prisma.knowledgeItem.findUnique.mockResolvedValue({ ...existing, chunks: [] });
      prisma.knowledgeItem.findFirst.mockResolvedValue(existing);
      prisma.knowledgeItem.create.mockResolvedValue(existing);
      prisma.knowledgeChunk.deleteMany.mockResolvedValue({ count: 0 });
      prisma.knowledgeChunk.createMany.mockResolvedValue({ count: 1 });
      prisma.knowledgeIndexTask.createMany.mockResolvedValue({ count: 1 });
      prisma.knowledgeItem.findUniqueOrThrow.mockResolvedValue(existing);

      const result = await updateKnowledgeItem("ki-1", {
        categoryL1: "医保政策",
        categoryL2: "报销",
        question: "更新后的问题",
        answer: "更新后的答案",
      });

      expect(prisma.knowledgeItem.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "ki-1" } })
      );
    });
  });

  describe("bulkUpdateKnowledgeItems", () => {
    it("空 ids 返回 affected: 0", async () => {
      const result = await bulkUpdateKnowledgeItems({ ids: [], action: "publish" });
      expect(result.affected).toBe(0);
    });

    it("publish 批量发布", async () => {
      prisma.knowledgeItem.updateMany.mockResolvedValue({ count: 3 });

      const result = await bulkUpdateKnowledgeItems({
        ids: ["ki-1", "ki-2", "ki-3"],
        action: "publish",
      });

      expect(prisma.knowledgeItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["ki-1", "ki-2", "ki-3"] } },
        data: { status: "published" },
      });
      expect(result.affected).toBe(3);
    });

    it("archive 批量归档", async () => {
      prisma.knowledgeItem.updateMany.mockResolvedValue({ count: 2 });

      const result = await bulkUpdateKnowledgeItems({
        ids: ["ki-1", "ki-2"],
        action: "archive",
      });

      expect(prisma.knowledgeItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["ki-1", "ki-2"] } },
        data: { status: "archived" },
      });
      expect(result.affected).toBe(2);
    });

    it("delete 逐个删除", async () => {
      prisma.knowledgeItem.findUnique.mockResolvedValue({
        ...buildKnowledgeItem(),
        chunks: [],
      });
      prisma.$transaction.mockImplementation(async (fn: Function) => fn(prisma));
      prisma.knowledgeItem.delete.mockResolvedValue(buildKnowledgeItem());

      const result = await bulkUpdateKnowledgeItems({
        ids: ["ki-1"],
        action: "delete",
      });

      expect(result.affected).toBe(1);
      // delete 调用 deleteKnowledgeItem 而不是 updateMany
      expect(prisma.knowledgeItem.delete).toHaveBeenCalled();
    });

    it("ids 去重", async () => {
      prisma.knowledgeItem.updateMany.mockResolvedValue({ count: 1 });

      await bulkUpdateKnowledgeItems({
        ids: ["ki-1", "ki-1", "ki-2"],
        action: "publish",
      });

      const call = prisma.knowledgeItem.updateMany.mock.calls[0][0];
      expect(call.where.id.in).toHaveLength(2);
    });
  });

  describe("importKnowledgeFromFiles", () => {
    it("创建导入任务并处理文件", async () => {
      prisma.importJob.create.mockResolvedValue({ id: "job-1" });
      (parseDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
        items: [
          {
            categoryL1: "用药咨询",
            categoryL2: null,
            question: "导入的问题",
            answer: "导入的答案",
            tags: ["标签"],
            sourceFile: "test.docx",
            docType: "docx",
            imagePath: null,
            imagePaths: [],
            originalText: "原文",
            normalizedText: "原文",
            chunkTexts: ["分块1"],
          },
        ],
        rawText: "原文",
      });
      prisma.knowledgeItem.findFirst.mockResolvedValue(null);
      prisma.knowledgeItem.create.mockResolvedValue(buildKnowledgeItem());
      prisma.knowledgeChunk.deleteMany.mockResolvedValue({ count: 0 });
      prisma.knowledgeChunk.createMany.mockResolvedValue({ count: 1 });
      prisma.knowledgeIndexTask.createMany.mockResolvedValue({ count: 1 });
      prisma.knowledgeItem.findUniqueOrThrow.mockResolvedValue(buildKnowledgeItem());
      prisma.importJob.update.mockResolvedValue({});

      const result = await importKnowledgeFromFiles(["/path/to/test.docx"]);

      expect(result.importedFiles).toBe(1);
      expect(result.importedChunks).toBe(1);
      expect(result.skippedFiles).toBe(0);
      expect(prisma.importJob.create).toHaveBeenCalled();
      expect(prisma.importJob.update).toHaveBeenCalled();
    });

    it("空文件被跳过", async () => {
      prisma.importJob.create.mockResolvedValue({ id: "job-1" });
      (parseDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
        items: [],
        rawText: "",
      });
      prisma.importJob.update.mockResolvedValue({});

      const result = await importKnowledgeFromFiles(["/path/to/empty.docx"]);

      expect(result.skippedFiles).toBe(1);
      expect(result.importedFiles).toBe(0);
    });

    it("解析失败的文件记入 errors", async () => {
      prisma.importJob.create.mockResolvedValue({ id: "job-1" });
      (parseDocument as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("解析失败"));
      prisma.importJob.update.mockResolvedValue({});

      const result = await importKnowledgeFromFiles(["/path/to/bad.docx"]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].reason).toBe("解析失败");
      expect(result.skippedFiles).toBe(1);
    });
  });
});
