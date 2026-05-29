import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";

vi.mock("@/lib/openai", () => ({
  buildMultimodalQueryText: vi.fn().mockResolvedValue("查询文本"),
}));

vi.mock("@/lib/retrieval/ml-service", () => ({
  embedMultimodal: vi.fn().mockResolvedValue({ vectors: [[0.1, 0.2, 0.3]] }),
  rerankMultimodal: vi.fn().mockResolvedValue({ scores: [0.9, 0.3] }),
}));

vi.mock("@/lib/retrieval/qdrant", () => ({
  COLLECTION_NAME: "test_collection",
  qdrant: {
    search: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/lib/services/settings", () => ({
  getRuntimeSettings: vi.fn().mockResolvedValue({
    retrievalTopK: 5,
    rerankTopN: 3,
    kbHitThreshold: 0.7,
    maxContextTurns: 4,
    cityScopeWeight: 1.3,
  }),
}));

vi.mock("@/lib/services/knowledge-index", () => ({
  enqueueDeletePointTask: vi.fn(),
  tryDrainKnowledgeIndexTasks: vi.fn(),
}));

import { retrieveAnswer } from "@/lib/services/retrieval";
import { buildMultimodalQueryText } from "@/lib/openai";
import { embedMultimodal, rerankMultimodal } from "@/lib/retrieval/ml-service";
import { qdrant } from "@/lib/retrieval/qdrant";

describe("retrieval service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue("查询文本");
  });

  it("知识命中路径：返回 sourceType kb", async () => {
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "point-1",
        score: 0.95,
        payload: {
          knowledgeItemId: "ki-1",
          chunkText: "答案内容",
          question: "问题",
          answer: "答案",
          imagePaths: [],
        },
      },
    ]);
    (rerankMultimodal as ReturnType<typeof vi.fn>).mockResolvedValue({ scores: [0.85] });
    prisma.knowledgeChunk.findUnique.mockResolvedValue({
      id: "point-1",
      qdrantPointId: "point-1",
      knowledgeItemId: "ki-1",
      knowledgeItem: {
        id: "ki-1",
        status: "published",
        question: "问题",
        answer: "答案",
        imagePathsJson: null,
        imagePath: null,
      },
    });
    prisma.knowledgeItem.update.mockResolvedValue({});
    prisma.knowledgeChunk.findMany.mockResolvedValue([{ chunkText: "答案内容" }]);

    const result = await retrieveAnswer({ question: "测试问题", imagePaths: [] });

    expect(result.sourceType).toBe("kb");
    if (result.sourceType === "kb") {
      expect(result.knowledgeItem.id).toBe("ki-1");
      expect(result.referenceSnippets[0]).toContain("[适用范围：通用]");
    }
  });

  it("LLM 回退路径：低于阈值返回 sourceType llm", async () => {
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "point-2",
        score: 0.5,
        payload: {
          knowledgeItemId: "ki-2",
          chunkText: "低分内容",
          question: "问题",
          answer: "答案",
        },
      },
    ]);
    (rerankMultimodal as ReturnType<typeof vi.fn>).mockResolvedValue({ scores: [0.3] });

    const result = await retrieveAnswer({ question: "无关问题", imagePaths: [] });

    expect(result.sourceType).toBe("llm");
    expect(result.queryText).toBe("查询文本");
  });

  it("空搜索结果返回 llm", async () => {
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await retrieveAnswer({ question: "问题", imagePaths: [] });

    expect(result.sourceType).toBe("llm");
  });

  it("医保类问题无知识命中时拒绝大模型兜底", async () => {
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue("医保刷不了");
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    prisma.knowledgeChunk.findMany.mockResolvedValue([]);

    const result = await retrieveAnswer({ question: "医保刷不了", imagePaths: [] });

    expect(result.sourceType).toBe("refusal");
    if (result.sourceType === "refusal") {
      expect(result.refusalReason).toContain("医保");
    }
  });

  it("未发布知识跳过", async () => {
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "point-3",
        score: 0.9,
        payload: { knowledgeItemId: "ki-3", chunkText: "内容", question: "Q", answer: "A" },
      },
    ]);
    (rerankMultimodal as ReturnType<typeof vi.fn>).mockResolvedValue({ scores: [0.85] });
    prisma.knowledgeChunk.findUnique.mockResolvedValue({
      id: "point-3",
      qdrantPointId: "point-3",
      knowledgeItemId: "ki-3",
      knowledgeItem: {
        id: "ki-3",
        status: "draft",
        question: "Q",
        answer: "A",
        imagePathsJson: null,
        imagePath: null,
      },
    });

    const result = await retrieveAnswer({ question: "问题", imagePaths: [] });

    expect(result.sourceType).toBe("llm");
  });

  it("地域不匹配的文档不会作为知识库命中", async () => {
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue("小票打印不了");
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "point-region",
        score: 0.9,
        payload: { knowledgeItemId: "ki-region", chunkText: "内容", question: "Q", answer: "A" },
      },
    ]);
    (rerankMultimodal as ReturnType<typeof vi.fn>).mockResolvedValue({ scores: [0.9] });
    prisma.knowledgeChunk.findMany.mockResolvedValue([]);
    prisma.knowledgeChunk.findUnique.mockResolvedValue({
      id: "chunk-region",
      qdrantPointId: "point-region",
      knowledgeItemId: "ki-region",
      document: { scopeLevel: "city", cityCode: "other-city" },
      knowledgeItem: {
        id: "ki-region",
        status: "published",
        question: "Q",
        answer: "A",
        imagePathsJson: null,
        imagePath: null,
      },
    });

    const result = await retrieveAnswer({
      question: "小票打印不了",
      imagePaths: [],
      region: { cityCode: "local-city" },
    });

    expect(result.sourceType).toBe("llm");
  });

  it("向量检索传入作用域过滤，城市专属证据在融合排序中优先", async () => {
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue("安定能不能卖");
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "point-common",
        score: 0.92,
        payload: {
          knowledgeItemId: "ki-common",
          chunkId: "chunk-common",
          chunkText: "通用政策",
          question: "Q",
          answer: "A",
          scopeLevel: "national",
        },
      },
      {
        id: "point-city",
        score: 0.91,
        payload: {
          knowledgeItemId: "ki-city",
          chunkId: "chunk-city",
          chunkText: "武汉政策",
          question: "Q",
          answer: "A",
          scopeLevel: "city",
          cityCode: "420100",
          cityName: "武汉",
        },
      },
    ]);
    (rerankMultimodal as ReturnType<typeof vi.fn>).mockResolvedValue({ scores: [0.8, 0.8] });
    prisma.knowledgeChunk.findMany.mockResolvedValue([]);
    prisma.knowledgeChunk.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      const id = where.id;
      return Promise.resolve({
        id,
        qdrantPointId: id === "chunk-city" ? "point-city" : "point-common",
        knowledgeItemId: id === "chunk-city" ? "ki-city" : "ki-common",
        chunkText: id === "chunk-city" ? "武汉政策" : "通用政策",
        sourceFile: id === "chunk-city" ? "武汉政策.md" : "通用政策.md",
        scopeLevel: id === "chunk-city" ? "city" : "national",
        cityCode: id === "chunk-city" ? "420100" : null,
        cityName: id === "chunk-city" ? "武汉" : null,
        document: id === "chunk-city" ? { scopeLevel: "city", cityCode: "420100" } : null,
        knowledgeItem: {
          id: id === "chunk-city" ? "ki-city" : "ki-common",
          status: "published",
          question: "Q",
          answer: "A",
          imagePathsJson: null,
          imagePath: null,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-02"),
        },
      });
    });
    prisma.knowledgeItem.update.mockResolvedValue({});

    const result = await retrieveAnswer({
      question: "安定能不能卖",
      imagePaths: [],
      region: { cityCode: "420100" },
    });

    expect(qdrant.search).toHaveBeenCalledWith(
      "test_collection",
      expect.objectContaining({
        filter: expect.objectContaining({ should: expect.any(Array) }),
      })
    );
    expect(result.sourceType).toBe("kb");
    if (result.sourceType === "kb") {
      expect(result.knowledgeItem.id).toBe("ki-city");
      expect(result.referenceSnippets[0]).toContain("仅限武汉");
    }
  });

  it("BM25 通道可在向量为空时召回精确实体", async () => {
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue("鄂医保〔2026〕12号");
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (rerankMultimodal as ReturnType<typeof vi.fn>).mockResolvedValue({ scores: [0.86] });
    prisma.knowledgeChunk.findMany.mockResolvedValue([
      {
        id: "chunk-policy",
        qdrantPointId: "point-policy",
        knowledgeItemId: "ki-policy",
        chunkText: "鄂医保〔2026〕12号规定门店需按流程结算。",
        bm25SearchText: "鄂医保〔2026〕12号 门店 医保结算",
        sourceFile: "医保政策.md",
        scopeLevel: "national",
        cityCode: null,
        cityName: null,
        overrideScope: false,
        knowledgeItem: {
          id: "ki-policy",
          status: "published",
          question: "鄂医保〔2026〕12号是什么？",
          answer: "按政策执行。",
          imagePathsJson: null,
          imagePath: null,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-02"),
        },
      },
    ]);
    prisma.knowledgeChunk.findUnique.mockResolvedValue({
      id: "chunk-policy",
      qdrantPointId: "point-policy",
      knowledgeItemId: "ki-policy",
      chunkText: "鄂医保〔2026〕12号规定门店需按流程结算。",
      sourceFile: "医保政策.md",
      scopeLevel: "national",
      cityCode: null,
      cityName: null,
      document: null,
      knowledgeItem: {
        id: "ki-policy",
        status: "published",
        question: "鄂医保〔2026〕12号是什么？",
        answer: "按政策执行。",
        imagePathsJson: null,
        imagePath: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-02"),
      },
    });
    prisma.knowledgeItem.update.mockResolvedValue({});

    const result = await retrieveAnswer({ question: "鄂医保〔2026〕12号", imagePaths: [] });

    expect(result.sourceType).toBe("kb");
    if (result.sourceType === "kb") {
      expect(result.retrievalDebug[0].sources).toContain("keyword");
    }
  });

  it("BM25 使用标准长度归一化，同等词频下短文档优先", async () => {
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue("地西泮");
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (rerankMultimodal as ReturnType<typeof vi.fn>).mockResolvedValue({ scores: [0.8, 0.8] });
    const longNoise = Array.from({ length: 80 }, (_, index) => `无关词${index}`).join(" ");
    prisma.knowledgeChunk.findMany.mockResolvedValue([
      {
        id: "chunk-long",
        qdrantPointId: "point-long",
        knowledgeItemId: "ki-long",
        chunkText: `地西泮 ${longNoise}`,
        bm25SearchText: `地西泮 ${longNoise}`,
        sourceFile: "长文档.md",
        scopeLevel: "national",
        cityCode: null,
        cityName: null,
        overrideScope: false,
        knowledgeItem: {
          id: "ki-long",
          status: "published",
          question: "地西泮说明",
          answer: "长文档",
          imagePathsJson: null,
          imagePath: null,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-02"),
        },
      },
      {
        id: "chunk-short",
        qdrantPointId: "point-short",
        knowledgeItemId: "ki-short",
        chunkText: "地西泮凭处方销售。",
        bm25SearchText: "地西泮凭处方销售。",
        sourceFile: "短文档.md",
        scopeLevel: "national",
        cityCode: null,
        cityName: null,
        overrideScope: false,
        knowledgeItem: {
          id: "ki-short",
          status: "published",
          question: "地西泮销售规定",
          answer: "短文档",
          imagePathsJson: null,
          imagePath: null,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-02"),
        },
      },
    ]);
    prisma.knowledgeChunk.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      const isShort = where.id === "chunk-short";
      return Promise.resolve({
        id: where.id,
        qdrantPointId: isShort ? "point-short" : "point-long",
        knowledgeItemId: isShort ? "ki-short" : "ki-long",
        chunkText: isShort ? "地西泮凭处方销售。" : `地西泮 ${longNoise}`,
        sourceFile: isShort ? "短文档.md" : "长文档.md",
        scopeLevel: "national",
        cityCode: null,
        cityName: null,
        document: null,
        knowledgeItem: {
          id: isShort ? "ki-short" : "ki-long",
          status: "published",
          question: isShort ? "地西泮销售规定" : "地西泮说明",
          answer: isShort ? "短文档" : "长文档",
          imagePathsJson: null,
          imagePath: null,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-02"),
        },
      });
    });
    prisma.knowledgeItem.update.mockResolvedValue({});

    const result = await retrieveAnswer({ question: "地西泮", imagePaths: [] });

    expect(result.sourceType).toBe("kb");
    if (result.sourceType === "kb") {
      expect(result.knowledgeItem.id).toBe("ki-short");
      expect(result.retrievalDebug[0].keywordScore ?? 0).toBeGreaterThan(
        result.retrievalDebug[1].keywordScore ?? 0
      );
    }
  });
});
