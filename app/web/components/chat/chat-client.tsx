"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { AttachmentItem } from "@pharmacy/shared";
import { CircleAlert, ImagePlus, LifeBuoy, SendHorizontal, Trash2, X } from "lucide-react";

import { AttachmentGallery } from "@/components/shared/attachment-gallery";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { getAttachmentItems, safeJsonParse } from "@/lib/utils";

type Conversation = {
  id: string;
  title: string;
  updatedAt: string | Date;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "human_l1" | "human_l2" | "system";
  sourceType: "kb" | "llm" | "manual" | "system";
  contentText: string;
  attachmentsJson: string | null;
  retrievalDebugJson: string | null;
  createdAt: string | Date;
};

type StreamDebugPayload = {
  retrievalDebug?: Array<{ question: string; sourceFile?: string | null; rerankScore: number }>;
  imagePaths?: string[];
};

export function ChatClient(props: {
  conversationId: string;
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => setMessages(props.messages), [props.messages]);
  useEffect(() => setConversations(props.conversations), [props.conversations]);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === props.conversationId) ?? conversations[0],
    [props.conversationId, conversations]
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

  async function createConversation() {
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "新会话" })
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "创建会话失败");
      return;
    }
    router.push(`/staff/chat?conversationId=${data.conversation.id}`);
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

    if (conversationId === props.conversationId) {
      if (remaining[0]) {
        router.push(`/staff/chat?conversationId=${remaining[0].id}`);
      } else {
        await createConversation();
      }
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
        createdAt: new Date().toISOString()
      },
      {
        id: optimisticAssistantId,
        role: "assistant",
        sourceType: "system",
        contentText: "",
        attachmentsJson: null,
        retrievalDebugJson: null,
        createdAt: new Date().toISOString()
      }
    ]);

    setText("");
    setAttachments([]);

    try {
      const response = await fetch(`/api/conversations/${props.conversationId}/messages`, {
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

          if (event === "delta" && payload.text) {
            setMessages((current) =>
              current.map((item) =>
                item.id === optimisticAssistantId ? { ...item, contentText: item.contentText + payload.text! } : item
              )
            );
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
      router.refresh();
    } catch (sendError) {
      setMessages((current) => current.filter((item) => item.id !== optimisticAssistantId));
      setError(sendError instanceof Error ? sendError.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  async function createTicket() {
    const response = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: props.conversationId })
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "创建工单失败");
      return;
    }
    router.push(`/staff/tickets/${data.ticket.id}`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="h-full">
        <CardHeader>
          <CardTitle>会话历史</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" variant="secondary" onClick={createConversation}>
            新建会话
          </Button>
          <div className="space-y-2">
            {conversations.map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-left text-sm transition ${
                  activeConversation?.id === item.id ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/40"
                }`}
              >
                <button type="button" onClick={() => router.push(`/staff/chat?conversationId=${item.id}`)} className="flex-1 text-left">
                  <div className="font-medium">{item.title}</div>
                </button>
                <button
                  type="button"
                  className="rounded-lg p-1 text-muted transition hover:bg-white hover:text-foreground"
                  onClick={() => deleteConversation(item.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="min-h-[520px]">
          <CardHeader>
            <CardTitle>门店智能问答</CardTitle>
            <p className="text-sm text-muted">支持纯文字、纯图片、图文混合输入。知识库命中后会做受控润色，未命中时走保守型大模型建议。</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-[420px] space-y-4 overflow-y-auto pr-1">
              {messages.map((message) => {
                const attachmentsData = getAttachmentItems(message.attachmentsJson);
                const debugPayload = safeJsonParse<{
                  debug?: Array<{ question: string; sourceFile?: string | null; rerankScore: number }>;
                  imagePaths?: string[];
                }>(message.retrievalDebugJson, {});
                const retrievalDebug = debugPayload.debug ?? [];
                const imagePaths = debugPayload.imagePaths ?? [];

                return (
                  <div
                    key={message.id}
                    className={`rounded-2xl border px-4 py-3 ${
                      message.role === "user" ? "ml-8 bg-white" : "mr-8 bg-secondary/50"
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Badge className={sourceBadgeClass(message.sourceType)}>{sourceLabel(message.sourceType, message.role)}</Badge>
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-6">{message.contentText || (message.role === "assistant" ? "正在生成..." : "")}</div>
                    {imagePaths.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {imagePaths.map((img, i) => (
                          <img
                            key={i}
                            src={`/api/files/${img}`}
                            alt=""
                            className="max-h-48 cursor-pointer rounded-xl border border-border object-contain transition hover:opacity-80"
                            onClick={() => window.open(`/api/files/${img}`, "_blank")}
                          />
                        ))}
                      </div>
                    ) : null}
                    <AttachmentGallery attachments={attachmentsData} />
                    {retrievalDebug.length ? (
                      <details className="mt-3 rounded-xl border border-border bg-white/80 p-3 text-xs">
                        <summary className="cursor-pointer text-muted">查看命中来源 / Debug</summary>
                        <div className="mt-2 space-y-2">
                          {retrievalDebug.map((item, index) => (
                            <div key={`${message.id}-${index}`} className="rounded-lg border border-border p-2">
                              <div>问题：{item.question}</div>
                              <div>来源：{item.sourceFile || "未知来源"}</div>
                              <div>分数：{item.rerankScore.toFixed(4)}</div>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-dashed border-border bg-white/60 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-muted">
                <CircleAlert className="h-4 w-4" />
                每次回答后都可点击人工服务，生成默认流转给人工处理1的工单。
              </div>
              <Textarea
                ref={textareaRef}
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
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {attachments.map((item) => (
                  <span key={item.path} className="inline-flex items-center gap-1 rounded-xl border border-border bg-white px-3 py-2 text-xs">
                    {item.name}
                    <button type="button" onClick={() => setAttachments((current) => current.filter((file) => file.path !== item.path))}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm">
                  <ImagePlus className="h-4 w-4" />
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
                <Button onClick={sendMessage} disabled={sending}>
                  <SendHorizontal className="mr-2 h-4 w-4" />
                  {sending ? "发送中..." : "发送"}
                </Button>
                <Button onClick={createTicket} disabled={sending} variant="outline">
                  <LifeBuoy className="mr-2 h-4 w-4" />
                  人工服务
                </Button>
              </div>
              <p className="mt-3 text-xs text-muted">如果仍有不明确的地方，请拨打 {props.serviceHotline} 电话咨询。</p>
              {error ? <Alert className="mt-3 border-destructive bg-destructive/10 text-destructive">{error}</Alert> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function sourceLabel(sourceType: Message["sourceType"], role: Message["role"]) {
  if (role === "human_l1" || role === "human_l2") {
    return "人工处理";
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
