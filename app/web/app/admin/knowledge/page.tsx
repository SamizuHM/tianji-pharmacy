import { AppShell } from "@/components/layout/app-shell";
import {
  KnowledgeImportButton,
  KnowledgeCreateForm
} from "@/components/knowledge/knowledge-admin";
import { KnowledgeTable } from "@/components/knowledge/knowledge-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getPendingTicketCounts } from "@/lib/services/tickets";

export default async function AdminKnowledgePage() {
  const user = await requireUser();
  const [items, jobs, pendingCounts] = await Promise.all([
    prisma.knowledgeItem.findMany({
      orderBy: { createdAt: "desc" },
      take: 100
    }),
    prisma.importJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    getPendingTicketCounts()
  ]);

  const serializedItems = items.map((item) => ({
    id: item.id,
    categoryL1: item.categoryL1,
    categoryL2: item.categoryL2,
    question: item.question,
    answer: item.answer,
    sourceFile: item.sourceFile,
    sourceType: item.sourceType,
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
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>导入操作</CardTitle>
          </CardHeader>
          <CardContent>
            <KnowledgeImportButton />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>新增知识</CardTitle>
          </CardHeader>
          <CardContent>
            <KnowledgeCreateForm />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>知识条目 ({items.length})</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <KnowledgeTable items={serializedItems} />
          </CardContent>
        </Card>
      </div>

      {jobs.length > 0 && (
        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>导入记录</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
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
