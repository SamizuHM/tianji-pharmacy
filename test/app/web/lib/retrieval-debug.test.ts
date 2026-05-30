import { describe, expect, it } from "vitest";

import { sortKnowledgeSourcesBySimilarity } from "@/lib/retrieval-debug";

describe("sortKnowledgeSourcesBySimilarity", () => {
  it("按前端展示的相似度降序排列知识来源", () => {
    const result = sortKnowledgeSourcesBySimilarity([
      { question: "A", rerankScore: 0.65 },
      { question: "B", rerankScore: 0.8 },
      { question: "C", rerankScore: 0.66 },
    ]);

    expect(result.map((item) => item.question)).toEqual(["B", "C", "A"]);
  });

  it("相似度相同时保留原始顺序", () => {
    const result = sortKnowledgeSourcesBySimilarity([
      { question: "A", rerankScore: 0.7 },
      { question: "B", rerankScore: 0.7 },
    ]);

    expect(result.map((item) => item.question)).toEqual(["A", "B"]);
  });
});
