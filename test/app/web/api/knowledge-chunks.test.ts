import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { buildUser } from "../../../helpers/factories";

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: vi.fn(),
}));

import { GET } from "@/app/api/knowledge/chunks/[id]/route";
import { getCurrentUser } from "@/lib/auth/session";

describe("GET /api/knowledge/chunks/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未登录返回 401", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/knowledge/chunks/chunk-1"), {
      params: Promise.resolve({ id: "chunk-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("管理员可读取 chunk 原文", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser({ role: "admin" }));
    prisma.knowledgeChunk.findUnique.mockResolvedValue({
      id: "chunk-1",
      chunkText: "通义Vivid 7具备AI智能摄影。",
      sourceFile: "手机产品.docx",
      scopeLevel: "city",
      cityName: "武汉",
      document: { title: "手机产品", scopeLevel: "city", cityName: "武汉" },
    });

    const response = await GET(new Request("http://localhost/api/knowledge/chunks/chunk-1"), {
      params: Promise.resolve({ id: "chunk-1" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.chunk.chunkText).toBe("通义Vivid 7具备AI智能摄影。");
  });

  it("非管理员只能读取本城市或通用 chunk", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildUser({ id: "staff-1", role: "staff" })
    );
    prisma.knowledgeChunk.findUnique.mockResolvedValue({
      id: "chunk-1",
      chunkText: "武汉专属内容",
      sourceFile: "武汉.docx",
      scopeLevel: "city",
      cityName: "武汉",
      document: null,
    });
    prisma.user.findUnique.mockResolvedValue({
      id: "staff-1",
      store: { cityName: "武汉" },
    });

    const response = await GET(new Request("http://localhost/api/knowledge/chunks/chunk-1"), {
      params: Promise.resolve({ id: "chunk-1" }),
    });

    expect(response.status).toBe(200);
  });

  it("非管理员不能读取其他城市 chunk", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildUser({ id: "staff-1", role: "staff" })
    );
    prisma.knowledgeChunk.findUnique.mockResolvedValue({
      id: "chunk-1",
      chunkText: "宜昌专属内容",
      sourceFile: "宜昌.docx",
      scopeLevel: "city",
      cityName: "宜昌",
      document: null,
    });
    prisma.user.findUnique.mockResolvedValue({
      id: "staff-1",
      store: { cityName: "武汉" },
    });

    const response = await GET(new Request("http://localhost/api/knowledge/chunks/chunk-1"), {
      params: Promise.resolve({ id: "chunk-1" }),
    });

    expect(response.status).toBe(403);
  });
});
