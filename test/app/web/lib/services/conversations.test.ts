import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  createConversation,
  getConversationList,
  getConversationDetail,
  getConversationMessages,
  appendConversationMessage,
  refreshConversationTitle,
  softDeleteConversation,
} from "@/lib/services/conversations";
import { buildConversation, buildChatMessage } from "../../../../helpers/factories";

describe("conversations service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createConversation", () => {
    it("使用 userId 和截断标题创建会话", async () => {
      const conv = buildConversation();
      prisma.conversation.create.mockResolvedValue(conv);

      const result = await createConversation("user-1", "这是一个很长的问题标题用来测试截断功能");
      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          title: "这是一个很长的问题标题用来测试截断功能".slice(0, 30),
        },
      });
      expect(result).toEqual(conv);
    });

    it("无 initialQuestion 时默认标题为新会话", async () => {
      prisma.conversation.create.mockResolvedValue(buildConversation({ title: "新会话" }));

      await createConversation("user-1");
      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: { userId: "user-1", title: "新会话" },
      });
    });
  });

  describe("getConversationList", () => {
    it("按 userId 过滤，排除已删除，按 updatedAt 降序", async () => {
      const convs = [buildConversation()];
      prisma.conversation.findMany.mockResolvedValue(convs);

      const result = await getConversationList("user-1");
      expect(prisma.conversation.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1", deletedAt: null },
        orderBy: { updatedAt: "desc" },
      });
      expect(result).toEqual(convs);
    });
  });

  describe("getConversationDetail", () => {
    it("按 ID 查找", async () => {
      const conv = buildConversation();
      prisma.conversation.findUnique.mockResolvedValue(conv);

      const result = await getConversationDetail("conv-1");
      expect(prisma.conversation.findUnique).toHaveBeenCalledWith({
        where: { id: "conv-1" },
      });
      expect(result).toEqual(conv);
    });
  });

  describe("getConversationMessages", () => {
    it("按 conversationId 查找，按 createdAt 升序", async () => {
      const msgs = [buildChatMessage()];
      prisma.chatMessage.findMany.mockResolvedValue(msgs);

      const result = await getConversationMessages("conv-1");
      expect(prisma.chatMessage.findMany).toHaveBeenCalledWith({
        where: { conversationId: "conv-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toEqual(msgs);
    });
  });

  describe("appendConversationMessage", () => {
    it("创建消息，默认 status 为 completed", async () => {
      const msg = buildChatMessage({ role: "user", sourceType: "kb" });
      prisma.chatMessage.create.mockResolvedValue(msg);

      const result = await appendConversationMessage({
        conversationId: "conv-1",
        role: "user",
        sourceType: "kb",
        contentText: "测试",
      });

      expect(prisma.chatMessage.create).toHaveBeenCalledWith({
        data: {
          conversationId: "conv-1",
          role: "user",
          sourceType: "kb",
          contentText: "测试",
          status: "completed",
          attachmentsJson: null,
          retrievalDebugJson: null,
        },
      });
      expect(result).toEqual(msg);
    });

    it("支持自定义 status 和 attachmentsJson", async () => {
      prisma.chatMessage.create.mockResolvedValue(buildChatMessage());

      await appendConversationMessage({
        conversationId: "conv-1",
        role: "assistant",
        sourceType: "llm",
        contentText: "回答",
        status: "streaming",
        attachmentsJson: '[{"name":"a.png","path":"a.png","mimeType":"image/png","size":100}]',
      });

      expect(prisma.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "streaming",
            attachmentsJson: '[{"name":"a.png","path":"a.png","mimeType":"image/png","size":100}]',
          }),
        })
      );
    });
  });

  describe("refreshConversationTitle", () => {
    it("更新标题并截断 30 字符", async () => {
      prisma.conversation.update.mockResolvedValue({});

      await refreshConversationTitle("conv-1", "这是一个很长的问题标题用来测试截断功能应该被截断");
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: "conv-1" },
        data: { title: "这是一个很长的问题标题用来测试截断功能应该被截断".slice(0, 30) },
      });
    });

    it("空输入时默认为图片问题", async () => {
      prisma.conversation.update.mockResolvedValue({});

      await refreshConversationTitle("conv-1", "");
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: "conv-1" },
        data: { title: "图片问题" },
      });
    });
  });

  describe("softDeleteConversation", () => {
    it("不存在时抛出会话不存在", async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);

      await expect(
        softDeleteConversation({ conversationId: "conv-1", userId: "user-1" })
      ).rejects.toThrow("会话不存在");
    });

    it("设置 deletedAt", async () => {
      prisma.conversation.findFirst.mockResolvedValue(buildConversation());
      prisma.conversation.update.mockResolvedValue(buildConversation({ deletedAt: new Date() }));

      await softDeleteConversation({ conversationId: "conv-1", userId: "user-1" });

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: "conv-1" },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("按 userId 和 deletedAt=null 过滤", async () => {
      prisma.conversation.findFirst.mockResolvedValue(buildConversation());
      prisma.conversation.update.mockResolvedValue(buildConversation());

      await softDeleteConversation({ conversationId: "conv-1", userId: "user-1" });

      expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
        where: { id: "conv-1", userId: "user-1", deletedAt: null },
      });
    });
  });
});
