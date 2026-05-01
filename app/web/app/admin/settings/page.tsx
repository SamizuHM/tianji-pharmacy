import { AppShell } from "@/components/layout/app-shell";
import { SettingsForm } from "@/components/settings/settings-form";
import { requireUser } from "@/lib/auth/session";
import { getRuntimeSettings } from "@/lib/services/settings";
import { getPendingTicketCounts } from "@/lib/services/tickets";

export default async function AdminSettingsPage() {
  const user = await requireUser();
  const [settings, pendingCounts] = await Promise.all([getRuntimeSettings(), getPendingTicketCounts()]);

  return (
    <AppShell
      role={user.role}
      displayName={user.displayName}
      title="系统设置"
      description="调整知识检索、重排和命中阈值等运行参数。"
      initialPendingCounts={pendingCounts}
    >
      <SettingsForm initialSettings={settings} />
    </AppShell>
  );
}
