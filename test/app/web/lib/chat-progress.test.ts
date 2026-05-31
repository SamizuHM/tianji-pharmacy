import { describe, it, expect } from "vitest";
import {
  PROGRESS_STEP_LABELS,
  PROGRESS_STEP_ORDER,
  formatDurationSeconds,
  type ProgressStepKey,
} from "@/lib/chat-progress";

describe("PROGRESS_STEP_LABELS", () => {
  it("包含 9 个步骤", () => {
    expect(Object.keys(PROGRESS_STEP_LABELS)).toHaveLength(9);
  });

  it("每个步骤有非空中文标签", () => {
    for (const [key, label] of Object.entries(PROGRESS_STEP_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
      expect(key.length).toBeGreaterThan(0);
    }
  });
});

describe("PROGRESS_STEP_ORDER", () => {
  it("与 labels 键一致", () => {
    const labelKeys = Object.keys(PROGRESS_STEP_LABELS) as ProgressStepKey[];
    expect(PROGRESS_STEP_ORDER).toEqual(labelKeys);
  });
});

describe("formatDurationSeconds", () => {
  it("正确格式化毫秒为秒", () => {
    expect(formatDurationSeconds(1000)).toBe("1.0s");
  });

  it("保留一位小数", () => {
    expect(formatDurationSeconds(1234)).toBe("1.2s");
  });

  it("0 毫秒", () => {
    expect(formatDurationSeconds(0)).toBe("0.0s");
  });

  it("大数值", () => {
    expect(formatDurationSeconds(60000)).toBe("60.0s");
  });
});
