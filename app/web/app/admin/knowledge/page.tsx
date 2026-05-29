import {
  KnowledgeDocumentUpload,
  KnowledgeCreateForm,
  RebuildIndexButton,
} from "@/components/knowledge/knowledge-admin";
import { KnowledgeDocumentTable } from "@/components/knowledge/knowledge-document-table";
import { MetricCard } from "@/components/shared/metric-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { prisma } from "@/lib/db";
import {
  ensureKnowledgeItemsHaveDocuments,
  getKnowledgeSummary,
  listKnowledgeDocuments,
} from "@/lib/services/knowledge";
import { BookOpen, CheckSquare, FileUp, Image, PlusSquare, Target } from "lucide-react";

export default async function AdminKnowledgePage(props: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    status?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  await ensureKnowledgeItemsHaveDocuments();

  const [documentResult, summary, jobs] = await Promise.all([
    listKnowledgeDocuments({
      q: searchParams.q,
      category: searchParams.category,
      status:
        (searchParams.status as "draft" | "published" | "archived" | "all" | undefined) ?? "all",
      page: Number(searchParams.page ?? 1),
      pageSize: Number(searchParams.pageSize ?? 10),
    }),
    getKnowledgeSummary(),
    prisma.importJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const serializedDocuments = documentResult.items.map((item) => ({
    id: item.id,
    title: item.title,
    sourceFile: item.sourceFile,
    businessCategory: item.businessCategory,
    answerPolicy: item.answerPolicy,
    scopeLevel: item.scopeLevel,
    provinceName: item.provinceName,
    cityName: item.cityName,
    districtName: item.districtName,
    status: item.status,
    hitCount: item.hitCount,
    updatedAt: item.updatedAt,
    _count: item._count,
  }));

  return (
    <>
      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="知识条目数"
          value={summary.total}
          description="全量知识沉淀"
          icon={BookOpen}
          tone="blue"
          trend="12.6%"
        />
        <MetricCard
          label="图片知识数"
          value={summary.imageCount}
          description="多模态资料"
          icon={Image}
          tone="green"
          trend="15.3%"
        />
        <MetricCard
          label="今日新增"
          value={summary.todayCreated}
          description="新增知识"
          icon={PlusSquare}
          tone="purple"
        />
        <MetricCard
          label="已发布"
          value={summary.published}
          description="可被检索命中"
          icon={CheckSquare}
          tone="orange"
        />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>知识入库</CardTitle>
              <CardDescription className="mt-1">
                上传业务文档或手动维护单条标准问答。
              </CardDescription>
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
                  <div className="text-sm font-medium text-slate-900 dark:text-foreground">
                    发布率
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-foreground">
                    {summary.total
                      ? Math.round((summary.published / summary.total) * 1000) / 10
                      : 0}
                    %
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-foreground">
                最近导入
              </div>
              <div className="space-y-2">
                {jobs.slice(0, 4).map((job) => (
                  <div
                    key={job.id}
                    className="rounded border border-border bg-white px-3 py-2 dark:bg-card"
                  >
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-slate-900 dark:text-foreground">
                        {job.status}
                      </span>
                      <span className="text-xs text-muted">
                        {new Date(job.createdAt).toLocaleString("zh-CN")}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted">{job.summary || "-"}</div>
                  </div>
                ))}
                {!jobs.length ? (
                  <div className="rounded border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
                    暂无导入记录
                  </div>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>知识文档 ({documentResult.total})</CardTitle>
            <CardDescription className="mt-1">
              按文档管理解析结果和切分后的 chunk，发布后进入检索索引。
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 overflow-x-auto">
            <KnowledgeDocumentTable
              documents={serializedDocuments}
              total={documentResult.total}
              page={documentResult.page}
              pageSize={documentResult.pageSize}
              pageCount={documentResult.pageCount}
              categoryOptions={documentResult.categoryOptions}
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
