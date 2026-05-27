import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  buildTicket,
  buildUser,
  buildAgentUser,
  buildChatMessage,
} from "../../../../helpers/factories";

// Mock 外部依赖
vi.mock("@/lib/notifications/server", () => ({
  broadcastTicketNotification: vi.fn(),
  getPendingTicketCounts: vi.fn(),
}));

vi.mock("@/lib/openai", () => ({
  classifyTicketDepartmentWithModel: vi.fn(() =>
    Promise.resolve({ departmentName: "医保办", confidence: 0.9, reason: "医保相关" })
  ),
  generateTicketKnowledgeDraftWithModel: vi.fn(),
}));

vi.mock("@/lib/services/conversations", () => ({
  appendConversationMessage: vi.fn(),
}));

vi.mock("@/lib/services/knowledge", () => ({
  upsertKnowledgeItem: vi.fn(),
}));

import {
  canAccessTicket,
  createTicketFromConversation,
  claimTicket,
  listTickets,
  replyTicket,
  escalateTicket,
  submitResolution,
  resolveTicket,
  closeTicketWithKnowledgeWriteback,
} from "@/lib/services/tickets";

import { broadcastTicketNotification } from "@/lib/notifications/server";
import { generateTicketKnowledgeDraftWithModel } from "@/lib/openai";
import { upsertKnowledgeItem } from "@/lib/services/knowledge";

// 测试内部纯函数 — 通过导出的 canAccessTicket 间接测试
// deriveTicketCategory, deriveTicketPriority 等通过 createTicketFromConversation 测试

