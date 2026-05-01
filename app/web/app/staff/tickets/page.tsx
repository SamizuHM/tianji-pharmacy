import { AppShell } from "@/components/layout/app-shell";
import { TicketList } from "@/components/tickets/ticket-list";
import { requireUser } from "@/lib/auth/session";
import { getPendingTicketCounts, listTickets } from "@/lib/services/tickets";

export default async function StaffTicketsPage(props: { searchParams: Promise<{ status?: string; statusGroup?: string; assignee?: string; q?: string; page?: string; pageSize?: string }> }) {
  const user = await requireUser(["staff"]);
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
      title="我的工单"
      description="查看我发起的工单、补充信息并跟踪人工处理进度。"
      initialPendingCounts={pendingCounts}
    >
      <TicketList
        title="药店工作人员工单列表"
        basePath="/staff/tickets"
        result={result}
        currentStatusGroup={(searchParams.statusGroup as "all" | "pending" | "processing" | "escalated" | "closed" | undefined) ?? "all"}
        currentAssignee={searchParams.assignee ?? "all"}
        q={searchParams.q}
      />
    </AppShell>
  );
}
