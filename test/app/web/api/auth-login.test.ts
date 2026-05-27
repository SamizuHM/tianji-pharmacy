import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { POST } from "@/app/api/auth/login/route";
import { prisma } from "@/lib/db";
import { buildUser } from "../../../helpers/factories";

vi.mock("@/lib/auth/session", () => ({
  createSession: vi.fn(),
  roleHome: vi.fn((role: string) =>
    role === "staff" ? "/staff/chat" : role === "admin" ? "/admin/users" : "/department/tickets"
  ),
}));

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("缺少用户名或密码返回 400", async () => {
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("不能为空");
  });

  it("非法 JSON 返回 400", async () => {
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: "{",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "请求数据格式错误" });
  });

  it("错误密码返回 401", async () => {
    const user = buildUser({ passwordHash: bcrypt.hashSync("demo123", 1) });
    prisma.user.findUnique.mockResolvedValue(user);

    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "test-user", password: "wrong" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("有效凭证返回 200 + role + redirectTo", async () => {
    const user = buildUser({ role: "staff", passwordHash: bcrypt.hashSync("demo123", 1) });
    prisma.user.findUnique.mockResolvedValue(user);

    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "test-user", password: "demo123" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.role).toBe("staff");
    expect(body.redirectTo).toBe("/staff/chat");
  });

  it("禁用账号返回 403", async () => {
    const user = buildUser({
      enabled: false,
      passwordHash: bcrypt.hashSync("demo123", 1),
    });
    prisma.user.findUnique.mockResolvedValue(user);

    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "test-user", password: "demo123" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("禁用");
  });

  it("用户不存在返回 401", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "nonexistent", password: "demo123" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
