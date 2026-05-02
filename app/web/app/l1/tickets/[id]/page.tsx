import { notFound } from "next/navigation";

import { TicketDetailClient } from "@/components/tickets/ticket-detail-client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getTicketDetail } from "@/lib/services/tickets";

export default async function L1TicketDetailPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["human_l1"]);
  const { id } = await props.params;
  const ticket = await getTicketDetail(id);

  if (!ticket) {
    notFound();
  }

  const departments = await prisma.department.findMany({
    include: {
      users: {
        select: { id: true, displayName: true },
        orderBy: { displayName: "asc" }
      }
    },
    orderBy: { name: "asc" }
  });

  return <TicketDetailClient role="human_l1" userId={user.id} ticket={ticket} departments={departments} />;
}
