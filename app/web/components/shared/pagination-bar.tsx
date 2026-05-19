"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function PaginationBar(props: {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  className?: string;
  isPending?: boolean;
  onNavigate?: (params: Record<string, string>) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(next: Record<string, string>) {
    if (props.onNavigate) {
      props.onNavigate(next);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(next).forEach(([key, value]) => params.set(key, value));
    router.push(`?${params.toString()}`);
  }

  const pages = Array.from({ length: Math.min(5, props.pageCount) }, (_, index) => {
    const start = Math.min(Math.max(1, props.page - 2), Math.max(1, props.pageCount - 4));
    return start + index;
  }).filter((page) => page <= props.pageCount);

  const disabled = props.isPending;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted transition-opacity duration-150",
        disabled && "pointer-events-none opacity-60",
        props.className
      )}
    >
      <div className="flex items-center gap-2">
        <span>共 {props.total} 条</span>
        {disabled ? <Loader2 className="size-3 animate-spin text-muted" /> : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-8"
          disabled={props.page <= 1 || disabled}
          onClick={() => update({ page: String(props.page - 1) })}
        >
          <ChevronLeft className="size-4" />
        </Button>
        {pages.map((page) => (
          <Button
            key={page}
            type="button"
            size="icon"
            variant={page === props.page ? "secondary" : "ghost"}
            className={cn(
              "size-8",
              page === props.page
                ? "border border-primary bg-blue-50 text-primary dark:border-primary/30 dark:bg-primary/10"
                : ""
            )}
            disabled={disabled}
            onClick={() => update({ page: String(page) })}
          >
            {page}
          </Button>
        ))}
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-8"
          disabled={props.page >= props.pageCount || disabled}
          onClick={() => update({ page: String(props.page + 1) })}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Select
          className="h-8 w-28"
          value={String(props.pageSize)}
          disabled={disabled}
          onChange={(event) => update({ page: "1", pageSize: event.target.value })}
        >
          {[10, 20, 50].map((size) => (
            <option key={size} value={size}>
              {size} 条/页
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
