import { describe, expect, it } from "vitest";

import {
  DEFAULT_DOCUMENT_CHUNKING_CONFIG,
  DEFAULT_PARENT_CHILD_CHUNKING_CONFIG,
  DEFAULT_QA_CHUNKING_CONFIG,
  chunkPlainText,
  chunkQaItems,
  fixedRecursiveSplit,
  normalizeTextForChunking,
  recursiveCharacterSplit,
} from "@/lib/services/document-chunking";

describe("document chunking", () => {
  it("按 Dify 风格预处理文本", () => {
    const result = normalizeTextForChunking(" A   B \n\n\n https://example.com test@example.com ", {
      removeExtraSpaces: true,
      removeUrlsEmails: true,
    });

    expect(result).toBe("A B");
  });

  it("递归字符切片优先使用自然分隔符", () => {
    const chunks = recursiveCharacterSplit(
      "第一段很短。\n\n第二段内容也很短。\n\n第三段内容也很短。",
      14,
      2
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n")).toContain("第一段");
  });

  it("固定分隔符切片在超长片段时回退到递归切片", () => {
    const chunks = fixedRecursiveSplit({
      text: "短段\n\n这是一个非常非常非常非常长的段落，需要继续按句号或字符递归切分。",
      separator: "\n\n",
      chunkSize: 18,
      overlap: 3,
    });

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]).toBe("短段");
  });

  it("通用文档切片返回 sectionPath", () => {
    const chunks = chunkPlainText(
      "医保政策第一段。\n\n医保政策第二段。",
      DEFAULT_DOCUMENT_CHUNKING_CONFIG
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].sectionPath).toBe("片段 1");
  });

  it("父子切片保留父片段元数据", () => {
    const chunks = chunkPlainText(
      "父段一第一行\n父段一第二行\n\n父段二第一行\n父段二第二行",
      DEFAULT_PARENT_CHILD_CHUNKING_CONFIG
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].metadata?.parentText).toContain("父段");
    expect(chunks[0].sectionPath).toContain("父片段");
  });

  it("QA 文档一问一答生成独立 chunk", () => {
    const chunks = chunkQaItems(
      [
        { question: "医保怎么报销？", answer: "按当地医保规则执行。" },
        { question: "药品怎么存放？", answer: "阴凉干燥处。" },
      ],
      DEFAULT_QA_CHUNKING_CONFIG
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("问题：医保怎么报销？");
    expect(chunks[1].sectionPath).toBe("QA 2");
  });
});
