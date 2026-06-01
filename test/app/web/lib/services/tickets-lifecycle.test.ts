import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  buildTicket,
  buildUser,
  buildAgentUser,
  buildChatMessage,
  buildDepartment,
} from "../../../../helpers/factories";

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
  upsertQaKnowledgeDocument: vi.fn(),
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
import { upsertQaKnowledgeDocument } from "@/lib/services/knowledge";
import { appendConversationMessage } from "@/lib/services/conversations";

// ============================================================
// 工单完整流转测试
// ============================================================

describe("工单完整流转 (lifecycle)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.department.findMany.mockResolvedValue([
      { name: "医保办", description: "医保政策、结算对接" },
      { name: "营运部", description: "门店运营" },
      { name: "其他部门", description: "兜底处理" },
    ]);
    prisma.department.findUnique.mockResolvedValue({ id: "dept-1", name: "营运部" });
  });

  it("完整流程: 创建 → 认领 → 回复 → 提交方案 → 确认解决 → 关闭写回", async () => {
    // Step 1: 创建工单
    prisma.chatMessage.findMany.mockResolvedValue([
      buildChatMessage({ role: "user", contentText: "医保报销比例是多少？" }),
      buildChatMessage({ role: "assistant", contentText: "根据最新政策..." }),
    ]);
    const createdTicket = buildTicket({
      id: "ticket-flow",
      ticketNo: "TK20250601001",
      status: "pending_claim",
      escalatedToDept: "医保办",
      createdByUserId: "user-staff",
      conversationId: "conv-1",
    });
    prisma.ticket.create.mockResolvedValue(createdTicket);
    prisma.ticketMessage.createMany.mockResolvedValue({ count: 3 });

    const ticket = await createTicketFromConversation({
      createdByUserId: "user-staff",
      conversationId: "conv-1",
    });
    expect(ticket.status).toBe("pending_claim");
    expect(broadcastTicketNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ticket_created" })
    );

    // Step 2: 部门人员认领
    prisma.ticket.findUnique.mockResolvedValue(
      buildTicket({ id: "ticket-flow", status: "pending_claim", escalatedToDept: "医保办" })
    );
    prisma.ticket.update.mockResolvedValue(
      buildTicket({ id: "ticket-flow", status: "processing", claimedByUserId: "agent-1" })
    );
    prisma.ticketMessage.create.mockResolvedValue({});

    const claimed = await claimTicket({
      ticketId: "ticket-flow",
      userId: "agent-1",
      userDisplayName: "客服张三",
      userDepartmentName: "医保办",
    });
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "processing", claimedByUserId: "agent-1" }),
      })
    );
    expect(broadcastTicketNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ticket_claimed" })
    );

    // Step 3: 部门人员回复
    prisma.ticket.findUnique.mockResolvedValue(
      buildTicket({ id: "ticket-flow", status: "processing", claimedByUserId: "agent-1" })
    );
    prisma.ticketMessage.create.mockResolvedValue({});
    prisma.ticket.update.mockResolvedValue({});

    const replyMsg = await replyTicket({
      ticketId: "ticket-flow",
      senderRole: "agent",
      senderUserId: "agent-1",
      content: "根据2025年最新政策，报销比例为70%。",
    });
    expect(prisma.ticketMessage.create).toHaveBeenCalled();

    // Step 4: 提交处理方案
    prisma.ticket.findUnique.mockResolvedValue(
      buildTicket({
        id: "ticket-flow",
        status: "processing",
        claimedByUserId: "agent-1",
      })
    );
    prisma.ticket.update.mockResolvedValue(buildTicket({ resolutionText: "已告知报销比例" }));
    prisma.ticketMessage.create.mockResolvedValue({});

    const submitted = await submitResolution({
      ticketId: "ticket-flow",
      userId: "agent-1",
      resolutionText: "已告知报销比例",
    });
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolutionText: "已告知报销比例",
          resolutionSubmittedByUserId: "agent-1",
        }),
      })
    );
    expect(broadcastTicketNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ticket_resolution_submitted" })
    );

    // Step 5: 药店工作人员确认解决
    prisma.ticket.findUnique.mockResolvedValue(
      buildTicket({
        id: "ticket-flow",
        status: "processing",
        createdByUserId: "user-staff",
        claimedByUserId: "agent-1",
        resolutionText: "已告知报销比例",
        resolutionSubmittedAt: new Date(),
      })
    );
    prisma.ticket.update.mockResolvedValue(buildTicket({ status: "resolved" }));
    prisma.ticketMessage.create.mockResolvedValue({});

    const resolved = await resolveTicket({
      ticketId: "ticket-flow",
      resolvedByUserId: "user-staff",
    });
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "resolved" } })
    );
    expect(broadcastTicketNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ticket_resolved" })
    );

    // Step 6: 关闭工单并写回知识库
    const draft = {
      id: "draft-1",
      ticketId: "ticket-flow",
      question: "医保报销比例是多少？",
      answer: "根据2025年最新政策，报销比例为70%。",
      tagsJson: '["医保","报销"]',
      imagePathsJson: "[]",
    };
    prisma.ticket.findUnique.mockResolvedValue(
      buildTicket({
        id: "ticket-flow",
        status: "resolved",
        createdByUserId: "user-staff",
        claimedByUserId: "agent-1",
        resolutionText: "已告知报销比例",
        knowledgeStatus: "pending_writeback",
        knowledgeDrafts: [draft],
        conversationId: "conv-1",
      })
    );
    (upsertQaKnowledgeDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ki-new" });
    prisma.$transaction.mockImplementation(async (fn: Function) => fn(prisma));
    prisma.ticketKnowledgeDraft.update.mockResolvedValue({});
    prisma.ticket.update.mockResolvedValue(buildTicket({ status: "closed" }));
    prisma.ticketMessage.create.mockResolvedValue({});

    const closed = await closeTicketWithKnowledgeWriteback({
      ticketId: "ticket-flow",
      closedByUserId: "user-staff",
    });
    expect(upsertQaKnowledgeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "医保报销比例是多少？",
        answer: "根据2025年最新政策，报销比例为70%。",
        sourceType: "manual_ticket",
        sourceTicketId: "ticket-flow",
      })
    );
    expect(appendConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        contentText: "工单已关闭，客服生成的优质答案已写回知识库。",
      })
    );
    expect(broadcastTicketNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ticket_closed" })
    );
  });
});

