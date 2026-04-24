import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { TicketDetailClient } from "@/components/tickets/ticket-detail-client";
import { requireUser } from "@/lib/auth/session";
import { getPendingTicketCounts, getTicketDetail } from "@/lib/services/tickets";

export default async function L1TicketDetailPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["human_l1"]);
  const { id } = await props.params;
  const [ticket, pendingCounts] = await Promise.all([getTicketDetail(id), getPendingTicketCounts()]);

  if (!ticket) {
    notFound();
  }

  return (
    <AppShell
      role={user.role}
      displayName={user.displayName}
      title={`人工处理1 - ${ticket.ticketNo}`}
      description={ticket.title}
      initialPendingCounts={pendingCounts}
    >
      <TicketDetailClient role="human_l1" ticket={ticket} />
    </AppShell>
  );
}
