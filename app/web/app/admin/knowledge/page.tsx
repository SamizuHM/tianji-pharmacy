import {
  KnowledgeDocumentUpload,
  KnowledgeCreateForm,
  RebuildIndexButton
} from "@/components/knowledge/knowledge-admin";
import { KnowledgeTable } from "@/components/knowledge/knowledge-table";
import { MetricCard } from "@/components/shared/metric-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { prisma } from "@/lib/db";
import { listKnowledgeItems } from "@/lib/services/knowledge";
import { BookOpen, CheckSquare, FileUp, Image, PlusSquare, Target } from "lucide-react";

export default async function AdminKnowledgePage(props: { searchParams: Promise<{ q?: string; category?: string; status?: string; page?: string; pageSize?: string }> }) {
  const searchParams = await props.searchParams;
  const [knowledgeResult, jobs] = await Promise.all([
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
    })
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
    <>
      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="知识条目数" value={knowledgeResult.summary.total} description="全量知识沉淀" icon={BookOpen} tone="blue" trend="12.6%" />
        <MetricCard label="图片知识数" value={knowledgeResult.summary.imageCount} description="多模态资料" icon={Image} tone="green" trend="15.3%" />
        <MetricCard label="今日新增" value={knowledgeResult.summary.todayCreated} description="新增知识" icon={PlusSquare} tone="purple" />
        <MetricCard label="已发布" value={knowledgeResult.summary.published} description="可被检索命中" icon={CheckSquare} tone="orange" />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>知识入库</CardTitle>
              <CardDescription className="mt-1">上传业务文档或手动维护单条标准问答。</CardDescription>
            </div>
            <div className="flex size-10 items-center justify-center rounded bg-blue-50 text-primary dark:border dark:border-primary/30 dark:bg-primary/10">
              <FileUp className="size-5" />
            </div>
          </CardHeader>
          <CardContent className="min-w-0">
            <Tabs defaultValue="upload">
              <TabsList>
                <TabsTrigger value="upload">导入文档</TabsTrigger>
                <TabsTrigger value="manual">新增知识</TabsTrigger>
              </TabsList>
              <TabsContent value="upload" className="mt-4">
                <KnowledgeDocumentUpload />
              </TabsContent>
              <TabsContent value="manual" className="mt-4">
                <KnowledgeCreateForm />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>索引状态</CardTitle>
              <CardDescription className="mt-1">最近导入记录和知识库发布概况。</CardDescription>
            </div>
            <RebuildIndexButton />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border bg-slate-50 p-4 dark:bg-secondary/60">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded bg-emerald-50 text-emerald-600 dark:border dark:border-success/30 dark:bg-success/10 dark:text-success">
                  <Target className="size-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-foreground">发布率</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-foreground">
                    {knowledgeResult.summary.total ? Math.round((knowledgeResult.summary.published / knowledgeResult.summary.total) * 1000) / 10 : 0}%
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-foreground">最近导入</div>
              <div className="space-y-2">
                {jobs.slice(0, 4).map((job) => (
                  <div key={job.id} className="rounded border border-border bg-white px-3 py-2 dark:bg-card">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-slate-900 dark:text-foreground">{job.status}</span>
                      <span className="text-xs text-muted">{new Date(job.createdAt).toLocaleString("zh-CN")}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted">{job.summary || "-"}</div>
                  </div>
                ))}
                {!jobs.length ? <div className="rounded border border-dashed border-border px-3 py-6 text-center text-sm text-muted">暂无导入记录</div> : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>知识条目 ({knowledgeResult.total})</CardTitle>
            <CardDescription className="mt-1">按分类、状态和关键词筛选，选中条目后可查看详情。</CardDescription>
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
    </>
  );
}
