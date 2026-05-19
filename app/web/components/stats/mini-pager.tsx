"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useTransition } from "react";

export function MiniPager({
  param,
  current,
  pageCount,
}: {
  param: "messagePage" | "ticketPage";
  current: number;
  pageCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const prev = Math.max(1, current - 1);
  const next = Math.min(pageCount, current + 1);

  function navigate(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(param, String(page));
    startTransition(() => {
      router.push(`/admin/stats?${params.toString()}`);
    });
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <button
        type="button"
        className="rounded border border-border px-2 py-1 transition-colors duration-150 hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-secondary"
        disabled={current <= 1 || isPending}
        onClick={() => navigate(prev)}
      >
        上一页
      </button>
      <span className="flex items-center gap-1">
        {isPending ? <Loader2 className="size-3 animate-spin" /> : null}
        {current}/{pageCount}
      </span>
      <button
        type="button"
        className="rounded border border-border px-2 py-1 transition-colors duration-150 hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-secondary"
        disabled={current >= pageCount || isPending}
        onClick={() => navigate(next)}
      >
        下一页
      </button>
    </div>
  );
}
