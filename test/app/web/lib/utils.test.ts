import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cn,
  safeJsonParse,
  truncateText,
  buildTicketNo,
  toArray,
  getAttachmentItems,
  getAttachmentPaths,
  getFileUrl,
  isImageAttachment,
} from "@/lib/utils";

describe("cn", () => {
  it("合并类名", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("处理条件类名", () => {
    expect(cn("foo", false && "bar", "baz")).toBe("foo baz");
  });

  it("tailwind-merge 去重冲突类", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

describe("safeJsonParse", () => {
  it("解析有效 JSON", () => {
    expect(safeJsonParse('{"a":1}', null)).toEqual({ a: 1 });
  });

  it("null 输入返回 fallback", () => {
    expect(safeJsonParse(null, "default")).toBe("default");
  });

  it("undefined 输入返回 fallback", () => {
    expect(safeJsonParse(undefined, "default")).toBe("default");
  });

  it("无效 JSON 返回 fallback", () => {
    expect(safeJsonParse("not json", "default")).toBe("default");
  });

  it("空字符串返回 fallback", () => {
    expect(safeJsonParse("", "default")).toBe("default");
  });

  it("保留类型参数", () => {
    const result = safeJsonParse<number[]>("[1,2,3]", []);
    expect(result).toEqual([1, 2, 3]);
  });
});

describe("truncateText", () => {
  it("短字符串不截断", () => {
    expect(truncateText("hello", 10)).toBe("hello");
  });

  it("默认 80 字符截断", () => {
    const long = "a".repeat(100);
    expect(truncateText(long)).toBe("a".repeat(80) + "...");
  });

  it("自定义长度截断", () => {
    expect(truncateText("hello world", 5)).toBe("hello...");
  });

  it("恰好等于边界不截断", () => {
    expect(truncateText("hello", 5)).toBe("hello");
  });
});

describe("buildTicketNo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-05-18"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("以 TK 开头", () => {
    expect(buildTicketNo()).toMatch(/^TK/);
  });

  it("包含日期部分 YYYYMMDD", () => {
    expect(buildTicketNo()).toMatch(/TK20250518/);
  });

  it("每次调用生成唯一值", () => {
    const a = buildTicketNo();
    const b = buildTicketNo();
    expect(a).not.toBe(b);
  });
});

describe("toArray", () => {
  it("单值包装为数组", () => {
    expect(toArray("a")).toEqual(["a"]);
  });

  it("数组透传", () => {
    expect(toArray(["a", "b"])).toEqual(["a", "b"]);
  });

  it("null 返回空数组", () => {
    expect(toArray(null)).toEqual([]);
  });

  it("undefined 返回空数组", () => {
    expect(toArray(undefined)).toEqual([]);
  });
});

describe("getAttachmentItems", () => {
  it("解析有效 JSON 数组", () => {
    const json = JSON.stringify([
      { name: "f.png", path: "a.png", mimeType: "image/png", size: 100 },
    ]);
    const result = getAttachmentItems(json);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("f.png");
  });

  it("null 返回空数组", () => {
    expect(getAttachmentItems(null)).toEqual([]);
  });

  it("undefined 返回空数组", () => {
    expect(getAttachmentItems(undefined)).toEqual([]);
  });

  it("过滤无 path 的项", () => {
    const json = JSON.stringify([{ name: "f", path: "", mimeType: "image/png", size: 0 }]);
    expect(getAttachmentItems(json)).toEqual([]);
  });
});

describe("getAttachmentPaths", () => {
  it("提取路径", () => {
    const json = JSON.stringify([
      { name: "a.png", path: "a.png", mimeType: "image/png", size: 100 },
      { name: "b.png", path: "b.png", mimeType: "image/png", size: 200 },
    ]);
    expect(getAttachmentPaths(json)).toEqual(["a.png", "b.png"]);
  });

  it("去重", () => {
    const json = JSON.stringify([
      { name: "a", path: "a.png", mimeType: "image/png", size: 100 },
      { name: "b", path: "a.png", mimeType: "image/png", size: 100 },
    ]);
    expect(getAttachmentPaths(json)).toEqual(["a.png"]);
  });

  it("null 返回空数组", () => {
    expect(getAttachmentPaths(null)).toEqual([]);
  });
});

describe("getFileUrl", () => {
  it("去掉 uploads/ 前缀并拼接路径", () => {
    expect(getFileUrl("uploads/2025/test.png")).toBe("/api/files/2025/test.png");
  });

  it("无 uploads/ 前缀直接拼接", () => {
    expect(getFileUrl("2025/test.png")).toBe("/api/files/2025/test.png");
  });
});

describe("isImageAttachment", () => {
  it("通过 MIME 类型检测图片", () => {
    expect(isImageAttachment({ mimeType: "image/png" })).toBe(true);
  });

  it("通过 MIME 类型检测 jpeg", () => {
    expect(isImageAttachment({ mimeType: "image/jpeg" })).toBe(true);
  });

  it("通过文件扩展名检测图片", () => {
    expect(isImageAttachment({ path: "test.png" })).toBe(true);
  });

  it("通过扩展名检测 jpg", () => {
    expect(isImageAttachment({ path: "photo.jpg" })).toBe(true);
  });

  it("非图片返回 false", () => {
    expect(isImageAttachment({ mimeType: "application/pdf", path: "doc.pdf" })).toBe(false);
  });

  it("无 MIME 和路径返回 false", () => {
    expect(isImageAttachment({})).toBe(false);
  });
});
