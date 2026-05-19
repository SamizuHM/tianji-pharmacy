"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import type { AttachmentItem } from "@pharmacy/shared";
import { Ticket, TicketKnowledgeDraft, TicketMessage } from "@prisma/client";
import {
  ArrowUpRight,
  BookOpen,
  CircleCheck,
  Loader2,
  MessageSquareReply,
  Send,
  Upload,
} from "lucide-react";

import { AttachmentGallery } from "@/components/shared/attachment-gallery";
import { PriorityBadge, TicketStatusBadge } from "@/components/shared/status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, parseTags } from "@/lib/presentation";
import { cn, getAttachmentItems } from "@/lib/utils";

import { OrgTreeSelect } from "./org-tree-select";

type TicketMessageWithSender = TicketMessage & {
  senderUser?: {
    displayName: string;
  } | null;
};

type TicketKnowledgeDraftWithUser = TicketKnowledgeDraft & {
  generatedBy?: { displayName: string } | null;
};

type KnowledgeMaterial = {
  id: string;
  role: string;
  roleLabel: string;
  sourceLabel: string;
  contentText: string;
  attachments: AttachmentItem[];
  createdAt: string;
};

type Department = {
  id: string;
  name: string;
  users: Array<{ id: string; displayName: string }>;
};

export function TicketDetailClient(props: {
  role: "staff" | "agent";
  userId: string;
  userDepartmentName?: string | null;
  ticket: Ticket & {
    createdBy: { displayName: string };
    closedBy: { displayName: string } | null;
    claimedBy: { displayName: string } | null;
    escalatedToUser: { displayName: string } | null;
    resolutionSubmittedBy: { displayName: string } | null;
    messages: TicketMessageWithSender[];
    knowledgeDrafts: TicketKnowledgeDraftWithUser[];
  };
  departments?: Department[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [content, setContent] = useState("");
  const [resolutionText, setResolutionText] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [error, setError] = useState("");
  const [showEscalate, setShowEscalate] = useState(false);
  const [showKnowledgeEntry, setShowKnowledgeEntry] = useState(false);

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

  function claimTicket() {
    startTransition(async () => {
      const response = await fetch(`/api/tickets/${props.ticket.id}/claim`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "认领失败");
        return;
      }
      router.refresh();
    });
  }

  function postReply() {
    startTransition(async () => {
      const response = await fetch(`/api/tickets/${props.ticket.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, attachments }),
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

  function escalate(target: { targetDept: string; targetUserId?: string }) {
    startTransition(async () => {
      const response = await fetch(`/api/tickets/${props.ticket.id}/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "升级失败");
        return;
      }
      setShowEscalate(false);
      router.refresh();
    });
  }

  function submitResolution() {
    startTransition(async () => {
      const response = await fetch(`/api/tickets/${props.ticket.id}/submit-resolution`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutionText }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "提交失败");
        return;
      }
      setResolutionText("");
      router.refresh();
    });
  }

  function resolveTicket() {
    startTransition(async () => {
      const response = await fetch(`/api/tickets/${props.ticket.id}/resolve`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "确认失败");
        return;
      }
      router.refresh();
    });
  }

  function closeTicket() {
    startTransition(async () => {
      const response = await fetch(`/api/tickets/${props.ticket.id}/close`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "关闭失败");
        return;
      }
      router.refresh();
    });
  }

  const isClaimant = props.ticket.claimedBy && props.ticket.claimedByUserId === props.userId;
  const isCreator = props.ticket.createdByUserId === props.userId;
  const isFrontlineAgent = props.role === "agent" && !props.userDepartmentName;
  const canClaim =
    props.role === "agent" &&
    ((isFrontlineAgent && props.ticket.status === "pending_claim") ||
      props.ticket.status === "escalated");
  const canReply =
    props.ticket.status !== "closed" &&
    ((props.role === "staff" && isCreator) || (props.role === "agent" && isClaimant));
  const canEscalate = isFrontlineAgent && isClaimant && props.ticket.status === "processing";
  const canSubmitResolution =
    props.role === "agent" &&
    (isClaimant || props.ticket.claimedByUserId === props.userId) &&
    props.ticket.status !== "closed" &&
    !props.ticket.resolutionSubmittedAt;
  const canResolve =
    props.role === "staff" &&
    isCreator &&
    props.ticket.status !== "closed" &&
    props.ticket.status !== "resolved" &&
    Boolean(props.ticket.resolutionSubmittedAt);
  const canGenerateKnowledge =
    props.role === "agent" && Boolean(isClaimant) && props.ticket.status === "resolved";
  const latestKnowledgeDraft = props.ticket.knowledgeDrafts[0] ?? null;
  const canClose =
    props.ticket.status === "resolved" &&
    ((props.role === "staff" && isCreator) || (props.role === "agent" && Boolean(isClaimant)));
  const canCloseWithWriteback =
    canClose &&
    props.ticket.knowledgeStatus === "pending_writeback" &&
    Boolean(latestKnowledgeDraft);

  const tags = parseTags(props.ticket.tagsJson);

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <div className="grid gap-5 md:grid-cols-5">
          <div className="flex items-center gap-3">
            <TicketStatusBadge status={props.ticket.status} className="rounded-full px-4 py-1" />
          </div>
          <InfoBlock label="工单编号" value={props.ticket.ticketNo} />
          <InfoBlock
            label="当前处理人"
            value={
              props.ticket.claimedBy?.displayName ||
              (props.ticket.status === "pending_claim" ? "待认领" : "-")
            }
          />
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
            <div className="mb-6 rounded-xl border border-border bg-white p-4 dark:bg-card">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="font-medium text-slate-900 dark:text-foreground">用户问题</div>
                <span className="text-xs text-muted">{formatDateTime(props.ticket.createdAt)}</span>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-6">
                {props.ticket.latestUserQuestion}
              </div>
            </div>
            <div className="mb-8 rounded-xl border border-blue-100 bg-blue-50/60 p-4 dark:border-border dark:bg-secondary/60">
              <div className="mb-2 flex items-center gap-2">
                <Badge className="bg-blue-100 text-primary dark:border-primary/20 dark:bg-primary/10 dark:text-primary">
                  AI 初始回答
                </Badge>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-6">
                {props.ticket.aiAnswerSnapshot}
              </div>
            </div>

            <div className="relative flex flex-col gap-5">
              {props.ticket.messages.map((message, index) => {
                const files = getAttachmentItems(message.attachments);
                return (
                  <div
                    key={message.id}
                    className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-4"
                  >
                    {index < props.ticket.messages.length - 1 ? (
                      <div className="absolute left-5 top-10 h-[calc(100%+1.25rem)] w-px bg-border" />
                    ) : null}
                    <div
                      className={cn(
                        "z-10 flex size-10 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-slate-600 shadow-sm dark:border-card",
                        message.senderRole === "system" &&
                          "dark:border-info/30 dark:bg-info/10 dark:text-info",
                        message.senderRole === "user" &&
                          "dark:border-primary/30 dark:bg-primary/10 dark:text-primary",
                        message.senderRole === "agent" &&
                          "dark:border-success/30 dark:bg-success/10 dark:text-success"
                      )}
                    >
                      {message.senderRole === "system"
                        ? "系"
                        : message.senderRole === "user"
                          ? "用"
                          : "人"}
                    </div>
                    <div className="rounded-lg border border-border bg-white p-4 shadow-sm dark:bg-card">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge>
                            {message.senderUser?.displayName || senderLabel(message.senderRole)}
                          </Badge>
                          <Badge className="bg-slate-100 text-slate-600 dark:border-primary/20 dark:bg-primary/10 dark:text-primary">
                            {message.messageType}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted">
                          {formatDateTime(message.createdAt)}
                        </span>
                      </div>
                      <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
                      <AttachmentGallery
                        attachments={files}
                        linkClassName="rounded border border-border px-3 py-2 text-xs"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          {/* Claim button */}
          {canClaim ? (
            <Card>
              <CardContent className="p-5">
                <Button className="w-full" onClick={claimTicket} disabled={pending}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {pending ? "认领中..." : "认领工单"}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {/* Quick actions */}
          <Card>
            <CardHeader>
              <CardTitle>快速操作</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {canReply ? (
                <ActionButton
                  title="回复处理建议"
                  description="针对当前问题给出回复建议"
                  tone="blue"
                  icon={<MessageSquareReply className="size-5" />}
                  onClick={() => document.querySelector<HTMLTextAreaElement>("textarea")?.focus()}
                />
              ) : null}
              {canEscalate && props.departments ? (
                <button
                  type="button"
                  className="flex items-center justify-between rounded-lg border border-orange-100 bg-orange-50 px-4 py-3 text-left text-orange-600 transition hover:bg-orange-100 disabled:opacity-60 dark:border-warning/30 dark:bg-warning/10 dark:text-warning dark:hover:bg-secondary"
                  onClick={() => setShowEscalate(!showEscalate)}
                  disabled={pending}
                >
                  <span>
                    <span className="block text-sm font-medium">升级到部门</span>
                    <span className="text-xs text-muted">将工单转交给其他部门处理</span>
                  </span>
                  <ArrowUpRight className="size-5" />
                </button>
              ) : null}
              {canSubmitResolution ? (
                <button
                  type="button"
                  className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-left text-emerald-600 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-success/30 dark:bg-success/10 dark:text-success dark:hover:bg-secondary"
                  onClick={() => document.getElementById("resolution-input")?.focus()}
                  disabled={pending}
                >
                  <span>
                    <span className="block text-sm font-medium">提交解决方案</span>
                    <span className="text-xs text-muted">
                      提交处理方案，等待药店工作人员确认关闭
                    </span>
                  </span>
                  <Send className="size-5" />
                </button>
              ) : null}
              {canResolve ? (
                <button
                  type="button"
                  className="flex items-center justify-between rounded-lg border border-cyan-100 bg-cyan-50 px-4 py-3 text-left text-cyan-600 transition hover:bg-cyan-100 disabled:opacity-60 dark:border-info/30 dark:bg-info/10 dark:text-info dark:hover:bg-secondary"
                  onClick={resolveTicket}
                  disabled={pending}
                >
                  <span>
                    <span className="block text-sm font-medium">问题已解决</span>
                    <span className="text-xs text-muted">确认后客服才能整理待入库知识</span>
                  </span>
                  <CircleCheck className="size-5" />
                </button>
              ) : null}
              {canGenerateKnowledge ? (
                <button
                  type="button"
                  className="flex items-center justify-between rounded-lg border border-purple-100 bg-purple-50 px-4 py-3 text-left text-purple-600 transition hover:bg-purple-100 disabled:opacity-60 dark:border-info/30 dark:bg-info/10 dark:text-info dark:hover:bg-secondary"
                  onClick={() => setShowKnowledgeEntry(!showKnowledgeEntry)}
                  disabled={pending}
                >
                  <span>
                    <span className="block text-sm font-medium">生成待入库答案</span>
                    <span className="text-xs text-muted">客服勾选有效对话和附件，整理优质答案</span>
                  </span>
                  <BookOpen className="size-5" />
                </button>
              ) : null}
              {error ? (
                <Alert className="border-destructive bg-red-50 text-destructive dark:border-destructive/30 dark:bg-destructive/10">
                  {error}
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          {/* Escalation UI */}
          {showEscalate && props.departments ? (
            <Card>
              <CardContent className="p-5">
                <OrgTreeSelect
                  departments={props.departments}
                  onSelect={escalate}
                  onCancel={() => setShowEscalate(false)}
                />
              </CardContent>
            </Card>
          ) : null}

          {/* Knowledge entry UI */}
          {showKnowledgeEntry ? (
            <Card>
              <CardContent className="p-5">
                <KnowledgeDraftBuilder
                  ticketId={props.ticket.id}
                  canGenerate={canGenerateKnowledge}
                  initialDraft={latestKnowledgeDraft}
                  onGenerated={() => {
                    setShowKnowledgeEntry(false);
                    router.refresh();
                  }}
                />
              </CardContent>
            </Card>
          ) : null}

          {/* Knowledge writeback info */}
          <Card className="border-blue-100 bg-blue-50/60 dark:border-border dark:bg-secondary/60">
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-foreground">
                知识写回状态：{knowledgeStatusLabel(props.ticket.knowledgeStatus)}
              </h3>
              {latestKnowledgeDraft ? (
                <KnowledgeDraftPreview draft={latestKnowledgeDraft} />
              ) : (
                <p className="mt-2 text-sm leading-6 text-muted">
                  当前工单尚未生成待入库答案。药店确认问题解决后，客服需要勾选有效历史对话和附件，生成优质答案后才能关闭并写回知识库。
                </p>
              )}
            </CardContent>
          </Card>

          {/* Ticket info */}
          <Card>
            <CardHeader>
              <CardTitle>工单信息</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <InfoRow
                label="工单优先级"
                value={<PriorityBadge priority={props.ticket.priority} />}
              />
              <InfoRow label="问题分类" value={props.ticket.category} />
              <InfoRow
                label="问题标签"
                value={
                  <span className="flex flex-wrap gap-1">
                    {tags.length
                      ? tags.map((tag) => (
                          <Badge
                            key={tag}
                            className="bg-slate-100 text-slate-600 dark:border-primary/20 dark:bg-primary/10 dark:text-primary"
                          >
                            {tag}
                          </Badge>
                        ))
                      : "-"}
                  </span>
                }
              />
              <InfoRow label="输入方式" value={props.ticket.inputMode} />
              <InfoRow label="首次响应" value={formatDateTime(props.ticket.firstRespondedAt)} />
              <InfoRow label="升级时间" value={formatDateTime(props.ticket.escalatedAt)} />
              {props.ticket.escalatedToDept ? (
                <InfoRow
                  label="升级目标"
                  value={
                    props.ticket.escalatedToDept +
                    (props.ticket.escalatedToUser
                      ? ` > ${props.ticket.escalatedToUser.displayName}`
                      : "")
                  }
                />
              ) : null}
              {props.ticket.resolutionSubmittedAt ? (
                <>
                  <InfoRow
                    label="方案提交时间"
                    value={formatDateTime(props.ticket.resolutionSubmittedAt)}
                  />
                  <InfoRow
                    label="方案提交人"
                    value={props.ticket.resolutionSubmittedBy?.displayName || "-"}
                  />
                </>
              ) : null}
              <InfoRow label="关闭时间" value={formatDateTime(props.ticket.closedAt)} />
            </CardContent>
          </Card>

          {/* Resolution submission (L1/L2) */}
          {canSubmitResolution ? (
            <Card>
              <CardHeader>
                <CardTitle>提交解决方案</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Textarea
                  id="resolution-input"
                  placeholder="填写处理方案，提交后等待药店工作人员确认关闭"
                  value={resolutionText}
                  onChange={(event) => setResolutionText(event.target.value)}
                />
                <Button onClick={submitResolution} disabled={pending || !resolutionText.trim()}>
                  {pending ? "提交中..." : "提交解决方案"}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {/* Resolve confirmation */}
          {canResolve ? (
            <Card>
              <CardHeader>
                <CardTitle>确认问题解决</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Alert className="border-primary/30 bg-blue-50 text-foreground dark:bg-primary/10">
                  人工客服已提交处理方案。确认问题解决后，客服才能勾选素材生成待入库知识。
                </Alert>
                <Textarea
                  placeholder="处理方案"
                  value={props.ticket.resolutionText || ""}
                  readOnly
                />
                <Button onClick={resolveTicket} disabled={pending}>
                  {pending ? "确认中..." : "问题已解决"}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {/* Close */}
          {canClose ? (
            <Card>
              <CardHeader>
                <CardTitle>关闭工单</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Alert className="border-primary/30 bg-blue-50 text-foreground dark:bg-primary/10">
                  问题已确认解决。关闭工单后，待入库答案会写回知识库。
                </Alert>
                <Textarea
                  placeholder="可编辑处理方案（可选）"
                  value={props.ticket.resolutionText || ""}
                  readOnly
                />
                {!canCloseWithWriteback ? (
                  <Alert className="border-orange-200 bg-orange-50 text-orange-700 dark:border-warning/30 dark:bg-warning/10 dark:text-foreground">
                    客服尚未生成待入库答案，暂不能关闭并写回知识库。
                  </Alert>
                ) : null}
                <Button onClick={closeTicket} disabled={pending || !canCloseWithWriteback}>
                  {pending ? "关闭中..." : "关闭工单写回知识库"}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {/* Reply section */}
          {canReply ? (
            <Card>
              <CardHeader>
                <CardTitle>继续处理</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {props.ticket.status === "closed" ? (
                  <Alert className="border-primary/30 bg-blue-50 text-foreground dark:bg-primary/10">
                    工单已关闭。如需补充图片或说明，请重新发起新工单，避免知识回写和处理记录前后不一致。
                  </Alert>
                ) : null}
                <Textarea
                  placeholder="补充处理说明"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                />
                <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded border border-border bg-white px-3 text-sm text-primary dark:bg-card">
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
                <Button
                  variant="secondary"
                  onClick={postReply}
                  disabled={pending || !content.trim()}
                >
                  {pending ? "发送中..." : "发送处理回复"}
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function KnowledgeDraftBuilder(props: {
  ticketId: string;
  canGenerate: boolean;
  initialDraft: TicketKnowledgeDraftWithUser | null;
  onGenerated: () => void;
}) {
  const [materials, setMaterials] = useState<KnowledgeMaterial[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadMaterials() {
      setLoading(true);
      setError("");
      const response = await fetch(`/api/tickets/${props.ticketId}/knowledge-materials`);
      const data = await response.json();
      if (cancelled) return;
      if (!response.ok) {
        setError(data.error || "加载对话素材失败");
        setLoading(false);
        return;
      }
      setMaterials(data.materials || []);
      setLoading(false);
    }
    loadMaterials();
    return () => {
      cancelled = true;
    };
  }, [props.ticketId]);

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function generateDraft() {
    setGenerating(true);
    setError("");
    const response = await fetch(`/api/tickets/${props.ticketId}/knowledge-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedMaterialIds: Array.from(selectedIds) }),
    });
    const data = await response.json();
    setGenerating(false);
    if (!response.ok) {
      setError(data.error || "生成待入库答案失败");
      return;
    }
    props.onGenerated();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-sm font-semibold text-slate-900 dark:text-foreground">
          生成待入库答案
        </div>
        <p className="mt-1 text-xs leading-5 text-muted">
          勾选本次工单中真正有效的问题、回答和附件，由大模型整理成一条可写入知识库的优质 QA。
        </p>
      </div>

      {props.initialDraft ? <KnowledgeDraftPreview draft={props.initialDraft} /> : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" />
          加载历史对话...
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-lg border border-border bg-white dark:bg-card">
          {materials.map((material) => {
            const checked = selectedIds.has(material.id);
            return (
              <label
                key={material.id}
                className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-3 last:border-b-0 hover:bg-slate-50 dark:hover:bg-secondary"
              >
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  checked={checked}
                  onChange={() => toggle(material.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{material.roleLabel}</Badge>
                    <Badge className="bg-slate-100 text-slate-600 dark:border-primary/20 dark:bg-primary/10 dark:text-primary">
                      {material.sourceLabel}
                    </Badge>
                    <span className="text-[11px] text-muted">
                      {formatDateTime(material.createdAt)}
                    </span>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-700 dark:text-foreground">
                    {material.contentText}
                  </div>
                  <AttachmentGallery
                    attachments={material.attachments}
                    linkClassName="rounded border border-border px-3 py-2 text-xs"
                  />
                </div>
              </label>
            );
          })}
        </div>
      )}

      {error ? (
        <Alert className="border-destructive bg-red-50 text-destructive dark:border-destructive/30 dark:bg-destructive/10">
          {error}
        </Alert>
      ) : null}

      <Button
        size="sm"
        disabled={!props.canGenerate || generating || selectedIds.size === 0}
        onClick={generateDraft}
      >
        {generating ? <Loader2 className="size-4 animate-spin" /> : null}
        {generating ? "生成中..." : `生成待入库答案（${selectedIds.size} 条）`}
      </Button>
    </div>
  );
}

function KnowledgeDraftPreview({ draft }: { draft: TicketKnowledgeDraftWithUser }) {
  const tags = parseTags(draft.tagsJson);
  const imagePaths = parseTags(draft.imagePathsJson);
  const attachments: AttachmentItem[] = imagePaths.map((path) => ({
    name: path.split("/").pop() || path,
    path,
    mimeType: "image/*",
    size: 0,
  }));

  return (
    <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3 text-sm dark:border-border dark:bg-card">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge className="bg-blue-100 text-primary dark:border-primary/20 dark:bg-primary/10 dark:text-primary">
          待入库
        </Badge>
        <span className="text-xs text-muted">
          {draft.generatedBy?.displayName ? `生成：${draft.generatedBy.displayName}` : "客服已生成"}
        </span>
      </div>
      <div className="text-xs text-muted">分类</div>
      <div className="mt-1 font-medium text-slate-900 dark:text-foreground">
        {draft.categoryL1} / {draft.categoryL2}
      </div>
      <div className="mt-3 text-xs text-muted">问题</div>
      <div className="mt-1 whitespace-pre-wrap leading-6 text-slate-800 dark:text-foreground">
        {draft.question}
      </div>
      <div className="mt-3 text-xs text-muted">优质答案</div>
      <div className="mt-1 whitespace-pre-wrap leading-6 text-slate-800 dark:text-foreground">
        {draft.answer}
      </div>
      {tags.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge
              key={tag}
              className="bg-slate-100 text-slate-600 dark:border-primary/20 dark:bg-primary/10 dark:text-primary"
            >
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
      <AttachmentGallery
        attachments={attachments}
        linkClassName="rounded border border-border px-3 py-2 text-xs"
      />
    </div>
  );
}

function knowledgeStatusLabel(status: Ticket["knowledgeStatus"]) {
  switch (status) {
    case "pending_writeback":
      return "待写回";
    case "written":
      return "已入库";
    default:
      return "未入库";
  }
}

function InfoBlock({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-900 dark:text-foreground">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-slate-900 dark:text-foreground">{value}</span>
    </div>
  );
}

function ActionButton(props: {
  title: string;
  description: string;
  tone: "blue";
  icon: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-left text-primary transition hover:bg-blue-100 dark:border-primary/30 dark:bg-primary/10 dark:hover:bg-secondary"
      onClick={props.onClick}
    >
      <span className="flex items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-blue-100 text-primary dark:border dark:border-primary/30 dark:bg-card/60">
          {props.icon}
        </span>
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
    case "assistant":
      return "系统大模型";
    case "agent":
      return "人工客服";
    default:
      return "系统";
  }
}
