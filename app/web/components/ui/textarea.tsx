import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-[120px] w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none transition focus:border-primary",
      className
    )}
    {...props}
  />
));

Textarea.displayName = "Textarea";

export { Textarea };

