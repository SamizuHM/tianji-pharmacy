import { notFound } from "next/navigation";

import { TicketDetailClient } from "@/components/tickets/ticket-detail-client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { canAccessTicket, getTicketDetail } from "@/lib/services/tickets";

export default async function DepartmentTicketDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser(["department"]);
  const { id } = await props.params;
  const ticket = await getTicketDetail(id);

  if (
    !ticket ||
    !canAccessTicket({
      role: user.role,
      userId: user.id,
      userDepartmentName: user.department?.name ?? null,
      ticket,
    })
  ) {
    notFound();
  }

  const departments = await prisma.department.findMany({
    include: {
      users: {
        where: { role: "department" },
        select: { id: true, displayName: true },
        orderBy: { displayName: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <TicketDetailClient
      role="department"
      userId={user.id}
      userDepartmentName={user.department?.name ?? null}
      ticket={ticket}
      departments={departments}
    />
  );
}
