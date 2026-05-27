import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";
import { getPendingTicketCounts } from "@/lib/services/tickets";

export default async function DepartmentLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(["department"]);
  const pendingCounts = await getPendingTicketCounts({
    role: user.role,
    userId: user.id,
    userDepartmentName: user.department?.name ?? null,
  });
  const title = user.department ? `${user.department.name}工单台` : "部门工单台";
  const description = user.department
    ? `处理分发到${user.department.name}的工单，可认领、回复和转派。`
    : "当前账号未绑定部门，请联系管理员完善人员信息。";

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
