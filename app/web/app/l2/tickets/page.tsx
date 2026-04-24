import { AppShell } from "@/components/layout/app-shell";
import { TicketList } from "@/components/tickets/ticket-list";
import { requireUser } from "@/lib/auth/session";
import { listTickets } from "@/lib/services/tickets";

export default async function L2TicketsPage(props: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser(["human_l2"]);
  const searchParams = await props.searchParams;
  const tickets = await listTickets({
    role: user.role,
    userId: user.id,
    status: (searchParams.status as "pending_l1" | "pending_l2" | "closed" | "all" | undefined) ?? "all"
  });

  return (
    <AppShell role={user.role} displayName={user.displayName} title="人工处理2工单台" description="专门处理升级工单，并负责最终闭环。">
      <TicketList title="人工处理2工单列表" basePath="/l2/tickets" tickets={tickets} currentStatus={searchParams.status ?? "all"} />
    </AppShell>
  );
}

