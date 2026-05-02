import { notFound } from "next/navigation";

import { TicketDetailClient } from "@/components/tickets/ticket-detail-client";
import { requireUser } from "@/lib/auth/session";
import { getTicketDetail } from "@/lib/services/tickets";

export default async function StaffTicketDetailPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["staff"]);
  const { id } = await props.params;
  const ticket = await getTicketDetail(id);

  if (!ticket || ticket.createdByUserId !== user.id) {
    notFound();
  }

  return <TicketDetailClient role="staff" userId={user.id} ticket={ticket} />;
}
