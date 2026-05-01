import { notFound } from "next/navigation";

import { TicketDetailClient } from "@/components/tickets/ticket-detail-client";
import { requireUser } from "@/lib/auth/session";
import { getTicketDetail } from "@/lib/services/tickets";

export default async function L2TicketDetailPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["human_l2"]);
  const { id } = await props.params;
  const ticket = await getTicketDetail(id);

  if (!ticket) {
    notFound();
  }

  return <TicketDetailClient role="human_l2" ticket={ticket} />;
}
