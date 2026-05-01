import type { TicketPriority, TicketStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import {
  knowledgeStatusLabel,
  knowledgeStatusTone,
  priorityLabel,
  priorityTone,
  statusLabel,
  statusTone
} from "@/lib/presentation";
import { cn } from "@/lib/utils";

export function TicketStatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  return <Badge className={cn("border", statusTone(status), className)}>{statusLabel(status)}</Badge>;
}

export function PriorityBadge({ priority, className }: { priority: TicketPriority; className?: string }) {
  return <Badge className={cn("border", priorityTone(priority), className)}>{priorityLabel(priority)}</Badge>;
}

export function KnowledgeStatusBadge({
  status,
  className
}: {
  status: "draft" | "published" | "archived";
  className?: string;
}) {
  return <Badge className={cn("border", knowledgeStatusTone(status), className)}>{knowledgeStatusLabel(status)}</Badge>;
}
