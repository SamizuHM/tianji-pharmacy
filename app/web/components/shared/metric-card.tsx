import type { ComponentType } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

export function MetricCard(props: {
  label: string;
  value: string | number;
  description?: string;
  trend?: string;
  trendDirection?: "up" | "down";
  icon: ComponentType<{ className?: string }>;
  tone?: "blue" | "green" | "purple" | "orange" | "indigo" | "teal";
}) {
  const Icon = props.icon;
  const TrendIcon = props.trendDirection === "down" ? ArrowDownRight : ArrowUpRight;
  const toneClass = {
    blue: "bg-blue-100 text-blue-600",
    green: "bg-emerald-100 text-emerald-600",
    purple: "bg-purple-100 text-purple-600",
    orange: "bg-orange-100 text-orange-600",
    indigo: "bg-indigo-100 text-indigo-600",
    teal: "bg-teal-100 text-teal-600"
  }[props.tone ?? "blue"];

  return (
    <div className="panel flex min-h-[128px] flex-col gap-3 p-5 transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className={cn("flex size-10 items-center justify-center rounded-full", toneClass)}>
          <Icon className="size-5" />
        </div>
        {props.trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium",
              props.trendDirection === "down" ? "text-red-500" : "text-emerald-500"
            )}
          >
            <TrendIcon className="size-3.5" />
            {props.trend}
          </span>
        ) : null}
      </div>
      <div>
        <div className="text-sm text-muted">{props.label}</div>
        <div className="mt-2 text-3xl font-semibold leading-none text-slate-900">{props.value}</div>
        {props.description ? <div className="mt-2 text-xs text-muted">{props.description}</div> : null}
      </div>
    </div>
  );
}
