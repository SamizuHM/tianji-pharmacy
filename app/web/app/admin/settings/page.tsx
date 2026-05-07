import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsForm } from "@/components/settings/settings-form";
import { ThemeSettings } from "@/components/settings/theme-settings";
import { getRuntimeSettings } from "@/lib/services/settings";
import { requireUser } from "@/lib/auth/session";

export default async function AdminSettingsPage() {
  const [settings, user] = await Promise.all([
    getRuntimeSettings(),
    requireUser()
  ]);

  return (
    <Tabs defaultValue="params">
      <TabsList>
        <TabsTrigger value="params">全局参数</TabsTrigger>
        <TabsTrigger value="theme">个人偏好</TabsTrigger>
      </TabsList>
      <TabsContent value="params">
        <SettingsForm initialSettings={settings} />
      </TabsContent>
      <TabsContent value="theme">
        <ThemeSettings
          currentTheme={user.sidebarTheme}
          currentColorMode={(user as { colorMode?: "light" | "dark" | "system" }).colorMode ?? "system"}
        />
      </TabsContent>
    </Tabs>
  );
}
