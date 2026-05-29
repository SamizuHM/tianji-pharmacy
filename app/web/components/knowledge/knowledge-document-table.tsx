"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileText, Search } from "lucide-react";

import { PaginationBar } from "@/components/shared/pagination-bar";
import { KnowledgeStatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { formatDateTime } from "@/lib/presentation";

type KnowledgeDocumentRow = {
  id: string;
  title: string;
  sourceFile: string | null;
  businessCategory: string;
  answerPolicy: "allow_llm_fallback" | "kb_only";
  scopeLevel: "national" | "province" | "city" | "district" | "store";
  provinceName: string | null;
  cityName: string | null;
  districtName: string | null;
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
    enabled: boolean;
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
      enabled: boolean;
    }>;
  }>;
};

function scopeLabel(item: KnowledgeDocumentRow) {
  if (item.scopeLevel === "national") return "全国";
  if (item.scopeLevel === "province") return item.provinceName || "省级";
  if (item.scopeLevel === "city") return item.cityName || "市级";
  if (item.scopeLevel === "district") return item.districtName || "区县";
  return "门店";
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

  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      return;
    }

    let disposed = false;
    fetch(`/api/knowledge/documents/${detailId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!disposed) {
          setDetail(data?.document ?? null);
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
    startNavTransition(() => router.push(`?${params.toString()}`));
  }

  function closeDetail() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("document");
    setDetailId(null);
    startNavTransition(() => router.push(`?${params.toString()}`));
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
              <TH>地域</TH>
              <TH>回答策略</TH>
              <TH>Chunks</TH>
              <TH>命中</TH>
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
                <TD>
                  <Badge>{item.answerPolicy === "kb_only" ? "仅知识库" : "允许兜底"}</Badge>
                </TD>
                <TD>{item._count?.chunks ?? 0}</TD>
                <TD>{item.hitCount}</TD>
                <TD>
                  <KnowledgeStatusBadge status={item.status} />
                </TD>
                <TD className="text-right">
                  <Button variant="outline" onClick={() => openDetail(item.id)}>
                    查看 chunk
                  </Button>
                </TD>
              </tr>
            ))}
            {!documents.length ? (
              <tr>
                <TD colSpan={8} className="py-10 text-center text-muted">
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
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <div className="text-xs text-muted">业务分类</div>
                    <div className="font-medium">{visibleDetail.businessCategory}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">适用地域</div>
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
                <div className="rounded-lg border border-border">
                  <Table>
                    <THead>
                      <tr>
                        <TH className="w-20">序号</TH>
                        <TH>切分内容</TH>
                        <TH className="w-28">状态</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {activeChunks.map((chunk) => (
                        <tr key={chunk.id}>
                          <TD>{chunk.chunkIndex + 1}</TD>
                          <TD>
                            <div className="flex flex-col gap-1">
                              <div className="text-xs text-muted">
                                {chunk.sectionPath || "未分节"}
                              </div>
                              <div className="whitespace-pre-wrap text-sm leading-6">
                                {chunk.chunkText}
                              </div>
                            </div>
                          </TD>
                          <TD>
                            <Badge>{chunk.enabled ? "启用" : "停用"}</Badge>
                          </TD>
                        </tr>
                      ))}
                      {!activeChunks.length ? (
                        <tr>
                          <TD colSpan={3} className="py-10 text-center text-muted">
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
