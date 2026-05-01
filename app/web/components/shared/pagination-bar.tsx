"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function PaginationBar(props: {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(next).forEach(([key, value]) => params.set(key, value));
    router.push(`?${params.toString()}`);
  }

  const pages = Array.from({ length: Math.min(5, props.pageCount) }, (_, index) => {
    const start = Math.min(Math.max(1, props.page - 2), Math.max(1, props.pageCount - 4));
    return start + index;
  }).filter((page) => page <= props.pageCount);

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted", props.className)}>
      <div>共 {props.total} 条</div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-8"
          disabled={props.page <= 1}
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
            className={cn("size-8", page === props.page ? "border border-primary bg-blue-50 text-primary" : "")}
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
          disabled={props.page >= props.pageCount}
          onClick={() => update({ page: String(props.page + 1) })}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Select
          className="h-8 w-28"
          value={String(props.pageSize)}
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
