"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded text-sm font-medium transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary px-4 py-2 text-primaryForeground shadow-sm hover:bg-blue-700 hover:shadow-md dark:border dark:border-primary/30 dark:bg-primary/10 dark:text-primary dark:hover:bg-secondary",
        secondary:
          "bg-blue-50 px-4 py-2 text-primary hover:bg-blue-100 dark:border dark:border-primary/30 dark:bg-primary/10 dark:text-primary dark:hover:bg-secondary",
        outline:
          "border border-border bg-white px-4 py-2 text-slate-700 hover:bg-slate-50 hover:border-slate-300 dark:bg-card dark:text-foreground dark:hover:border-border dark:hover:bg-secondary",
        ghost:
          "px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-muted dark:hover:bg-secondary dark:hover:text-foreground",
        destructive:
          "bg-destructive px-4 py-2 text-white hover:bg-red-600 dark:hover:bg-destructive/90",
      },
      size: {
        default: "h-10",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-5",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  )
);

Button.displayName = "Button";

export { Button, buttonVariants };
