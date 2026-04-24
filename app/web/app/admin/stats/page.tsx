import { AppShell } from "@/components/layout/app-shell";
import { TrendChart } from "@/components/stats/trend-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getStatsSummary, getTrendData } from "@/lib/services/stats";

export default async function AdminStatsPage() {
  const user = await requireUser();
  const [summary, trends, messages, tickets] = await Promise.all([
    getStatsSummary(),
    getTrendData(),
    prisma.chatMessage.findMany({
      include: {
        conversation: { include: { user: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 50
    }),
    prisma.ticket.findMany({
      include: { createdBy: true, closedBy: true },
      orderBy: { createdAt: "desc" },
      take: 50
    })
  ]);

  const statCards = [
    { label: "总提问数", value: summary.totalQuestions },
    { label: "知识库命中数", value: summary.kbHits },
    { label: "大模型回答数", value: summary.llmAnswers },
    { label: "转人工次数", value: summary.transferCount },
    { label: "工单总数", value: summary.totalTickets },
    { label: "已关闭工单数", value: summary.closedTickets },
    { label: "人工1处理数", value: summary.human1Closed },
    { label: "人工2处理数", value: summary.human2Closed }
  ];

  return (
    <AppShell role={user.role} displayName={user.displayName} title="统计与历史记录" description="查看问答命中、工单闭环和最近 7 天趋势。">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((item) => (
          <Card key={item.label}>
            <CardContent className="space-y-2 py-6">
              <div className="text-sm text-muted">{item.label}</div>
              <div className="text-3xl font-semibold">{item.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>最近 7 天趋势</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart data={trends} />
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>历史问答列表</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <TH>时间</TH>
                  <TH>用户</TH>
                  <TH>来源</TH>
                  <TH>内容摘要</TH>
                </tr>
              </THead>
              <TBody>
                {messages.map((message) => (
                  <tr key={message.id}>
                    <TD>{new Date(message.createdAt).toLocaleString("zh-CN")}</TD>
                    <TD>{message.conversation.user.displayName}</TD>
                    <TD>{message.sourceType}</TD>
                    <TD>{message.contentText.slice(0, 60)}</TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>历史工单列表</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <TH>工单号</TH>
                  <TH>状态</TH>
                  <TH>发起人</TH>
                  <TH>关闭人</TH>
                </tr>
              </THead>
              <TBody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <TD>{ticket.ticketNo}</TD>
                    <TD>{ticket.status}</TD>
                    <TD>{ticket.createdBy.displayName}</TD>
                    <TD>{ticket.closedBy?.displayName || "未关闭"}</TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

