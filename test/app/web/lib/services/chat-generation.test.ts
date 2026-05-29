import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";

vi.mock("@/lib/active-streams", () => ({
  registerStream: vi.fn(),
  emitDelta: vi.fn(),
  completeStream: vi.fn(),
  failStream: vi.fn(),
  isStreamActive: vi.fn(),
}));

vi.mock("@/lib/openai", () => ({
  streamKbStyledAnswer: vi.fn(),
  streamGeneralPharmacyAnswer: vi.fn(),
  buildKbStyledPrompt: vi.fn().mockReturnValue({ system: "系统提示", userText: "用户文本" }),
  buildGeneralPharmacyPrompt: vi.fn().mockReturnValue({ system: "系统提示", userText: "用户文本" }),
}));

vi.mock("@/lib/retrieval/ml-service", () => ({
  streamMultimodalChat: vi.fn(),
}));

vi.mock("@/lib/services/conversations", () => ({
  appendConversationMessage: vi.fn(),
  getConversationMessages: vi.fn(),
  refreshConversationTitle: vi.fn(),
}));

vi.mock("@/lib/services/retrieval", () => ({
  retrieveAnswer: vi.fn(),
}));

vi.mock("@/lib/services/settings", () => ({
  getRuntimeSettings: vi.fn().mockResolvedValue({
    retrievalTopK: 5,
    rerankTopN: 3,
    kbHitThreshold: 0.7,
    maxContextTurns: 4,
    cityScopeWeight: 1.3,
  }),
}));

import { createAssistantGenerationStream } from "@/lib/services/chat-generation";
import { appendConversationMessage, getConversationMessages } from "@/lib/services/conversations";
import { retrieveAnswer } from "@/lib/services/retrieval";
import { streamGeneralPharmacyAnswer } from "@/lib/openai";
import { registerStream, completeStream, failStream } from "@/lib/active-streams";

async function consumeStream(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value, { stream: true });
  }
  return fullText;
}