// ============================================================
// canAccessTicket 补充边界测试
// ============================================================

describe("canAccessTicket 边界场景", () => {
  it("department 用户无部门名时不可见任何工单", () => {
    expect(
      canAccessTicket({
        role: "department",
        userId: "agent-1",
        userDepartmentName: undefined,
        ticket: { status: "pending_claim", createdByUserId: "user-1", escalatedToDept: "营运部" },
      })
    ).toBe(false);
  });

  it("department 用户无部门名时不可见自己认领的工单（claim 场景）", () => {
    // claimedByUserId 匹配时仍然可见
    expect(
      canAccessTicket({
        role: "department",
        userId: "agent-1",
        userDepartmentName: undefined,
        ticket: { status: "processing", createdByUserId: "user-1", claimedByUserId: "agent-1" },
      })
    ).toBe(true);
  });

  it("closed 工单对目标部门成员可见", () => {
    expect(
      canAccessTicket({
        role: "department",
        userId: "agent-1",
        userDepartmentName: "营运部",
        ticket: { status: "closed", createdByUserId: "user-1", escalatedToDept: "营运部" },
      })
    ).toBe(true);
  });

  it("closed 工单对非目标部门不可见", () => {
    expect(
      canAccessTicket({
        role: "department",
        userId: "agent-1",
        userDepartmentName: "采购部",
        ticket: { status: "closed", createdByUserId: "user-1", escalatedToDept: "营运部" },
      })
    ).toBe(false);
  });

  it("未知角色不可见", () => {
    expect(
      canAccessTicket({
        role: "unknown" as never,
        userId: "x",
        ticket: { status: "pending_claim", createdByUserId: "user-1" },
      })
    ).toBe(false);
  });

  it("staff 不可见别人的 escalated 工单", () => {
    expect(
      canAccessTicket({
        role: "staff",
        userId: "user-2",
        ticket: { status: "escalated", createdByUserId: "user-1", escalatedToDept: "营运部" },
      })
    ).toBe(false);
  });
});

