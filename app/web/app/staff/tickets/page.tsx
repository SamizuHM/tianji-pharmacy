import { AppShell } from "@/components/layout/app-shell";
import { TicketList } from "@/components/tickets/ticket-list";
import { requireUser } from "@/lib/auth/session";
import { listTickets } from "@/lib/services/tickets";

export default async function StaffTicketsPage(props: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser(["staff"]);
  const searchParams = await props.searchParams;
  const tickets = await listTickets({
    role: user.role,
    userId: user.id,
    status: (searchParams.status as "pending_l1" | "pending_l2" | "closed" | "all" | undefined) ?? "all"
  });

  return (
    <AppShell role={user.role} displayName={user.displayName} title="我的工单" description="查看我发起的工单、补充信息并跟踪人工处理进度。">
      <TicketList title="药店工作人员工单列表" basePath="/staff/tickets" tickets={tickets} currentStatus={searchParams.status ?? "all"} />
    </AppShell>
  );
}

