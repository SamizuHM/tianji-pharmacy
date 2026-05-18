import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { buildTicket, buildChatMessage, buildUser } from "../../../../helpers/factories";

vi.mock("@/lib/notifications/server", () => ({
  broadcastTicketNotification: vi.fn(),
  getPendingTicketCounts: vi.fn(),
}));

vi.mock("@/lib/openai", () => ({
  generateTicketKnowledgeDraftWithModel: vi.fn(),
}));

vi.mock("@/lib/services/conversations", () => ({
  appendConversationMessage: vi.fn(),
}));

vi.mock("@/lib/services/knowledge", () => ({
  upsertKnowledgeItem: vi.fn(),
}));

import {
  getTicketDetail,
  getTicketKnowledgeMaterials,
  generateTicketKnowledgeDraft,
} from "@/lib/services/tickets";
import { generateTicketKnowledgeDraftWithModel } from "@/lib/openai";

describe("tickets 补全测试", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getTicketDetail", () => {
    it("返回包含关联数据的工单详情", async () => {
      const ticket = buildTicket();
      prisma.ticket.findUnique.mockResolvedValue(ticket);

      const result = await getTicketDetail("ticket-1");

      expect(prisma.ticket.findUnique).toHaveBeenCalledWith({
        where: { id: "ticket-1" },
        include: expect.objectContaining({
          createdBy: true,
          messages: expect.any(Object),
          knowledgeDrafts: expect.any(Object),
        }),
      });
      expect(result).toEqual(ticket);
    });

    it("不存在的工单返回 null", async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      const result = await getTicketDetail("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getTicketKnowledgeMaterials", () => {
    it("过滤系统消息并转换格式", async () => {
      prisma.ticket.findUnique.mockResolvedValue(
        buildTicket({
          messages: [
            { id: "m1", senderRole: "system", messageType: "system", content: "系统消息", attachments: null, createdAt: new Date(), senderUser: null },
            { id: "m2", senderRole: "user", messageType: "text", content: "用户问题", attachments: null, createdAt: new Date(), senderUser: { displayName: "用户A" } },
            { id: "m3", senderRole: "agent", messageType: "text", content: "客服回复", attachments: null, createdAt: new Date(), senderUser: { displayName: "客服B" } },
          ],
        })
      );

      const materials = await getTicketKnowledgeMaterials("ticket-1");

      expect(materials).toHaveLength(2);
      expect(materials[0].role).toBe("user");
      expect(materials[1].role).toBe("agent");
    });

    it("工单不存在时抛错", async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(getTicketKnowledgeMaterials("nonexistent")).rejects.toThrow("工单不存在");
    });
  });

  describe("generateTicketKnowledgeDraft", () => {
    it("工单不存在时抛错", async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        generateTicketKnowledgeDraft({
          ticketId: "nonexistent",
          generatedByUserId: "agent-1",
          selectedMaterialIds: ["m1"],
        })
      ).rejects.toThrow("工单不存在");
    });

    it("已关闭工单不能生成草稿", async () => {
      prisma.ticket.findUnique.mockResolvedValue(buildTicket({ status: "closed" }));

      await expect(
        generateTicketKnowledgeDraft({
          ticketId: "t-1",
          generatedByUserId: "agent-1",
          selectedMaterialIds: ["m1"],
        })
      ).rejects.toThrow("工单已关闭，不能重新生成待入库内容");
    });

    it("未解决的工单不能生成草稿", async () => {
      prisma.ticket.findUnique.mockResolvedValue(buildTicket({ status: "processing" }));

      await expect(
        generateTicketKnowledgeDraft({
          ticketId: "t-1",
          generatedByUserId: "agent-1",
          selectedMaterialIds: ["m1"],
        })
      ).rejects.toThrow("药店工作人员确认问题解决后，客服才能生成待入库内容");
    });

    it("未选择有效内容时抛错", async () => {
      prisma.ticket.findUnique.mockResolvedValue(
        buildTicket({
          status: "resolved",
          messages: [
            { id: "m1", senderRole: "system", messageType: "system", content: "系统消息", attachments: null, createdAt: new Date(), senderUser: null },
          ],
        })
      );

      await expect(
        generateTicketKnowledgeDraft({
          ticketId: "t-1",
          generatedByUserId: "agent-1",
          selectedMaterialIds: ["nonexistent-id"],
        })
      ).rejects.toThrow("请选择用于入库的有效对话内容");
    });

    it("正确生成知识草稿", async () => {
      const ticket = buildTicket({
        status: "resolved",
        ticketNo: "TK001",
        title: "测试工单",
        messages: [
          { id: "tm:user1", senderRole: "user", messageType: "text", content: "用户问题内容", attachments: null, createdAt: new Date("2025-01-01"), senderUser: { displayName: "用户A" } },
          { id: "tm:agent1", senderRole: "agent", messageType: "text", content: "客服回答内容", attachments: null, createdAt: new Date("2025-01-01"), senderUser: { displayName: "客服B" } },
        ],
      });
      prisma.ticket.findUnique
        .mockResolvedValueOnce(ticket)   // generateTicketKnowledgeDraft 中查找
        .mockResolvedValue(ticket);      // getTicketKnowledgeMaterials 中查找

      (generateTicketKnowledgeDraftWithModel as ReturnType<typeof vi.fn>).mockResolvedValue({
        categoryL1: "用药咨询",
        categoryL2: null,
        question: "生成的问题",
        answer: "生成的答案",
        tags: ["标签1"],
      });

      prisma.$transaction.mockImplementation(async (fn: Function) => fn(prisma));
      prisma.ticketKnowledgeDraft.create.mockResolvedValue({
        id: "draft-1",
        categoryL1: "用药咨询",
        question: "生成的问题",
        answer: "生成的答案",
      });
      prisma.ticket.update.mockResolvedValue({});

      const result = await generateTicketKnowledgeDraft({
        ticketId: "t-1",
        generatedByUserId: "agent-1",
        selectedMaterialIds: ["ticketMessage:tm:user1", "ticketMessage:tm:agent1"],
      });

      expect(generateTicketKnowledgeDraftWithModel).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});
