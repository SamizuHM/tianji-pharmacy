"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import type { AttachmentItem } from "@pharmacy/shared";
import {
  ArrowDown,
  Bot,
  CircleAlert,
  ClipboardPaste,
  Database,
  ImagePlus,
  LifeBuoy,
  Plus,
  SendHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X
} from "lucide-react";

import { AttachmentGallery } from "@/components/shared/attachment-gallery";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  formatDurationSeconds,
  PROGRESS_STEP_LABELS,
  PROGRESS_STEP_ORDER,
  type ProgressDonePayload,
  type ProgressEventPayload,
  type ProgressStepKey,
  type ProgressSummaryItem
} from "@/lib/chat-progress";
import { getAttachmentItems, getFileUrl, safeJsonParse } from "@/lib/utils";

type Conversation = {
  id: string;
  title: string;
  updatedAt: string | Date;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "agent" | "system";
  sourceType: "kb" | "llm" | "manual" | "system";
  contentText: string;
  attachmentsJson: string | null;
  retrievalDebugJson: string | null;
  feedback: "helpful" | "unhelpful" | null;
  createdAt: string | Date;
};

type StreamDebugPayload = {
  retrievalDebug?: Array<{ question: string; sourceFile?: string | null; rerankScore: number }>;
  imagePaths?: string[];
};

type MessageProgressState = {
  status: "running" | "completed" | "error";
  steps: Partial<Record<ProgressStepKey, ProgressSummaryItem>>;
  currentStepKey?: ProgressStepKey;
  currentStepStartedClientAt?: number;
  currentElapsedMs: number;
  totalDurationMs?: number;
  firstResponseLatencyMs?: number | null;
  firstTokenLatencyMs?: number | null;
  reasoningAnswerMs?: number;
  waitFirstTokenMs?: number;
  streamAnswerMs?: number;
};

