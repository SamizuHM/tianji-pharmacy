import { redirect } from "next/navigation";

export default async function AgentTicketDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  redirect(`/department/tickets/${id}`);
}
