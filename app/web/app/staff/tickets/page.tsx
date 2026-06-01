import { TicketList } from "@/components/tickets/ticket-list";
import { requireUser } from "@/lib/auth/session";
import { listTickets } from "@/lib/services/tickets";

export default async function StaffTicketsPage(props: {
  searchParams: Promise<{
    status?: string;
    statusGroup?: string;
    q?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const user = await requireUser(["staff"]);
  const searchParams = await props.searchParams;
  const result = await listTickets({
    role: user.role,
    userId: user.id,
    status:
      (searchParams.status as
        | "pending_claim"
        | "processing"
        | "escalated"
        | "resolved"
        | "closed"
        | "all"
        | undefined) ?? "all",
    statusGroup:
      (searchParams.statusGroup as
        | "all"
        | "pending"
        | "processing"
        | "escalated"
        | "resolved"
        | "closed"
        | undefined) ?? "all",
    q: searchParams.q,
    page: Number(searchParams.page ?? 1),
    pageSize: Number(searchParams.pageSize ?? 10),
  });

  return (
    <TicketList
      title="药店工作人员工单列表"
      basePath="/staff/tickets"
      result={result}
      currentStatusGroup={
        (searchParams.statusGroup as
          | "all"
          | "pending"
          | "processing"
          | "escalated"
          | "resolved"
          | "closed"
          | undefined) ?? "all"
      }
      q={searchParams.q}
      currentUserId={user.id}
      showTicketType={false}
      showCurrentDepartment
    />
  );
}
