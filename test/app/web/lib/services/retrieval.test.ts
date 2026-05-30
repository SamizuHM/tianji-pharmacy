import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";

vi.mock("@/lib/openai", () => ({
  buildMultimodalQueryText: vi.fn().mockResolvedValue("查询文本"),
  rewriteRetrievalQueriesWithModel: vi.fn(),
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
    rerankAlpha: 0.7,
  }),
}));

vi.mock("@/lib/services/knowledge-index", () => ({
  enqueueDeletePointTask: vi.fn(),
  tryDrainKnowledgeIndexTasks: vi.fn(),
}));

import { retrieveAnswer } from "@/lib/services/retrieval";
import { buildMultimodalQueryText, rewriteRetrievalQueriesWithModel } from "@/lib/openai";
import { embedMultimodal, rerankMultimodal } from "@/lib/retrieval/ml-service";
import { qdrant } from "@/lib/retrieval/qdrant";

describe("retrieval service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue("查询文本");
    (rewriteRetrievalQueriesWithModel as ReturnType<typeof vi.fn>).mockImplementation(
      ({ queryText }: { queryText: string }) =>
        Promise.resolve({
          normalizedQuery: queryText,
          businessCategory: /医保/.test(queryText)
            ? "医保"
            : /安定|处方|药/.test(queryText)
              ? "用药"
              : /小票|打印/.test(queryText)
                ? "收银打印"
                : "通用",
          vectorQueries: [queryText],
          keywordQueries: [queryText],
          mustTerms: [],
        })
    );
    // 默认 findMany 返回空，各测试按需覆盖
    prisma.knowledgeChunk.findMany.mockImplementation(() => Promise.resolve([]));
    prisma.knowledgeChunk.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _avg: { bm25DocLength: 0 },
    });
    prisma.knowledgeBm25Term.findMany.mockResolvedValue([]);
    prisma.knowledgeItem.update.mockResolvedValue({});
  });

  it("知识命中路径：返回 sourceType kb", async () => {
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "point-1",
        score: 0.95,
        payload: {
          knowledgeItemId: "ki-1",
          chunkId: "point-1",
          chunkText: "答案内容",
          question: "问题",
          answer: "答案",
          imagePaths: [],
          scopeLevel: "common",
        },
      },
    ]);
    (rerankMultimodal as ReturnType<typeof vi.fn>).mockResolvedValue({ scores: [0.85] });
    prisma.knowledgeChunk.findMany.mockImplementation(({ where, include }) => {
      // evidence 批量查询同时 include document
      if (include?.document) {
        return Promise.resolve([
          {
            id: "point-1",
            qdrantPointId: "point-1",
            knowledgeItemId: "ki-1",
            scopeLevel: "common",
            cityName: null,
            chunkText: "答案内容",
            sourceFile: null,
            document: null,
            knowledgeItem: {
              id: "ki-1",
              status: "published",
              question: "问题",
              answer: "答案",
              imagePathsJson: null,
              imagePath: null,
              sourceFile: null,
              createdAt: new Date("2026-01-01"),
              updatedAt: new Date("2026-01-02"),
            },
          },
        ]);
      }
      return Promise.resolve([]);
    });

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
          chunkId: "point-2",
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

  it("普通问题低分仍可走大模型兜底", async () => {
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue("打印机卡纸怎么办");
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "point-policy-old",
        score: 0.5,
        payload: {
          knowledgeItemId: "ki-policy-old",
          chunkId: "point-policy-old",
          chunkText: "低分旧知识",
          question: "问题",
          answer: "答案",
        },
      },
    ]);
    (rerankMultimodal as ReturnType<typeof vi.fn>).mockResolvedValue({ scores: [0.2] });

    const result = await retrieveAnswer({ question: "打印机卡纸怎么办", imagePaths: [] });

    expect(result.sourceType).toBe("llm");
  });

  it("LLM 查询重写输出多个子 query 后用于向量检索", async () => {
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue("它没处方能卖吗");
    (rewriteRetrievalQueriesWithModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      normalizedQuery: "地西泮无处方能销售吗",
      businessCategory: "用药",
      vectorQueries: ["没带处方能买安定吗", "地西泮无处方销售规定"],
      keywordQueries: ["地西泮 安定 处方药 第二类精神药品"],
      mustTerms: ["地西泮", "安定"],
    });
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await retrieveAnswer({
      question: "它没处方能卖吗",
      imagePaths: [],
      historyMessages: [{ role: "user", content: "顾客想买安定" }],
    });

    expect(rewriteRetrievalQueriesWithModel).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: "它没处方能卖吗",
        historyText: expect.stringContaining("顾客想买安定"),
      })
    );
    expect(embedMultimodal).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ text: "没带处方能买安定吗" }),
        expect.objectContaining({ text: "地西泮无处方销售规定" }),
      ])
    );
  });

  it("LLM 查询重写失败时向上抛出错误", async () => {
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue("安定能卖吗");
    (rewriteRetrievalQueriesWithModel as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("rewrite failed")
    );

    await expect(retrieveAnswer({ question: "安定能卖吗", imagePaths: [] })).rejects.toThrow(
      "rewrite failed"
    );
  });

  it("空搜索结果返回 llm", async () => {
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await retrieveAnswer({ question: "问题", imagePaths: [] });

    expect(result.sourceType).toBe("llm");
  });

  it("Qdrant 集合不存在时按空知识库处理，不向前端抛 Not Found", async () => {
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue("打印机卡纸怎么办");
    (qdrant.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Not Found"));

    const result = await retrieveAnswer({ question: "打印机卡纸怎么办", imagePaths: [] });

    expect(result.sourceType).toBe("llm");
    expect(result.retrievalDebug).toEqual([]);
  });

  it("医保类问题无知识命中时拒绝大模型兜底", async () => {
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue("医保刷不了");
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await retrieveAnswer({ question: "医保刷不了", imagePaths: [] });

    expect(result.sourceType).toBe("sensitive");
  });

  it("未发布知识跳过", async () => {
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "point-3",
        score: 0.9,
        payload: {
          knowledgeItemId: "ki-3",
          chunkId: "point-3",
          chunkText: "内容",
          question: "Q",
          answer: "A",
        },
      },
    ]);
    (rerankMultimodal as ReturnType<typeof vi.fn>).mockResolvedValue({ scores: [0.85] });
    prisma.knowledgeChunk.findMany.mockImplementation(({ where, include }) => {
      // evidence 批量查询同时 include document
      if (include?.document) {
        return Promise.resolve([
          {
            id: "point-3",
            qdrantPointId: "point-3",
            knowledgeItemId: "ki-3",
            scopeLevel: "common",
            cityName: null,
            chunkText: "内容",
            sourceFile: null,
            document: null,
            knowledgeItem: {
              id: "ki-3",
              status: "draft",
              question: "Q",
              answer: "A",
              imagePathsJson: null,
              imagePath: null,
            },
          },
        ]);
      }
      return Promise.resolve([]);
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
        payload: {
          knowledgeItemId: "ki-region",
          chunkId: "chunk-region",
          chunkText: "内容",
          question: "Q",
          answer: "A",
          scopeLevel: "city",
          cityName: "宜昌",
        },
      },
    ]);
    (rerankMultimodal as ReturnType<typeof vi.fn>).mockResolvedValue({ scores: [0.9] });
    prisma.knowledgeChunk.findMany.mockImplementation(({ where, include }) => {
      // evidence 批量查询同时 include document
      if (include?.document) {
        return Promise.resolve([
          {
            id: "chunk-region",
            qdrantPointId: "point-region",
            knowledgeItemId: "ki-region",
            scopeLevel: "city",
            cityName: "宜昌",
            chunkText: "内容",
            sourceFile: null,
            document: { scopeLevel: "city", cityName: "宜昌" },
            knowledgeItem: {
              id: "ki-region",
              status: "published",
              question: "Q",
              answer: "A",
              imagePathsJson: null,
              imagePath: null,
            },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await retrieveAnswer({
      question: "小票打印不了",
      imagePaths: [],
      region: { cityName: "武汉" },
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
          scopeLevel: "common",
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
          cityName: "武汉",
        },
      },
    ]);
    (rerankMultimodal as ReturnType<typeof vi.fn>).mockResolvedValue({ scores: [0.8, 0.8] });
    const mockFn = prisma.knowledgeChunk.findMany;
    mockFn.mockImplementation(({ where, include }) => {
      if (include?.document) {
        const ids =
          where?.id?.$in ??
          where?.id?.in ??
          where?.qdrantPointId?.$in ??
          where?.qdrantPointId?.in ??
          [];
        const byPointId = ids.length > 0 && !where?.id?.$in;
        const chunks = ids.map((id: string) => {
          const isCity = byPointId ? id === "point-city" : id === "chunk-city";
          return {
            id: isCity ? "chunk-city" : "chunk-common",
            qdrantPointId: isCity ? "point-city" : "point-common",
            knowledgeItemId: isCity ? "ki-city" : "ki-common",
            chunkText: isCity ? "武汉政策" : "通用政策",
            sourceFile: isCity ? "武汉政策.md" : "通用政策.md",
            scopeLevel: isCity ? "city" : "common",
            cityName: isCity ? "武汉" : null,
            document: isCity ? { scopeLevel: "city", cityName: "武汉" } : null,
            knowledgeItem: {
              id: isCity ? "ki-city" : "ki-common",
              status: "published",
              question: "Q",
              answer: "A",
              imagePathsJson: null,
              imagePath: null,
              createdAt: new Date("2026-01-01"),
              updatedAt: new Date("2026-01-02"),
            },
          };
        });
        return Promise.resolve(chunks);
      }
      return Promise.resolve([]);
    });

    const result = await retrieveAnswer({
      question: "安定能不能卖",
      imagePaths: [],
      region: { cityName: "武汉" },
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
    const policyChunk = {
      id: "chunk-policy",
      qdrantPointId: "point-policy",
      knowledgeItemId: "ki-policy",
      chunkText: "鄂医保〔2026〕12号规定门店需按流程结算。",
      bm25DocLength: 12,
      sourceFile: "医保政策.md",
      scopeLevel: "common",
      cityName: null,
      overrideScope: false,
      document: null,
      knowledgeItem: {
        id: "ki-policy",
        status: "published",
        question: "鄂医保〔2026〕12号是什么？",
        answer: "按政策执行。",
        imagePathsJson: null,
        imagePath: null,
        sourceFile: "医保政策.md",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-02"),
      },
    };
    prisma.knowledgeBm25Term.findMany.mockResolvedValue([
      { chunkId: "chunk-policy", term: "鄂医保", termFrequency: 1, docLength: 12 },
      { chunkId: "chunk-policy", term: "医保", termFrequency: 2, docLength: 12 },
      { chunkId: "chunk-policy", term: "2026", termFrequency: 1, docLength: 12 },
      { chunkId: "chunk-policy", term: "12", termFrequency: 1, docLength: 12 },
      { chunkId: "chunk-policy", term: "号", termFrequency: 1, docLength: 12 },
    ]);
    prisma.knowledgeChunk.aggregate.mockResolvedValue({
      _count: { _all: 1 },
      _avg: { bm25DocLength: 12 },
    });
    prisma.knowledgeChunk.findMany.mockImplementation(({ where, include }) => {
      // evidence 批量查询同时 include document
      if (include?.document) {
        return Promise.resolve([policyChunk]);
      }
      return Promise.resolve([policyChunk]);
    });

    const result = await retrieveAnswer({ question: "鄂医保〔2026〕12号", imagePaths: [] });

    expect(prisma.knowledgeBm25Term.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          term: expect.objectContaining({ in: expect.any(Array) }),
          OR: expect.arrayContaining([expect.objectContaining({ scopeLevel: "common" })]),
        }),
      })
    );
    expect(result.sourceType).toBe("kb");
    if (result.sourceType === "kb") {
      expect(result.retrievalDebug[0].sources).toContain("keyword");
      expect(result.knowledgeItem.question).toBe("医保政策.md");
    }
  });

  it("上传文档命中时使用文件名作为可读知识来源", async () => {
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue(
      "我想买3000元左右拍照最好的手机"
    );
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "point-phone",
        score: 0.95,
        payload: {
          knowledgeItemId: "ki-phone",
          chunkId: "chunk-phone",
          chunkText: "通义Vivid 7具备AI智能摄影，参考售价2999 - 3299。",
          question: "1780105284102-wXSwka",
          answer: "阿里云百炼手机产品介绍",
          sourceFile: "阿里云百炼系列手机产品介绍.docx",
          scopeLevel: "city",
          cityName: "武汉",
        },
      },
    ]);
    (rerankMultimodal as ReturnType<typeof vi.fn>).mockResolvedValue({ scores: [0.9] });
    prisma.knowledgeChunk.findMany.mockImplementation((...args) => {
      const { where, include } = args[0] ?? {};
      // evidence 批量查询同时 include document
      if (include?.document) {
        return Promise.resolve([
          {
            id: "chunk-phone",
            qdrantPointId: "point-phone",
            knowledgeItemId: "ki-phone",
            chunkText: "通义Vivid 7具备AI智能摄影，参考售价2999 - 3299。",
            sourceFile: "阿里云百炼系列手机产品介绍.docx",
            scopeLevel: "city",
            cityName: "武汉",
            document: {
              title: "阿里云百炼系列手机产品介绍",
              scopeLevel: "city",
              cityName: "武汉",
            },
            knowledgeItem: {
              id: "ki-phone",
              status: "published",
              question: "1780105284102-wXSwka",
              answer: "阿里云百炼手机产品介绍",
              sourceFile: "阿里云百炼系列手机产品介绍.docx",
              imagePathsJson: null,
              imagePath: null,
              createdAt: new Date("2026-05-30T01:41:43.083Z"),
              updatedAt: new Date("2026-05-30T01:41:43.083Z"),
            },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await retrieveAnswer({
      question: "我想买3000元左右拍照最好的手机",
      imagePaths: [],
      region: { cityName: "武汉" },
    });

    expect(result.sourceType).toBe("kb");
    if (result.sourceType === "kb") {
      expect(result.knowledgeItem.question).toBe("阿里云百炼系列手机产品介绍.docx");
      expect(result.retrievalDebug[0].question).toBe("阿里云百炼系列手机产品介绍.docx");
      expect(result.retrievalDebug[0].chunkText).toBe(
        "通义Vivid 7具备AI智能摄影，参考售价2999 - 3299。"
      );
      expect(result.referenceSnippets[0]).toContain("通义Vivid 7");
    }
  });
});
