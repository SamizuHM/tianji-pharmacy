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
    scroll: vi.fn().mockResolvedValue({ points: [] }),
  },
  ensureFullTextPayloadIndex: vi.fn(),
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

  it("文档历史回答策略不决定兜底，普通问题低分仍可走大模型", async () => {
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue("打印机卡纸怎么办");
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "point-policy-old",
        score: 0.5,
        payload: {
          knowledgeItemId: "ki-policy-old",
          chunkText: "低分旧知识",
          question: "问题",
          answer: "答案",
          answerPolicy: "kb_only",
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

  it("LLM 查询重写失败时回退规则式子 query", async () => {
    (buildMultimodalQueryText as ReturnType<typeof vi.fn>).mockResolvedValue("安定能卖吗");
    (rewriteRetrievalQueriesWithModel as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("rewrite failed")
    );
    (qdrant.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await retrieveAnswer({ question: "安定能卖吗", imagePaths: [] });

    expect(embedMultimodal).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("地西泮") })])
    );
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
      expect(result.refusalReason).toBe("当前知识库中未找到相关政策，建议咨询上级主管部门。");
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
    (qdrant.scroll as ReturnType<typeof vi.fn>).mockResolvedValue({
      points: [
        {
          id: "point-policy",
          payload: {
            knowledgeItemId: "ki-policy",
            chunkId: "chunk-policy",
            chunkText: "鄂医保〔2026〕12号规定门店需按流程结算。",
            question: "鄂医保〔2026〕12号是什么？",
            answer: "按政策执行。",
            sourceFile: "医保政策.md",
            scopeLevel: "national",
            imagePaths: [],
          },
        },
      ],
    });
    (rerankMultimodal as ReturnType<typeof vi.fn>).mockResolvedValue({ scores: [0.86] });
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

    expect(qdrant.scroll).toHaveBeenCalledWith(
      "test_collection",
      expect.objectContaining({
        filter: expect.objectContaining({
          must: expect.arrayContaining([
            expect.objectContaining({
              key: "chunkText",
              match: expect.objectContaining({ text: "鄂医保〔2026〕12号" }),
            }),
          ]),
        }),
      })
    );
    expect(result.sourceType).toBe("kb");
    if (result.sourceType === "kb") {
      expect(result.retrievalDebug[0].sources).toContain("keyword");
    }
  });
});
