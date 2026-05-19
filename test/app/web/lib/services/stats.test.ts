import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  getStatsSummary,
  getTrendData,
  listHistoryMessages,
  listHistoryTickets,
} from "@/lib/services/stats";

describe("stats service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getStatsSummary", () => {
    it("返回聚合统计", async () => {
      // getStatsSummary 使用 Promise.all，需要 mock 7 个 count
      prisma.chatMessage.count
        .mockResolvedValueOnce(100) // totalQuestions
        .mockResolvedValueOnce(60) // kbHits
        .mockResolvedValueOnce(40); // llmAnswers
      prisma.ticket.count
        .mockResolvedValueOnce(30) // totalTickets
        .mockResolvedValueOnce(20) // closedTickets
        .mockResolvedValueOnce(15) // agentClosed
        .mockResolvedValueOnce(30); // transferCount

      const result = await getStatsSummary();

      expect(result.totalQuestions).toBe(100);
      expect(result.kbHits).toBe(60);
      expect(result.llmAnswers).toBe(40);
      expect(result.totalTickets).toBe(30);
      expect(result.closedTickets).toBe(20);
      expect(result.agentClosed).toBe(15);
    });

    it("计算 kbHitRate", async () => {
      prisma.chatMessage.count
        .mockResolvedValueOnce(200)
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(100);
      prisma.ticket.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const result = await getStatsSummary();
      expect(result.kbHitRate).toBe(0.5);
    });

    it("totalQuestions 为 0 时 kbHitRate 为 0", async () => {
      prisma.chatMessage.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      prisma.ticket.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const result = await getStatsSummary();
      expect(result.kbHitRate).toBe(0);
    });
  });

  describe("getTrendData", () => {
    it("返回 7 天数据", async () => {
      prisma.chatMessage.findMany.mockResolvedValue([]);
      prisma.ticket.findMany.mockResolvedValue([]);

      const result = await getTrendData();
      expect(result).toHaveLength(7);
      expect(result[0]).toHaveProperty("day");
      expect(result[0]).toHaveProperty("questionCount");
      expect(result[0]).toHaveProperty("kbHitCount");
    });

    it("每天统计正确", async () => {
      const today = new Date();
      const todayStr = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

      prisma.chatMessage.findMany.mockResolvedValue([
        { role: "user", sourceType: "kb", createdAt: today },
        { role: "assistant", sourceType: "kb", createdAt: today },
      ]);
      prisma.ticket.findMany.mockResolvedValue([
        { createdAt: today, status: "closed", closedAt: today },
      ]);

      const result = await getTrendData();
      const todayData = result[result.length - 1];
      expect(todayData.questionCount).toBe(1);
      expect(todayData.kbHitCount).toBe(1);
      expect(todayData.ticketCreatedCount).toBe(1);
      expect(todayData.ticketClosedCount).toBe(1);
    });
  });

  describe("listHistoryMessages", () => {
    it("分页参数正确", async () => {
      prisma.chatMessage.findMany.mockResolvedValue([]);
      prisma.chatMessage.count.mockResolvedValue(0);

      const result = await listHistoryMessages({ page: 2, pageSize: 20 });

      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(20);
      expect(result.pageCount).toBe(Math.max(1, Math.ceil(0 / 20)));
    });

    it("搜索查询构建正确", async () => {
      prisma.chatMessage.findMany.mockResolvedValue([]);
      prisma.chatMessage.count.mockResolvedValue(0);

      await listHistoryMessages({ q: "测试" });

      const findManyCall = prisma.chatMessage.findMany.mock.calls[0][0];
      expect(findManyCall.where.OR).toBeDefined();
      expect(findManyCall.where.OR.length).toBe(3);
    });

    it("默认 page=1, pageSize=10", async () => {
      prisma.chatMessage.findMany.mockResolvedValue([]);
      prisma.chatMessage.count.mockResolvedValue(0);

      const result = await listHistoryMessages();
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
    });
  });

  describe("listHistoryTickets", () => {
    it("分页参数正确", async () => {
      prisma.ticket.findMany.mockResolvedValue([]);
      prisma.ticket.count.mockResolvedValue(50);

      const result = await listHistoryTickets({ page: 3, pageSize: 15 });

      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(15);
      expect(result.pageCount).toBe(4);
    });

    it("搜索查询包含多个字段", async () => {
      prisma.ticket.findMany.mockResolvedValue([]);
      prisma.ticket.count.mockResolvedValue(0);

      await listHistoryTickets({ q: "医保" });

      const findManyCall = prisma.ticket.findMany.mock.calls[0][0];
      expect(findManyCall.where.OR).toBeDefined();
      expect(findManyCall.where.OR.length).toBe(5);
    });
  });
});
