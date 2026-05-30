import { describe, expect, it } from "vitest";

import { buildKbStyledPrompt } from "@/lib/openai";

describe("buildKbStyledPrompt", () => {
  it("知识库命中后的整理提示词不再输出政策未命中兜底", () => {
    const prompt = buildKbStyledPrompt({
      question: "我想买3000元左右拍照最好的手机",
      referenceQuestion: "阿里云百炼系列手机产品介绍.docx",
      referenceAnswer: "通义Vivid 7具备AI智能摄影，参考售价2999 - 3299。",
      referenceSnippets: [
        "[来源：阿里云百炼系列手机产品介绍.docx][适用范围：仅限武汉]\n通义Vivid 7具备AI智能摄影，参考售价2999 - 3299。",
      ],
      knowledgeUpdatedAt: "2026-05-30T01:41:43.083Z",
    });

    expect(prompt.system).toContain("当前请求已经通过检索命中知识库");
    expect(prompt.system).toContain("禁止输出知识库未命中");
    expect(prompt.system).not.toContain("当前知识库中未找到相关政策");
    expect(prompt.system).not.toContain("只能输出");
    expect(prompt.userText).toContain("阿里云百炼系列手机产品介绍.docx");
    expect(prompt.userText).toContain("通义Vivid 7");
  });
});
