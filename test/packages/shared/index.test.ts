import { describe, it, expect } from "vitest";
import {
  FIXED_ASSISTANT_SUFFIX,
  stripFixedAssistantSuffix,
  DEPARTMENTS,
  FIXED_USERS,
} from "@pharmacy/shared";

describe("stripFixedAssistantSuffix", () => {
  it("去除一次后缀", () => {
    const text = `这是回答。${FIXED_ASSISTANT_SUFFIX}`;
    expect(stripFixedAssistantSuffix(text)).toBe("这是回答。");
  });

  it("去除多次重复后缀", () => {
    const text = `回答${FIXED_ASSISTANT_SUFFIX}${FIXED_ASSISTANT_SUFFIX}`;
    expect(stripFixedAssistantSuffix(text)).toBe("回答");
  });

  it("无后缀不变", () => {
    expect(stripFixedAssistantSuffix("正常文本")).toBe("正常文本");
  });

  it("空字符串不变", () => {
    expect(stripFixedAssistantSuffix("")).toBe("");
  });

  it("仅后缀返回空字符串", () => {
    expect(stripFixedAssistantSuffix(FIXED_ASSISTANT_SUFFIX)).toBe("");
  });

  it("后缀后有空格也能去除", () => {
    const text = `回答  ${FIXED_ASSISTANT_SUFFIX}  `;
    expect(stripFixedAssistantSuffix(text)).toBe("回答");
  });
});

describe("FIXED_ASSISTANT_SUFFIX", () => {
  it("值正确", () => {
    expect(FIXED_ASSISTANT_SUFFIX).toBe("如以上操作仍无法解决，建议您转人工进行咨询");
  });
});

describe("DEPARTMENTS", () => {
  it("有 6 个部门", () => {
    expect(DEPARTMENTS).toHaveLength(6);
  });

  it("每个部门有 name 和 description", () => {
    for (const dept of DEPARTMENTS) {
      expect(dept.name.length).toBeGreaterThan(0);
      expect(dept.description.length).toBeGreaterThan(0);
    }
  });

  it("包含关键部门", () => {
    const names = DEPARTMENTS.map((d) => d.name);
    expect(names).toContain("营运部");
    expect(names).toContain("医保办");
  });
});

describe("FIXED_USERS", () => {
  it("有 10 个用户", () => {
    expect(FIXED_USERS).toHaveLength(10);
  });

  it("每个用户有必要字段", () => {
    for (const user of FIXED_USERS) {
      expect(user.username.length).toBeGreaterThan(0);
      expect(user.password.length).toBeGreaterThan(0);
      expect(user.displayName.length).toBeGreaterThan(0);
      expect(["staff", "agent"]).toContain(user.role);
    }
  });

  it("包含 1 个 staff 用户", () => {
    expect(FIXED_USERS.filter((u) => u.role === "staff")).toHaveLength(1);
  });

  it("包含 9 个 agent 用户", () => {
    expect(FIXED_USERS.filter((u) => u.role === "agent")).toHaveLength(9);
  });

  it("默认密码都是 demo123", () => {
    for (const user of FIXED_USERS) {
      expect(user.password).toBe("demo123");
    }
  });
});
