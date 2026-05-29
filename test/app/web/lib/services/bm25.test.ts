import { describe, expect, it } from "vitest";

import { scoreBm25Documents, tokenizeForBm25 } from "@/lib/services/bm25";

describe("bm25 service", () => {
  it("使用 BM25 公式让精确实体命中文档排在前面", () => {
    const results = scoreBm25Documents("鄂医保〔2026〕12号 地西泮", [
      {
        id: "doc-noise",
        text: "医保结算需要按门店流程处理，普通药品按系统提示销售。",
        payload: { label: "noise" },
      },
      {
        id: "doc-policy",
        text: "鄂医保〔2026〕12号规定，地西泮等处方药销售和医保结算必须按政策执行。",
        payload: { label: "policy" },
      },
    ]);

    expect(results[0]?.id).toBe("doc-policy");
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it("没有查询词命中时不返回伪分数", () => {
    const results = scoreBm25Documents("完全无关实体", [
      { id: "doc-1", text: "小票打印机卡纸处理流程", payload: {} },
    ]);

    expect(results).toEqual([]);
  });

  it("中文长词会补充二元切分以提升模糊召回", () => {
    expect(tokenizeForBm25("医保结算")).toEqual(
      expect.arrayContaining(["医保结算", "医保", "保结", "结算"])
    );
  });
});
