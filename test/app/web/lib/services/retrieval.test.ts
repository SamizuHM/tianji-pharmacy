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
      expect(result.referenceSnippets).toEqual(["答案内容"]);
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
      knowledgeItem: { id: "ki-3", status: "draft", question: "Q", answer: "A", imagePathsJson: null, imagePath: null },
    });

    const result = await retrieveAnswer({ question: "问题", imagePaths: [] });

    expect(result.sourceType).toBe("llm");
  });
});
