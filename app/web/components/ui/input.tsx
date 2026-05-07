import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded border border-border bg-white px-3 py-2 text-sm outline-none transition-all duration-150 placeholder:text-slate-400 hover:border-slate-300 focus:border-primary focus:ring-1 focus:ring-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-card dark:text-foreground dark:placeholder:text-muted dark:hover:border-border",
      className
    )}
    {...props}
  />
));

Input.displayName = "Input";

export { Input };
