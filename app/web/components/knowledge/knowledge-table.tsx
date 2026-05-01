"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, FileText, Image as ImageIcon, Pencil, Search, Trash2 } from "lucide-react";

import { ImageLightbox } from "@/components/knowledge/image-lightbox";
import { KnowledgeEditForm } from "@/components/knowledge/knowledge-admin";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { KnowledgeStatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { formatDateTime, parseTags } from "@/lib/presentation";

type KnowledgeItemRow = {
  id: string;
  categoryL1: string;
  categoryL2: string;
  question: string;
  answer: string;
  sourceFile: string | null;
  sourceType: string;
  status: "draft" | "published" | "archived";
  hitCount: number;
  lastHitAt: string | Date | null;
  updatedAt: string | Date;
  tagsJson: string | null;
  imagePathsJson: string | null;
  imagePath: string | null;
  chunks?: Array<{ id: string; chunkText: string; chunkIndex: number; sourceFile: string | null }>;
};

type KnowledgeDetail = KnowledgeItemRow & {
  chunks?: Array<{ id: string; chunkText: string; chunkIndex: number; sourceFile: string | null }>;
};

export function KnowledgeTable({
  items,
  total,
  page,
  pageSize,
  pageCount,
  categoryOptions,
  q,
  category,
  status
}: {
  items: KnowledgeItemRow[];
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
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(searchParams.get("selected"));
  const [detail, setDetail] = useState<KnowledgeDetail | null>(null);

  const allSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id));

  useEffect(() => {
    const selected = searchParams.get("selected");
    setDetailId(selected);
  }, [searchParams]);

  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      return;
    }

    let disposed = false;
    fetch(`/api/knowledge/${detailId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!disposed) {
          setDetail(data?.item ?? null);
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
    };
  }, [detailId]);

  const selectedItem = useMemo(() => items.find((item) => item.id === detailId), [detailId, items]);
  const visibleDetail = detail ?? selectedItem ?? null;

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
    router.push(`?${params.toString()}`);
  }

  function openDetail(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("selected", id);
    router.push(`?${params.toString()}`);
  }

  function closeDetail() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("selected");
    router.push(`?${params.toString()}`);
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? items.map((item) => item.id) : []);
  }

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((current) => (checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id)));
  }

  function runBulk(action: "publish" | "archive" | "delete") {
    if (!selectedIds.length) {
      return;
    }

    if (action === "delete" && !confirm("确定删除选中的知识条目？此操作不可撤销。")) {
      return;
    }

    startTransition(async () => {
      await fetch("/api/knowledge/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, action })
      });
      setSelectedIds([]);
      router.refresh();
    });
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form
          className="flex min-w-[260px] flex-1 items-center gap-3"
          action={(formData) => update({ q: String(formData.get("q") || "") })}
        >
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input name="q" defaultValue={q} placeholder="搜索具体问题或关键词" className="pl-9" />
          </div>
          <Button type="submit" variant="outline">搜索</Button>
        </form>
        <Select value={category ?? "all"} onChange={(event) => update({ category: event.target.value })} className="w-40">
          <option value="all">全部分类</option>
          {categoryOptions.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </Select>
        <Select value={status ?? "all"} onChange={(event) => update({ status: event.target.value })} className="w-32">
          <option value="all">全部状态</option>
          <option value="published">已发布</option>
          <option value="draft">草稿</option>
          <option value="archived">已归档</option>
        </Select>
        <Button variant="outline" disabled={!selectedIds.length || pending} onClick={() => runBulk("publish")}>
          发布
        </Button>
        <Button variant="outline" disabled={!selectedIds.length || pending} onClick={() => runBulk("archive")}>
          <Archive className="size-4" />
          归档
        </Button>
        <Button variant="outline" disabled={!selectedIds.length || pending} onClick={() => runBulk("delete")}>
          <Trash2 className="size-4" />
          删除
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table className="min-w-[1080px]">
          <THead>
            <tr>
              <TH className="w-12 text-center">
                <Checkbox checked={allSelected} onCheckedChange={(checked) => toggleAll(Boolean(checked))} />
              </TH>
              <TH>一级分类</TH>
              <TH>二级分类</TH>
              <TH>具体问题</TH>
              <TH>简要标准答案</TH>
              <TH>来源</TH>
              <TH>命中</TH>
              <TH>状态</TH>
              <TH className="text-right">操作</TH>
            </tr>
          </THead>
          <TBody>
            {items.map((item) => {
              const imagePaths: string[] = item.imagePathsJson
                ? JSON.parse(item.imagePathsJson)
                : item.imagePath
                  ? [item.imagePath]
                  : [];

              return (
                <tr key={item.id} className={detailId === item.id ? "bg-blue-50/60" : ""}>
                  {editingId === item.id ? (
                    <TD colSpan={9}>
                      <KnowledgeEditForm item={item} onCancel={() => setEditingId(null)} />
                    </TD>
                  ) : (
                    <>
                      <TD className="text-center">
                        <Checkbox checked={selectedIds.includes(item.id)} onCheckedChange={(checked) => toggleOne(item.id, Boolean(checked))} />
                      </TD>
                      <TD>{item.categoryL1}</TD>
                      <TD>{item.categoryL2}</TD>
                      <TD>
                        <button className="max-w-[240px] truncate text-left font-medium text-slate-900 hover:text-primary" onClick={() => openDetail(item.id)}>
                          {item.question}
                        </button>
                        {imagePaths.length ? (
                          <div className="mt-2 flex items-center gap-2">
                            {imagePaths.slice(0, 2).map((img, i) => (
                              <img
                                key={img}
                                src={`/api/files/${img}`}
                                alt=""
                                className="size-10 cursor-pointer rounded border border-border object-cover"
                                onClick={() => setLightbox({ images: imagePaths, index: i })}
                              />
                            ))}
                            {imagePaths.length > 2 ? <span className="text-xs text-muted">+{imagePaths.length - 2}</span> : null}
                          </div>
                        ) : null}
                      </TD>
                      <TD>
                        <div className="max-w-[260px] truncate text-muted">{item.answer}</div>
                      </TD>
                      <TD>
                        <div className="max-w-[160px] truncate text-muted">{item.sourceFile || item.sourceType}</div>
                      </TD>
                      <TD>
                        <div className="font-medium text-slate-900">{item.hitCount}</div>
                        <div className="text-xs text-muted">{formatDateTime(item.lastHitAt)}</div>
                      </TD>
                      <TD>
                        <KnowledgeStatusBadge status={item.status} />
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(item.id)}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openDetail(item.id)}>
                            查看
                          </Button>
                        </div>
                      </TD>
                    </>
                  )}
                </tr>
              );
            })}
          </TBody>
        </Table>
        {!items.length ? <div className="px-4 py-12 text-center text-sm text-muted">暂无知识条目</div> : null}
      </div>

      <PaginationBar total={total} page={page} pageSize={pageSize} pageCount={pageCount} />

      <Sheet open={Boolean(detailId)} onOpenChange={(open) => (!open ? closeDetail() : undefined)}>
        <SheetContent className="max-w-xl">
          <SheetHeader>
            <SheetTitle>知识条目详情</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {visibleDetail ? (
              <div className="flex flex-col gap-6">
                <section>
                  <h3 className="text-sm font-semibold text-slate-900">基本信息</h3>
                  <div className="mt-4 grid grid-cols-[92px_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
                    <span className="text-muted">具体问题</span>
                    <span>{visibleDetail.question}</span>
                    <span className="text-muted">一级分类</span>
                    <span>{visibleDetail.categoryL1}</span>
                    <span className="text-muted">二级分类</span>
                    <span>{visibleDetail.categoryL2}</span>
                    <span className="text-muted">状态</span>
                    <KnowledgeStatusBadge status={visibleDetail.status} />
                    <span className="text-muted">更新时间</span>
                    <span>{formatDateTime(visibleDetail.updatedAt)}</span>
                    <span className="text-muted">命中次数</span>
                    <span>{visibleDetail.hitCount}</span>
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-semibold text-slate-900">简要标准答案</h3>
                  <div className="mt-3 rounded-lg border border-border bg-slate-50 p-4 text-sm leading-6">{visibleDetail.answer}</div>
                </section>
                <section>
                  <h3 className="text-sm font-semibold text-slate-900">标签</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {parseTags(visibleDetail.tagsJson).length
                      ? parseTags(visibleDetail.tagsJson).map((tag) => <Badge key={tag} className="bg-blue-50 text-primary">{tag}</Badge>)
                      : <span className="text-sm text-muted">暂无标签</span>}
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-semibold text-slate-900">多模态内容</h3>
                  <DetailAssets item={visibleDetail} onPreview={(images, index) => setLightbox({ images, index })} />
                </section>
                <section>
                  <h3 className="text-sm font-semibold text-slate-900">分片内容</h3>
                  <div className="mt-3 flex flex-col gap-2">
                    {visibleDetail.chunks?.length ? (
                      visibleDetail.chunks.map((chunk) => (
                        <div key={chunk.id} className="rounded border border-border bg-white p-3 text-sm leading-6">
                          {chunk.chunkText}
                        </div>
                      ))
                    ) : (
                      <span className="text-sm text-muted">暂无分片详情</span>
                    )}
                  </div>
                </section>
              </div>
            ) : (
              <div className="py-12 text-center text-sm text-muted">正在加载详情...</div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          initialIndex={lightbox.index}
          open={true}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

function DetailAssets({
  item,
  onPreview
}: {
  item: KnowledgeItemRow;
  onPreview: (images: string[], index: number) => void;
}) {
  const imagePaths: string[] = item.imagePathsJson
    ? JSON.parse(item.imagePathsJson)
    : item.imagePath
      ? [item.imagePath]
      : [];

  return (
    <div className="mt-3 flex flex-wrap gap-3">
      <div className="flex min-w-56 items-center gap-3 rounded-lg border border-border bg-white p-3">
        <FileText className="size-5 text-red-500" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-900">{item.sourceFile || "手动录入知识"}</div>
          <div className="text-xs text-muted">{item.sourceType}</div>
        </div>
      </div>
      {imagePaths.map((img, index) => (
        <button
          key={img}
          type="button"
          className="flex size-20 items-center justify-center rounded-lg border border-dashed border-border bg-slate-50"
          onClick={() => onPreview(imagePaths, index)}
        >
          <ImageIcon className="size-5 text-muted" />
        </button>
      ))}
    </div>
  );
}
