import { AppShell } from "@/components/layout/app-shell";
import { TicketList } from "@/components/tickets/ticket-list";
import { requireUser } from "@/lib/auth/session";
import { getPendingTicketCounts, listTickets } from "@/lib/services/tickets";

export default async function L1TicketsPage(props: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser(["human_l1"]);
  const searchParams = await props.searchParams;
  const [tickets, pendingCounts] = await Promise.all([
    listTickets({
      role: user.role,
      userId: user.id,
      status: (searchParams.status as "pending_l1" | "pending_l2" | "closed" | "all" | undefined) ?? "all"
    }),
    getPendingTicketCounts()
  ]);

  return (
    <AppShell
      role={user.role}
      displayName={user.displayName}
      title="人工处理1工单台"
      description="可回复建议、关闭工单，必要时升级到人工处理2。"
      initialPendingCounts={pendingCounts}
    >
      <TicketList
        title={`人工处理1工单列表（待处理 ${pendingCounts.human_l1}）`}
        basePath="/l1/tickets"
        tickets={tickets}
        currentStatus={searchParams.status ?? "all"}
      />
    </AppShell>
  );
}
