import { AppShell } from "@/components/layout/app-shell";
import { TicketList } from "@/components/tickets/ticket-list";
import { requireUser } from "@/lib/auth/session";
import { getPendingTicketCounts, listTickets } from "@/lib/services/tickets";

export default async function L2TicketsPage(props: { searchParams: Promise<{ status?: string; statusGroup?: string; assignee?: string; q?: string; page?: string; pageSize?: string }> }) {
  const user = await requireUser(["human_l2"]);
  const searchParams = await props.searchParams;
  const [result, pendingCounts] = await Promise.all([
    listTickets({
      role: user.role,
      userId: user.id,
      status: (searchParams.status as "pending_l1" | "processing_l1" | "pending_l2" | "processing_l2" | "closed" | "all" | undefined) ?? "all",
      statusGroup: (searchParams.statusGroup as "all" | "pending" | "processing" | "escalated" | "closed" | undefined) ?? "all",
      assignee: (searchParams.assignee as "human_l1" | "human_l2" | "all" | undefined) ?? "all",
      q: searchParams.q,
      page: Number(searchParams.page ?? 1),
      pageSize: Number(searchParams.pageSize ?? 10)
    }),
    getPendingTicketCounts()
  ]);

  return (
    <AppShell
      role={user.role}
      displayName={user.displayName}
      title="人工处理2工单台"
      description="专门处理升级工单，并负责最终闭环。"
      initialPendingCounts={pendingCounts}
    >
      <TicketList
        title={`人工处理2工单列表（待处理 ${pendingCounts.human_l2}）`}
        basePath="/l2/tickets"
        result={result}
        currentStatusGroup={(searchParams.statusGroup as "all" | "pending" | "processing" | "escalated" | "closed" | undefined) ?? "all"}
        currentAssignee={searchParams.assignee ?? "all"}
        q={searchParams.q}
      />
    </AppShell>
  );
}
