import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { TicketDetailClient } from "@/components/tickets/ticket-detail-client";
import { requireUser } from "@/lib/auth/session";
import { getPendingTicketCounts, getTicketDetail } from "@/lib/services/tickets";

export default async function StaffTicketDetailPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["staff"]);
  const { id } = await props.params;
  const [ticket, pendingCounts] = await Promise.all([getTicketDetail(id), getPendingTicketCounts()]);

  if (!ticket || ticket.createdByUserId !== user.id) {
    notFound();
  }

  return (
    <AppShell
      role={user.role}
      displayName={user.displayName}
      title={`工单详情 ${ticket.ticketNo}`}
      description={ticket.title}
      initialPendingCounts={pendingCounts}
    >
      <TicketDetailClient role="staff" ticket={ticket} />
    </AppShell>
  );
}
