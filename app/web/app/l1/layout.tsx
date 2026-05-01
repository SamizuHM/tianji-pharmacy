import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";
import { getPendingTicketCounts } from "@/lib/services/tickets";

export default async function L1Layout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(["human_l1"]);
  const pendingCounts = await getPendingTicketCounts();

  return (
    <AppShell
      role={user.role}
      displayName={user.displayName}
      title="人工处理1工单台"
      description="可回复建议、关闭工单，必要时升级到人工处理2。"
      initialPendingCounts={pendingCounts}
    >
      {children}
    </AppShell>
  );
}
