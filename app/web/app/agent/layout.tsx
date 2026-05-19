import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";
import { getPendingTicketCounts } from "@/lib/services/tickets";

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(["agent"]);
  const pendingCounts = await getPendingTicketCounts({
    role: user.role,
    userId: user.id,
    userDepartmentName: user.department?.name ?? null,
  });
  const title = user.department ? `${user.department.name}工单台` : "前台客服工单台";
  const description = user.department
    ? `处理升级到${user.department.name}的工单`
    : "可认领、回复和升级工单到部门专家。";

  return (
    <AppShell
      role={user.role}
      displayName={user.displayName}
      title={title}
      description={description}
      initialPendingCounts={pendingCounts}
      userDepartmentName={user.department?.name ?? null}
      sidebarTheme={user.sidebarTheme as "blue" | "light"}
      colorMode={(user as { colorMode?: "light" | "dark" | "system" }).colorMode ?? "system"}
    >
      {children}
    </AppShell>
  );
}