export function ChatClient(props: {
  conversationId: string | null;
  conversations: Conversation[];
  messages: Message[];
  serviceHotline: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [messages, setMessages] = useState<Message[]>(props.messages);
  const [conversations, setConversations] = useState<Conversation[]>(props.conversations);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(props.conversationId);
  const [progressByMessageId, setProgressByMessageId] = useState<Record<string, MessageProgressState>>({});
  const [finalProgressByAssistantId, setFinalProgressByAssistantId] = useState<Record<string, MessageProgressState>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [mobileAssistantOpen, setMobileAssistantOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previousConversationIdRef = useRef<string | null>(props.conversationId);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => setMessages(props.messages), [props.messages]);
  useEffect(() => setConversations(props.conversations), [props.conversations]);
  useEffect(() => setCurrentConversationId(props.conversationId), [props.conversationId]);
  useEffect(() => {
    const hasRunningProgress = Object.values(progressByMessageId).some((item) => item.status === "running");
    if (!hasRunningProgress) {
      return;
    }

    const timer = window.setInterval(() => setNowMs(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [progressByMessageId]);
  useEffect(() => {
    if (previousConversationIdRef.current === currentConversationId) {
      return;
    }
    previousConversationIdRef.current = currentConversationId;
    setProgressByMessageId({});
    setFinalProgressByAssistantId({});
    // 切换会话时滚动到底部
    requestAnimationFrame(() => {
      scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight });
    });
  }, [currentConversationId]);

  // 自动滚动：流式消息返回时，若用户在底部附近则持续滚动
  useEffect(() => {
    if (!isNearBottomRef.current) {
      return;
    }
    scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight });
  }, [messages]);

  function handleScroll() {
    const el = scrollContainerRef.current;
    if (!el) {
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    isNearBottomRef.current = nearBottom;
    setShowScrollButton(!nearBottom);
  }

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === currentConversationId) ?? null,
    [currentConversationId, conversations]
  );

  async function uploadFiles(fileList: FileList | File[]) {
    if (!fileList.length) return;
    const formData = new FormData();
    Array.from(fileList).forEach((file) => formData.append("files", file));

    const response = await fetch("/api/uploads", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "上传失败");
    }

    setAttachments((current) => [...current, ...data.files]);
  }

  function startNewConversation() {
    setMobileHistoryOpen(false);
    setCurrentConversationId(null);
    setMessages([]);
    setProgressByMessageId({});
    setFinalProgressByAssistantId({});
    setText("");
    setAttachments([]);
    router.push("/staff/chat");
  }

  async function createConversationForFirstMessage(input: { title: string }) {
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: input.title })
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "创建会话失败");
      return null;
    }
    const conversation = data.conversation as Conversation;
    setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
    setCurrentConversationId(conversation.id);
    window.history.replaceState(null, "", `/staff/chat?conversationId=${conversation.id}`);
    return conversation.id;
  }

  async function deleteConversation(conversationId: string) {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: "DELETE"
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "删除会话失败");
      return;
    }

    const remaining = conversations.filter((item) => item.id !== conversationId);
    setConversations(remaining);
    setMobileHistoryOpen(false);

    if (conversationId === currentConversationId) {
      setCurrentConversationId(null);
      setMessages([]);
      setProgressByMessageId({});
      setFinalProgressByAssistantId({});
      router.push("/staff/chat");
    } else {
      router.refresh();
    }
  }

  async function sendMessage() {
    if (!text.trim() && !attachments.length) {
      setError("请输入文字或上传图片后再发送");
      return;
    }

    setError("");
    setSending(true);

    const requestAttachments = attachments;
    const requestText = text.trim();
    const optimisticUserId = `temp-user-${Date.now()}`;
    const optimisticAssistantId = `temp-assistant-${Date.now()}`;

    setMessages((current) => [
      ...current,
      {
        id: optimisticUserId,
        role: "user",
        sourceType: "system",
        contentText: requestText || "用户上传了图片",
        attachmentsJson: requestAttachments.length ? JSON.stringify(requestAttachments) : null,
        retrievalDebugJson: null,
        feedback: null,
        createdAt: new Date().toISOString()
      },
      {
        id: optimisticAssistantId,
        role: "assistant",
        sourceType: "system",
        contentText: "",
        attachmentsJson: null,
        retrievalDebugJson: null,
        feedback: null,
        createdAt: new Date().toISOString()
      }
    ]);

    setText("");
    setAttachments([]);

    try {
      const conversationId =
        currentConversationId ??
        (await createConversationForFirstMessage({
          title: requestText || "图片问题"
        }));

      if (!conversationId) {
        throw new Error("创建会话失败");
      }

      const response = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: requestText,
          attachments: requestAttachments
        })
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "发送失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalDebug: StreamDebugPayload = {};
      let finalProgressState: MessageProgressState | undefined;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const lines = frame.split("\n");
          const eventLine = lines.find((line) => line.startsWith("event:"));
          const dataLine = lines.find((line) => line.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const event = eventLine.replace("event:", "").trim();
          const payload = JSON.parse(dataLine.replace("data:", "").trim()) as {
            text?: string;
            error?: string;
            sourceType?: Message["sourceType"];
            retrievalDebug?: StreamDebugPayload["retrievalDebug"];
            imagePaths?: string[];
            totalDurationMs?: number;
            stepsSummary?: ProgressSummaryItem[];
            assistantMessageId?: string;
            firstResponseLatencyMs?: number | null;
            firstTokenLatencyMs?: number | null;
            reasoningAnswerMs?: number;
            waitFirstTokenMs?: number;
            streamAnswerMs?: number;
          };

          if (event === "meta" && payload.sourceType) {
            setMessages((current) =>
              current.map((item) =>
                item.id === optimisticAssistantId ? { ...item, sourceType: payload.sourceType! } : item
              )
            );
          }

          if (event === "debug") {
            finalDebug = {
              retrievalDebug: payload.retrievalDebug,
              imagePaths: payload.imagePaths
            };
          }

          if (event === "progress") {
            const progressPayload = payload as ProgressEventPayload;
            setProgressByMessageId((current) => {
              const existing = current[optimisticAssistantId] ?? {
                status: "running" as const,
                steps: {},
                currentElapsedMs: 0
              };

              if (progressPayload.status === "started") {
                return {
                  ...current,
                  [optimisticAssistantId]: {
                    ...existing,
                    status: "running",
                    currentStepKey: progressPayload.stepKey,
                    currentStepStartedClientAt: Date.now(),
                    currentElapsedMs: progressPayload.elapsedTotalMs
                  }
                };
              }

              return {
                ...current,
                [optimisticAssistantId]: {
                  ...existing,
                  status: "running",
                  steps: {
                    ...existing.steps,
                    [progressPayload.stepKey]: {
                      stepKey: progressPayload.stepKey,
                      label: progressPayload.label,
                      startedAtMs: progressPayload.startedAtMs,
                      endedAtMs: progressPayload.endedAtMs ?? progressPayload.startedAtMs,
                      durationMs: progressPayload.durationMs ?? 0,
                      detail: progressPayload.detail
                    }
                  },
                  currentStepKey:
                    existing.currentStepKey === progressPayload.stepKey ? undefined : existing.currentStepKey,
                  currentStepStartedClientAt:
                    existing.currentStepKey === progressPayload.stepKey ? undefined : existing.currentStepStartedClientAt,
                  currentElapsedMs: progressPayload.elapsedTotalMs
                }
              };
            });
          }

          if (event === "delta" && payload.text) {
            setMessages((current) =>
              current.map((item) =>
                item.id === optimisticAssistantId ? { ...item, contentText: item.contentText + payload.text! } : item
              )
            );
          }

          if (event === "done" && payload.assistantMessageId) {
            const donePayload = payload as ProgressDonePayload;
            const completedState: MessageProgressState = {
              status: "completed",
              steps: Object.fromEntries(donePayload.stepsSummary.map((item) => [item.stepKey, item])),
              currentElapsedMs: donePayload.totalDurationMs,
              totalDurationMs: donePayload.totalDurationMs,
              firstResponseLatencyMs: donePayload.firstResponseLatencyMs,
              firstTokenLatencyMs: donePayload.firstTokenLatencyMs,
              reasoningAnswerMs: donePayload.reasoningAnswerMs,
              waitFirstTokenMs: donePayload.waitFirstTokenMs,
              streamAnswerMs: donePayload.streamAnswerMs
            };
            finalProgressState = completedState;
            setProgressByMessageId((current) => ({
              ...current,
              [optimisticAssistantId]: completedState
            }));
            setFinalProgressByAssistantId((current) => ({
              ...current,
              [donePayload.assistantMessageId]: completedState
            }));
          }

          if (event === "error") {
            throw new Error(payload.error || "生成回答失败");
          }
        }
      }

      setMessages((current) =>
        current.map((item) =>
          item.id === optimisticAssistantId
            ? { ...item, retrievalDebugJson: JSON.stringify({ debug: finalDebug.retrievalDebug ?? [], imagePaths: finalDebug.imagePaths ?? [] }) }
            : item
        )
      );
      if (finalProgressState) {
        setProgressByMessageId((current) => ({
          ...current,
          [optimisticAssistantId]: finalProgressState!
        }));
      }
      router.refresh();
    } catch (sendError) {
      setProgressByMessageId((current) => {
        const existing = current[optimisticAssistantId];
        if (!existing) {
          return current;
        }
        return {
          ...current,
          [optimisticAssistantId]: {
            ...existing,
            status: "error",
            currentStepKey: undefined,
            currentStepStartedClientAt: undefined
          }
        };
      });
      setError(sendError instanceof Error ? sendError.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  async function createTicket() {
    if (!currentConversationId) {
      setError("请先发送一条消息后再转人工");
      return;
    }
    const response = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: currentConversationId })
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "创建工单失败");
      return;
    }
    router.push(`/staff/tickets/${data.ticket.id}`);
  }

  async function updateFeedback(messageId: string, feedback: "helpful" | "unhelpful") {
    setMessages((current) =>
      current.map((item) => (item.id === messageId ? { ...item, feedback: item.feedback === feedback ? null : feedback } : item))
    );

    await fetch(`/api/messages/${messageId}/feedback`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feedback: messages.find((item) => item.id === messageId)?.feedback === feedback ? null : feedback
      })
    }).catch(() => undefined);
  }

  function openConversation(conversationId: string) {
    setMobileHistoryOpen(false);
    setCurrentConversationId(conversationId);
    router.push(`/staff/chat?conversationId=${conversationId}`);
  }

  const conversationHistory = (
    <>
      <div className="flex flex-col gap-2">
        {conversations.map((item) => (
          <div
            key={item.id}
            className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm transition-all duration-150 ${
              activeConversation?.id === item.id ? "border-blue-200 bg-blue-50 shadow-sm" : "border-transparent hover:bg-slate-50 hover:border-slate-200"
            }`}
          >
            <button type="button" onClick={() => openConversation(item.id)} className="flex-1 text-left">
              <div className="truncate font-medium text-slate-900">{item.title}</div>
              <div className="mt-1 text-xs text-muted">{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</div>
            </button>
            <button
              type="button"
              className="rounded p-1 text-muted transition-all duration-150 hover:bg-red-50 hover:text-red-500"
              onClick={() => deleteConversation(item.id)}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </>
  );

  const assistantInfo = (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>助手信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex size-16 items-center justify-center rounded-full bg-blue-100 text-primary">
              <Bot className="size-8" />
            </div>
            <div>
              <div className="font-semibold text-slate-900">药店智能助手</div>
              <div className="mt-1 flex items-center gap-2 text-sm text-emerald-600">
                <span className="size-2 rounded-full bg-emerald-500" />
                在线
              </div>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted">基于企业知识库与大模型的智能问答助手，提供专业、准确、高效的支持服务。</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>能力范围</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {["药品知识", "合规政策", "经营管理", "系统操作", "医保政策", "会员权益"].map((item) => (
            <Badge key={item} className="border border-border bg-white px-3 py-2 text-slate-600">
              {item}
            </Badge>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>知识库来源</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {["企业 SOP 手册", "药品法规政策", "常见问题库", "医保政策库", "系统操作指南", "培训资料库"].map((item) => (
            <div key={item} className="flex items-center gap-2 text-slate-700">
              <BookOpenIcon />
              {item}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-6rem)] min-h-0 flex-col overflow-hidden xl:grid xl:h-[calc(100vh-8rem)] xl:grid-cols-[280px_minmax(0,1fr)_280px] xl:gap-5">
      <Card className="hidden min-h-[520px] flex-col overflow-hidden xl:flex">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>会话历史</CardTitle>
          <Button size="sm" variant="secondary" onClick={startNewConversation}>
            <Plus className="size-4" />
            新建会话
          </Button>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-3">
          {conversationHistory}
        </CardContent>
      </Card>

      <Card className="min-h-0 flex flex-1 flex-col overflow-hidden xl:flex-none">
        <CardHeader className="hidden xl:block">
          <CardTitle>门店智能问答</CardTitle>
          <p className="text-sm text-muted">支持文字、图片与图文混合输入；知识库命中后做受控润色，未命中时走通用药店场景问答。</p>
        </CardHeader>
        <CardContent className="relative flex min-h-0 flex-1 flex-col p-0">
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-white px-3 xl:hidden">
            <Sheet open={mobileHistoryOpen} onOpenChange={setMobileHistoryOpen}>
              <SheetTrigger asChild>
                <Button size="sm" variant="ghost">历史</Button>
              </SheetTrigger>
              <SheetContent side="left" className="max-w-[86vw]">
                <SheetHeader>
                  <SheetTitle>会话历史</SheetTitle>
                </SheetHeader>
                <SheetBody className="p-3">
                  <Button className="mb-3 w-full" variant="secondary" onClick={startNewConversation}>
                    <Plus className="size-4" />
                    新建会话
                  </Button>
                  {conversationHistory}
                </SheetBody>
              </SheetContent>
            </Sheet>
            <div className="min-w-0 text-center">
              <div className="truncate text-sm font-semibold text-slate-950">门店智能问答</div>
              <div className="truncate text-[11px] text-muted">{activeConversation?.title ?? "新会话"}</div>
            </div>
            <Sheet open={mobileAssistantOpen} onOpenChange={setMobileAssistantOpen}>
              <SheetTrigger asChild>
                <Button size="sm" variant="ghost">助手</Button>
              </SheetTrigger>
              <SheetContent side="right" className="max-w-[86vw]">
                <SheetHeader>
                  <SheetTitle>助手信息</SheetTitle>
                </SheetHeader>
                <SheetBody className="p-3">{assistantInfo}</SheetBody>
              </SheetContent>
            </Sheet>
          </div>
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-3 pb-4 pt-4 sm:px-5 sm:pt-5"
          >
            {!messages.length ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-blue-100 text-primary">
                  <Sparkles className="size-7" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-slate-900">门店智能问答</h3>
                <p className="mt-2 max-w-xs text-sm text-muted">
                  在下方输入您的门店相关问题，支持文字、图片与图文混合输入
                </p>
              </div>
            ) : null}
            <div className="flex flex-col gap-4">
              {messages.map((message) => {
                const attachmentsData = getAttachmentItems(message.attachmentsJson);
                const debugPayload = safeJsonParse<{
                  debug?: Array<{ question: string; sourceFile?: string | null; rerankScore: number }>;
                  imagePaths?: string[];
                }>(message.retrievalDebugJson, {});
                const retrievalDebug = debugPayload.debug ?? [];
                const imagePaths = debugPayload.imagePaths ?? [];
                const progressState = progressByMessageId[message.id] ?? finalProgressByAssistantId[message.id];
                const messageText =
                  message.contentText || (message.role === "assistant" && progressState?.status === "running" ? "正在生成..." : "");
                const isUser = message.role === "user";

                return (
                  <div
                    key={message.id}
                    className={`flex gap-2 sm:gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    {!isUser ? (
                      <div className="mt-2 hidden size-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600 sm:flex">
                        {message.sourceType === "kb" ? <Database className="size-4" /> : <Sparkles className="size-4" />}
                      </div>
                    ) : null}
                    <div
                      className={`max-w-[92%] rounded-xl border px-3 py-2.5 shadow-sm sm:max-w-[86%] sm:px-4 sm:py-3 ${
                        isUser ? "border-blue-100 bg-blue-50 text-slate-900" : "border-border bg-white"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <Badge className={sourceBadgeClass(message.sourceType)}>{sourceLabel(message.sourceType, message.role)}</Badge>
                        <span className="text-xs text-muted">{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      {message.role === "assistant" && progressState ? <ProgressCard progress={progressState} nowMs={nowMs} /> : null}
                      <div className="whitespace-pre-wrap text-sm leading-6">{messageText}</div>
                      {imagePaths.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {imagePaths.map((img, i) => (
                            <img
                              key={i}
                              src={getFileUrl(img)}
                              alt=""
                              className="max-h-48 cursor-pointer rounded-lg border border-border object-contain transition-all duration-200 hover:scale-[1.02] hover:opacity-80 hover:shadow-md"
                              onClick={() => window.open(getFileUrl(img), "_blank")}
                            />
                          ))}
                        </div>
                      ) : null}
                      <AttachmentGallery attachments={attachmentsData} />
                      {message.role === "assistant" ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted">
                          {retrievalDebug[0] ? (
                            <div className="mr-auto rounded border border-border bg-slate-50 px-3 py-2">
                              命中知识：{retrievalDebug[0].question || "无"} · 相似度 {retrievalDebug[0].rerankScore.toFixed(2)}
                            </div>
                          ) : null}
                          <button
                            type="button"
                            className={`rounded p-1.5 transition-all duration-150 hover:bg-blue-50 hover:text-primary active:scale-90 ${message.feedback === "helpful" ? "bg-blue-50 text-primary" : ""}`}
                            onClick={() => updateFeedback(message.id, "helpful")}
                          >
                            <ThumbsUp className="size-4" />
                          </button>
                          <button
                            type="button"
                            className={`rounded p-1.5 transition-all duration-150 hover:bg-red-50 hover:text-red-500 active:scale-90 ${message.feedback === "unhelpful" ? "bg-red-50 text-red-500" : ""}`}
                            onClick={() => updateFeedback(message.id, "unhelpful")}
                          >
                            <ThumbsDown className="size-4" />
                          </button>
                          <Button size="sm" variant="outline" onClick={createTicket} disabled={sending}>
                            <LifeBuoy className="size-4" />
                            人工服务
                          </Button>
                        </div>
                      ) : null}
                      {retrievalDebug.length > 1 ? (
                        <details className="mt-3 rounded-lg border border-border bg-slate-50 p-3 text-xs">
                          <summary className="cursor-pointer text-muted">查看更多命中来源</summary>
                          <div className="mt-2 flex flex-col gap-2">
                            {retrievalDebug.slice(1).map((item, index) => (
                              <div key={`${message.id}-${index}`} className="rounded border border-border bg-white p-2">
                                <div>问题：{item.question}</div>
                                <div>来源：{item.sourceFile || "未知来源"}</div>
                                <div>分数：{item.rerankScore.toFixed(4)}</div>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {messages.length ? (
                <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted">
                  <CircleAlert className="size-4" />
                  每次回答后都可点击人工服务；仍不明确时请拨打 {props.serviceHotline} 电话咨询。
                </div>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            className={`absolute bottom-20 right-4 z-10 flex size-9 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-all duration-300 hover:bg-blue-700 sm:bottom-72 sm:right-6 ${
              showScrollButton ? "scale-100 opacity-100" : "pointer-events-none scale-75 opacity-0"
            }`}
            onClick={() => scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: "smooth" })}
          >
            <ArrowDown className="size-4" />
          </button>

          <div className="shrink-0 border-t border-border bg-white p-3 sm:p-5">
            {/* 手机端：单行输入框 + 内嵌图标按钮 */}
            <div className="relative sm:hidden">
              {attachments.length ? (
                <div className="flex flex-wrap gap-1.5 rounded-lg border border-blue-100 bg-white px-3 py-2 shadow-sm">
                  {attachments.map((item) => (
                    <span key={item.path} className="inline-flex items-center gap-1 rounded border border-border bg-slate-50 px-2 py-1 text-xs">
                      {item.name}
                      <button type="button" className="text-slate-400 hover:text-red-500" onClick={() => setAttachments((current) => current.filter((file) => file.path !== item.path))}>
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="flex items-end rounded-lg border border-blue-100 bg-white shadow-sm focus-within:border-primary focus-within:shadow-md">
                <textarea
                  ref={textareaRef}
                  placeholder="请输入门店问题..."
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onPaste={async (event) => {
                    const clipboardFiles = Array.from(event.clipboardData.items)
                      .filter((item) => item.type.startsWith("image/"))
                      .map((item) => item.getAsFile())
                      .filter((item): item is File => Boolean(item));

                    if (clipboardFiles.length) {
                      event.preventDefault();
                      await uploadFiles(clipboardFiles);
                    }
                  }}
                  rows={1}
                  className="max-h-[33dvh] min-h-0 flex-1 resize-none overflow-y-auto bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-slate-400"
                  style={{ fieldSizing: "content" }}
                />
                <div className="flex shrink-0 items-center gap-1 pr-2 pb-1">
                  <label className="flex size-8 cursor-pointer items-center justify-center rounded-full text-primary transition-all duration-150 hover:bg-blue-50 active:scale-90">
                    <ImagePlus className="size-5" />
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      multiple
                      className="hidden"
                      onChange={async (event) => {
                        if (event.target.files?.length) {
                          await uploadFiles(event.target.files);
                          event.target.value = "";
                        }
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={sending || (!text.trim() && !attachments.length)}
                    className="flex size-8 items-center justify-center rounded-full bg-primary text-white transition-all duration-150 hover:bg-blue-700 active:scale-90 disabled:opacity-50"
                  >
                    <SendHorizontal className="size-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* PC端：保持原有多行布局 */}
            <div className="hidden rounded-lg border border-blue-100 bg-white shadow-sm transition-all duration-200 focus-within:border-primary focus-within:shadow-md sm:block">
              <Textarea
                placeholder="请输入门店问题，或粘贴截图后补充说明..."
                value={text}
                onChange={(event) => setText(event.target.value)}
                onPaste={async (event) => {
                  const clipboardFiles = Array.from(event.clipboardData.items)
                    .filter((item) => item.type.startsWith("image/"))
                    .map((item) => item.getAsFile())
                    .filter((item): item is File => Boolean(item));

                  if (clipboardFiles.length) {
                    event.preventDefault();
                    await uploadFiles(clipboardFiles);
                  }
                }}
                className="min-h-24 border-none focus:ring-0"
              />
              <div className="flex flex-wrap gap-2 px-4">
                {attachments.map((item) => (
                  <span key={item.path} className="inline-flex items-center gap-2 rounded border border-border bg-slate-50 px-3 py-2 text-xs transition-all duration-150 hover:border-slate-300">
                    {item.name}
                    <button type="button" className="rounded transition-colors duration-150 hover:bg-red-50 hover:text-red-500" onClick={() => setAttachments((current) => current.filter((file) => file.path !== item.path))}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
                <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded border border-border bg-white px-3 text-sm text-primary transition-all duration-150 hover:border-blue-200 hover:bg-blue-50 hover:shadow-sm active:scale-[0.97]">
                  <ImagePlus className="size-4" />
                  上传图片
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    multiple
                    className="hidden"
                    onChange={async (event) => {
                      if (event.target.files?.length) {
                        await uploadFiles(event.target.files);
                        event.target.value = "";
                      }
                    }}
                  />
                </label>
                <button type="button" className="inline-flex h-9 items-center gap-2 rounded px-3 text-sm text-slate-600 transition-all duration-150 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97]">
                  <ClipboardPaste className="size-4" />
                  粘贴图片
                </button>
                <div className="ml-auto text-xs text-muted">{text.length}/2000</div>
                <Button onClick={sendMessage} disabled={sending}>
                  <SendHorizontal className="size-4" />
                  {sending ? "发送中..." : "发送"}
                </Button>
              </div>
            </div>

            {error ? <Alert className="mt-3 border-destructive bg-red-50 text-destructive">{error}</Alert> : null}
          </div>
        </CardContent>
      </Card>

      <div className="hidden xl:block">{assistantInfo}</div>
    </div>
  );
}

function BookOpenIcon() {
  return <Database className="size-4 text-primary" />;
}

function sourceLabel(sourceType: Message["sourceType"], role: Message["role"]) {
  if (role === "agent") {
    return "人工客服";
  }

  switch (sourceType) {
    case "kb":
      return "知识库";
    case "llm":
      return "大模型";
    case "manual":
      return "人工处理";
    default:
      return "系统";
  }
}

function sourceBadgeClass(sourceType: Message["sourceType"]) {
  if (sourceType === "kb") {
    return "bg-primary/10 text-primary";
  }
  if (sourceType === "llm") {
    return "bg-accent/30 text-foreground";
  }
  if (sourceType === "manual") {
    return "bg-secondary text-foreground";
  }
  return "";
}

function ProgressCard(props: { progress: MessageProgressState; nowMs: number }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const visibleSteps = PROGRESS_STEP_ORDER.filter(
    (stepKey) => props.progress.steps[stepKey] || props.progress.currentStepKey === stepKey
  );
  const totalDurationMs =
    props.progress.status === "running" && props.progress.currentStepStartedClientAt
      ? props.progress.currentElapsedMs + Math.max(0, props.nowMs - props.progress.currentStepStartedClientAt)
      : props.progress.totalDurationMs ?? props.progress.currentElapsedMs;
  const title =
    props.progress.status === "completed"
      ? "本次处理完成"
      : props.progress.status === "error"
        ? "处理已中断"
        : "处理中";
  const latestStepLabel =
    props.progress.status === "running"
      ? PROGRESS_STEP_LABELS[props.progress.currentStepKey ?? PROGRESS_STEP_ORDER[0]]
      : title;
  const currentStepDurationMs =
    props.progress.status === "running" && props.progress.currentStepStartedClientAt
      ? Math.max(0, props.nowMs - props.progress.currentStepStartedClientAt)
      : undefined;
  const summaryDurationMs = props.progress.status === "running" ? currentStepDurationMs ?? 0 : totalDurationMs;
  const showDetails = detailsOpen;

  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openDetails() {
    clearCloseTimer();
    setDetailsOpen(true);
  }

  function scheduleCloseDetails() {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setDetailsOpen(false);
    }, 100);
  }

  function updatePopoverPosition() {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gutter = 12;
    const width = Math.min(360, Math.max(280, Math.min(rect.width, viewportWidth - gutter * 2)));
    const left = Math.min(Math.max(gutter, rect.left), viewportWidth - width - gutter);
    const spaceBelow = viewportHeight - rect.bottom - gutter;
    const spaceAbove = rect.top - gutter;
    const maxHeight = Math.min(420, Math.max(180, Math.max(spaceBelow, spaceAbove)));
    const shouldOpenAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const top = shouldOpenAbove
      ? Math.max(gutter, rect.top - maxHeight - 8)
      : Math.min(rect.bottom + 8, viewportHeight - maxHeight - gutter);

    setPopoverPosition({
      left,
      top,
      width,
      maxHeight
    });
  }

  useEffect(() => {
    return () => clearCloseTimer();
  }, []);

  useEffect(() => {
    if (!detailsOpen) {
      setPopoverPosition(null);
      return;
    }

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [detailsOpen, props.nowMs]);

  const detailsPanel =
    showDetails && popoverPosition && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed z-[1000] overflow-y-auto rounded-2xl border border-border bg-white p-3 shadow-2xl"
            style={{
              left: popoverPosition.left,
              top: popoverPosition.top,
              width: popoverPosition.width,
              maxHeight: popoverPosition.maxHeight
            }}
            onMouseEnter={openDetails}
            onMouseLeave={scheduleCloseDetails}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-foreground">{title}</div>
              <div className="text-xs text-muted">总耗时 {formatDurationSeconds(totalDurationMs)}</div>
            </div>

            <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-3">
              <div className="rounded-xl bg-secondary/40 px-3 py-2">
                <div>首个响应</div>
                <div className="mt-1 font-medium text-foreground">
                  {props.progress.firstResponseLatencyMs != null
                    ? formatDurationSeconds(props.progress.firstResponseLatencyMs)
                    : "未返回"}
                </div>
              </div>
              <div className="rounded-xl bg-secondary/40 px-3 py-2">
                <div>首个正文</div>
                <div className="mt-1 font-medium text-foreground">
                  {props.progress.firstTokenLatencyMs != null ? formatDurationSeconds(props.progress.firstTokenLatencyMs) : "未返回"}
                </div>
              </div>
              <div className="rounded-xl bg-secondary/40 px-3 py-2">
                <div>流式输出</div>
                <div className="mt-1 font-medium text-foreground">
                  {props.progress.streamAnswerMs != null ? formatDurationSeconds(props.progress.streamAnswerMs) : "未开始"}
                </div>
              </div>
            </div>

            {visibleSteps.length ? (
              <div className="mt-3 space-y-2 text-sm">
                {visibleSteps.map((stepKey) => {
                  const completedStep = props.progress.steps[stepKey];
                  const isCurrent = props.progress.currentStepKey === stepKey && props.progress.status === "running";

                  return (
                    <div
                      key={stepKey}
                      className={`rounded-xl px-3 py-2 ${
                        isCurrent ? "bg-primary/10 text-primary" : "bg-secondary/40 text-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span>{completedStep?.label ?? PROGRESS_STEP_LABELS[stepKey]}</span>
                        <span className="text-xs">
                          {completedStep ? formatDurationSeconds(completedStep.durationMs) : isCurrent ? "进行中" : ""}
                        </span>
                      </div>
                      {completedStep?.detail ? <div className="mt-1 text-xs text-muted">{completedStep.detail}</div> : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>,
          document.body
        )
      : null;

  return (
    <div
      className="mb-3"
      onMouseEnter={openDetails}
      onMouseLeave={scheduleCloseDetails}
    >
      <button
        ref={triggerRef}
        type="button"
        className="flex w-full items-center justify-between rounded-2xl border border-border bg-white/80 px-3 py-2 text-left"
        onClick={() => {
          clearCloseTimer();
          if (typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches) {
            setDetailsOpen(true);
            return;
          }
          setDetailsOpen((current) => !current);
        }}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{latestStepLabel}</div>
        </div>
        <div className="ml-3 shrink-0 text-xs text-muted">{formatDurationSeconds(summaryDurationMs)}</div>
      </button>
      {detailsPanel}
    </div>
  );
}
