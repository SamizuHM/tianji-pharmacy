import { describe, expect, it } from "vitest";

import {
  prepareKnowledgeSourcesForDisplay,
  sortKnowledgeSourcesBySimilarity,
} from "@/lib/retrieval-debug";

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

  it("旧 KB 消息没有显式引用标记时，把最高相似度条目标为已引用", () => {
    const result = prepareKnowledgeSourcesForDisplay(
      [
        { question: "A", rerankScore: 0.65 },
        { question: "B", rerankScore: 0.8 },
      ],
      { isKbMessage: true }
    );

    expect(result.map((item) => ({ question: item.question, used: item.usedAsReference }))).toEqual(
      [
        { question: "B", used: true },
        { question: "A", used: false },
      ]
    );
  });

  it("有显式引用标记时尊重后端标记", () => {
    const result = prepareKnowledgeSourcesForDisplay(
      [
        { question: "A", rerankScore: 0.65, usedAsReference: true },
        { question: "B", rerankScore: 0.8, usedAsReference: false },
      ],
      { isKbMessage: true }
    );

    expect(result.map((item) => ({ question: item.question, used: item.usedAsReference }))).toEqual(
      [
        { question: "B", used: false },
        { question: "A", used: true },
      ]
    );
  });
});