// ============================================================
// listTickets 补充测试
// ============================================================

describe("listTickets 补充场景", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupListMocks(counts: {
    total: number;
    all: number;
    pending: number;
    processing: number;
    escalated: number;
    resolved: number;
    closed: number;
    myTickets: number;
  }) {
    prisma.ticket.findMany.mockResolvedValue([buildTicket()]);
    prisma.ticket.count
      .mockResolvedValueOnce(counts.total)
      .mockResolvedValueOnce(counts.all)
      .mockResolvedValueOnce(counts.pending)
      .mockResolvedValueOnce(counts.processing)
      .mockResolvedValueOnce(counts.escalated)
      .mockResolvedValueOnce(counts.resolved)
      .mockResolvedValueOnce(counts.closed)
      .mockResolvedValueOnce(counts.myTickets);
  }

  it("department 角色使用复合 OR 条件", async () => {
    setupListMocks({
      total: 5,
      all: 5,
      pending: 1,
      processing: 2,
      escalated: 1,
      resolved: 1,
      closed: 0,
      myTickets: 2,
    });

    const result = await listTickets({
      role: "department",
      userId: "agent-1",
      userDepartmentName: "营运部",
    });

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { claimedByUserId: "agent-1" },
                {
                  status: { in: ["pending_claim", "escalated"] },
                  escalatedToDept: "营运部",
                },
              ]),
            }),
          ]),
        }),
      })
    );
    expect(result.summary.all).toBe(5);
  });

  it("admin 角色无过滤条件", async () => {
    setupListMocks({
      total: 100,
      all: 100,
      pending: 10,
      processing: 20,
      escalated: 5,
      resolved: 30,
      closed: 35,
      myTickets: 0,
    });

    await listTickets({ role: "admin", userId: "admin-1" });

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
      })
    );
  });

  it("statusGroup 过滤生效", async () => {
    setupListMocks({
      total: 3,
      all: 10,
      pending: 3,
      processing: 2,
      escalated: 1,
      resolved: 3,
      closed: 1,
      myTickets: 0,
    });

    await listTickets({
      role: "admin",
      userId: "admin-1",
      statusGroup: "pending",
    });

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ status: { in: ["pending_claim"] } }]),
        }),
      })
    );
  });

  it("搜索关键词 q 生效", async () => {
    setupListMocks({
      total: 1,
      all: 10,
      pending: 1,
      processing: 2,
      escalated: 1,
      resolved: 3,
      closed: 3,
      myTickets: 0,
    });

    await listTickets({
      role: "admin",
      userId: "admin-1",
      q: "医保",
    });

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: expect.arrayContaining([
                { ticketNo: { contains: "医保" } },
                { title: { contains: "医保" } },
              ]),
            },
          ]),
        }),
      })
    );
  });

  it("分页参数被正确 clamp", async () => {
    setupListMocks({
      total: 0,
      all: 0,
      pending: 0,
      processing: 0,
      escalated: 0,
      resolved: 0,
      closed: 0,
      myTickets: 0,
    });

    const result = await listTickets({
      role: "staff",
      userId: "user-1",
      page: -1,
      pageSize: 999,
    });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50); // max 50
  });

  it("pageSize 最小值为 5", async () => {
    setupListMocks({
      total: 0,
      all: 0,
      pending: 0,
      processing: 0,
      escalated: 0,
      resolved: 0,
      closed: 0,
      myTickets: 0,
    });

    const result = await listTickets({
      role: "staff",
      userId: "user-1",
      pageSize: 1,
    });

    expect(result.pageSize).toBe(5);
  });

  it("department 无部门名时返回空结果", async () => {
    prisma.ticket.findMany.mockResolvedValue([]);
    prisma.ticket.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await listTickets({
      role: "department",
      userId: "agent-1",
      userDepartmentName: null,
    });

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "__no_visible_tickets__" },
      })
    );
  });
});

