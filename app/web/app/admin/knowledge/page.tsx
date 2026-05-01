import { AppShell } from "@/components/layout/app-shell";
import {
  KnowledgeImportButton,
  KnowledgeCreateForm
} from "@/components/knowledge/knowledge-admin";
import { KnowledgeTable } from "@/components/knowledge/knowledge-table";
import { MetricCard } from "@/components/shared/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { listKnowledgeItems } from "@/lib/services/knowledge";
import { getPendingTicketCounts } from "@/lib/services/tickets";
import { BookOpen, CheckSquare, Image, PlusSquare } from "lucide-react";

export default async function AdminKnowledgePage(props: { searchParams: Promise<{ q?: string; category?: string; status?: string; page?: string; pageSize?: string }> }) {
  const user = await requireUser();
  const searchParams = await props.searchParams;
  const [knowledgeResult, jobs, pendingCounts] = await Promise.all([
    listKnowledgeItems({
      q: searchParams.q,
      category: searchParams.category,
      status: (searchParams.status as "draft" | "published" | "archived" | "all" | undefined) ?? "all",
      page: Number(searchParams.page ?? 1),
      pageSize: Number(searchParams.pageSize ?? 10)
    }),
    prisma.importJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    getPendingTicketCounts()
  ]);

  const serializedItems = knowledgeResult.items.map((item) => ({
    id: item.id,
    categoryL1: item.categoryL1,
    categoryL2: item.categoryL2,
    question: item.question,
    answer: item.answer,
    sourceFile: item.sourceFile,
    sourceType: item.sourceType,
    status: item.status,
    hitCount: item.hitCount,
    lastHitAt: item.lastHitAt,
    updatedAt: item.updatedAt,
    tagsJson: item.tagsJson,
    imagePathsJson: item.imagePathsJson,
    imagePath: item.imagePath
  }));

  return (
    <AppShell
      role={user.role}
      displayName={user.displayName}
      title="知识库管理"
      description="导入知识文档、手动新增知识条目、查看和管理已有知识。"
      initialPendingCounts={pendingCounts}
    >
      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="知识条目数" value={knowledgeResult.summary.total} description="全量知识沉淀" icon={BookOpen} tone="blue" trend="12.6%" />
        <MetricCard label="图片知识数" value={knowledgeResult.summary.imageCount} description="多模态资料" icon={Image} tone="green" trend="15.3%" />
        <MetricCard label="今日新增" value={knowledgeResult.summary.todayCreated} description="新增知识" icon={PlusSquare} tone="purple" />
        <MetricCard label="已发布" value={knowledgeResult.summary.published} description="可被检索命中" icon={CheckSquare} tone="orange" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>导入操作</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0">
            <KnowledgeImportButton />
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>新增知识</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0">
            <KnowledgeCreateForm />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>知识条目 ({knowledgeResult.total})</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 overflow-x-auto">
            <KnowledgeTable
              items={serializedItems}
              total={knowledgeResult.total}
              page={knowledgeResult.page}
              pageSize={knowledgeResult.pageSize}
              pageCount={knowledgeResult.pageCount}
              categoryOptions={knowledgeResult.categoryOptions}
              q={searchParams.q}
              category={searchParams.category}
              status={searchParams.status}
            />
          </CardContent>
        </Card>
      </div>

      {jobs.length > 0 && (
        <div className="mt-6">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>导入记录</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-2 pr-4 font-medium">时间</th>
                    <th className="pb-2 pr-4 font-medium">状态</th>
                    <th className="pb-2 font-medium">摘要</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b border-border/50">
                      <td className="py-2 pr-4">{new Date(job.createdAt).toLocaleString("zh-CN")}</td>
                      <td className="py-2 pr-4">{job.status}</td>
                      <td className="py-2">{job.summary?.slice(0, 100) || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
