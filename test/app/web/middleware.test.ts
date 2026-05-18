import { describe, it, expect, vi } from "vitest";

// Mock next/server — 测试不需要真实 Next.js 运行时
vi.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    headers: Map<string, string>;
    private body: unknown;

    static json(body: unknown, init?: { status?: number }) {
      const resp = new MockNextResponse();
      resp.body = body;
      resp.status = init?.status ?? 200;
      resp.headers = new Map();
      return resp;
    }

    static redirect(url: URL) {
      const resp = new MockNextResponse();
      resp.status = 307;
      resp.headers = new Map([["location", url.toString()]]);
      return resp;
    }

    static next() {
      const resp = new MockNextResponse();
      resp.status = 200;
      resp.headers = new Map();
      return resp;
    }
  }

  class MockNextRequest {
    url: string;
    cookies: { get: (name: string) => { value: string } | undefined; set: (name: string, value: string) => void; has: (name: string) => boolean };
    nextUrl: { pathname: string };

    constructor(input: URL | string) {
      const url = typeof input === "string" ? new URL(input) : input;
      this.url = url.toString();
      this.nextUrl = { pathname: url.pathname };
      const cookieMap = new Map<string, string>();
      this.cookies = {
        get: (name: string) => {
          const value = cookieMap.get(name);
          return value !== undefined ? { value } : undefined;
        },
        set: (name: string, value: string) => cookieMap.set(name, value),
        has: (name: string) => cookieMap.has(name),
      };
    }
  }

  return { NextResponse: MockNextResponse, NextRequest: MockNextRequest };
});

import { middleware } from "@/middleware";

function createRequest(url: string, sessionToken?: string) {
  const { NextRequest } = require("next/server") as { NextRequest: new (url: URL | string) => { cookies: { set: (name: string, value: string) => void } } };
  const req = new NextRequest(url);
  if (sessionToken) {
    req.cookies.set("pharmacy_demo_session", sessionToken);
  }
  return req;
}

describe("middleware", () => {
  it("受保护路径无 cookie → 重定向 /login", () => {
    const request = createRequest("http://localhost/staff/chat");
    const response = middleware(request as never);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("受保护路径有 cookie → next()", () => {
    const request = createRequest("http://localhost/staff/chat", "test-token");
    const response = middleware(request as never);
    expect(response.status).toBe(200);
  });

  it("根路径 / 有 cookie → 重定向 /staff/chat", () => {
    const request = createRequest("http://localhost/", "test-token");
    const response = middleware(request as never);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/staff/chat");
  });

  it("根路径 / 无 cookie → next()", () => {
    const request = createRequest("http://localhost/");
    const response = middleware(request as never);
    expect(response.status).toBe(200);
  });

  it("/agent 路径无 cookie → 重定向", () => {
    const request = createRequest("http://localhost/agent/tickets");
    const response = middleware(request as never);
    expect(response.status).toBe(307);
  });

  it("/admin 路径无 cookie → 重定向", () => {
    const request = createRequest("http://localhost/admin/stats");
    const response = middleware(request as never);
    expect(response.status).toBe(307);
  });
});
