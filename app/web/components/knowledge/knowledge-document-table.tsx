"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Edit3, FileText, RefreshCw, Save, Search, Trash2 } from "lucide-react";

import { PaginationBar } from "@/components/shared/pagination-bar";
import { KnowledgeStatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { formatDateTime } from "@/lib/presentation";
import { HUBEI_CITY_NAMES } from "@/lib/knowledge-scope";

type KnowledgeDocumentRow = {
  id: string;
  title: string;
  sourceFile: string | null;
  businessCategory: string;
  scopeLevel: "common" | "city";
  cityName: string | null;
  status: "draft" | "published" | "archived";
  hitCount: number;
  updatedAt: string | Date;
  _count?: { chunks: number; chunkSets: number };
};

type KnowledgeDocumentDetail = KnowledgeDocumentRow & {
  chunks: Array<{
    id: string;
    chunkIndex: number;
    chunkText: string;
    sectionPath: string | null;
    hypotheticalQuestionsJson: string | null;
    bm25DocLength: number;
    enabled: boolean;
  }>;
  knowledgeItems: Array<{
    id: string;
    question: string;
    answer: string;
    status: "draft" | "published" | "archived";
  }>;
  chunkSets: Array<{
    id: string;
    isActive: boolean;
    chunkStrategy: string;
    configJson: string | null;
    chunks: Array<{
      id: string;
      chunkIndex: number;
      chunkText: string;
      sectionPath: string | null;
      hypotheticalQuestionsJson: string | null;
      bm25DocLength: number;
      enabled: boolean;
    }>;
  }>;
};

function scopeLabel(item: KnowledgeDocumentRow) {
  if (item.scopeLevel === "city") return item.cityName || "城市专属";
  return "通用";
}

function parseHqList(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function KnowledgeDocumentTable({
  documents,
  total,
  page,
  pageSize,
  pageCount,
  categoryOptions,
  q,
  category,
  status,
}: {
  documents: KnowledgeDocumentRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  categoryOptions: string[];
  q?: string;
  category?: string;
  status?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navPending, startNavTransition] = useTransition();
  const [detailId, setDetailId] = useState<string | null>(searchParams.get("document"));
  const [detail, setDetail] = useState<KnowledgeDocumentDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [metadataForm, setMetadataForm] = useState({
    title: "",
    businessCategory: "",
    scopeLevel: "common" as "common" | "city",
    cityName: "",
    status: "published" as "draft" | "published" | "archived",
  });
  const [indexTasks, setIndexTasks] = useState<
    Array<{
      id: string;
      taskType: string;
      status: string;
      chunkId: string | null;
      retryCount: number;
      lastError: string | null;
    }>
  >([]);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      setIndexTasks([]);
      return;
    }

    let disposed = false;
    fetch(`/api/knowledge/documents/${detailId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!disposed) {
          const nextDetail = data?.document ?? null;
          setDetail(nextDetail);
          if (nextDetail) {
            setMetadataForm({
              title: nextDetail.title,
              businessCategory: nextDetail.businessCategory,
              scopeLevel: nextDetail.scopeLevel,
              cityName: nextDetail.cityName ?? "",
              status: nextDetail.status,
            });
          }
        }
      })
      .catch(() => undefined);

    fetch(`/api/knowledge/index-tasks?documentId=${detailId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!disposed && data?.tasks) {
          setIndexTasks(data.tasks);
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
    };
  }, [detailId]);

  const selectedDocument = useMemo(
    () => documents.find((item) => item.id === detailId),
    [detailId, documents]
  );
  const visibleDetail = detail ?? selectedDocument ?? null;
  const activeChunks =
    detail?.chunkSets.find((item) => item.isActive)?.chunks ?? detail?.chunks ?? [];
  const activeChunkSet = detail?.chunkSets.find((item) => item.isActive);

  function update(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(next).forEach(([key, value]) => {
      if (!value || value === "all") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    params.set("page", "1");
    startNavTransition(() => {
      router.push(`?${params.toString()}`);
    });
  }

  function openDetail(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("document", id);
    setDetailId(id);
    setDetailError("");
    setEditingMetadata(false);
    startNavTransition(() => router.push(`?${params.toString()}`));
  }

  function closeDetail() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("document");
    setDetailId(null);
    setDetailError("");
    setEditingMetadata(false);
    setIndexTasks([]);
    startNavTransition(() => router.push(`?${params.toString()}`));
  }

  async function retryFailedTasks(taskIds: string[]) {
    setRetryingIds((prev) => {
      const next = new Set(prev);
      taskIds.forEach((id) => next.add(id));
      return next;
    });
    try {
      const response = await fetch("/api/knowledge/index-tasks/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds }),
      });
      if (response.ok) {
        if (detailId) {
          const tasksRes = await fetch(`/api/knowledge/index-tasks?documentId=${detailId}`);
          const tasksData = await tasksRes.json();
          if (tasksData?.tasks) setIndexTasks(tasksData.tasks);
        }
      }
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        taskIds.forEach((id) => next.delete(id));
        return next;
      });
    }
  }

  async function saveMetadata() {
    if (!visibleDetail) return;
    setDetailError("");
    const response = await fetch(`/api/knowledge/documents/${visibleDetail.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadataForm),
    });
    const data = await response.json();
    if (!response.ok) {
      setDetailError(data.error || "保存文档失败");
      return;
    }
    setDetail((current) => (current ? { ...current, ...data.document } : current));
    setEditingMetadata(false);
    router.refresh();
  }

  async function deleteDocument(item: KnowledgeDocumentRow) {
    const confirmed = window.confirm(
      `确认删除知识文档“${item.title}”？相关 Chunk、HQ 和索引都会删除。`
    );
    if (!confirmed) return;
    setDetailError("");
    const response = await fetch(`/api/knowledge/documents/${item.id}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) {
      setDetailError(data.error || "删除文档失败");
      return;
    }
    if (detailId === item.id) {
      closeDetail();
    }
    router.refresh();
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form
          className="flex min-w-[260px] flex-1 items-center gap-3"
          action={(formData) => update({ q: String(formData.get("q") || "") })}
        >
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              name="q"
              defaultValue={q}
              placeholder="搜索文档、chunk 或关键词"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline" disabled={navPending}>
            搜索
          </Button>
        </form>
        <Select
          value={category ?? "all"}
          disabled={navPending}
          onChange={(event) => update({ category: event.target.value })}
          className="w-40"
        >
          <option value="all">全部分类</option>
          {categoryOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <Select
          value={status ?? "all"}
          disabled={navPending}
          onChange={(event) => update({ status: event.target.value })}
          className="w-32"
        >
          <option value="all">全部状态</option>
          <option value="published">已发布</option>
          <option value="draft">草稿</option>
          <option value="archived">已归档</option>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table className="min-w-[980px]">
          <THead>
            <tr>
              <TH>文档</TH>
              <TH>分类</TH>
              <TH>适用范围</TH>
              <TH>Chunks</TH>
              <TH>命中</TH>
              <TH>更新时间</TH>
              <TH>状态</TH>
              <TH className="text-right">操作</TH>
            </tr>
          </THead>
          <TBody>
            {documents.map((item) => (
              <tr key={item.id}>
                <TD>
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 text-muted" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.title}</div>
                      <div className="truncate text-xs text-muted">{item.sourceFile || "-"}</div>
                    </div>
                  </div>
                </TD>
                <TD>{item.businessCategory}</TD>
                <TD>{scopeLabel(item)}</TD>
                <TD>{item._count?.chunks ?? 0}</TD>
                <TD>{item.hitCount}</TD>
                <TD className="whitespace-nowrap text-xs text-muted">
                  {formatDateTime(item.updatedAt)}
                </TD>
                <TD>
                  <KnowledgeStatusBadge status={item.status} />
                </TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => openDetail(item.id)}>
                      查看
                    </Button>
                    <Button variant="ghost" onClick={() => deleteDocument(item)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </TD>
              </tr>
            ))}
            {!documents.length ? (
              <tr>
                <TD colSpan={7} className="py-10 text-center text-muted">
                  暂无文档
                </TD>
              </tr>
            ) : null}
          </TBody>
        </Table>
      </div>

      <div className="mt-4">
        <PaginationBar page={page} pageCount={pageCount} pageSize={pageSize} total={total} />
      </div>

      <Sheet open={Boolean(detailId)} onOpenChange={(open) => (!open ? closeDetail() : undefined)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>{visibleDetail?.title ?? "知识文档"}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {visibleDetail ? (
              <div className="flex flex-col gap-4">
                {detailError ? (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {detailError}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-muted">文档元数据会影响作用域过滤和索引重建。</div>
                  <div className="flex gap-2">
                    {editingMetadata ? (
                      <>
                        <Button size="sm" onClick={saveMetadata} disabled={navPending}>
                          <Save className="size-4" />
                          保存
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingMetadata(false)}
                        >
                          取消
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setEditingMetadata(true)}>
                        <Edit3 className="size-4" />
                        编辑
                      </Button>
                    )}
                  </div>
                </div>
                {editingMetadata ? (
                  <div className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-xs text-muted">标题</span>
                      <Input
                        value={metadataForm.title}
                        onChange={(event) =>
                          setMetadataForm({ ...metadataForm, title: event.target.value })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-xs text-muted">业务分类</span>
                      <Input
                        value={metadataForm.businessCategory}
                        onChange={(event) =>
                          setMetadataForm({
                            ...metadataForm,
                            businessCategory: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-xs text-muted">适用范围</span>
                      <Select
                        value={metadataForm.scopeLevel}
                        onChange={(event) =>
                          setMetadataForm({
                            ...metadataForm,
                            scopeLevel: event.target.value as "common" | "city",
                            cityName: event.target.value === "city" ? metadataForm.cityName : "",
                          })
                        }
                      >
                        <option value="common">通用</option>
                        <option value="city">城市专属</option>
                      </Select>
                    </label>
                    {metadataForm.scopeLevel === "city" ? (
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-xs text-muted">城市</span>
                        <Select
                          value={metadataForm.cityName}
                          onChange={(event) =>
                            setMetadataForm({ ...metadataForm, cityName: event.target.value })
                          }
                        >
                          <option value="">请选择城市</option>
                          {HUBEI_CITY_NAMES.map((cityName) => (
                            <option key={cityName} value={cityName}>
                              {cityName}
                            </option>
                          ))}
                        </Select>
                      </label>
                    ) : null}
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-xs text-muted">状态</span>
                      <Select
                        value={metadataForm.status}
                        onChange={(event) =>
                          setMetadataForm({
                            ...metadataForm,
                            status: event.target.value as "draft" | "published" | "archived",
                          })
                        }
                      >
                        <option value="published">已发布</option>
                        <option value="draft">草稿</option>
                        <option value="archived">已归档</option>
                      </Select>
                    </label>
                  </div>
                ) : null}
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <div className="text-xs text-muted">业务分类</div>
                    <div className="font-medium">{visibleDetail.businessCategory}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">适用范围</div>
                    <div className="font-medium">{scopeLabel(visibleDetail)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">更新时间</div>
                    <div className="font-medium">{formatDateTime(visibleDetail.updatedAt)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">切片策略</div>
                    <div className="font-medium">{activeChunkSet?.chunkStrategy ?? "未设置"}</div>
                  </div>
                </div>
                {detail?.knowledgeItems?.length ? (
                  <div className="rounded-lg border border-border p-3">
                    <div className="mb-2 text-sm font-semibold">关联知识条目</div>
                    <div className="space-y-3">
                      {detail.knowledgeItems.map((item) => (
                        <div key={item.id} className="rounded border border-border px-3 py-2">
                          <div className="flex flex-wrap gap-2 text-xs text-muted">
                            <KnowledgeStatusBadge status={item.status} />
                          </div>
                          <div className="mt-2 text-sm font-medium">{item.question}</div>
                          <div className="mt-1 line-clamp-3 text-sm text-muted">{item.answer}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="rounded-lg border border-border">
                  <Table>
                    <THead>
                      <tr>
                        <TH className="w-20">序号</TH>
                        <TH>切分内容</TH>
                        <TH className="w-32">HQ</TH>
                        <TH className="w-28">状态</TH>
                        <TH className="w-36">索引任务</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {activeChunks.map((chunk) => {
                        const hqList = parseHqList(chunk.hypotheticalQuestionsJson);
                        const chunkTasks = indexTasks.filter((t) => t.chunkId === chunk.id);
                        const failedTasks = chunkTasks.filter((t) => t.status === "failed");
                        return (
                          <tr key={chunk.id}>
                            <TD>{chunk.chunkIndex + 1}</TD>
                            <TD>
                              <div className="flex flex-col gap-1">
                                <div className="text-xs text-muted">
                                  {chunk.sectionPath || "未分节"} · BM25 长度 {chunk.bm25DocLength}
                                </div>
                                <div className="whitespace-pre-wrap text-sm leading-6">
                                  {chunk.chunkText}
                                </div>
                              </div>
                            </TD>
                            <TD>
                              {hqList.length ? (
                                <div className="flex max-h-44 flex-col gap-1 overflow-y-auto text-xs">
                                  {hqList.map((hq, index) => (
                                    <div
                                      key={`${chunk.id}-${index}`}
                                      className="rounded bg-slate-50 px-2 py-1 dark:bg-secondary"
                                    >
                                      {hq}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-muted">未生成</span>
                              )}
                            </TD>
                            <TD>
                              <Badge>{chunk.enabled ? "启用" : "停用"}</Badge>
                            </TD>
                            <TD>
                              {chunkTasks.length === 0 ? (
                                <span className="text-xs text-muted">无</span>
                              ) : (
                                <div className="flex flex-col gap-1">
                                  {chunkTasks.map((task) => (
                                    <div key={task.id} className="flex items-center gap-1">
                                      <Badge
                                        className={
                                          task.status === "completed"
                                            ? "bg-green-100 text-green-700"
                                            : task.status === "failed"
                                              ? "bg-red-100 text-red-700"
                                              : task.status === "pending"
                                                ? "bg-yellow-100 text-yellow-700"
                                                : "bg-blue-100 text-blue-700"
                                        }
                                      >
                                        {task.status === "completed"
                                          ? "完成"
                                          : task.status === "failed"
                                            ? "失败"
                                            : task.status === "pending"
                                              ? "等待中"
                                              : "处理中"}
                                      </Badge>
                                      {task.status === "failed" && task.lastError && (
                                        <span
                                          className="max-w-[120px] truncate text-xs text-red-500"
                                          title={task.lastError}
                                        >
                                          {task.lastError}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                  {failedTasks.length > 0 && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="mt-1 h-6 gap-1 px-2 text-xs"
                                      disabled={failedTasks.some((t) => retryingIds.has(t.id))}
                                      onClick={() => retryFailedTasks(failedTasks.map((t) => t.id))}
                                    >
                                      <RefreshCw className="size-3" />
                                      {failedTasks.some((t) => retryingIds.has(t.id))
                                        ? "重试中…"
                                        : "重试失败任务"}
                                    </Button>
                                  )}
                                </div>
                              )}
                            </TD>
                          </tr>
                        );
                      })}
                      {!activeChunks.length ? (
                        <tr>
                          <TD colSpan={5} className="py-10 text-center text-muted">
                            暂无 chunk
                          </TD>
                        </tr>
                      ) : null}
                    </TBody>
                  </Table>
                </div>
              </div>
            ) : null}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
