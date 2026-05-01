import { Skeleton } from "@/components/ui/skeleton";

export default function StaffLoading() {
  return (
    <div className="grid h-[calc(100vh-7rem)] gap-5 xl:grid-cols-[280px_minmax(0,1fr)_280px]">
      <div className="rounded-lg border bg-card p-4">
        <Skeleton className="mb-4 h-5 w-24" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <Skeleton className="mb-4 h-5 w-32" />
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-3/4" />
          ))}
        </div>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <Skeleton className="mb-4 h-5 w-24" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
