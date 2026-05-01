"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import type { AttachmentItem } from "@pharmacy/shared";
import { Ticket, TicketMessage } from "@prisma/client";
import { ArrowUpRight, CheckCircle2, MessageSquareReply, Upload } from "lucide-react";

import { AttachmentGallery } from "@/components/shared/attachment-gallery";
import { PriorityBadge, TicketStatusBadge } from "@/components/shared/status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, parseTags, roleLabel } from "@/lib/presentation";
import { getAttachmentItems } from "@/lib/utils";

type TicketMessageWithSender = TicketMessage & {
  senderUser?: {
    displayName: string;
  } | null;
};

export function TicketDetailClient(props: {
  role: "staff" | "human_l1" | "human_l2";
  ticket: Ticket & {
    createdBy: { displayName: string };
    closedBy: { displayName: string } | null;
    messages: TicketMessageWithSender[];
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [content, setContent] = useState("");
  const [resolutionText, setResolutionText] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [error, setError] = useState("");

  async function uploadFiles(fileList: FileList) {
    const formData = new FormData();
    Array.from(fileList).forEach((file) => formData.append("files", file));
    const response = await fetch("/api/uploads", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "上传失败");
    }
    setAttachments((current) => [...current, ...data.files]);
  }

  function postReply() {
    startTransition(async () => {
      const response = await fetch(`/api/tickets/${props.ticket.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          attachments
        })
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "回复失败");
        return;
      }
      setContent("");
      setAttachments([]);
      router.refresh();
    });
  }

  function closeTicket() {
    startTransition(async () => {
      const response = await fetch(`/api/tickets/${props.ticket.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolutionText,
          attachments
        })
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "关闭失败");
        return;
      }
      setResolutionText("");
      setAttachments([]);
      router.refresh();
    });
  }

  function escalate() {
    startTransition(async () => {
      const response = await fetch(`/api/tickets/${props.ticket.id}/escalate`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "升级失败");
        return;
      }
      router.refresh();
    });
  }

  const tags = parseTags(props.ticket.tagsJson);

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <div className="grid gap-5 md:grid-cols-5">
          <div className="flex items-center gap-3">
            <TicketStatusBadge status={props.ticket.status} className="rounded-full px-4 py-1" />
          </div>
          <InfoBlock label="工单编号" value={props.ticket.ticketNo} />
          <InfoBlock label="当前处理人" value={roleLabel(props.ticket.currentAssigneeRole)} />
          <InfoBlock label="来源用户" value={props.ticket.createdBy.displayName} />
          <InfoBlock label="创建时间" value={formatDateTime(props.ticket.createdAt)} />
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>处理时间线</CardTitle>
            <CardDescription>用户问题、AI 初答、人工补充和系统流转记录</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="mb-6 rounded-xl border border-border bg-white p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="font-medium text-slate-900">用户问题</div>
                <span className="text-xs text-muted">{formatDateTime(props.ticket.createdAt)}</span>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-6">{props.ticket.latestUserQuestion}</div>
            </div>
            <div className="mb-8 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Badge className="bg-blue-100 text-primary">AI 初始回答</Badge>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-6">{props.ticket.aiAnswerSnapshot}</div>
            </div>

            <div className="relative flex flex-col gap-5">
              {props.ticket.messages.map((message, index) => {
                const files = getAttachmentItems(message.attachments);
                return (
                  <div key={message.id} className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-4">
                    {index < props.ticket.messages.length - 1 ? (
                      <div className="absolute left-5 top-10 h-[calc(100%+1.25rem)] w-px bg-border" />
                    ) : null}
                    <div className="z-10 flex size-10 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-slate-600 shadow-sm">
                      {message.senderRole === "system" ? "系" : message.senderRole === "user" ? "用" : "人"}
                    </div>
                    <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge>{message.senderUser?.displayName || senderLabel(message.senderRole)}</Badge>
                          <Badge className="bg-slate-100 text-slate-600">{message.messageType}</Badge>
                        </div>
                        <span className="text-xs text-muted">{formatDateTime(message.createdAt)}</span>
                      </div>
                      <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
                      <AttachmentGallery attachments={files} linkClassName="rounded border border-border px-3 py-2 text-xs" />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>快速操作</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ActionButton
                title="回复处理建议"
                description="针对当前问题给出回复建议"
                tone="blue"
                icon={<MessageSquareReply className="size-5" />}
              />
              {props.role === "human_l1" && props.ticket.status !== "closed" ? (
                <button
                  type="button"
                  className="flex items-center justify-between rounded-lg border border-orange-100 bg-orange-50 px-4 py-3 text-left text-orange-600 transition hover:bg-orange-100"
                  onClick={escalate}
                  disabled={pending}
                >
                  <span>
                    <span className="block text-sm font-medium">升级到人工处理2</span>
                    <span className="text-xs text-muted">升级给更高级别的人工处理者</span>
                  </span>
                  <ArrowUpRight className="size-5" />
                </button>
              ) : null}
              {props.role !== "staff" && props.ticket.status !== "closed" ? (
                <button
                  type="button"
                  className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-left text-emerald-600 transition hover:bg-emerald-100"
                  onClick={closeTicket}
                  disabled={pending || !resolutionText.trim()}
                >
                  <span>
                    <span className="block text-sm font-medium">关闭工单</span>
                    <span className="text-xs text-muted">问题已解决，关闭并归档工单</span>
                  </span>
                  <CheckCircle2 className="size-5" />
                </button>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-blue-100 bg-blue-50/60">
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold text-slate-900">关闭后将自动写回知识库</h3>
              <p className="mt-2 text-sm leading-6 text-muted">
                工单关闭后，系统会自动提炼本次问答中的关键信息，写回知识库，帮助更多门店解决类似问题。
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>工单信息</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <InfoRow label="工单优先级" value={<PriorityBadge priority={props.ticket.priority} />} />
              <InfoRow label="问题分类" value={props.ticket.category} />
              <InfoRow
                label="问题标签"
                value={
                  <span className="flex flex-wrap gap-1">
                    {tags.length ? tags.map((tag) => <Badge key={tag} className="bg-slate-100 text-slate-600">{tag}</Badge>) : "-"}
                  </span>
                }
              />
              <InfoRow label="输入方式" value={props.ticket.inputMode} />
              <InfoRow label="首次响应" value={formatDateTime(props.ticket.firstRespondedAt)} />
              <InfoRow label="升级时间" value={formatDateTime(props.ticket.escalatedAt)} />
              <InfoRow label="关闭时间" value={formatDateTime(props.ticket.closedAt)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>继续处理</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {props.ticket.status === "closed" ? (
                <Alert className="border-primary/30 bg-blue-50 text-foreground">
                  工单已关闭。如需补充图片或说明，请重新发起新工单，避免知识回写和处理记录前后不一致。
                </Alert>
              ) : null}
              <Textarea placeholder="补充处理说明" value={content} onChange={(event) => setContent(event.target.value)} />
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded border border-border bg-white px-3 text-sm text-primary">
                <Upload className="size-4" />
                上传图片
                <input
                  className="hidden"
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  multiple
                  disabled={props.ticket.status === "closed"}
                  onChange={async (event) => {
                    if (event.target.files?.length) {
                      await uploadFiles(event.target.files);
                    }
                  }}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {attachments.map((item) => (
                  <Badge key={item.path}>{item.name}</Badge>
                ))}
              </div>
              <Button variant="secondary" onClick={postReply} disabled={pending || props.ticket.status === "closed"}>
                发送处理回复
              </Button>
              {props.role !== "staff" && props.ticket.status !== "closed" ? (
                <>
                  <Textarea
                    placeholder="填写最终处理结论，关闭工单后将自动写回知识库"
                    value={resolutionText}
                    onChange={(event) => setResolutionText(event.target.value)}
                  />
                  <Button onClick={closeTicket} disabled={pending || !resolutionText.trim()}>
                    关闭工单并写回知识库
                  </Button>
                </>
              ) : null}
              {error ? <Alert className="border-destructive bg-red-50 text-destructive">{error}</Alert> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </div>
  );
}

function ActionButton(props: { title: string; description: string; tone: "blue"; icon: ReactNode }) {
  return (
    <button
      type="button"
      className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-left text-primary transition hover:bg-blue-100"
      onClick={() => document.querySelector<HTMLTextAreaElement>("textarea")?.focus()}
    >
      <span className="flex items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-blue-100">{props.icon}</span>
        <span>
          <span className="block text-sm font-medium">{props.title}</span>
          <span className="text-xs text-muted">{props.description}</span>
        </span>
      </span>
      <ArrowUpRight className="size-5" />
    </button>
  );
}

function senderLabel(role: TicketMessage["senderRole"]) {
  switch (role) {
    case "user":
      return "药店工作人员";
    case "human_l1":
      return "人工处理1";
    case "human_l2":
      return "人工处理2";
    default:
      return "系统";
  }
}
