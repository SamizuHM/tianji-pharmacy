"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import removeMarkdown from "remove-markdown";

import {
  FIXED_ASSISTANT_SUFFIX,
  stripFixedAssistantSuffix,
  type AttachmentItem,
} from "@pharmacy/shared";
import {
  ArrowDown,
  Bot,
  Check,
  CircleAlert,
  Clipboard,
  ClipboardPaste,
  Database,
  Download,
  FileText,
  ImagePlus,
  LifeBuoy,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  SendHorizontal,
  Square,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { MarkdownMessage } from "@/components/chat/markdown-message";
import { AttachmentGallery } from "@/components/shared/attachment-gallery";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  formatDurationSeconds,
  PROGRESS_STEP_LABELS,
  PROGRESS_STEP_ORDER,
  type ProgressDonePayload,
  type ProgressEventPayload,
  type ProgressStepKey,
  type ProgressSummaryItem,
} from "@/lib/chat-progress";
import {
  prepareKnowledgeSourcesForDisplay,
  type KnowledgeSourceDebugItem,
} from "@/lib/retrieval-debug";
import { cn, getAttachmentItems, getFileUrl, safeJsonParse } from "@/lib/utils";

type Conversation = {
  id: string;
  title: string;
  updatedAt: string | Date;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "agent" | "system";
  sourceType: "kb" | "llm" | "manual" | "system" | "sensitive";
  contentText: string;
  attachmentsJson: string | null;
  retrievalDebugJson: string | null;
  feedback: "helpful" | "unhelpful" | null;
  status: "streaming" | "completed" | "failed";
  createdAt: string | Date;
};

type StreamDebugPayload = {
  retrievalDebug?: KnowledgeSourceDebugItem[];
  imagePaths?: string[];
};

