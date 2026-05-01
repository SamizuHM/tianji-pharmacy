import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";
import { getPendingTicketCounts } from "@/lib/services/tickets";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(["staff"]);
  const pendingCounts = await getPendingTicketCounts();

  return (
    <AppShell
      role={user.role}
      displayName={user.displayName}
      title="药店工作人员问答台"
      description="先检索知识库，未命中再走大模型。每轮回答后都支持一键转人工。"
      initialPendingCounts={pendingCounts}
    >
      {children}
    </AppShell>
  );
}
