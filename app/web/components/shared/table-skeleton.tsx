import { Skeleton } from "@/components/ui/skeleton";
import { TD } from "@/components/ui/table";

export function TableSkeleton({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: columns }).map((_, colIndex) => (
            <TD key={colIndex}>
              <Skeleton className="h-4 w-full" />
            </TD>
          ))}
        </tr>
      ))}
    </>
  );
}
