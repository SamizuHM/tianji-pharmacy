"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ColorModeName, SidebarThemeName } from "@/lib/themes";

const themeOptions: Array<{
  value: SidebarThemeName;
  label: string;
  description: string;
  previewBg: string;
  previewAccent: string;
  previewLine: string;
  previewNav: string;
  previewNavActive: string;
}> = [
  {
    value: "blue",
    label: "蓝色经典",
    description: "深蓝渐变侧边栏，沉稳专业的视觉风格",
    previewBg: "bg-gradient-to-b from-[#172554] to-[#2e1065]",
    previewAccent: "bg-blue-500/60",
    previewLine: "bg-white/25",
    previewNav: "bg-white/10",
    previewNavActive: "border-l-2 border-blue-400 bg-white/15",
  },
  {
    value: "light",
    label: "简约白色",
    description: "白色浮动侧边栏，清新简洁的现代风格",
    previewBg:
      "bg-gradient-to-b from-white to-[#f5f7fb] border border-slate-200 dark:border-border dark:from-[#111827] dark:to-[#0f172a]",
    previewAccent: "bg-cyan-500/60",
    previewLine: "bg-slate-300 dark:bg-slate-600",
    previewNav: "bg-white border border-slate-100 dark:border-border dark:bg-card",
    previewNavActive: "bg-blue-50 border border-blue-200 dark:border-primary/30 dark:bg-primary/10",
  },
];

const colorModeOptions: Array<{
  value: ColorModeName;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  {
    value: "light",
    label: "白天",
    description: "始终使用明亮界面",
    icon: Sun,
  },
  {
    value: "dark",
    label: "夜间",
    description: "始终使用暗色界面",
    icon: Moon,
  },
  {
    value: "system",
    label: "跟随系统",
    description: "按操作系统自动切换",
    icon: Monitor,
  },
];

export function ThemeSettings({
  currentTheme,
  currentColorMode,
}: {
  currentTheme: string;
  currentColorMode: ColorModeName;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function switchTheme(theme: SidebarThemeName) {
    setPending(true);
    try {
      const response = await fetch("/api/settings/theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
      });
      if (response.ok) {
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  async function switchColorMode(colorMode: ColorModeName) {
    setPending(true);
    try {
      const response = await fetch("/api/settings/theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorMode }),
      });
      if (response.ok) {
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-foreground">主题风格</h3>
          <p className="mt-1 text-sm text-muted">控制侧边栏和整体布局风格。</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {themeOptions.map((option) => {
            const selected = currentTheme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => switchTheme(option.value)}
                disabled={pending}
                className={cn(
                  "relative flex flex-col items-start gap-4 rounded-xl border-2 p-5 text-left transition-all",
                  selected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border hover:border-slate-300 hover:shadow-sm dark:hover:border-border"
                )}
              >
                <div
                  className={cn(
                    "flex h-24 w-full flex-col gap-1.5 rounded-lg p-3",
                    option.previewBg
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className={cn("size-4 rounded", option.previewAccent)} />
                    <div className={cn("h-2 w-16 rounded-full", option.previewLine)} />
                  </div>
                  <div className={cn("mt-1 h-3 w-full rounded", option.previewNavActive)} />
                  <div className={cn("h-3 w-full rounded", option.previewNav)} />
                  <div className={cn("h-3 w-3/4 rounded", option.previewNav)} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 dark:text-foreground">
                      {option.label}
                    </span>
                    {selected ? (
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-white dark:bg-primary/10 dark:text-primary">
                        <Check className="size-3" />
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted">{option.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-foreground">颜色模式</h3>
          <p className="mt-1 text-sm text-muted">同时作用于蓝色经典和简约白色主题。</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {colorModeOptions.map((option) => {
            const selected = currentColorMode === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => switchColorMode(option.value)}
                disabled={pending}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-4 text-left transition-all",
                  selected
                    ? "border-primary bg-primary/5 shadow-sm dark:bg-secondary"
                    : "border-border hover:border-slate-300 hover:bg-slate-50 dark:hover:border-border dark:hover:bg-secondary"
                )}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-lg border",
                    selected
                      ? "border-primary bg-primary text-white dark:border-primary/20 dark:bg-primary/10 dark:text-primary"
                      : "border-border bg-white text-slate-500 dark:bg-card dark:text-muted"
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-foreground">
                    {option.label}
                    {selected ? <Check className="size-4 text-primary" /> : null}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">{option.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
