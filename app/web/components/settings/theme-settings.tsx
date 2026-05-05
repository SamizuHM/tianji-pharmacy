"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { SidebarThemeName } from "@/lib/themes";

const themeOptions: Array<{
  value: SidebarThemeName;
  label: string;
  description: string;
  previewBg: string;
  previewNav: string;
  previewNavActive: string;
}> = [
  {
    value: "blue",
    label: "蓝色经典",
    description: "深蓝渐变侧边栏，沉稳专业的视觉风格",
    previewBg: "bg-gradient-to-b from-[#172554] to-[#2e1065]",
    previewNav: "bg-white/10",
    previewNavActive: "border-l-2 border-blue-400 bg-white/15"
  },
  {
    value: "light",
    label: "简约白色",
    description: "白色浮动侧边栏，清新简洁的现代风格",
    previewBg: "bg-gradient-to-b from-white to-[#f5f7fb] border border-slate-200",
    previewNav: "bg-white border border-slate-100",
    previewNavActive: "bg-blue-50 border border-blue-200"
  }
];

export function ThemeSettings({ currentTheme }: { currentTheme: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function switchTheme(theme: SidebarThemeName) {
    setPending(true);
    try {
      const response = await fetch("/api/settings/theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme })
      });
      if (response.ok) {
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <p className="mb-4 text-sm text-muted">仅影响当前账号，不会影响其他用户。</p>
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
                : "border-border hover:border-slate-300 hover:shadow-sm"
            )}
          >
            <div className={cn("flex h-24 w-full flex-col gap-1.5 rounded-lg p-3", option.previewBg)}>
              <div className="flex items-center gap-2">
                <div className="size-4 rounded bg-blue-500/60" />
                <div className="h-2 w-16 rounded-full bg-white/25" />
              </div>
              <div className={cn("mt-1 h-3 w-full rounded", option.previewNavActive)} />
              <div className={cn("h-3 w-full rounded", option.previewNav)} />
              <div className={cn("h-3 w-3/4 rounded", option.previewNav)} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900">{option.label}</span>
                {selected ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary text-white">
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
    </div>
  );
}
