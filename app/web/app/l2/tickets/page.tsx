import { TicketList } from "@/components/tickets/ticket-list";
import { requireUser } from "@/lib/auth/session";
import { listTickets } from "@/lib/services/tickets";

export default async function L2TicketsPage(props: { searchParams: Promise<{ status?: string; statusGroup?: string; q?: string; page?: string; pageSize?: string }> }) {
  const user = await requireUser(["human_l1"]);
  const searchParams = await props.searchParams;
  const result = await listTickets({
    role: user.role,
    userId: user.id,
    userDepartmentName: user.department?.name ?? null,
    status: (searchParams.status as "pending_claim" | "processing" | "escalated" | "closed" | "all" | undefined) ?? "all",
    statusGroup: (searchParams.statusGroup as "all" | "pending" | "processing" | "escalated" | "closed" | undefined) ?? "all",
    q: searchParams.q,
    page: Number(searchParams.page ?? 1),
    pageSize: Number(searchParams.pageSize ?? 10)
  });

  return (
    <TicketList
      title="工单列表"
      basePath="/l2/tickets"
      result={result}
      currentStatusGroup={(searchParams.statusGroup as "all" | "pending" | "processing" | "escalated" | "closed" | undefined) ?? "all"}
      q={searchParams.q}
      currentUserId={user.id}
    />
  );
}
