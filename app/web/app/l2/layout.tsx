import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";
import { getPendingTicketCounts } from "@/lib/services/tickets";

export default async function L2Layout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(["human_l2"]);
  const pendingCounts = await getPendingTicketCounts();

  return (
    <AppShell
      role={user.role}
      displayName={user.displayName}
      title="人工处理2工单台"
      description="处理升级工单，给出最终解决方案。"
      initialPendingCounts={pendingCounts}
    >
      {children}
    </AppShell>
  );
}
