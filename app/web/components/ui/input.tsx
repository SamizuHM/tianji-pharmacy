import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none transition focus:border-primary",
      className
    )}
    {...props}
  />
));

Input.displayName = "Input";

export { Input };