// ============================================================
// claimTicket 补充测试
// ============================================================

describe("claimTicket 补充场景", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("无部门名时抛错", async () => {
    prisma.ticket.findUnique.mockResolvedValue(buildTicket({ status: "pending_claim" }));

    await expect(
      claimTicket({
        ticketId: "t-1",
        userId: "agent-1",
        userDisplayName: "客服",
      })
    ).rejects.toThrow("当前账号未绑定部门，不能认领工单");
  });

  it("已关闭工单不能认领", async () => {
    prisma.ticket.findUnique.mockResolvedValue(buildTicket({ status: "closed" }));

    await expect(
      claimTicket({
        ticketId: "t-1",
        userId: "agent-1",
        userDisplayName: "客服",
        userDepartmentName: "营运部",
      })
    ).rejects.toThrow("当前工单不可认领");
  });

  it("processing 工单不能认领", async () => {
    prisma.ticket.findUnique.mockResolvedValue(buildTicket({ status: "processing" }));

    await expect(
      claimTicket({
        ticketId: "t-1",
        userId: "agent-1",
        userDisplayName: "客服",
        userDepartmentName: "营运部",
      })
    ).rejects.toThrow("当前工单不可认领");
  });

  it("正确认领 escalated 工单", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      buildTicket({ status: "escalated", escalatedToDept: "营运部" })
    );
    prisma.ticket.update.mockResolvedValue(
      buildTicket({ status: "processing", claimedByUserId: "agent-1" })
    );
    prisma.ticketMessage.create.mockResolvedValue({});

    await claimTicket({
      ticketId: "t-1",
      userId: "agent-1",
      userDisplayName: "客服",
      userDepartmentName: "营运部",
    });

    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["pending_claim", "escalated"] },
          escalatedToDept: "营运部",
        }),
        data: expect.objectContaining({ status: "processing" }),
      })
    );
  });

  it("认领时设置 firstRespondedAt（首次响应时间）", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      buildTicket({ status: "pending_claim", escalatedToDept: "营运部", firstRespondedAt: null })
    );
    prisma.ticket.update.mockResolvedValue(buildTicket({ status: "processing" }));
    prisma.ticketMessage.create.mockResolvedValue({});

    await claimTicket({
      ticketId: "t-1",
      userId: "agent-1",
      userDisplayName: "客服",
      userDepartmentName: "营运部",
    });

    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          firstRespondedAt: expect.any(Date),
        }),
      })
    );
  });
});

// ============================================================
// replyTicket 补充测试
// ============================================================

