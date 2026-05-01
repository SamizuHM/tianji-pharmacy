import { SettingsForm } from "@/components/settings/settings-form";
import { getRuntimeSettings } from "@/lib/services/settings";

export default async function AdminSettingsPage() {
  const settings = await getRuntimeSettings();

  return <SettingsForm initialSettings={settings} />;
}
