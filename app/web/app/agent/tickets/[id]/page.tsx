import { notFound } from "next/navigation";

import { TicketDetailClient } from "@/components/tickets/ticket-detail-client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { canAccessTicket, getTicketDetail } from "@/lib/services/tickets";

export default async function AgentTicketDetailPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["agent"]);
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

  // 只有前台客服（无部门）才需要部门列表用于升级 UI
  const departments = !user.department
    ? await prisma.department.findMany({
        include: {
          users: {
            select: { id: true, displayName: true },
            orderBy: { displayName: "asc" },
          },
        },
        orderBy: { name: "asc" },
      })
    : undefined;

  return (
    <TicketDetailClient
      role="agent"
      userId={user.id}
      userDepartmentName={user.department?.name ?? null}
      ticket={ticket}
      departments={departments}
    />
  );
}
