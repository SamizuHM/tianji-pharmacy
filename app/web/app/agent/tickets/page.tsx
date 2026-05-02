import { TicketList } from "@/components/tickets/ticket-list";
import { requireUser } from "@/lib/auth/session";
import { getPendingTicketCounts, listTickets } from "@/lib/services/tickets";

export default async function AgentTicketsPage(props: { searchParams: Promise<{ status?: string; statusGroup?: string; q?: string; page?: string; pageSize?: string }> }) {
  const user = await requireUser(["agent"]);
  const searchParams = await props.searchParams;
  const [result, pendingCounts] = await Promise.all([
    listTickets({
      role: user.role,
      userId: user.id,
      userDepartmentName: user.department?.name ?? null,
      status: (searchParams.status as "pending_claim" | "processing" | "escalated" | "closed" | "all" | undefined) ?? "all",
      statusGroup: (searchParams.statusGroup as "all" | "pending" | "processing" | "escalated" | "closed" | undefined) ?? "all",
      q: searchParams.q,
      page: Number(searchParams.page ?? 1),
      pageSize: Number(searchParams.pageSize ?? 10)
    }),
    getPendingTicketCounts({
      role: user.role,
      userId: user.id,
      userDepartmentName: user.department?.name ?? null
    })
  ]);

  return (
    <TicketList
      title={`工单列表（待认领 ${pendingCounts.pendingClaim}，已升级 ${pendingCounts.escalated}）`}
      basePath="/agent/tickets"
      result={result}
      currentStatusGroup={(searchParams.statusGroup as "all" | "pending" | "processing" | "escalated" | "closed" | undefined) ?? "all"}
      q={searchParams.q}
      currentUserId={user.id}
    />
  );
}
