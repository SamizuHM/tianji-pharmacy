import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded bg-secondary px-2 py-0.5 text-xs font-medium text-foreground transition-colors duration-150 dark:border dark:border-primary/20 dark:bg-primary/10 dark:text-primary",
        className
      )}
      {...props}
    />
  );
}