describe("replyTicket 补充场景", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("staff 回复不改变工单状态", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      buildTicket({ status: "processing", conversationId: "conv-1" })
    );
    prisma.ticketMessage.create.mockResolvedValue({});

    await replyTicket({
      ticketId: "t-1",
      senderRole: "user",
      senderUserId: "user-1",
      content: "补充说明",
    });

    // staff 回复不应触发 ticket.update（不改变状态）
    expect(prisma.ticket.update).not.toHaveBeenCalled();
    expect(prisma.ticketMessage.create).toHaveBeenCalled();
  });

  it("带附件的回复 messageType 为 image", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      buildTicket({ status: "processing", conversationId: null })
    );
    prisma.ticketMessage.create.mockResolvedValue({});

    await replyTicket({
      ticketId: "t-1",
      senderRole: "agent",
      senderUserId: "agent-1",
      content: "看这张图",
      attachments: JSON.stringify([{ name: "test.png", path: "/uploads/test.png" }]),
    });

    expect(prisma.ticketMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        messageType: "image",
        attachments: expect.any(String),
      }),
    });
  });

  it("agent 回复 escalated 工单时自动转为 processing", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      buildTicket({ status: "escalated", claimedByUserId: null, conversationId: null })
    );
    prisma.ticketMessage.create.mockResolvedValue({});
    prisma.ticket.update.mockResolvedValue({});

    await replyTicket({
      ticketId: "t-1",
      senderRole: "agent",
      senderUserId: "agent-new",
      content: "我来处理这个转派工单",
    });

    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "processing",
          claimedByUserId: "agent-new",
        }),
      })
    );
  });

  it("有 conversationId 时同步消息到会话", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      buildTicket({ status: "processing", conversationId: "conv-1" })
    );
    prisma.ticketMessage.create.mockResolvedValue({});

    await replyTicket({
      ticketId: "t-1",
      senderRole: "agent",
      senderUserId: "agent-1",
      content: "回复内容",
    });

    expect(appendConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        role: "agent",
        sourceType: "manual",
        contentText: "回复内容",
      })
    );
  });

  it("无 conversationId 时不同步消息", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      buildTicket({ status: "processing", conversationId: null })
    );
    prisma.ticketMessage.create.mockResolvedValue({});

    await replyTicket({
      ticketId: "t-1",
      senderRole: "agent",
      senderUserId: "agent-1",
      content: "回复内容",
    });

    expect(appendConversationMessage).not.toHaveBeenCalled();
  });
});

// ============================================================
// escalateTicket 补充测试
// ============================================================

describe("escalateTicket 补充场景", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("工单不存在时抛错", async () => {
    prisma.ticket.findUnique.mockResolvedValue(null);

    await expect(
      escalateTicket({
        ticketId: "t-1",
        senderUserId: "agent-1",
        senderDisplayName: "客服",
        targetDept: "营运部",
      })
    ).rejects.toThrow("工单不存在");
  });

  it("目标部门不存在时抛错", async () => {
    prisma.ticket.findUnique.mockResolvedValue(buildTicket({ claimedByUserId: "agent-1" }));
    prisma.department.findUnique.mockResolvedValue(null);

    await expect(
      escalateTicket({
        ticketId: "t-1",
        senderUserId: "agent-1",
        senderDisplayName: "客服",
        targetDept: "不存在的部门",
      })
    ).rejects.toThrow("目标部门不存在");
  });

  it("转派后清除 claimedByUserId", async () => {
    prisma.department.findFirst.mockResolvedValue({ id: "dept-1", name: "营运部" });
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
      senderDisplayName: "客服",
      targetDept: "营运部",
    });

    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          claimedByUserId: null,
          escalatedToUserId: null,
        }),
      })
    );
  });
});

// ============================================================
// submitResolution 补充测试
// ============================================================

describe("submitResolution 补充场景", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("工单不存在时抛错", async () => {
    prisma.ticket.findUnique.mockResolvedValue(null);

    await expect(
      submitResolution({ ticketId: "t-1", userId: "agent-1", resolutionText: "方案" })
    ).rejects.toThrow("工单不存在");
  });

  it("已关闭工单不能提交方案", async () => {
    prisma.ticket.findUnique.mockResolvedValue(buildTicket({ status: "closed" }));

    await expect(
      submitResolution({ ticketId: "t-1", userId: "agent-1", resolutionText: "方案" })
    ).rejects.toThrow("工单已关闭");
  });
});

// ============================================================
// resolveTicket 补充测试
// ============================================================

