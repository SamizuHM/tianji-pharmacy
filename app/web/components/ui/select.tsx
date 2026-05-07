"use client";

import type { SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn("h-10 cursor-pointer rounded border border-border bg-white px-3 text-sm outline-none transition-all duration-150 hover:border-slate-300 focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50 dark:bg-card dark:text-foreground dark:hover:border-border", className)}
      {...props}
    />
  );
}