type MessageProgressState = {
  status: "running" | "completed" | "error";
  steps: Partial<Record<ProgressStepKey, ProgressSummaryItem>>;
  currentStepKey?: ProgressStepKey;
  currentStepStartedClientAt?: number;
  currentElapsedMs: number;
  totalDurationMs?: number;
  firstTokenLatencyMs?: number | null;
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
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(
    props.conversationId
  );
  const [progressByMessageId, setProgressByMessageId] = useState<
    Record<string, MessageProgressState>
  >({});
  const [finalProgressByAssistantId, setFinalProgressByAssistantId] = useState<
    Record<string, MessageProgressState>
  >({});
  const [nowMs, setNowMs] = useState(0);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [mobileAssistantOpen, setMobileAssistantOpen] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [confirmingMessageDeleteId, setConfirmingMessageDeleteId] = useState<string | null>(null);
  const [copiedActionKey, setCopiedActionKey] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editText, setEditText] = useState("");
  const [editImagePaths, setEditImagePaths] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previousConversationIdRef = useRef<string | null>(props.conversationId);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const resumeEventSourceRef = useRef<EventSource | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => setMessages(props.messages), [props.messages]);
  useEffect(() => setConversations(props.conversations), [props.conversations]);
  useEffect(() => setCurrentConversationId(props.conversationId), [props.conversationId]);
  useEffect(() => {
    if (!editingMessage) {
      return;
    }

    requestAnimationFrame(() => {
      const textarea = editTextareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      resizeEditTextarea(textarea);
    });
  }, [editingMessage?.id]);
  useEffect(() => {
    if (!editingMessage) {
      return;
    }
    requestAnimationFrame(() => {
      if (editTextareaRef.current) {
        resizeEditTextarea(editTextareaRef.current);
      }
    });
  }, [editText, editingMessage]);
  useEffect(() => {
    const hasRunningProgress = Object.values(progressByMessageId).some(
      (item) => item.status === "running"
    );
    if (!hasRunningProgress) {
      return;
    }

    const timer = window.setInterval(() => setNowMs(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [progressByMessageId]);

  // 初始化客户端时间戳，避免 SSR/hydration 不匹配
  useEffect(() => {
    setNowMs(Date.now());
  }, []);
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

  // 断点续传：检查是否有正在生成的消息
  useEffect(() => {
    if (!props.conversationId) return;
    let disposed = false;

    (async () => {
      try {
        const res = await fetch(`/api/conversations/${props.conversationId}/resume`);
        if (!res.ok || disposed) return;
        const data = (await res.json()) as {
          streamingMessageId?: string;
          contentText?: string;
          sourceType?: Message["sourceType"];
          active?: boolean;
        };

        if (!data.streamingMessageId || disposed) return;

        const mid = data.streamingMessageId;

        // 更新消息内容为已生成部分
        setMessages((current) =>
          current.map((item) =>
            item.id === mid
              ? {
                  ...item,
                  contentText: data.contentText ?? "",
                  sourceType: data.sourceType ?? item.sourceType,
                }
              : item
          )
        );

        // 如果后端流还在运行，续接 SSE
        if (data.active) {
          setSending(true);
          setProgressByMessageId((current) => ({
            ...current,
            [mid]: { status: "running", steps: {}, currentElapsedMs: 0 },
          }));

          const eventSource = new EventSource(
            `/api/conversations/${props.conversationId}/stream?messageId=${mid}`
          );
          resumeEventSourceRef.current = eventSource;
          eventSource.addEventListener("delta", (event) => {
            if (disposed) return;
            const payload = JSON.parse(event.data) as { text?: string };
            if (payload.text) {
              setMessages((current) =>
                current.map((item) =>
                  item.id === mid
                    ? { ...item, contentText: item.contentText + payload.text! }
                    : item
                )
              );
            }
          });

          eventSource.addEventListener("done", () => {
            eventSource.close();
            resumeEventSourceRef.current = null;
            setSending(false);
            setProgressByMessageId((current) => {
              const existing = current[mid];
              if (!existing) return current;
              return { ...current, [mid]: { ...existing, status: "completed" } };
            });
            router.refresh();
          });

          eventSource.onerror = () => {
            eventSource.close();
            resumeEventSourceRef.current = null;
            setSending(false);
            router.refresh();
          };
        }
      } catch {
        // 忽略
      }
    })();

    return () => {
      disposed = true;
    };
  }, [props.conversationId]);

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
      body: JSON.stringify({ title: input.title }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "创建会话失败");
      return null;
    }
    const conversation = data.conversation as Conversation;
    setConversations((current) => [
      conversation,
      ...current.filter((item) => item.id !== conversation.id),
    ]);
    setCurrentConversationId(conversation.id);
    window.history.replaceState(null, "", `/staff/chat?conversationId=${conversation.id}`);
    return conversation.id;
  }

  async function deleteConversation(conversationId: string) {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: "DELETE",
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "删除会话失败");
      return;
    }

    const remaining = conversations.filter((item) => item.id !== conversationId);
    setConversations(remaining);
    setConfirmingDeleteId(null);
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
    abortRef.current = new AbortController();

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
        status: "completed",
        createdAt: new Date().toISOString(),
      },
      {
        id: optimisticAssistantId,
        role: "assistant",
        sourceType: "system",
        contentText: "",
        attachmentsJson: null,
        retrievalDebugJson: null,
        feedback: null,
        status: "streaming",
        createdAt: new Date().toISOString(),
      },
    ]);

    setText("");
    setAttachments([]);

    try {
      const conversationId =
        currentConversationId ??
        (await createConversationForFirstMessage({
          title: requestText || "图片问题",
        }));

      if (!conversationId) {
        throw new Error("创建会话失败");
      }

      const response = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: requestText,
          attachments: requestAttachments,
        }),
        signal: abortRef.current.signal,
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
            firstTokenLatencyMs?: number | null;
            waitFirstTokenMs?: number;
            streamAnswerMs?: number;
          };

          if (event === "meta" && payload.sourceType) {
            setMessages((current) =>
              current.map((item) =>
                item.id === optimisticAssistantId
                  ? { ...item, sourceType: payload.sourceType! }
                  : item
              )
            );
          }

          if (event === "debug") {
            finalDebug = {
              retrievalDebug: payload.retrievalDebug,
              imagePaths: payload.imagePaths,
            };
          }

          if (event === "progress") {
            const progressPayload = payload as ProgressEventPayload;
            setProgressByMessageId((current) => {
              const existing = current[optimisticAssistantId] ?? {
                status: "running" as const,
                steps: {},
                currentElapsedMs: 0,
              };

              if (progressPayload.status === "started") {
                return {
                  ...current,
                  [optimisticAssistantId]: {
                    ...existing,
                    status: "running",
                    currentStepKey: progressPayload.stepKey,
                    currentStepStartedClientAt: Date.now(),
                    currentElapsedMs: progressPayload.elapsedTotalMs,
                  },
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
                      detail: progressPayload.detail,
                    },
                  },
                  currentStepKey:
                    existing.currentStepKey === progressPayload.stepKey
                      ? undefined
                      : existing.currentStepKey,
                  currentStepStartedClientAt:
                    existing.currentStepKey === progressPayload.stepKey
                      ? undefined
                      : existing.currentStepStartedClientAt,
                  currentElapsedMs: progressPayload.elapsedTotalMs,
                },
              };
            });
          }

          if (event === "delta" && payload.text) {
            setMessages((current) =>
              current.map((item) =>
                item.id === optimisticAssistantId
                  ? { ...item, contentText: item.contentText + payload.text! }
                  : item
              )
            );
          }

          if (event === "done" && payload.assistantMessageId) {
            const donePayload = payload as ProgressDonePayload;
            const completedState: MessageProgressState = {
              status: "completed",
              steps: Object.fromEntries(
                donePayload.stepsSummary.map((item) => [item.stepKey, item])
              ),
              currentElapsedMs: donePayload.totalDurationMs,
              totalDurationMs: donePayload.totalDurationMs,
              firstTokenLatencyMs: donePayload.firstTokenLatencyMs,
              waitFirstTokenMs: donePayload.waitFirstTokenMs,
              streamAnswerMs: donePayload.streamAnswerMs,
            };
            finalProgressState = completedState;
            setProgressByMessageId((current) => ({
              ...current,
              [optimisticAssistantId]: completedState,
            }));
            setFinalProgressByAssistantId((current) => ({
              ...current,
              [donePayload.assistantMessageId]: completedState,
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
            ? {
                ...item,
                status: "completed",
                retrievalDebugJson: JSON.stringify({
                  debug: finalDebug.retrievalDebug ?? [],
                  imagePaths: finalDebug.imagePaths ?? [],
                }),
              }
            : item
        )
      );
      if (finalProgressState) {
        setProgressByMessageId((current) => ({
          ...current,
          [optimisticAssistantId]: finalProgressState!,
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
            currentStepStartedClientAt: undefined,
          },
        };
      });
      setError(sendError instanceof Error ? sendError.message : "发送失败");
      setMessages((current) =>
        current.map((item) =>
          item.id === optimisticAssistantId ? { ...item, status: "failed" } : item
        )
      );
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }

    event.preventDefault();
    if (sending || (!text.trim() && !attachments.length)) {
      return;
    }

    void sendMessage();
  }

  async function stopGenerating() {
    // 取消正常的 fetch SSE 流
    abortRef.current?.abort();

    // 关闭续接 EventSource
    resumeEventSourceRef.current?.close();
    resumeEventSourceRef.current = null;

    // 通知后端标记消息完成
    if (currentConversationId) {
      await fetch(`/api/conversations/${currentConversationId}/stop`, { method: "POST" }).catch(
        () => undefined
      );
    }

    setSending(false);
    router.refresh();
  }

  async function createTicket() {
    if (!currentConversationId) {
      setError("请先发送一条消息后再转人工");
      return;
    }
    const response = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: currentConversationId }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "创建工单失败");
      return;
    }
    router.push(`/staff/tickets/${data.ticket.id}`);
  }

  async function copyMessage(message: Message, format: "text" | "markdown") {
    const value = format === "markdown" ? messageToMarkdown(message) : messageToPlainText(message);
    await navigator.clipboard.writeText(value.trim());
    const actionKey = `${message.id}:${format}`;
    setCopiedActionKey(actionKey);
    window.setTimeout(
      () => setCopiedActionKey((current) => (current === actionKey ? null : current)),
      1600
    );
  }

  function downloadMessage(message: Message, format: "text" | "markdown") {
    const content =
      format === "markdown" ? messageToMarkdown(message) : messageToPlainText(message);
    const extension = format === "markdown" ? "md" : "txt";
    const blob = new Blob([content.trim() + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(activeConversation?.title ?? "会话")}-${message.role}-${formatMessageTimeForFile(message.createdAt)}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function deleteMessage(messageId: string) {
    const response = await fetch(`/api/messages/${messageId}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || "删除消息失败");
      return;
    }

    setMessages((current) => current.filter((item) => item.id !== messageId));
    setProgressByMessageId((current) => {
      const next = { ...current };
      delete next[messageId];
      return next;
    });
    setFinalProgressByAssistantId((current) => {
      const next = { ...current };
      delete next[messageId];
      return next;
    });
    setConfirmingMessageDeleteId(null);
    router.refresh();
  }

  function openEditMessage(message: Message) {
    const debugPayload = safeJsonParse<{ imagePaths?: string[] }>(message.retrievalDebugJson, {});
    setEditingMessage(message);
    setEditText(
      message.contentText === "用户上传了图片"
        ? ""
        : message.role === "assistant"
          ? stripFixedAssistantSuffix(message.contentText)
          : message.contentText
    );
    setEditImagePaths(debugPayload.imagePaths ?? []);
  }

  async function saveEditedMessage() {
    if (!editingMessage) {
      return;
    }

    const response = await fetch(`/api/messages/${editingMessage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contentText: editText,
        imagePaths: editImagePaths,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || "保存消息失败");
      return;
    }

    setMessages((current) =>
      current.map((item) => {
        if (item.id !== editingMessage.id) {
          return item;
        }
        const debugPayload = safeJsonParse<Record<string, unknown>>(item.retrievalDebugJson, {});
        return {
          ...item,
          contentText: editText.trim() || (item.role === "user" ? "用户上传了图片" : ""),
          retrievalDebugJson: JSON.stringify({
            ...debugPayload,
            imagePaths: editImagePaths,
          }),
        };
      })
    );
    setEditingMessage(null);
    router.refresh();
  }

  async function resendCurrentEditedUserMessage() {
    if (!editingMessage || editingMessage.role !== "user") {
      return;
    }

    await resendEditedUserMessage(editingMessage, editText);
  }

  async function resendEditedUserMessage(message: Message, nextText: string) {
    setError("");
    setSending(true);
    abortRef.current = new AbortController();

    const optimisticAssistantId = `temp-assistant-${Date.now()}`;
    const messageIndex = messages.findIndex((item) => item.id === message.id);
    const editedContentText = nextText.trim() || "用户上传了图片";

    setMessages((current) => [
      ...current
        .slice(0, Math.max(0, messageIndex + 1))
        .map((item) =>
          item.id === message.id ? { ...item, contentText: editedContentText } : item
        ),
      {
        id: optimisticAssistantId,
        role: "assistant",
        sourceType: "system",
        contentText: "",
        attachmentsJson: null,
        retrievalDebugJson: null,
        feedback: null,
        status: "streaming",
        createdAt: new Date().toISOString(),
      },
    ]);
    setProgressByMessageId((current) => ({
      ...current,
      [optimisticAssistantId]: { status: "running", steps: {}, currentElapsedMs: 0 },
    }));
    setEditingMessage(null);

    try {
      const response = await fetch(`/api/messages/${message.id}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentText: nextText.trim() }),
        signal: abortRef.current.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "重新发送失败");
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
            assistantMessageId?: string;
            totalDurationMs?: number;
            stepsSummary?: ProgressSummaryItem[];
            firstTokenLatencyMs?: number | null;
            waitFirstTokenMs?: number;
            streamAnswerMs?: number;
          };

          if (event === "meta" && payload.sourceType) {
            setMessages((current) =>
              current.map((item) =>
                item.id === optimisticAssistantId
                  ? { ...item, sourceType: payload.sourceType! }
                  : item
              )
            );
          }

          if (event === "debug") {
            finalDebug = {
              retrievalDebug: payload.retrievalDebug,
              imagePaths: payload.imagePaths,
            };
          }

          if (event === "progress") {
            const progressPayload = payload as ProgressEventPayload;
            setProgressByMessageId((current) => {
              const existing = current[optimisticAssistantId] ?? {
                status: "running" as const,
                steps: {},
                currentElapsedMs: 0,
              };

              if (progressPayload.status === "started") {
                return {
                  ...current,
                  [optimisticAssistantId]: {
                    ...existing,
                    status: "running",
                    currentStepKey: progressPayload.stepKey,
                    currentStepStartedClientAt: Date.now(),
                    currentElapsedMs: progressPayload.elapsedTotalMs,
                  },
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
                      detail: progressPayload.detail,
                    },
                  },
                  currentStepKey:
                    existing.currentStepKey === progressPayload.stepKey
                      ? undefined
                      : existing.currentStepKey,
                  currentStepStartedClientAt:
                    existing.currentStepKey === progressPayload.stepKey
                      ? undefined
                      : existing.currentStepStartedClientAt,
                  currentElapsedMs: progressPayload.elapsedTotalMs,
                },
              };
            });
          }

          if (event === "delta" && payload.text) {
            setMessages((current) =>
              current.map((item) =>
                item.id === optimisticAssistantId
                  ? { ...item, contentText: item.contentText + payload.text! }
                  : item
              )
            );
          }

          if (event === "done" && payload.assistantMessageId) {
            const donePayload = payload as ProgressDonePayload;
            const completedState: MessageProgressState = {
              status: "completed",
              steps: Object.fromEntries(
                donePayload.stepsSummary.map((item) => [item.stepKey, item])
              ),
              currentElapsedMs: donePayload.totalDurationMs,
              totalDurationMs: donePayload.totalDurationMs,
              firstTokenLatencyMs: donePayload.firstTokenLatencyMs,
              waitFirstTokenMs: donePayload.waitFirstTokenMs,
              streamAnswerMs: donePayload.streamAnswerMs,
            };
            finalProgressState = completedState;
            setProgressByMessageId((current) => ({
              ...current,
              [optimisticAssistantId]: completedState,
            }));
            setFinalProgressByAssistantId((current) => ({
              ...current,
              [donePayload.assistantMessageId]: completedState,
            }));
          }

          if (event === "error") {
            throw new Error(payload.error || "重新发送失败");
          }
        }
      }

      setMessages((current) =>
        current.map((item) =>
          item.id === optimisticAssistantId
            ? {
                ...item,
                status: "completed",
                retrievalDebugJson: JSON.stringify({
                  debug: finalDebug.retrievalDebug ?? [],
                  imagePaths: finalDebug.imagePaths ?? [],
                }),
              }
            : item
        )
      );
      if (finalProgressState) {
        setProgressByMessageId((current) => ({
          ...current,
          [optimisticAssistantId]: finalProgressState!,
        }));
      }
      router.refresh();
    } catch (resendError) {
      setProgressByMessageId((current) => {
        const existing = current[optimisticAssistantId];
        if (!existing) return current;
        return {
          ...current,
          [optimisticAssistantId]: {
            ...existing,
            status: "error",
            currentStepKey: undefined,
            currentStepStartedClientAt: undefined,
          },
        };
      });
      setMessages((current) =>
        current.map((item) =>
          item.id === optimisticAssistantId ? { ...item, status: "failed" } : item
        )
      );
      setError(resendError instanceof Error ? resendError.message : "重新发送失败");
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  async function regenerateMessage(message: Message) {
    if (message.role !== "assistant" || !currentConversationId) {
      return;
    }

    setError("");
    setSending(true);
    abortRef.current = new AbortController();
    setMessages((current) =>
      current.map((item) =>
        item.id === message.id
          ? {
              ...item,
              contentText: "",
              status: "streaming",
              sourceType: "system",
              retrievalDebugJson: null,
            }
          : item
      )
    );
    setProgressByMessageId((current) => ({
      ...current,
      [message.id]: { status: "running", steps: {}, currentElapsedMs: 0 },
    }));

    try {
      const response = await fetch(`/api/messages/${message.id}/regenerate`, {
        method: "POST",
        signal: abortRef.current.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "重新生成失败");
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
            firstTokenLatencyMs?: number | null;
            waitFirstTokenMs?: number;
            streamAnswerMs?: number;
          };

          if (event === "meta" && payload.sourceType) {
            setMessages((current) =>
              current.map((item) =>
                item.id === message.id ? { ...item, sourceType: payload.sourceType! } : item
              )
            );
          }

          if (event === "debug") {
            finalDebug = {
              retrievalDebug: payload.retrievalDebug,
              imagePaths: payload.imagePaths,
            };
          }

          if (event === "progress") {
            const progressPayload = payload as ProgressEventPayload;
            setProgressByMessageId((current) => {
              const existing = current[message.id] ?? {
                status: "running" as const,
                steps: {},
                currentElapsedMs: 0,
              };

              if (progressPayload.status === "started") {
                return {
                  ...current,
                  [message.id]: {
                    ...existing,
                    status: "running",
                    currentStepKey: progressPayload.stepKey,
                    currentStepStartedClientAt: Date.now(),
                    currentElapsedMs: progressPayload.elapsedTotalMs,
                  },
                };
              }

              return {
                ...current,
                [message.id]: {
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
                      detail: progressPayload.detail,
                    },
                  },
                  currentStepKey:
                    existing.currentStepKey === progressPayload.stepKey
                      ? undefined
                      : existing.currentStepKey,
                  currentStepStartedClientAt:
                    existing.currentStepKey === progressPayload.stepKey
                      ? undefined
                      : existing.currentStepStartedClientAt,
                  currentElapsedMs: progressPayload.elapsedTotalMs,
                },
              };
            });
          }

          if (event === "delta" && payload.text) {
            setMessages((current) =>
              current.map((item) =>
                item.id === message.id
                  ? { ...item, contentText: item.contentText + payload.text! }
                  : item
              )
            );
          }

          if (event === "done" && payload.assistantMessageId) {
            const donePayload = payload as ProgressDonePayload;
            const completedState: MessageProgressState = {
              status: "completed",
              steps: Object.fromEntries(
                donePayload.stepsSummary.map((item) => [item.stepKey, item])
              ),
              currentElapsedMs: donePayload.totalDurationMs,
              totalDurationMs: donePayload.totalDurationMs,
              firstTokenLatencyMs: donePayload.firstTokenLatencyMs,
              waitFirstTokenMs: donePayload.waitFirstTokenMs,
              streamAnswerMs: donePayload.streamAnswerMs,
            };
            finalProgressState = completedState;
            setProgressByMessageId((current) => ({ ...current, [message.id]: completedState }));
            setFinalProgressByAssistantId((current) => ({
              ...current,
              [donePayload.assistantMessageId]: completedState,
            }));
          }

          if (event === "error") {
            throw new Error(payload.error || "重新生成失败");
          }
        }
      }

      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? {
                ...item,
                status: "completed",
                retrievalDebugJson: JSON.stringify({
                  debug: finalDebug.retrievalDebug ?? [],
                  imagePaths: finalDebug.imagePaths ?? [],
                }),
              }
            : item
        )
      );
      if (finalProgressState) {
        setProgressByMessageId((current) => ({ ...current, [message.id]: finalProgressState! }));
      }
      router.refresh();
    } catch (regenerateError) {
      setProgressByMessageId((current) => {
        const existing = current[message.id];
        if (!existing) return current;
        return {
          ...current,
          [message.id]: {
            ...existing,
            status: "error",
            currentStepKey: undefined,
            currentStepStartedClientAt: undefined,
          },
        };
      });
      setMessages((current) =>
        current.map((item) => (item.id === message.id ? { ...item, status: "failed" } : item))
      );
      setError(regenerateError instanceof Error ? regenerateError.message : "重新生成失败");
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  function openConversation(conversationId: string) {
    setMobileHistoryOpen(false);
    setConfirmingDeleteId(null);
    setCurrentConversationId(conversationId);
    router.push(`/staff/chat?conversationId=${conversationId}`);
  }

  const conversationHistory = (
    <>
      <div className="flex flex-col gap-2">
        {conversations.map((item) => (
          <div
            key={item.id}
            className={`flex min-w-0 items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm transition-all duration-150 ${
              activeConversation?.id === item.id
                ? "border-blue-200 bg-blue-50 shadow-sm dark:border-primary/20 dark:bg-accent"
                : "border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-border dark:hover:bg-secondary"
            }`}
          >
            <button
              type="button"
              onClick={() => openConversation(item.id)}
              className="min-w-0 flex-1 overflow-hidden text-left"
            >
              <div className="truncate font-medium text-slate-900 dark:text-foreground">
                {item.title}
              </div>
              <div className="mt-1 text-xs text-muted" suppressHydrationWarning>
                {new Date(item.updatedAt).toLocaleDateString("zh-CN")}
              </div>
            </button>
            <Dialog
              open={confirmingDeleteId === item.id}
              onOpenChange={(open) => setConfirmingDeleteId(open ? item.id : null)}
            >
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-muted transition-all duration-150 hover:bg-red-50 hover:text-red-500 dark:hover:bg-destructive/10 dark:hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>确认删除？</DialogTitle>
                  <DialogDescription className="truncate">{item.title}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmingDeleteId(null)}
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => deleteConversation(item.id)}
                  >
                    确认
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
            <div className="flex size-16 items-center justify-center rounded-full bg-blue-100 text-primary dark:border dark:border-primary/30 dark:bg-primary/10">
              <Bot className="size-8" />
            </div>
            <div>
              <div className="font-semibold text-slate-900 dark:text-foreground">药店智能助手</div>
              <div className="mt-1 flex items-center gap-2 text-sm text-emerald-600">
                <span className="size-2 rounded-full bg-emerald-500" />
                在线
              </div>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted">
            基于企业知识库与大模型的智能问答助手，提供专业、准确、高效的支持服务。
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>能力范围</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {["药品知识", "合规政策", "经营管理", "系统操作", "医保政策", "会员权益"].map((item) => (
            <Badge
              key={item}
              className="border border-border bg-white px-3 py-2 text-slate-600 dark:border-primary/30 dark:bg-primary/10 dark:text-primary"
            >
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
          {[
            "企业 SOP 手册",
            "药品法规政策",
            "常见问题库",
            "医保政策库",
            "系统操作指南",
            "培训资料库",
          ].map((item) => (
            <div key={item} className="flex items-center gap-2 text-slate-700 dark:text-foreground">
              <BookOpenIcon />
              {item}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden xl:grid xl:grid-cols-[280px_minmax(0,1fr)_280px] xl:grid-rows-[minmax(0,1fr)] xl:gap-5">
      <Card className="hidden min-h-0 flex-col overflow-hidden xl:flex">
        <CardHeader className="flex shrink-0 flex-row items-center justify-between gap-3 [@media(max-height:830px)]:px-4 [@media(max-height:830px)]:py-3">
          <CardTitle className="whitespace-nowrap">会话历史</CardTitle>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0 px-3"
            onClick={startNewConversation}
          >
            <Plus className="size-4" />
            新建会话
          </Button>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 p-0">
          <ScrollArea className="h-full" viewportClassName="[&>div]:!block">
            <div className="p-3">{conversationHistory}</div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-none">
        <CardHeader className="hidden shrink-0 xl:block [@media(max-height:830px)]:px-4 [@media(max-height:830px)]:py-3">
          <CardTitle>门店智能问答</CardTitle>
          <p className="text-sm text-muted [@media(max-height:830px)]:hidden">
            支持文字、图片与图文混合输入；知识库命中后做受控润色，未命中时走通用药店场景问答。
          </p>
        </CardHeader>
        <CardContent className="relative flex min-h-0 flex-1 flex-col p-0">
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-white px-3 dark:bg-card xl:hidden">
            <Sheet open={mobileHistoryOpen} onOpenChange={setMobileHistoryOpen}>
              <SheetTrigger asChild>
                <Button size="sm" variant="ghost">
                  历史
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="max-w-[86vw]">
                <SheetHeader>
                  <SheetTitle>会话历史</SheetTitle>
                </SheetHeader>
                <SheetBody className="p-3">
                  <Button
                    className="mb-3 w-full"
                    variant="secondary"
                    onClick={startNewConversation}
                  >
                    <Plus className="size-4" />
                    新建会话
                  </Button>
                  {conversationHistory}
                </SheetBody>
              </SheetContent>
            </Sheet>
            <div className="min-w-0 text-center">
              <div className="truncate text-sm font-semibold text-slate-950 dark:text-foreground">
                门店智能问答
              </div>
              <div className="truncate text-[11px] text-muted">
                {activeConversation?.title ?? "新会话"}
              </div>
            </div>
            <Sheet open={mobileAssistantOpen} onOpenChange={setMobileAssistantOpen}>
              <SheetTrigger asChild>
                <Button size="sm" variant="ghost">
                  助手
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="max-w-[86vw]">
                <SheetHeader>
                  <SheetTitle>助手信息</SheetTitle>
                </SheetHeader>
                <SheetBody className="p-3">{assistantInfo}</SheetBody>
              </SheetContent>
            </Sheet>
          </div>
          <ScrollArea
            viewportRef={scrollContainerRef}
            onViewportScroll={handleScroll}
            className="min-h-0 flex-1 bg-slate-50/60 dark:bg-secondary/50"
            viewportClassName="[&>div]:!block [&>div]:h-full"
          >
            <div className="flex h-full flex-col px-3 pb-8 pt-4 sm:px-5 sm:pb-10 sm:pt-5">
              {!messages.length ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-blue-100 text-primary dark:bg-accent">
                    <Sparkles className="size-7" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-slate-900 dark:text-foreground">
                    门店智能问答
                  </h3>
                  <p className="mt-2 max-w-xs text-sm text-muted">
                    在下方输入您的门店相关问题，支持文字、图片与图文混合输入
                  </p>
                </div>
              ) : null}
              <div className="flex flex-col gap-4">
                {messages.map((message) => {
                  const attachmentsData = getAttachmentItems(message.attachmentsJson);
                  const debugPayload = safeJsonParse<{
                    debug?: KnowledgeSourceDebugItem[];
                    imagePaths?: string[];
                  }>(message.retrievalDebugJson, {});
                  const retrievalDebug = debugPayload.debug ?? [];
                  const imagePaths = debugPayload.imagePaths ?? [];
                  const progressState =
                    progressByMessageId[message.id] ?? finalProgressByAssistantId[message.id];
                  const rawMessageText =
                    message.contentText ||
                    (message.role === "assistant" && progressState?.status === "running"
                      ? "正在生成..."
                      : "");
                  const messageText =
                    message.role === "assistant"
                      ? stripFixedAssistantSuffix(rawMessageText)
                      : rawMessageText;
                  const isUser = message.role === "user";
                  const isTemporaryMessage = message.id.startsWith("temp-");
                  const canPersistAction = !isTemporaryMessage && message.status !== "streaming";
                  const hasContent = Boolean(
                    (message.role === "assistant"
                      ? stripFixedAssistantSuffix(message.contentText)
                      : message.contentText
                    ).trim()
                  );
                  const showAssistantFixedSuffix =
                    message.role === "assistant" &&
                    message.status === "completed" &&
                    Boolean(messageText.trim());
                  const isEditingMessage = editingMessage?.id === message.id;
                  const bubbleWidthClass = isEditingMessage
                    ? "w-full max-w-[96%] sm:max-w-[92%]"
                    : "max-w-[92%] sm:max-w-[86%]";

                  return (
                    <div
                      key={message.id}
                      className={`flex gap-2 sm:gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      {!isUser ? (
                        <div className="mt-2 hidden size-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600 sm:flex">
                          {message.sourceType === "kb" ? (
                            <Database className="size-4" />
                          ) : (
                            <Sparkles className="size-4" />
                          )}
                        </div>
                      ) : null}
                      <div
                        className={`${bubbleWidthClass} rounded-xl border px-3 py-2.5 shadow-sm sm:px-4 sm:py-3 ${
                          isUser
                            ? "border-blue-100 bg-blue-50 text-slate-900 dark:border-primary/20 dark:bg-accent dark:text-foreground"
                            : "border-border bg-white dark:bg-card dark:text-foreground"
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <Badge className={sourceBadgeClass(message.sourceType)}>
                            {sourceLabel(message.sourceType, message.role)}
                          </Badge>
                          <span className="text-xs text-muted" suppressHydrationWarning>
                            {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        {message.role === "assistant" && progressState ? (
                          <ProgressCard progress={progressState} nowMs={nowMs} />
                        ) : null}
                        {isEditingMessage ? (
                          <div className="flex flex-col gap-3">
                            <Textarea
                              ref={editTextareaRef}
                              value={editText}
                              onChange={(event) => setEditText(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  setEditingMessage(null);
                                  return;
                                }
                                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                  event.preventDefault();
                                  void saveEditedMessage();
                                }
                              }}
                              className="max-h-[420px] min-h-48 w-full resize-none overflow-y-auto rounded-xl bg-white/80 text-sm leading-6 dark:bg-card sm:min-h-56"
                              placeholder="请输入消息内容"
                            />
                          </div>
                        ) : (
                          <>
                            <MarkdownMessage content={messageText} />
                            {showAssistantFixedSuffix ? (
                              <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-orange-600">
                                {FIXED_ASSISTANT_SUFFIX}
                              </p>
                            ) : null}
                          </>
                        )}
                        {message.role === "assistant" &&
                        isEditingMessage &&
                        editImagePaths.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {editImagePaths.map((imagePath) => (
                              <div
                                key={imagePath}
                                className="relative rounded-lg border border-border bg-slate-50 p-1 dark:bg-secondary"
                              >
                                <img
                                  src={getFileUrl(imagePath)}
                                  alt=""
                                  className="max-h-36 rounded object-contain"
                                />
                                <button
                                  type="button"
                                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow hover:text-destructive dark:bg-card"
                                  onClick={() =>
                                    setEditImagePaths((current) =>
                                      current.filter((item) => item !== imagePath)
                                    )
                                  }
                                >
                                  <X className="size-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {!isEditingMessage && imagePaths.length ? (
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
                        {isEditingMessage ? (
                          <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setEditingMessage(null)}
                            >
                              取消
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={saveEditedMessage}
                              disabled={sending}
                            >
                              保存
                            </Button>
                            {message.role === "user" ? (
                              <Button
                                type="button"
                                size="sm"
                                onClick={resendCurrentEditedUserMessage}
                                disabled={sending}
                              >
                                重新发送
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                        {message.role === "user" && !isEditingMessage ? (
                          <div className="mt-3 flex justify-end border-t border-border pt-3">
                            <MessageActionMenu
                              message={message}
                              hasContent={hasContent}
                              canPersistAction={canPersistAction}
                              copiedActionKey={copiedActionKey}
                              onCopy={copyMessage}
                              onDownload={downloadMessage}
                              onDeleteRequest={() => setConfirmingMessageDeleteId(message.id)}
                              onEdit={() => openEditMessage(message)}
                            />
                          </div>
                        ) : null}
                        {message.role === "assistant" && !isEditingMessage ? (
                          <AssistantMessageFooter
                            message={message}
                            hasContent={hasContent}
                            canPersistAction={canPersistAction}
                            copiedActionKey={copiedActionKey}
                            retrievalDebug={retrievalDebug}
                            sending={sending}
                            onCreateTicket={createTicket}
                            onCopy={copyMessage}
                            onDownload={downloadMessage}
                            onDeleteRequest={() => setConfirmingMessageDeleteId(message.id)}
                            onEdit={() => openEditMessage(message)}
                            onRegenerate={() => regenerateMessage(message)}
                          />
                        ) : null}
                        <Dialog
                          open={confirmingMessageDeleteId === message.id}
                          onOpenChange={(open) =>
                            setConfirmingMessageDeleteId(open ? message.id : null)
                          }
                        >
                          <DialogContent className="sm:max-w-sm">
                            <DialogHeader>
                              <DialogTitle>确认删除这条消息？</DialogTitle>
                              <DialogDescription className="line-clamp-2">
                                {message.contentText ||
                                  sourceLabel(message.sourceType, message.role)}
                              </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setConfirmingMessageDeleteId(null)}
                              >
                                取消
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                onClick={() => deleteMessage(message.id)}
                              >
                                删除
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                  );
                })}
                {messages.length ? (
                  <div className="flex items-center justify-center gap-1.5 pb-6 pt-2 text-xs">
                    <CircleAlert className="size-4 text-orange-500" />
                    <span className="text-slate-600">
                      每次回答后都可点击
                      <span className="font-semibold text-orange-600">人工服务</span>
                      ；仍不明确时请拨打{" "}
                      <span className="font-semibold text-slate-800">
                        {props.serviceHotline}
                      </span>{" "}
                      电话咨询。
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          </ScrollArea>

          <div className="relative shrink-0 border-t border-border bg-white p-3 dark:bg-card sm:p-5 [@media(max-height:830px)]:sm:p-3">
            <button
              type="button"
              className={`absolute -top-12 right-3 z-10 flex size-9 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-all duration-300 hover:bg-blue-700 dark:border dark:border-primary/30 dark:bg-card dark:text-primary dark:hover:bg-secondary ${
                showScrollButton
                  ? "scale-100 opacity-100"
                  : "pointer-events-none scale-75 opacity-0"
              }`}
              onClick={() =>
                scrollContainerRef.current?.scrollTo({
                  top: scrollContainerRef.current.scrollHeight,
                  behavior: "smooth",
                })
              }
            >
              <ArrowDown className="size-4" />
            </button>
            {/* 手机端：单行输入框 + 内嵌图标按钮 */}
            <div className="relative sm:hidden [@media(max-height:830px)]:!block">
              {attachments.length ? (
                <div className="flex flex-wrap gap-1.5 rounded-lg border border-blue-100 bg-white px-3 py-2 shadow-sm dark:border-border dark:bg-card">
                  {attachments.map((item) => (
                    <span
                      key={item.path}
                      className="inline-flex items-center gap-1 rounded border border-border bg-slate-50 px-2 py-1 text-xs dark:bg-secondary"
                    >
                      {item.name}
                      <button
                        type="button"
                        className="text-slate-400 hover:text-red-500 dark:text-muted"
                        onClick={() =>
                          setAttachments((current) =>
                            current.filter((file) => file.path !== item.path)
                          )
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="flex items-end rounded-lg border border-blue-100 bg-white shadow-sm focus-within:border-primary focus-within:shadow-md dark:border-border dark:bg-card">
                <textarea
                  ref={textareaRef}
                  placeholder="请输入门店问题..."
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
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
                  className="max-h-[33dvh] min-h-0 flex-1 resize-none overflow-y-auto bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-slate-400 dark:text-foreground dark:placeholder:text-muted [@media(max-height:830px)]:max-h-20"
                  style={{ fieldSizing: "content" }}
                />
                <div className="flex shrink-0 items-center gap-1 pb-1 pr-2">
                  <label className="flex size-8 cursor-pointer items-center justify-center rounded-full text-primary transition-all duration-150 hover:bg-blue-50 active:scale-90 dark:hover:bg-accent">
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
                    onClick={sending ? stopGenerating : sendMessage}
                    disabled={!sending && !text.trim() && !attachments.length}
                    className="flex size-8 items-center justify-center rounded-full bg-primary text-white transition-all duration-150 hover:bg-blue-700 active:scale-90 disabled:opacity-50 dark:border dark:border-primary/30 dark:bg-primary/10 dark:text-primary dark:hover:bg-secondary"
                  >
                    {sending ? (
                      <Square className="size-3.5 fill-current" />
                    ) : (
                      <SendHorizontal className="size-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* PC端：保持原有多行布局 */}
            <div className="hidden rounded-lg border border-blue-100 bg-white shadow-sm transition-all duration-200 focus-within:border-primary focus-within:shadow-md dark:border-border dark:bg-card sm:block [@media(max-height:830px)]:!hidden">
              <Textarea
                placeholder="请输入门店问题，或粘贴截图后补充说明..."
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={handleComposerKeyDown}
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
                className="min-h-24 resize-none overflow-y-auto border-none focus:ring-0 [@media(max-height:830px)]:max-h-20 [@media(max-height:830px)]:min-h-12"
              />
              <div className="flex flex-wrap gap-2 px-4 [@media(max-height:830px)]:px-3">
                {attachments.map((item) => (
                  <span
                    key={item.path}
                    className="inline-flex items-center gap-2 rounded border border-border bg-slate-50 px-3 py-2 text-xs transition-all duration-150 hover:border-slate-300 dark:bg-secondary dark:hover:border-border"
                  >
                    {item.name}
                    <button
                      type="button"
                      className="rounded transition-colors duration-150 hover:bg-red-50 hover:text-red-500 dark:hover:bg-destructive/10 dark:hover:text-destructive"
                      onClick={() =>
                        setAttachments((current) =>
                          current.filter((file) => file.path !== item.path)
                        )
                      }
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border px-4 py-3 [@media(max-height:830px)]:mt-2 [@media(max-height:830px)]:gap-2 [@media(max-height:830px)]:px-3 [@media(max-height:830px)]:py-2">
                <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded border border-border bg-white px-3 text-sm text-primary transition-all duration-150 hover:border-blue-200 hover:bg-blue-50 hover:shadow-sm active:scale-[0.97] dark:bg-card dark:hover:border-primary/30 dark:hover:bg-accent">
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
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-2 rounded px-3 text-sm text-slate-600 transition-all duration-150 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97] dark:text-muted dark:hover:bg-secondary dark:hover:text-foreground [@media(max-height:830px)]:hidden"
                >
                  <ClipboardPaste className="size-4" />
                  粘贴图片
                </button>
                <div className="ml-auto text-xs text-muted">{text.length}/2000</div>
                <Button onClick={sending ? stopGenerating : sendMessage} disabled={false}>
                  {sending ? (
                    <>
                      <Square className="size-3.5 fill-current" /> 停止
                    </>
                  ) : (
                    <>
                      <SendHorizontal className="size-4" /> 发送
                    </>
                  )}
                </Button>
              </div>
            </div>

            {error ? (
              <Alert className="mt-3 border-destructive bg-red-50 text-destructive dark:border-destructive/30 dark:bg-destructive/10">
                {error}
              </Alert>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <ScrollArea className="hidden min-h-0 xl:block">{assistantInfo}</ScrollArea>
    </div>
  );
}

function BookOpenIcon() {
  return <Database className="size-4 text-primary" />;
}

function sourceLabel(sourceType: Message["sourceType"], role: Message["role"]) {
  if (role === "agent") {
    return "部门人员";
  }

  switch (sourceType) {
    case "kb":
      return "知识库";
    case "llm":
      return "大模型";
    case "manual":
      return "人工处理";
    case "sensitive":
      return "敏感词命中，仅限知识库";
    default:
      return "系统";
  }
}

function sourceBadgeClass(sourceType: Message["sourceType"]) {
  if (sourceType === "kb") {
    return "bg-primary/10 text-primary";
  }
  if (sourceType === "llm") {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }
  if (sourceType === "manual") {
    return "bg-secondary text-foreground";
  }
  if (sourceType === "sensitive") {
    return "bg-destructive/10 text-destructive";
  }
  return "";
}

function MessageActionMenu(props: {
  message: Message;
  hasContent: boolean;
  canPersistAction: boolean;
  copiedActionKey: string | null;
  regenerateDisabled?: boolean;
  onCopy: (message: Message, format: "text" | "markdown") => void | Promise<void>;
  onDownload: (message: Message, format: "text" | "markdown") => void;
  onDeleteRequest: () => void;
  onEdit: () => void;
  onRegenerate?: () => void | Promise<void>;
}) {
  const markdownCopied = props.copiedActionKey === `${props.message.id}:markdown`;
  const textCopied = props.copiedActionKey === `${props.message.id}:text`;

  return (
    <TooltipProvider delayDuration={500}>
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="rounded p-1.5 transition-all duration-150 hover:bg-blue-50 hover:text-primary active:scale-90 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-accent"
              onClick={() => props.onCopy(props.message, "markdown")}
              disabled={!props.hasContent}
            >
              {markdownCopied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>复制 Markdown</TooltipContent>
        </Tooltip>

        {props.onRegenerate ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded p-1.5 transition-all duration-150 hover:bg-blue-50 hover:text-primary active:scale-90 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-accent"
                onClick={props.onRegenerate}
                disabled={!props.canPersistAction || props.regenerateDisabled}
              >
                <RefreshCw className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>重新生成</TooltipContent>
          </Tooltip>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="rounded p-1.5 transition-all duration-150 hover:bg-blue-50 hover:text-primary active:scale-90 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-accent"
              onClick={props.onEdit}
              disabled={!props.canPersistAction}
            >
              <Pencil className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>编辑</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded p-1.5 transition-all duration-150 hover:bg-slate-100 hover:text-slate-900 active:scale-90 dark:hover:bg-secondary dark:hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={!props.hasContent}
                onClick={() => props.onCopy(props.message, "text")}
              >
                {textCopied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                复制纯文本
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!props.hasContent}
                onClick={() => props.onDownload(props.message, "markdown")}
              >
                <FileText className="size-4" />
                下载 Markdown
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!props.hasContent}
                onClick={() => props.onDownload(props.message, "text")}
              >
                <Download className="size-4" />
                下载纯文本
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!props.canPersistAction}
              className="text-destructive focus:text-destructive"
              onClick={props.onDeleteRequest}
            >
              <Trash2 className="size-4" />
              删除消息
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  );
}

function AssistantMessageFooter(props: {
  message: Message;
  hasContent: boolean;
  canPersistAction: boolean;
  copiedActionKey: string | null;
  retrievalDebug: KnowledgeSourceDebugItem[];
  sending: boolean;
  onCreateTicket: () => void | Promise<void>;
  onCopy: (message: Message, format: "text" | "markdown") => void | Promise<void>;
  onDownload: (message: Message, format: "text" | "markdown") => void;
  onDeleteRequest: () => void;
  onEdit: () => void;
  onRegenerate: () => void | Promise<void>;
}) {
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);

  const isLlmAnswer = props.message.sourceType === "llm";

  const actionRow = (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        size="sm"
        variant={isLlmAnswer ? "default" : "outline"}
        onClick={props.onCreateTicket}
        disabled={props.sending}
        className={cn("shrink-0", isLlmAnswer && "font-bold shadow-md ring-2 ring-orange-300")}
      >
        <LifeBuoy className="size-4" />
        人工服务
      </Button>
      <MessageActionMenu
        message={props.message}
        hasContent={props.hasContent}
        canPersistAction={props.canPersistAction}
        copiedActionKey={props.copiedActionKey}
        onCopy={props.onCopy}
        onDownload={props.onDownload}
        onDeleteRequest={props.onDeleteRequest}
        onEdit={props.onEdit}
        onRegenerate={props.onRegenerate}
        regenerateDisabled={props.sending}
      />
    </div>
  );

  return (
    <div className="mt-3 border-t border-border pt-3 text-xs text-muted">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {props.retrievalDebug.length ? (
          <ReferenceKnowledgePanel
            messageId={props.message.id}
            sourceType={props.message.sourceType}
            retrievalDebug={props.retrievalDebug}
            open={knowledgeOpen}
            onOpenChange={setKnowledgeOpen}
            className={knowledgeOpen ? "order-first w-full flex-none" : "min-w-[260px] flex-1"}
          />
        ) : null}
        <div className={knowledgeOpen ? "order-last" : "order-first"}>{actionRow}</div>
      </div>
    </div>
  );
}

function ReferenceKnowledgePanel(props: {
  messageId: string;
  sourceType: Message["sourceType"];
  retrievalDebug: KnowledgeSourceDebugItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}) {
  const [openSourceKey, setOpenSourceKey] = useState<string | null>(null);
  const [sourceDetails, setSourceDetails] = useState<
    Record<
      string,
      {
        chunkText?: string;
        sourceFile?: string | null;
        scopeLevel?: string | null;
        cityName?: string | null;
        loading?: boolean;
        error?: string;
      }
    >
  >({});
  const orderedSources = prepareKnowledgeSourcesForDisplay(props.retrievalDebug, {
    isKbMessage: props.sourceType === "kb",
  });
  const primary = orderedSources[0];
  const referencedCount = orderedSources.filter((item) => item.usedAsReference).length;
  const panelLabel =
    props.sourceType === "kb" && referencedCount
      ? `已引用 ${referencedCount} 条`
      : `候选 ${orderedSources.length} 条`;

  async function toggleSourceDetail(item: KnowledgeSourceDebugItem, index: number) {
    const key = item.chunkId ?? String(index);
    if (openSourceKey === key) {
      setOpenSourceKey(null);
      return;
    }

    setOpenSourceKey(key);
    if (item.chunkText || !item.chunkId || sourceDetails[key]) {
      return;
    }

    setSourceDetails((current) => ({ ...current, [key]: { loading: true } }));
    try {
      const response = await fetch(`/api/knowledge/chunks/${item.chunkId}`);
      const data = await response.json();
      if (!response.ok) {
        setSourceDetails((current) => ({
          ...current,
          [key]: { error: data.error || "读取知识片段失败" },
        }));
        return;
      }
      setSourceDetails((current) => ({
        ...current,
        [key]: {
          chunkText: data.chunk?.chunkText,
          sourceFile: data.chunk?.sourceFile,
          scopeLevel: data.chunk?.scopeLevel,
          cityName: data.chunk?.cityName,
        },
      }));
    } catch {
      setSourceDetails((current) => ({
        ...current,
        [key]: { error: "读取知识片段失败" },
      }));
    }
  }

  return (
    <div
      className={`rounded border border-border bg-slate-50 text-xs text-muted dark:bg-secondary ${props.className ?? ""}`}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-slate-100 dark:hover:bg-secondary/80"
        onClick={() => props.onOpenChange(!props.open)}
        aria-expanded={props.open}
      >
        <span
          className={`shrink-0 transition-transform duration-150 ${props.open ? "rotate-90" : ""}`}
        >
          ▸
        </span>
        <span className="min-w-0 truncate" suppressHydrationWarning>
          参考知识：{primary.question || "无"} · 相似度 {primary.rerankScore.toFixed(2)}
          {primary.updatedAt
            ? ` · 更新于 ${new Date(primary.updatedAt).toLocaleDateString("zh-CN")}`
            : ""}
        </span>
        <Badge className="ml-auto shrink-0 border-blue-100 bg-blue-50 text-blue-700">
          {panelLabel}
        </Badge>
      </button>
      {props.open ? (
        <div className="border-t border-border p-3">
          <div className="mb-2 font-medium text-foreground">参考知识</div>
          <div className="flex flex-col gap-2">
            {orderedSources.map((item, index) => {
              const sourceKey = item.chunkId ?? String(index);
              const detail = sourceDetails[sourceKey];
              const sourceFile =
                detail?.sourceFile || item.sourceFile || item.question || "未知来源";
              const scopeLevel = detail?.scopeLevel ?? item.scopeLevel;
              const cityName = detail?.cityName ?? item.cityName;
              const chunkText = item.chunkText || detail?.chunkText;

              return (
                <div
                  key={`${props.messageId}-${sourceKey}`}
                  className={`rounded border p-2 ${
                    item.usedAsReference
                      ? "border-blue-200 bg-blue-50/70 text-slate-900 dark:border-primary/40 dark:bg-accent/40 dark:text-foreground"
                      : "border-border bg-white dark:bg-card"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">
                        {item.question || "无"}
                      </div>
                      <div className="mt-1">相似度：{item.rerankScore.toFixed(4)}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {item.usedAsReference ? (
                        <Badge className="border-blue-200 bg-white text-blue-700 dark:bg-card">
                          已引用
                        </Badge>
                      ) : (
                        <Badge className="border-slate-200 bg-slate-100 text-slate-500">候选</Badge>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => void toggleSourceDetail(item, index)}
                      >
                        <FileText className="size-3.5" />
                        查看知识源
                      </Button>
                    </div>
                  </div>
                  {item.updatedAt ? (
                    <div className="mt-1">
                      更新于：{new Date(item.updatedAt).toLocaleDateString("zh-CN")}
                    </div>
                  ) : null}
                  {openSourceKey === sourceKey ? (
                    <div className="mt-2 rounded border border-border bg-white/80 p-2 leading-5 dark:bg-card">
                      <div>来源：{sourceFile}</div>
                      {scopeLevel ? (
                        <div>
                          适用范围：
                          {scopeLevel === "city" ? cityName || "城市专属" : "通用"}
                        </div>
                      ) : null}
                      {item.sources?.length ? (
                        <div>召回通道：{item.sources.join(" / ")}</div>
                      ) : null}
                      {typeof item.finalScore === "number" ? (
                        <div>融合分：{item.finalScore.toFixed(4)}</div>
                      ) : null}
                      {detail?.loading ? (
                        <div className="mt-2 rounded bg-slate-50 px-2 py-1 text-muted dark:bg-secondary">
                          正在读取 Chunk...
                        </div>
                      ) : detail?.error ? (
                        <div className="mt-2 rounded bg-red-50 px-2 py-1 text-red-700">
                          {detail.error}
                        </div>
                      ) : chunkText ? (
                        <div className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-foreground">
                          {chunkText}
                        </div>
                      ) : (
                        <div className="mt-2 rounded bg-slate-50 px-2 py-1 text-muted dark:bg-secondary">
                          未找到该参考知识对应的 Chunk 原文。
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function resizeEditTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 420)}px`;
}

function messageToMarkdown(message: Message) {
  const roleLabel =
    message.role === "user"
      ? "用户"
      : message.role === "assistant"
        ? "助手"
        : sourceLabel(message.sourceType, message.role);
  const time = new Date(message.createdAt).toLocaleString("zh-CN");
  const content =
    message.role === "assistant"
      ? stripFixedAssistantSuffix(message.contentText)
      : message.contentText;
  return [`### ${roleLabel} · ${time}`, "", content.trim()].join("\n");
}

function messageToPlainText(message: Message) {
  const content =
    message.role === "assistant"
      ? stripFixedAssistantSuffix(message.contentText)
      : message.contentText;
  return markdownToPlainText(content).trim();
}

function markdownToPlainText(markdown: string) {
  if (!markdown) {
    return "";
  }

  return removeMarkdown(markdown);
}

function safeFileName(value: string) {
  return (
    value
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 48) || "消息"
  );
}

function formatMessageTimeForFile(value: string | Date) {
  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join("");
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
      ? props.progress.currentElapsedMs +
        Math.max(0, props.nowMs - props.progress.currentStepStartedClientAt)
      : (props.progress.totalDurationMs ?? props.progress.currentElapsedMs);
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
  const summaryDurationMs =
    props.progress.status === "running" ? (currentStepDurationMs ?? 0) : totalDurationMs;
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
      maxHeight,
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
            className="fixed z-[1000] overflow-y-auto rounded-2xl border border-border bg-white p-3 shadow-2xl dark:bg-card"
            style={{
              left: popoverPosition.left,
              top: popoverPosition.top,
              width: popoverPosition.width,
              maxHeight: popoverPosition.maxHeight,
            }}
            onMouseEnter={openDetails}
            onMouseLeave={scheduleCloseDetails}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-foreground">{title}</div>
              <div className="text-xs text-muted">
                总耗时 {formatDurationSeconds(totalDurationMs)}
              </div>
            </div>

            <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
              <div className="rounded-xl bg-secondary/40 px-3 py-2">
                <div>首个正文</div>
                <div className="mt-1 font-medium text-foreground">
                  {props.progress.firstTokenLatencyMs != null
                    ? formatDurationSeconds(props.progress.firstTokenLatencyMs)
                    : "未返回"}
                </div>
              </div>
              <div className="rounded-xl bg-secondary/40 px-3 py-2">
                <div>流式输出</div>
                <div className="mt-1 font-medium text-foreground">
                  {props.progress.streamAnswerMs != null
                    ? formatDurationSeconds(props.progress.streamAnswerMs)
                    : "未开始"}
                </div>
              </div>
            </div>

            {visibleSteps.length ? (
              <div className="mt-3 space-y-2 text-sm">
                {visibleSteps.map((stepKey) => {
                  const completedStep = props.progress.steps[stepKey];
                  const isCurrent =
                    props.progress.currentStepKey === stepKey &&
                    props.progress.status === "running";

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
                          {completedStep
                            ? formatDurationSeconds(completedStep.durationMs)
                            : isCurrent
                              ? "进行中"
                              : ""}
                        </span>
                      </div>
                      {completedStep?.detail ? (
                        <div className="mt-1 text-xs text-muted">{completedStep.detail}</div>
                      ) : null}
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
    <div className="mb-3" onMouseEnter={openDetails} onMouseLeave={scheduleCloseDetails}>
      <button
        ref={triggerRef}
        type="button"
        className="flex w-full items-center justify-between rounded-2xl border border-border bg-white/80 px-3 py-2 text-left dark:bg-card/80"
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
        <div className="ml-3 shrink-0 text-xs text-muted">
          {formatDurationSeconds(summaryDurationMs)}
        </div>
      </button>
      {detailsPanel}
    </div>
  );
}
