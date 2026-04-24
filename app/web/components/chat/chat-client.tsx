"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { AttachmentItem } from "@pharmacy/shared";
import { CircleAlert, ImagePlus, LifeBuoy, SendHorizontal } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { safeJsonParse } from "@/lib/utils";

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

export function ChatClient(props: {
  conversationId: string;
  conversations: Conversation[];
  messages: Message[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeConversation = useMemo(
    () => props.conversations.find((item) => item.id === props.conversationId) ?? props.conversations[0],
    [props.conversationId, props.conversations]
  );

  async function uploadFiles(fileList: FileList | File[]) {
    if (!fileList.length) {
      return;
    }

    const formData = new FormData();
    Array.from(fileList).forEach((file) => formData.append("files", file));

    const response = await fetch("/api/uploads", {
      method: "POST",
      body: formData
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "上传失败");
    }

    setAttachments((current) => [...current, ...data.files]);
  }

  async function sendMessage() {
    if (!text.trim() && !attachments.length) {
      setError("请输入文字或上传图片后再发送");
      return;
    }

    setError("");
    startTransition(async () => {
      const response = await fetch(`/api/conversations/${props.conversationId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text,
          attachments
        })
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "发送失败");
        return;
      }

      setText("");
      setAttachments([]);
      router.refresh();
    });
  }

  async function createTicket() {
    startTransition(async () => {
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
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="h-full">
        <CardHeader>
          <CardTitle>会话历史</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            action={async () => {
              const response = await fetch("/api/conversations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "新会话" })
              });
              const data = await response.json();
              router.push(`/staff/chat?conversationId=${data.conversation.id}`);
            }}
          >
            <Button className="w-full" variant="secondary">
              新建会话
            </Button>
          </form>
          <div className="space-y-2">
            {props.conversations.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => router.push(`/staff/chat?conversationId=${item.id}`)}
                className={`w-full rounded-2xl border px-3 py-3 text-left text-sm transition ${
                  activeConversation?.id === item.id ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/40"
                }`}
              >
                <div className="font-medium">{item.title}</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="min-h-[520px]">
          <CardHeader>
            <CardTitle>门店智能问答</CardTitle>
            <p className="text-sm text-muted">支持纯文字、纯图片、图文混合输入。知识库命中时直接返回标准答案，未命中时走大模型兜底。</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-[420px] space-y-4 overflow-y-auto pr-1">
              {props.messages.map((message) => {
                const attachmentsData = safeJsonParse<AttachmentItem[]>(message.attachmentsJson, []);
                const retrievalDebug = safeJsonParse<Array<{ question: string; sourceFile?: string | null; rerankScore: number }>>(
                  message.retrievalDebugJson,
                  []
                );

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
                    <div className="whitespace-pre-wrap text-sm leading-6">{message.contentText}</div>
                    {attachmentsData.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {attachmentsData.map((item) => (
                          <a
                            key={item.path}
                            href={`/api/files/${item.path.replace(/^uploads\//, "")}`}
                            target="_blank"
                            className="rounded-xl border border-border bg-white px-3 py-2 text-xs hover:bg-secondary"
                            rel="noreferrer"
                          >
                            {item.name}
                          </a>
                        ))}
                      </div>
                    ) : null}
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
                  <Badge key={item.path}>{item.name}</Badge>
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
                <Button onClick={sendMessage} disabled={pending}>
                  <SendHorizontal className="mr-2 h-4 w-4" />
                  {pending ? "发送中..." : "发送"}
                </Button>
                <Button onClick={createTicket} disabled={pending} variant="outline">
                  <LifeBuoy className="mr-2 h-4 w-4" />
                  人工服务
                </Button>
              </div>
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