describe("resolveTicket 补充场景", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("工单不存在时抛错", async () => {
    prisma.ticket.findUnique.mockResolvedValue(null);

    await expect(resolveTicket({ ticketId: "t-1", resolvedByUserId: "user-1" })).rejects.toThrow(
      "工单不存在"
    );
  });

  it("已关闭工单不能确认解决", async () => {
    prisma.ticket.findUnique.mockResolvedValue(buildTicket({ status: "closed" }));

    await expect(resolveTicket({ ticketId: "t-1", resolvedByUserId: "user-1" })).rejects.toThrow(
      "工单已关闭"
    );
  });

  it("已确认解决的工单不能重复确认", async () => {
    prisma.ticket.findUnique.mockResolvedValue(buildTicket({ status: "resolved" }));

    await expect(resolveTicket({ ticketId: "t-1", resolvedByUserId: "user-1" })).rejects.toThrow(
      "工单已确认解决"
    );
  });

  it("有认领人时通知认领人", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      buildTicket({
        createdByUserId: "user-1",
        claimedByUserId: "agent-1",
        resolutionText: "方案",
        resolutionSubmittedAt: new Date(),
        ticketNo: "TK001",
      })
    );
    prisma.ticket.update.mockResolvedValue(buildTicket({ status: "resolved" }));
    prisma.ticketMessage.create.mockResolvedValue({});

    await resolveTicket({ ticketId: "t-1", resolvedByUserId: "user-1" });

    expect(broadcastTicketNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ticket_resolved",
        targetUserIds: ["agent-1"],
      })
    );
  });
});

// ============================================================
// closeTicketWithKnowledgeWriteback 补充测试
// ============================================================

describe("closeTicketWithKnowledgeWriteback 补充场景", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("admin 可以关闭任何工单", async () => {
    const draft = {
      id: "draft-1",
      question: "问题",
      answer: "答案",
      tagsJson: "[]",
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
        conversationId: null,
      })
    );
    (upsertQaKnowledgeDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ki-new" });
    prisma.$transaction.mockImplementation(async (fn: Function) => fn(prisma));
    prisma.ticketKnowledgeDraft.update.mockResolvedValue({});
    prisma.ticket.update.mockResolvedValue(buildTicket({ status: "closed" }));
    prisma.ticketMessage.create.mockResolvedValue({});

    const result = await closeTicketWithKnowledgeWriteback({
      ticketId: "t-1",
      closedByUserId: "admin-1",
      closedByRole: "admin",
    });

    expect(prisma.ticket.update).toHaveBeenCalled();
  });

  it("认领人可以关闭工单", async () => {
    const draft = {
      id: "draft-1",
      question: "问题",
      answer: "答案",
      tagsJson: "[]",
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
        conversationId: null,
      })
    );
    (upsertQaKnowledgeDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ki-new" });
    prisma.$transaction.mockImplementation(async (fn: Function) => fn(prisma));
    prisma.ticketKnowledgeDraft.update.mockResolvedValue({});
    prisma.ticket.update.mockResolvedValue(buildTicket({ status: "closed" }));
    prisma.ticketMessage.create.mockResolvedValue({});

    await closeTicketWithKnowledgeWriteback({
      ticketId: "t-1",
      closedByUserId: "agent-1",
    });

    expect(prisma.ticket.update).toHaveBeenCalled();
  });

  it("无 resolutionText 时不能关闭", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      buildTicket({
        status: "resolved",
        createdByUserId: "user-1",
        resolutionText: null,
        knowledgeStatus: "pending_writeback",
        knowledgeDrafts: [{ id: "d-1" }],
      })
    );

    await expect(
      closeTicketWithKnowledgeWriteback({ ticketId: "t-1", closedByUserId: "user-1" })
    ).rejects.toThrow("关闭工单需要部门人员先提交处理方案");
  });

  it("已关闭工单不能重复关闭", async () => {
    prisma.ticket.findUnique.mockResolvedValue(buildTicket({ status: "closed" }));

    await expect(
      closeTicketWithKnowledgeWriteback({ ticketId: "t-1", closedByUserId: "user-1" })
    ).rejects.toThrow("工单已关闭");
  });
});