describe("tickets service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.department.findMany.mockResolvedValue([
      { name: "医保办", description: "医保政策、结算对接" },
      { name: "其他部门", description: "兜底处理" },
    ]);
    prisma.department.findUnique.mockResolvedValue({ id: "dept-1", name: "营运部" });
  });

  // === 纯函数测试 ===

  describe("canAccessTicket", () => {
    it("staff 只能看自己创建的工单", () => {
      expect(
        canAccessTicket({
          role: "staff",
          userId: "user-1",
          ticket: { status: "pending_claim", createdByUserId: "user-1" },
        })
      ).toBe(true);

      expect(
        canAccessTicket({
          role: "staff",
          userId: "user-2",
          ticket: { status: "pending_claim", createdByUserId: "user-1" },
        })
      ).toBe(false);
    });

    it("admin 可看所有工单", () => {
      expect(
        canAccessTicket({
          role: "admin",
          userId: "admin-1",
          ticket: { status: "closed", createdByUserId: "user-1" },
        })
      ).toBe(true);
    });

    it("department 可看自己认领的工单", () => {
      expect(
        canAccessTicket({
          role: "department",
          userId: "agent-1",
          ticket: { status: "processing", createdByUserId: "user-1", claimedByUserId: "agent-1" },
        })
      ).toBe(true);
    });

    it("department 可看分发到本部门的 pending_claim", () => {
      expect(
        canAccessTicket({
          role: "department",
          userId: "agent-1",
          userDepartmentName: "营运部",
          ticket: {
            status: "pending_claim",
            createdByUserId: "user-1",
            escalatedToDept: "营运部",
          },
        })
      ).toBe(true);
    });

    it("department 不可看分发到其他部门的 pending_claim", () => {
      expect(
        canAccessTicket({
          role: "department",
          userId: "agent-2",
          userDepartmentName: "营运部",
          ticket: {
            status: "pending_claim",
            createdByUserId: "user-1",
            escalatedToDept: "采购部",
          },
        })
      ).toBe(false);
    });

    it("转派工单目标部门成员可见", () => {
      expect(
        canAccessTicket({
          role: "department",
          userId: "agent-2",
          userDepartmentName: "营运部",
          ticket: { status: "escalated", createdByUserId: "user-1", escalatedToDept: "营运部" },
        })
      ).toBe(true);
    });

    it("转派工单非目标部门不可见", () => {
      expect(
        canAccessTicket({
          role: "department",
          userId: "agent-3",
          userDepartmentName: "采购部",
          ticket: {
            status: "escalated",
            createdByUserId: "user-1",
            escalatedToDept: "营运部",
          },
        })
      ).toBe(false);
    });
  });

  // === 服务函数测试 ===

  describe("createTicketFromConversation", () => {
    it("无用户消息时抛错", async () => {
      prisma.chatMessage.findMany.mockResolvedValue([buildChatMessage({ role: "assistant" })]);

      await expect(
        createTicketFromConversation({ createdByUserId: "user-1", conversationId: "conv-1" })
      ).rejects.toThrow("当前会话缺少可用于转人工的用户问题");
    });

    it("正确创建工单", async () => {
      prisma.chatMessage.findMany.mockResolvedValue([
        buildChatMessage({ role: "user", contentText: "医保报销比例是多少？" }),
        buildChatMessage({ role: "assistant", contentText: "根据政策..." }),
      ]);
      prisma.ticket.create.mockResolvedValue(buildTicket({ id: "new-ticket" }));
      prisma.ticketMessage.createMany.mockResolvedValue({ count: 3 });

      const result = await createTicketFromConversation({
        createdByUserId: "user-1",
        conversationId: "conv-1",
      });

      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "pending_claim",
            category: "医保政策",
            createdByUserId: "user-1",
            conversationId: "conv-1",
          }),
        })
      );
      expect(broadcastTicketNotification).toHaveBeenCalled();
    });

    it("自动分类 - 商品库存", async () => {
      prisma.chatMessage.findMany.mockResolvedValue([
        buildChatMessage({ role: "user", contentText: "药品库存不够了" }),
      ]);
      prisma.ticket.create.mockResolvedValue(buildTicket());
      prisma.ticketMessage.createMany.mockResolvedValue({ count: 1 });

      await createTicketFromConversation({ createdByUserId: "user-1", conversationId: "conv-1" });

      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ category: "商品库存" }),
        })
      );
    });

    it("自动分类 - 默认用药咨询", async () => {
      prisma.chatMessage.findMany.mockResolvedValue([
        buildChatMessage({ role: "user", contentText: "头疼怎么办" }),
      ]);
      prisma.ticket.create.mockResolvedValue(buildTicket());
      prisma.ticketMessage.createMany.mockResolvedValue({ count: 1 });

      await createTicketFromConversation({ createdByUserId: "user-1", conversationId: "conv-1" });

      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ category: "用药咨询" }),
        })
      );
    });

    it("自动优先级 - 紧急为 high", async () => {
      prisma.chatMessage.findMany.mockResolvedValue([
        buildChatMessage({ role: "user", contentText: "系统异常无法登录" }),
      ]);
      prisma.ticket.create.mockResolvedValue(buildTicket());
      prisma.ticketMessage.createMany.mockResolvedValue({ count: 1 });

      await createTicketFromConversation({ createdByUserId: "user-1", conversationId: "conv-1" });

      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: "high" }),
        })
      );
    });
  });

  describe("claimTicket", () => {
    it("工单不存在时抛错", async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        claimTicket({ ticketId: "t-1", userId: "agent-1", userDisplayName: "部门人员" })
      ).rejects.toThrow("工单不存在");
    });

    it("非目标部门不能认领 pending_claim", async () => {
      prisma.ticket.findUnique.mockResolvedValue(buildTicket({ status: "pending_claim" }));

      await expect(
        claimTicket({
          ticketId: "t-1",
          userId: "agent-2",
          userDisplayName: "专家",
          userDepartmentName: "营运部",
        })
      ).rejects.toThrow("当前工单未分发到你的部门，不能认领");
    });

    it("转派工单非目标部门不能认领", async () => {
      prisma.ticket.findUnique.mockResolvedValue(
        buildTicket({
          status: "escalated",
          escalatedToDept: "营运部",
        })
      );

      await expect(
        claimTicket({
          ticketId: "t-1",
          userId: "agent-3",
          userDisplayName: "无关客服",
          userDepartmentName: "采购部",
        })
      ).rejects.toThrow("当前工单未分发到你的部门，不能认领");
    });

    it("正确认领 pending_claim 工单", async () => {
      prisma.ticket.findUnique.mockResolvedValue(
        buildTicket({ status: "pending_claim", escalatedToDept: "营运部" })
      );
      prisma.ticket.update.mockResolvedValue(
        buildTicket({ status: "processing", claimedByUserId: "agent-1" })
      );
      prisma.ticketMessage.create.mockResolvedValue({});

      const result = await claimTicket({
        ticketId: "t-1",
        userId: "agent-1",
        userDisplayName: "客服1",
        userDepartmentName: "营运部",
      });

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "processing", claimedByUserId: "agent-1" }),
        })
      );
      expect(broadcastTicketNotification).toHaveBeenCalled();
    });
  });

  describe("escalateTicket", () => {
    it("不是认领人时抛错", async () => {
      prisma.ticket.findUnique.mockResolvedValue(buildTicket({ claimedByUserId: "agent-1" }));

      await expect(
        escalateTicket({
          ticketId: "t-1",
          senderUserId: "agent-2",
          senderDisplayName: "客服2",
          targetDept: "营运部",
        })
      ).rejects.toThrow("只有工单认领人才能转派工单");
    });

    it("正确转派", async () => {
      prisma.ticket.findUnique.mockResolvedValue(
        buildTicket({ claimedByUserId: "agent-1", ticketNo: "TK001" })
      );
      prisma.ticket.update.mockResolvedValue(
        buildTicket({ status: "escalated", escalatedToDept: "营运部" })
      );
      prisma.ticketMessage.create.mockResolvedValue({});

      await escalateTicket({
        ticketId: "t-1",
        senderUserId: "agent-1",
        senderDisplayName: "客服1",
        targetDept: "营运部",
      });

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "escalated",
            escalatedToDept: "营运部",
            claimedByUserId: null,
          }),
        })
      );
      expect(broadcastTicketNotification).toHaveBeenCalled();
    });
  });

  describe("replyTicket", () => {
    it("工单不存在时抛错", async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        replyTicket({
          ticketId: "t-1",
          senderRole: "agent",
          senderUserId: "agent-1",
          content: "回复",
        })
      ).rejects.toThrow("工单不存在");
    });

    it("已关闭工单不能回复", async () => {
      prisma.ticket.findUnique.mockResolvedValue(buildTicket({ status: "closed" }));

      await expect(
        replyTicket({
          ticketId: "t-1",
          senderRole: "agent",
          senderUserId: "agent-1",
          content: "回复",
        })
      ).rejects.toThrow("工单已关闭，不能继续追加回复");
    });

    it("agent 回复 pending_claim 工单时自动转为 processing", async () => {
      prisma.ticket.findUnique.mockResolvedValue(buildTicket({ status: "pending_claim" }));
      prisma.ticketMessage.create.mockResolvedValue({});
      prisma.ticket.update.mockResolvedValue({});

      await replyTicket({
        ticketId: "t-1",
        senderRole: "agent",
        senderUserId: "agent-1",
        content: "我来处理",
      });

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "processing",
          }),
        })
      );
    });
  });

  describe("submitResolution", () => {
    it("不是认领人时抛错", async () => {
      prisma.ticket.findUnique.mockResolvedValue(
        buildTicket({ status: "processing", claimedByUserId: "agent-1" })
      );

      await expect(
        submitResolution({
          ticketId: "t-1",
          userId: "agent-2",
          resolutionText: "解决方案",
        })
      ).rejects.toThrow("只有当前认领人可以提交处理方案");
    });

    it("正确提交方案", async () => {
      prisma.ticket.findUnique.mockResolvedValue(
        buildTicket({ status: "processing", claimedByUserId: "agent-1" })
      );
      prisma.ticket.update.mockResolvedValue(buildTicket({ resolutionText: "方案" }));
      prisma.ticketMessage.create.mockResolvedValue({});

      await submitResolution({
        ticketId: "t-1",
        userId: "agent-1",
        resolutionText: "解决方案",
      });

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resolutionText: "解决方案",
            resolutionSubmittedByUserId: "agent-1",
          }),
        })
      );
      expect(broadcastTicketNotification).toHaveBeenCalled();
    });
  });

  describe("resolveTicket", () => {
    it("不是创建人时抛错", async () => {
      prisma.ticket.findUnique.mockResolvedValue(
        buildTicket({ createdByUserId: "user-1", claimedByUserId: "agent-1" })
      );

      await expect(resolveTicket({ ticketId: "t-1", resolvedByUserId: "user-2" })).rejects.toThrow(
        "只有提交工单的药店工作人员可以确认问题已解决"
      );
    });

    it("未提交方案时抛错", async () => {
      prisma.ticket.findUnique.mockResolvedValue(
        buildTicket({
          createdByUserId: "user-1",
          resolutionText: null,
          resolutionSubmittedAt: null,
        })
      );

      await expect(resolveTicket({ ticketId: "t-1", resolvedByUserId: "user-1" })).rejects.toThrow(
        "确认解决前需要部门人员先提交处理方案"
      );
    });

    it("正确标记为 resolved", async () => {
      prisma.ticket.findUnique.mockResolvedValue(
        buildTicket({
          createdByUserId: "user-1",
          claimedByUserId: "agent-1",
          resolutionText: "方案已解决",
          resolutionSubmittedAt: new Date(),
        })
      );
      prisma.ticket.update.mockResolvedValue(buildTicket({ status: "resolved" }));
      prisma.ticketMessage.create.mockResolvedValue({});

      const result = await resolveTicket({ ticketId: "t-1", resolvedByUserId: "user-1" });

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "resolved" }),
        })
      );
    });
  });

  describe("closeTicketWithKnowledgeWriteback", () => {
    it("工单不存在时抛错", async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        closeTicketWithKnowledgeWriteback({ ticketId: "t-1", closedByUserId: "user-1" })
      ).rejects.toThrow("工单不存在");
    });

    it("未解决时抛错", async () => {
      prisma.ticket.findUnique.mockResolvedValue(buildTicket({ status: "processing" }));

      await expect(
        closeTicketWithKnowledgeWriteback({ ticketId: "t-1", closedByUserId: "user-1" })
      ).rejects.toThrow("药店工作人员确认问题解决后才能关闭工单");
    });

    it("无权限时抛错", async () => {
      prisma.ticket.findUnique.mockResolvedValue(
        buildTicket({
          status: "resolved",
          createdByUserId: "user-1",
          claimedByUserId: "agent-1",
        })
      );

      await expect(
        closeTicketWithKnowledgeWriteback({ ticketId: "t-1", closedByUserId: "user-2" })
      ).rejects.toThrow("只有提交工单的药店工作人员、当前部门处理人或管理员可以关闭工单");
    });

    it("无草稿时抛错", async () => {
      prisma.ticket.findUnique.mockResolvedValue(
        buildTicket({
          status: "resolved",
          createdByUserId: "user-1",
          resolutionText: "方案",
          knowledgeStatus: "not_ready",
          knowledgeDrafts: [],
        })
      );

      await expect(
        closeTicketWithKnowledgeWriteback({ ticketId: "t-1", closedByUserId: "user-1" })
      ).rejects.toThrow("客服尚未生成待入库内容");
    });

    it("正确关闭并写回知识库", async () => {
      const draft = {
        id: "draft-1",
        ticketId: "t-1",
        categoryL1: "用药咨询",
        categoryL2: null,
        question: "问题",
        answer: "答案",
        tagsJson: '["标签1"]',
        imagePathsJson: "[]",
      };

      prisma.ticket.findUnique.mockResolvedValue(
        buildTicket({
          status: "resolved",
          createdByUserId: "user-1",
          claimedByUserId: "agent-1",
          resolutionText: "方案",
          knowledgeStatus: "pending_writeback",
          knowledgeDrafts: [draft],
        })
      );

      const mockUpsertedItem = { id: "ki-new" };
      (upsertKnowledgeItem as ReturnType<typeof vi.fn>).mockResolvedValue(mockUpsertedItem);

      prisma.$transaction.mockImplementation(async (fn: Function) => fn(prisma));
      prisma.ticketKnowledgeDraft.update.mockResolvedValue({});
      prisma.ticket.update.mockResolvedValue(buildTicket({ status: "closed" }));
      prisma.ticketMessage.create.mockResolvedValue({});

      const result = await closeTicketWithKnowledgeWriteback({
        ticketId: "t-1",
        closedByUserId: "user-1",
      });

      expect(upsertKnowledgeItem).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(broadcastTicketNotification).toHaveBeenCalled();
    });
  });

  describe("listTickets", () => {
    it("分页参数正确", async () => {
      // listTickets 调用 9 个并行查询
      const mockItems = [buildTicket()];
      const setupListMocks = () => {
        prisma.ticket.findMany.mockResolvedValue(mockItems);
        prisma.ticket.count
          .mockResolvedValueOnce(1) // total (where)
          .mockResolvedValueOnce(10) // all (roleWhere)
          .mockResolvedValueOnce(3) // pending
          .mockResolvedValueOnce(2) // processing
          .mockResolvedValueOnce(1) // escalated
          .mockResolvedValueOnce(3) // resolved
          .mockResolvedValueOnce(1) // closed
          .mockResolvedValueOnce(2); // myTickets
      };
      setupListMocks();

      const result = await listTickets({
        role: "staff",
        userId: "user-1",
        page: 1,
        pageSize: 10,
      });

      expect(result.items).toEqual(mockItems);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.summary.all).toBe(10);
    });
  });
});
