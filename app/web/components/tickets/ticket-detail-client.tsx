"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { AttachmentItem } from "@pharmacy/shared";
import { Ticket, TicketMessage } from "@prisma/client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { safeJsonParse } from "@/lib/utils";

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
        body: JSON.stringify({ resolutionText })
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "关闭失败");
        return;
      }
      setResolutionText("");
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

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <CardTitle>处理时间线</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {props.ticket.messages.map((message) => {
            const files = safeJsonParse<AttachmentItem[]>(message.attachments, []);
            return (
              <div key={message.id} className="rounded-2xl border border-border bg-white p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Badge>{message.senderUser?.displayName || senderLabel(message.senderRole)}</Badge>
                  <Badge className="bg-secondary text-foreground">{message.messageType}</Badge>
                </div>
                <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                {files.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {files.map((file) => (
                      <a
                        key={file.path}
                        href={`/api/files/${file.path.replace(/^uploads\//, "")}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-xl border border-border px-3 py-2 text-xs"
                      >
                        {file.name}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>工单摘要</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="text-muted">工单号</div>
              <div>{props.ticket.ticketNo}</div>
            </div>
            <div>
              <div className="text-muted">状态</div>
              <div>{props.ticket.status}</div>
            </div>
            <div>
              <div className="text-muted">当前级别</div>
              <div>{props.ticket.currentAssigneeRole}</div>
            </div>
            <div>
              <div className="text-muted">问题摘要</div>
              <div>{props.ticket.latestUserQuestion}</div>
            </div>
            <div>
              <div className="text-muted">AI 初答</div>
              <div className="whitespace-pre-wrap">{props.ticket.aiAnswerSnapshot}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>继续处理</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea placeholder="补充处理说明" value={content} onChange={(event) => setContent(event.target.value)} />
            <label className="inline-flex cursor-pointer rounded-xl border border-border px-4 py-2 text-sm">
              上传图片
              <input
                className="hidden"
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                multiple
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
            <Button className="w-full" variant="secondary" onClick={postReply} disabled={pending}>
              发送处理回复
            </Button>

            {props.role !== "staff" && props.ticket.status !== "closed" ? (
              <>
                <Textarea
                  placeholder="填写最终处理结论，关闭工单后将自动写回知识库"
                  value={resolutionText}
                  onChange={(event) => setResolutionText(event.target.value)}
                />
                <Button className="w-full" onClick={closeTicket} disabled={pending}>
                  关闭工单并写回知识库
                </Button>
              </>
            ) : null}

            {props.role === "human_l1" && props.ticket.status === "pending_l1" ? (
              <Button className="w-full" variant="outline" onClick={escalate} disabled={pending}>
                升级到人工处理2
              </Button>
            ) : null}
            {error ? <Alert className="border-destructive bg-destructive/10 text-destructive">{error}</Alert> : null}
          </CardContent>
        </Card>
      </div>
    </div>
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
