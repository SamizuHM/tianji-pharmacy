import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildUser } from "../../../helpers/factories";

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/services/knowledge", () => ({
  getKnowledgeDocumentDetail: vi.fn(),
  updateKnowledgeDocumentMetadata: vi.fn(),
  deleteKnowledgeDocument: vi.fn(),
}));

import { GET, PATCH, DELETE } from "@/app/api/knowledge/documents/[id]/route";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getKnowledgeDocumentDetail,
  updateKnowledgeDocumentMetadata,
  deleteKnowledgeDocument,
} from "@/lib/services/knowledge";

const adminUser = buildUser({ id: "admin-1", role: "admin" });
const staffUser = buildUser({ id: "staff-1", role: "staff" });

describe("/api/knowledge/documents/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("非管理员不能读取文档详情", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(staffUser);

    const response = await GET(new Request("http://localhost/api/knowledge/documents/doc-1"), {
      params: Promise.resolve({ id: "doc-1" }),
    });

    expect(response.status).toBe(403);
    expect(getKnowledgeDocumentDetail).not.toHaveBeenCalled();
  });

  it("管理员可读取带 HQ 的文档详情", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser);
    (getKnowledgeDocumentDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "doc-1",
      title: "测试文档",
      chunks: [{ id: "chunk-1", hypotheticalQuestionsJson: '["怎么查产品参数"]' }],
    });

    const response = await GET(new Request("http://localhost/api/knowledge/documents/doc-1"), {
      params: Promise.resolve({ id: "doc-1" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.document.chunks[0].hypotheticalQuestionsJson).toContain("产品参数");
  });

  it("管理员可更新文档地域和基础元数据", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser);
    (updateKnowledgeDocumentMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "doc-1",
      title: "新标题",
      scopeLevel: "city",
      cityName: "武汉",
    });

    const request = new Request("http://localhost/api/knowledge/documents/doc-1", {
      method: "PATCH",
      body: JSON.stringify({
        title: "新标题",
        businessCategory: "产品资料",
        scopeLevel: "city",
        cityName: "武汉",
        status: "published",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "doc-1" }) });

    expect(response.status).toBe(200);
    expect(updateKnowledgeDocumentMetadata).toHaveBeenCalledWith("doc-1", {
      title: "新标题",
      businessCategory: "产品资料",
      scopeLevel: "city",
      cityName: "武汉",
      status: "published",
    });
  });

  it("更新城市专属文档时必须选择湖北城市", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser);

    const request = new Request("http://localhost/api/knowledge/documents/doc-1", {
      method: "PATCH",
      body: JSON.stringify({
        title: "新标题",
        businessCategory: "产品资料",
        scopeLevel: "city",
        cityName: "",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "doc-1" }) });

    expect(response.status).toBe(400);
    expect(updateKnowledgeDocumentMetadata).not.toHaveBeenCalled();
  });

  it("管理员可删除知识文档", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser);
    (deleteKnowledgeDocument as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const response = await DELETE(new Request("http://localhost/api/knowledge/documents/doc-1"), {
      params: Promise.resolve({ id: "doc-1" }),
    });

    expect(response.status).toBe(200);
    expect(deleteKnowledgeDocument).toHaveBeenCalledWith("doc-1");
  });
});
