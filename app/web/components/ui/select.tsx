"use client";

import type { SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn("h-10 rounded border border-border bg-white px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary", className)}
      {...props}
    />
  );
}
