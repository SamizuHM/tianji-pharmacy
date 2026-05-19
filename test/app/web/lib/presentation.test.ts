import { describe, it, expect } from "vitest";
import {
  roleLabel,
  statusLabel,
  statusTone,
  priorityLabel,
  priorityTone,
  knowledgeStatusLabel,
  knowledgeStatusTone,
  parseTags,
  formatDateTime,
} from "@/lib/presentation";

describe("roleLabel", () => {
  it("staff → 药店工作人员", () => {
    expect(roleLabel("staff")).toBe("药店工作人员");
  });

  it("agent → 人工客服", () => {
    expect(roleLabel("agent")).toBe("人工客服");
  });

  it("未知角色原样返回", () => {
    expect(roleLabel("admin" as never)).toBe("admin");
  });
});

describe("statusLabel", () => {
  it("pending_claim → 待认领", () => {
    expect(statusLabel("pending_claim")).toBe("待认领");
  });

  it("processing → 处理中", () => {
    expect(statusLabel("processing")).toBe("处理中");
  });

  it("escalated → 已升级", () => {
    expect(statusLabel("escalated")).toBe("已升级");
  });

  it("resolved → 已解决", () => {
    expect(statusLabel("resolved")).toBe("已解决");
  });

  it("closed → 已关闭", () => {
    expect(statusLabel("closed")).toBe("已关闭");
  });
});

describe("statusTone", () => {
  it("所有状态返回非空字符串", () => {
    const statuses: Array<Parameters<typeof statusTone>[0]> = [
      "pending_claim",
      "processing",
      "escalated",
      "resolved",
      "closed",
    ];
    for (const s of statuses) {
      expect(statusTone(s).length).toBeGreaterThan(0);
    }
  });
});

describe("priorityLabel", () => {
  it("high → 高", () => {
    expect(priorityLabel("high")).toBe("高");
  });

  it("medium → 中", () => {
    expect(priorityLabel("medium")).toBe("中");
  });

  it("low → 低", () => {
    expect(priorityLabel("low")).toBe("低");
  });
});

describe("priorityTone", () => {
  it("所有优先级返回非空字符串", () => {
    const priorities: Array<Parameters<typeof priorityTone>[0]> = ["high", "medium", "low"];
    for (const p of priorities) {
      expect(priorityTone(p).length).toBeGreaterThan(0);
    }
  });
});

describe("knowledgeStatusLabel", () => {
  it("draft → 草稿", () => {
    expect(knowledgeStatusLabel("draft")).toBe("草稿");
  });

  it("published → 已发布", () => {
    expect(knowledgeStatusLabel("published")).toBe("已发布");
  });

  it("archived → 已归档", () => {
    expect(knowledgeStatusLabel("archived")).toBe("已归档");
  });
});

describe("knowledgeStatusTone", () => {
  it("所有状态返回非空字符串", () => {
    const statuses: Array<Parameters<typeof knowledgeStatusTone>[0]> = [
      "draft",
      "published",
      "archived",
    ];
    for (const s of statuses) {
      expect(knowledgeStatusTone(s).length).toBeGreaterThan(0);
    }
  });
});

describe("parseTags", () => {
  it("解析有效 JSON 数组", () => {
    expect(parseTags('["a","b"]')).toEqual(["a", "b"]);
  });

  it("null 返回空数组", () => {
    expect(parseTags(null)).toEqual([]);
  });

  it("undefined 返回空数组", () => {
    expect(parseTags(undefined)).toEqual([]);
  });

  it("无效 JSON 返回空数组", () => {
    expect(parseTags("not json")).toEqual([]);
  });

  it("过滤非字符串项", () => {
    expect(parseTags('[1, "a", true, "b"]')).toEqual(["a", "b"]);
  });

  it("非数组 JSON 返回空数组", () => {
    expect(parseTags('{"a":1}')).toEqual([]);
  });
});

describe("formatDateTime", () => {
  it("格式化有效日期", () => {
    const result = formatDateTime("2025-05-18T10:30:00");
    expect(result).toContain("2025");
    expect(result).toContain("05");
    expect(result).toContain("18");
  });

  it("null 返回 -", () => {
    expect(formatDateTime(null)).toBe("-");
  });

  it("undefined 返回 -", () => {
    expect(formatDateTime(undefined)).toBe("-");
  });

  it("接受 Date 对象", () => {
    const result = formatDateTime(new Date("2025-05-18T10:30:00"));
    expect(result).toContain("2025");
  });
});
