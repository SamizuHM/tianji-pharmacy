import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-accent bg-accent/20 px-4 py-3 text-sm", className)}
      {...props}
    />
  );
}
