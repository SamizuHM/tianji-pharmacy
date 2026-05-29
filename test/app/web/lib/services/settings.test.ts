import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { getRuntimeSettings, updateRuntimeSettings } from "@/lib/services/settings";

describe("settings service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getRuntimeSettings", () => {
    it("无 DB 设置时返回 env 默认值", async () => {
      prisma.appSetting.findMany.mockResolvedValue([]);

      const result = await getRuntimeSettings();
      expect(result.retrievalTopK).toBe(5);
      expect(result.rerankTopN).toBe(3);
      expect(result.kbHitThreshold).toBe(0.7);
      expect(result.maxContextTurns).toBe(4);
      expect(result.cityScopeWeight).toBe(1.3);
    });

    it("DB 值覆盖 env 默认值", async () => {
      prisma.appSetting.findMany.mockResolvedValue([
        { key: "RETRIEVAL_TOP_K", value: "10" },
        { key: "RERANK_TOP_N", value: "7" },
        { key: "KB_HIT_THRESHOLD", value: "0.85" },
        { key: "MAX_CONTEXT_TURNS", value: "8" },
        { key: "CITY_SCOPE_WEIGHT", value: "1.6" },
      ]);

      const result = await getRuntimeSettings();
      expect(result.retrievalTopK).toBe(10);
      expect(result.rerankTopN).toBe(7);
      expect(result.kbHitThreshold).toBe(0.85);
      expect(result.maxContextTurns).toBe(8);
      expect(result.cityScopeWeight).toBe(1.6);
    });

    it("部分 DB 值存在时，其余使用 env 默认值", async () => {
      prisma.appSetting.findMany.mockResolvedValue([{ key: "RETRIEVAL_TOP_K", value: "20" }]);

      const result = await getRuntimeSettings();
      expect(result.retrievalTopK).toBe(20);
      expect(result.rerankTopN).toBe(3);
      expect(result.kbHitThreshold).toBe(0.7);
      expect(result.maxContextTurns).toBe(4);
    });
  });

  describe("updateRuntimeSettings", () => {
    it("调用 upsert 5 次", async () => {
      prisma.appSetting.upsert.mockResolvedValue({});
      prisma.appSetting.findMany.mockResolvedValue([
        { key: "RETRIEVAL_TOP_K", value: "15" },
        { key: "RERANK_TOP_N", value: "6" },
        { key: "KB_HIT_THRESHOLD", value: "0.8" },
        { key: "MAX_CONTEXT_TURNS", value: "5" },
        { key: "CITY_SCOPE_WEIGHT", value: "1.5" },
      ]);

      await updateRuntimeSettings({
        retrievalTopK: 15,
        rerankTopN: 6,
        kbHitThreshold: 0.8,
        maxContextTurns: 5,
        cityScopeWeight: 1.5,
      });

      expect(prisma.appSetting.upsert).toHaveBeenCalledTimes(5);
    });

    it("将数字转换为字符串存储", async () => {
      prisma.appSetting.upsert.mockResolvedValue({});
      prisma.appSetting.findMany.mockResolvedValue([]);

      await updateRuntimeSettings({
        retrievalTopK: 15,
        rerankTopN: 6,
        kbHitThreshold: 0.8,
        maxContextTurns: 5,
        cityScopeWeight: 1.5,
      });

      const calls = prisma.appSetting.upsert.mock.calls;
      const values = calls.map(
        (c: unknown[]) => (c[0] as { update: { value: string } }).update.value
      );
      expect(values).toContain("15");
      expect(values).toContain("6");
      expect(values).toContain("0.8");
      expect(values).toContain("5");
      expect(values).toContain("1.5");
    });

    it("返回更新后的设置", async () => {
      prisma.appSetting.upsert.mockResolvedValue({});
      prisma.appSetting.findMany.mockResolvedValue([
        { key: "RETRIEVAL_TOP_K", value: "15" },
        { key: "RERANK_TOP_N", value: "6" },
        { key: "KB_HIT_THRESHOLD", value: "0.8" },
        { key: "MAX_CONTEXT_TURNS", value: "5" },
        { key: "CITY_SCOPE_WEIGHT", value: "1.5" },
      ]);

      const result = await updateRuntimeSettings({
        retrievalTopK: 15,
        rerankTopN: 6,
        kbHitThreshold: 0.8,
        maxContextTurns: 5,
        cityScopeWeight: 1.5,
      });

      expect(result.retrievalTopK).toBe(15);
      expect(result.cityScopeWeight).toBe(1.5);
    });
  });
});
