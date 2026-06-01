"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Ticket, User } from "@prisma/client";
import {
  CheckCircle2,
  CircleCheck,
  Clock3,
  FileText,
  Filter,
  Pin,
  Search,
  Ticket as TicketIcon,
  Trash2,
} from "lucide-react";
import { useCallback, useState, useTransition } from "react";

import { MetricCard } from "@/components/shared/metric-card";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { PriorityBadge, TicketStatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { formatDateTime } from "@/lib/presentation";
import type { TicketListResult, TicketStatusGroup } from "@/lib/services/tickets";
import { cn } from "@/lib/utils";

type TicketRow = Ticket & {
  createdBy?: User;
  closedBy?: User | null;
  claimedBy?: User | null;
};

export function TicketList(props: {
  title: string;
  basePath: string;
  result: TicketListResult;
  currentStatusGroup: TicketStatusGroup;
  q?: string;
  currentUserId: string;
  showTicketType?: boolean;
  showCurrentDepartment?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const result = props.result as TicketListResult & { items: TicketRow[] };
  const showTicketType = props.showTicketType ?? true;
  const showCurrentDepartment = props.showCurrentDepartment ?? false;
  const columnCount = 8 + (showTicketType ? 1 : 0) + (showCurrentDepartment ? 1 : 0);

  const deleteTicket = useCallback(
    (ticket: TicketRow) => {
      if (!window.confirm(`确认删除工单"${ticket.ticketNo}"？删除后不可恢复。`)) return;
      setDeletingId(ticket.id);
      startTransition(async () => {
        const response = await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
        const data = await response.json();
        setDeletingId(null);
        if (!response.ok) {
          window.alert(data.error || "删除失败");
          return;
        }
        router.refresh();
      });
    },
    [router]
  );

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
    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  }

  const tabs: Array<{ key: TicketStatusGroup; label: string; count: number }> = [
    { key: "all", label: "全部工单", count: result.summary.all },
    { key: "pending", label: "待认领", count: result.summary.pending },
    { key: "processing", label: "处理中", count: result.summary.processing },
    { key: "escalated", label: "已转派", count: result.summary.escalated },
    { key: "resolved", label: "已解决", count: result.summary.resolved },
    { key: "closed", label: "已关闭", count: result.summary.closed },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="panel flex flex-wrap gap-1 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={cn(
                "rounded px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.97]",
                props.currentStatusGroup === tab.key
                  ? "bg-primary text-white shadow-sm dark:bg-primary/10 dark:text-primary"
                  : "text-slate-600 hover:bg-slate-50 dark:text-muted dark:hover:bg-secondary dark:hover:text-foreground"
              )}
              onClick={() => update({ statusGroup: tab.key })}
            >
              {tab.label}
              <span
                className={cn(
                  "ml-2 text-xs",
                  props.currentStatusGroup === tab.key
                    ? "text-blue-100 dark:text-primary"
                    : "text-slate-400 dark:text-muted"
                )}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>
        <form
          className="ml-auto flex min-w-[280px] flex-1 items-center gap-3 md:max-w-xl"
          action={(formData) => update({ q: String(formData.get("q") || "") })}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 dark:text-muted" />
            <Input
              name="q"
              defaultValue={props.q}
              placeholder="搜索工单编号、问题摘要、创建人"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline">
            <Filter className="size-4" />
            筛选
          </Button>
        </form>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-foreground">
          今日工单概览
        </h2>
        <div
          className={cn(
            "grid gap-4 transition-opacity duration-150 md:grid-cols-2 xl:grid-cols-6",
            isPending && "opacity-60"
          )}
        >
          <MetricCard
            label="待认领"
            value={result.summary.pending}
            description="等待部门响应"
            icon={FileText}
            tone="blue"
            trend="12.5%"
          />
          <MetricCard
            label="处理中"
            value={result.summary.processing}
            description="已有人工回复"
            icon={Clock3}
            tone="orange"
            trend="6.7%"
          />
          <MetricCard
            label="已转派"
            value={result.summary.escalated}
            description="转派待接收"
            icon={Pin}
            tone="purple"
            trend="2.3%"
          />
          <MetricCard
            label="已解决"
            value={result.summary.resolved}
            description="等待知识整理"
            icon={CircleCheck}
            tone="indigo"
          />
          <MetricCard
            label="已关闭"
            value={result.summary.closed}
            description="闭环归档"
            icon={CheckCircle2}
            tone="green"
            trend="18.4%"
          />
          <MetricCard
            label="今日总量"
            value={result.summary.all}
            description={props.title}
            icon={TicketIcon}
            tone="indigo"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[980px]">
            <THead>
              <tr>
                <TH>工单编号</TH>
                <TH>问题摘要</TH>
                {showTicketType ? <TH>问题类型</TH> : null}
                {showCurrentDepartment ? <TH>所在部门</TH> : null}
                <TH>状态</TH>
                <TH>处理人</TH>
                <TH>优先级</TH>
                <TH>创建人</TH>
                <TH>创建时间</TH>
                <TH className="text-right">操作</TH>
              </tr>
            </THead>
            <TBody>
              {isPending ? (
                <TableSkeleton columns={columnCount} rows={5} />
              ) : (
                result.items.map((ticket) => (
                  <tr key={ticket.id}>
                    <TD className="font-medium text-slate-900 dark:text-foreground">
                      {ticket.ticketNo}
                    </TD>
                    <TD>
                      <div className="max-w-[280px]">
                        <div className="truncate font-medium text-slate-900 dark:text-foreground">
                          {ticket.title}
                        </div>
                        <div className="mt-1 truncate text-xs text-muted">
                          {ticket.latestUserQuestion}
                        </div>
                      </div>
                    </TD>
                    {showTicketType ? (
                      <TD>
                        <Badge className="border border-blue-100 bg-blue-50 text-primary dark:border-primary/20 dark:bg-primary/10 dark:text-primary">
                          {ticket.category}
                        </Badge>
                      </TD>
                    ) : null}
                    {showCurrentDepartment ? <TD>{ticket.escalatedToDept || "-"}</TD> : null}
                    <TD>
                      <TicketStatusBadge status={ticket.status} />
                    </TD>
                    <TD>
                      {ticket.claimedBy?.displayName ||
                        (ticket.status === "pending_claim" ? "待认领" : "-")}
                    </TD>
                    <TD>
                      <PriorityBadge priority={ticket.priority} />
                    </TD>
                    <TD>{ticket.createdBy?.displayName || "-"}</TD>
                    <TD>{formatDateTime(ticket.createdAt)}</TD>
                    <TD className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {ticket.createdByUserId === props.currentUserId &&
                        ticket.status === "pending_claim" ? (
                          <button
                            type="button"
                            className="inline-flex h-8 items-center rounded border border-red-200 bg-white px-3 text-xs font-medium text-red-600 transition-all duration-150 hover:border-red-300 hover:bg-red-50 hover:shadow-sm active:scale-[0.97] disabled:opacity-50 dark:bg-card dark:text-red-400 dark:hover:bg-red-950/30"
                            disabled={deletingId === ticket.id}
                            onClick={() => deleteTicket(ticket)}
                          >
                            <Trash2 className="mr-1 size-3" />
                            {deletingId === ticket.id ? "删除中..." : "删除"}
                          </button>
                        ) : null}
                        <Link
                          href={`${props.basePath}/${ticket.id}`}
                          className="inline-flex h-8 items-center rounded border border-border bg-white px-3 text-xs font-medium text-slate-700 transition-all duration-150 hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm active:scale-[0.97] dark:bg-card dark:text-foreground dark:hover:border-border dark:hover:bg-secondary"
                        >
                          查看详情
                        </Link>
                      </div>
                    </TD>
                  </tr>
                ))
              )}
            </TBody>
          </Table>
          {!result.items.length ? (
            <div className="px-4 py-12 text-center text-sm text-muted">暂无工单</div>
          ) : null}
        </div>
        <PaginationBar
          total={result.total}
          page={result.page}
          pageSize={result.pageSize}
          pageCount={result.pageCount}
          isPending={isPending}
          onNavigate={(params) => {
            const merged = new URLSearchParams(searchParams.toString());
            Object.entries(params).forEach(([key, value]) => merged.set(key, value));
            startTransition(() => {
              router.push(`?${merged.toString()}`);
            });
          }}
        />
      </Card>
    </div>
  );
}