describe("createAssistantGenerationStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("create 模式：创建用户消息并刷新标题", async () => {
    (appendConversationMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "user-msg-1", createdAt: new Date() }) // user message
      .mockResolvedValueOnce({ id: "asst-msg-1" }); // assistant message
    (getConversationMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (retrieveAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      sourceType: "llm",
      queryText: "测试",
      retrievalDebug: [],
    });

    // 创建一个空的异步迭代器模拟流
    async function* emptyStream() {}
    (streamGeneralPharmacyAnswer as ReturnType<typeof vi.fn>).mockResolvedValue(emptyStream());

    const response = createAssistantGenerationStream({
      mode: "create",
      conversationId: "conv-1",
      text: "测试问题",
      attachments: [],
    });

    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");

    // 消费流以触发所有异步逻辑
    await consumeStream(response);

    expect(appendConversationMessage).toHaveBeenCalledTimes(2); // user + assistant
    expect(registerStream).toHaveBeenCalledWith("asst-msg-1");
    expect(completeStream).toHaveBeenCalledWith("asst-msg-1");
  });

  it("从会话账号绑定门店读取城市名并注入检索作用域", async () => {
    (appendConversationMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "user-msg-1", createdAt: new Date() })
      .mockResolvedValueOnce({ id: "asst-msg-1" });
    (getConversationMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    prisma.conversation.findUnique.mockResolvedValueOnce({
      id: "conv-1",
      user: {
        storeId: "store-1",
        store: {
          cityName: "武汉",
        },
      },
    });
    (retrieveAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      sourceType: "llm",
      queryText: "测试",
      retrievalDebug: [],
    });
    async function* emptyStream() {}
    (streamGeneralPharmacyAnswer as ReturnType<typeof vi.fn>).mockResolvedValue(emptyStream());

    const response = createAssistantGenerationStream({
      mode: "create",
      conversationId: "conv-1",
      text: "武汉医保怎么处理",
      attachments: [],
    });

    await consumeStream(response);

    expect(retrieveAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        region: expect.objectContaining({
          cityName: "武汉",
        }),
      }),
      expect.any(Object)
    );
  });

  it("KB 命中路径使用知识库风格回答", async () => {
    (appendConversationMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "user-msg-1", createdAt: new Date() })
      .mockResolvedValueOnce({ id: "asst-msg-1" });
    (getConversationMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (retrieveAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      sourceType: "kb",
      queryText: "测试",
      retrievalDebug: [],
      knowledgeItem: { id: "ki-1", question: "Q", answer: "A", imagePaths: [] },
      referenceSnippets: ["引用1"],
    });

    const { streamKbStyledAnswer } = await import("@/lib/openai");
    async function* emptyStream() {}
    (streamKbStyledAnswer as ReturnType<typeof vi.fn>).mockResolvedValue(emptyStream());

    const response = createAssistantGenerationStream({
      mode: "create",
      conversationId: "conv-1",
      text: "医保怎么报销",
      attachments: [],
    });

    await consumeStream(response);

    expect(streamKbStyledAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "医保怎么报销",
        referenceQuestion: "Q",
        referenceAnswer: "A",
      })
    );
  });

  it("错误时发送 error 事件并关闭流", async () => {
    (appendConversationMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "user-msg-1", createdAt: new Date() })
      .mockResolvedValueOnce({ id: "asst-msg-1" });
    (getConversationMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    // retrieveAnswer 之后，streamGeneralPharmacyAnswer 抛出错误
    (retrieveAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      sourceType: "llm",
      queryText: "测试",
      retrievalDebug: [],
    });
    (streamGeneralPharmacyAnswer as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("LLM 服务异常")
    );
    // prisma.chatMessage.update 在错误处理中被调用，需要 mock
    prisma.chatMessage.update.mockResolvedValue({});

    const response = createAssistantGenerationStream({
      mode: "create",
      conversationId: "conv-1",
      text: "测试",
      attachments: [],
    });

    const text = await consumeStream(response);

    expect(text).toContain("error");
    expect(text).toContain("LLM 服务异常");
    expect(failStream).toHaveBeenCalledWith("asst-msg-1");
    expect(prisma.chatMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "asst-msg-1" },
        data: expect.objectContaining({ status: "failed" }),
      })
    );
  });

  it("强制知识库类问题未命中时直接拒答，不调用通用大模型", async () => {
    (appendConversationMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "user-msg-1", createdAt: new Date() })
      .mockResolvedValueOnce({ id: "asst-msg-1" });
    (getConversationMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (retrieveAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      sourceType: "refusal",
      queryText: "医保刷不了",
      retrievalDebug: [],
      refusalReason: "当前知识库中未找到相关政策，建议咨询上级主管部门。",
    });

    const response = createAssistantGenerationStream({
      mode: "create",
      conversationId: "conv-1",
      text: "医保刷不了",
      attachments: [],
    });

    const text = await consumeStream(response);

    expect(text).toContain("当前知识库中未找到相关政策，建议咨询上级主管部门。");
    expect(text).not.toContain("不会使用通用大模型兜底回答");
    expect(streamGeneralPharmacyAnswer).not.toHaveBeenCalled();
    expect(completeStream).toHaveBeenCalledWith("asst-msg-1");
  });

  it("SSE 流包含 progress、delta、done 事件", async () => {
    (appendConversationMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "user-msg-1", createdAt: new Date() })
      .mockResolvedValueOnce({ id: "asst-msg-1" });
    (getConversationMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (retrieveAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      sourceType: "llm",
      queryText: "测试",
      retrievalDebug: [],
    });

    // 模拟 LLM 返回流数据
    async function* mockStream() {
      yield { choices: [{ delta: { content: "你好" } }] };
      yield { choices: [{ delta: { content: "，世界" } }] };
    }
    (streamGeneralPharmacyAnswer as ReturnType<typeof vi.fn>).mockResolvedValue(mockStream());

    const response = createAssistantGenerationStream({
      mode: "create",
      conversationId: "conv-1",
      text: "测试",
      attachments: [],
    });

    const text = await consumeStream(response);

    expect(text).toContain("event: progress");
    expect(text).toContain("event: delta");
    expect(text).toContain("event: done");
    expect(text).toContain("你好");
    expect(text).toContain("，世界");
  });
});
