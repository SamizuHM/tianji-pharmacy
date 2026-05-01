import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-5 shadow-soft">
            <Skeleton className="mb-3 h-3 w-20" />
            <Skeleton className="mb-2 h-7 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border bg-card p-6">
        <Skeleton className="mb-4 h-5 w-32" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
