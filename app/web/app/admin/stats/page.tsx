import Link from "next/link";
import { BarChart3, Bot, CheckCircle2, Database, FileText, MessageSquare, Search, Ticket } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { MetricCard } from "@/components/shared/metric-card";
import { TicketStatusBadge } from "@/components/shared/status-badge";
import { TrendChart } from "@/components/stats/trend-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/presentation";
import { getStatsSummary, getTrendData, listHistoryMessages, listHistoryTickets } from "@/lib/services/stats";
import { getPendingTicketCounts } from "@/lib/services/tickets";

export default async function AdminStatsPage(props: {
  searchParams: Promise<{ q?: string; messagePage?: string; ticketPage?: string }>;
}) {
  const user = await requireUser();
  const searchParams = await props.searchParams;
  const [summary, trends, messages, tickets, pendingCounts] = await Promise.all([
    getStatsSummary(),
    getTrendData(),
    listHistoryMessages({
      q: searchParams.q,
      page: Number(searchParams.messagePage ?? 1),
      pageSize: 5
    }),
    listHistoryTickets({
      q: searchParams.q,
      page: Number(searchParams.ticketPage ?? 1),
      pageSize: 5
    }),
    getPendingTicketCounts()
  ]);

  const kbRate = Math.round(summary.kbHitRate * 1000) / 10;
  const llmRate = summary.totalQuestions ? Math.round((summary.llmAnswers / summary.totalQuestions) * 1000) / 10 : 0;
  const transferRate = summary.totalQuestions ? Math.round((summary.transferCount / summary.totalQuestions) * 1000) / 10 : 0;

  return (
    <AppShell
      role={user.role}
      displayName={user.displayName}
      title="统计分析"
      description="查看问答命中、工单闭环和最近 7 天趋势。"
      initialPendingCounts={pendingCounts}
    >
      <div className="flex flex-col gap-5">
        <form className="ml-auto flex w-full max-w-md items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input name="q" defaultValue={searchParams.q} placeholder="搜索问题、工单或知识点" className="pl-9" />
          </div>
          <Button type="submit" variant="outline">筛选</Button>
        </form>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard label="总提问数" value={summary.totalQuestions} description="较上月" icon={MessageSquare} tone="blue" trend="12.6%" />
          <MetricCard label="知识库命中数" value={summary.kbHits} description="较上月" icon={Database} tone="teal" trend="15.3%" />
          <MetricCard label="大模型回答数" value={summary.llmAnswers} description="较上月" icon={Bot} tone="purple" trend="8.7%" />
          <MetricCard label="转人工次数" value={summary.transferCount} description="较上月" icon={Ticket} tone="orange" trend="3.2%" trendDirection="down" />
          <MetricCard label="工单总数" value={summary.totalTickets} description="较上月" icon={FileText} tone="indigo" trend="9.4%" />
          <MetricCard label="已关闭工单数" value={summary.closedTickets} description="较上月" icon={CheckCircle2} tone="green" trend="11.8%" />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>近 7 天问答趋势</CardTitle>
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
                <Legend color="bg-blue-600" label="总提问数" />
                <Legend color="bg-teal-500" label="知识库命中数" />
                <Legend color="bg-purple-500" label="大模型回答数" />
                <Legend color="bg-orange-500" label="转人工次数" />
              </div>
            </CardHeader>
            <CardContent>
              <TrendChart data={trends} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>知识库命中 vs 大模型兜底</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center gap-8">
                <div
                  className="relative flex size-40 items-center justify-center rounded-full"
                  style={{
                    background: `conic-gradient(#0ea5e9 0% ${kbRate}%, #8b5cf6 ${kbRate}% ${kbRate + llmRate}%, #e2e8f0 ${kbRate + llmRate}% 100%)`
                  }}
                >
                  <div className="flex size-28 flex-col items-center justify-center rounded-full bg-white">
                    <span className="text-xs text-muted">总提问数</span>
                    <span className="text-2xl font-semibold text-slate-900">{summary.totalQuestions}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-3 text-sm">
                  <Legend color="bg-teal-500" label={`知识库命中 ${summary.kbHits} (${kbRate}%)`} />
                  <Legend color="bg-purple-500" label={`大模型回答 ${summary.llmAnswers} (${llmRate}%)`} />
                  <Legend color="bg-slate-300" label={`转人工次数 ${summary.transferCount} (${transferRate}%)`} />
                </div>
              </div>
              <div className="mt-6 border-t border-border pt-4 text-sm text-muted">
                知识库命中率 <span className="font-semibold text-teal-600">{kbRate}%</span>，工单闭环率{" "}
                <span className="font-semibold text-emerald-600">{Math.round(summary.closedRate * 1000) / 10}%</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>历史问答</CardTitle>
              <MiniPager param="messagePage" current={messages.page} pageCount={messages.pageCount} searchParams={searchParams} />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <tr>
                    <TH>提问内容</TH>
                    <TH>用户</TH>
                    <TH>回答方式</TH>
                    <TH>提问时间</TH>
                  </tr>
                </THead>
                <TBody>
                  {messages.items.map((message) => (
                    <tr key={message.id}>
                      <TD>
                        <div className="max-w-[260px] truncate font-medium text-slate-900">{message.contentText}</div>
                      </TD>
                      <TD>{message.conversation.user.displayName}</TD>
                      <TD>{message.sourceType}</TD>
                      <TD>{formatDateTime(message.createdAt)}</TD>
                    </tr>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>历史工单</CardTitle>
              <MiniPager param="ticketPage" current={tickets.page} pageCount={tickets.pageCount} searchParams={searchParams} />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <tr>
                    <TH>工单编号</TH>
                    <TH>问题分类</TH>
                    <TH>优先级</TH>
                    <TH>状态</TH>
                    <TH>创建时间</TH>
                  </tr>
                </THead>
                <TBody>
                  {tickets.items.map((ticket) => (
                    <tr key={ticket.id}>
                      <TD className="font-medium text-slate-900">{ticket.ticketNo}</TD>
                      <TD>{ticket.category}</TD>
                      <TD>{ticket.priority}</TD>
                      <TD><TicketStatusBadge status={ticket.status} /></TD>
                      <TD>{formatDateTime(ticket.createdAt)}</TD>
                    </tr>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="rounded border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-primary">
          数据统计仅包含近两年记录，每日 00:00 更新。
        </div>
      </div>
    </AppShell>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`size-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function MiniPager({
  param,
  current,
  pageCount,
  searchParams
}: {
  param: "messagePage" | "ticketPage";
  current: number;
  pageCount: number;
  searchParams: { q?: string; messagePage?: string; ticketPage?: string };
}) {
  const prev = Math.max(1, current - 1);
  const next = Math.min(pageCount, current + 1);
  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (searchParams.q) params.set("q", searchParams.q);
    if (searchParams.messagePage) params.set("messagePage", searchParams.messagePage);
    if (searchParams.ticketPage) params.set("ticketPage", searchParams.ticketPage);
    params.set(param, String(page));
    return `/admin/stats?${params.toString()}`;
  };

  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <Link className="rounded border border-border px-2 py-1 hover:bg-slate-50" href={buildHref(prev)}>上一页</Link>
      <span>{current}/{pageCount}</span>
      <Link className="rounded border border-border px-2 py-1 hover:bg-slate-50" href={buildHref(next)}>下一页</Link>
    </div>
  );
}
