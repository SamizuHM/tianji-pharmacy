import { describe, it, expect } from "vitest";

// session.ts 中依赖 next/headers 和 next/navigation 的函数（createSession, destroySession, getCurrentUser, requireUser）
// 由于 Next.js 15 的 async storage 机制，无法在 Vitest 中直接 mock。
// 这些函数通过 API 路由测试间接覆盖（auth-login.test.ts 中验证了 login 流程）。
// 此文件仅测试纯函数。

import { roleHome, SESSION_COOKIE_NAME } from "@/lib/auth/session";

describe("session 纯函数", () => {
  describe("SESSION_COOKIE_NAME", () => {
    it("值为 pharmacy_demo_session", () => {
      expect(SESSION_COOKIE_NAME).toBe("pharmacy_demo_session");
    });
  });

  describe("roleHome", () => {
    it("staff → /staff/chat", () => {
      expect(roleHome("staff")).toBe("/staff/chat");
    });

    it("department → /department/tickets", () => {
      expect(roleHome("department")).toBe("/department/tickets");
    });

    it("admin → /admin/users", () => {
      expect(roleHome("admin")).toBe("/admin/users");
    });

    it("未知角色 → /login", () => {
      expect(roleHome("unknown" as never)).toBe("/login");
    });
  });
});
