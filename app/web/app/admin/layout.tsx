import { headers } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";
import { getPendingTicketCounts } from "@/lib/services/tickets";

const TITLES: Record<string, { title: string; description: string }> = {
  "/admin/knowledge": { title: "知识库管理", description: "导入知识文档、手动新增知识条目、查看和管理已有知识。" },
  "/admin/stats": { title: "统计分析", description: "查看问答命中、工单闭环和最近 7 天趋势。" },
  "/admin/settings": { title: "系统设置", description: "调整知识检索、重排和命中阈值等运行参数。" }
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const pendingCounts = await getPendingTicketCounts();
  const pathname = (await headers()).get("x-next-url") ?? "/admin";
  const match = TITLES[pathname] ?? { title: "管理后台", description: "" };

  return (
    <AppShell
      role={user.role}
      displayName={user.displayName}
      title={match.title}
      description={match.description}
      initialPendingCounts={pendingCounts}
      sidebarTheme={user.sidebarTheme as "blue" | "light"}
      colorMode={(user as { colorMode?: "light" | "dark" | "system" }).colorMode ?? "system"}
    >
      {children}
    </AppShell>
  );
}
