import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildUser } from "../../../helpers/factories";

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/services/settings", () => ({
  getRuntimeSettings: vi.fn(),
  updateRuntimeSettings: vi.fn(),
}));

import { GET, PUT } from "@/app/api/settings/route";
import { getCurrentUser } from "@/lib/auth/session";
import { getRuntimeSettings, updateRuntimeSettings } from "@/lib/services/settings";

describe("GET /api/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未登录返回 401", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("返回设置", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser({ role: "admin" }));
    (getRuntimeSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      retrievalTopK: 5,
      rerankTopN: 3,
      kbHitThreshold: 0.7,
      maxContextTurns: 4,
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.settings).toBeDefined();
    expect(body.settings.retrievalTopK).toBe(5);
  });
});

describe("PUT /api/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未登录返回 401", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const request = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PUT(request);
    expect(response.status).toBe(401);
  });

  it("无效数据返回 400", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser({ role: "admin" }));

    const request = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        retrievalTopK: -1,
        rerankTopN: 3,
        kbHitThreshold: 0.5,
        maxContextTurns: 4,
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);
  });

  it("rerankTopN > retrievalTopK 返回 400", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser({ role: "admin" }));

    const request = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        retrievalTopK: 5,
        rerankTopN: 10,
        kbHitThreshold: 0.5,
        maxContextTurns: 4,
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("重排数量不能大于召回数量");
  });

  it("有效数据更新成功", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser({ role: "admin" }));
    (updateRuntimeSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      retrievalTopK: 10,
      rerankTopN: 5,
      kbHitThreshold: 0.8,
      maxContextTurns: 6,
    });

    const request = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        retrievalTopK: 10,
        rerankTopN: 5,
        kbHitThreshold: 0.8,
        maxContextTurns: 6,
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PUT(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.settings.retrievalTopK).toBe(10);
  });
});
