import type { TicketPriority, TicketStatus, UserRole } from "@prisma/client";

export function roleLabel(role: UserRole) {
  switch (role) {
    case "staff":
      return "药店工作人员";
    case "agent":
      return "人工客服";
    default:
      return role;
  }
}

export function statusLabel(status: TicketStatus) {
  switch (status) {
    case "pending_claim":
      return "待认领";
    case "processing":
      return "处理中";
    case "escalated":
      return "已升级";
    case "closed":
      return "已关闭";
    default:
      return status;
  }
}

export function statusTone(status: TicketStatus) {
  switch (status) {
    case "pending_claim":
      return "border-orange-100 bg-orange-50 text-orange-600";
    case "processing":
      return "border-blue-100 bg-blue-50 text-blue-600";
    case "escalated":
      return "border-purple-100 bg-purple-50 text-purple-600";
    case "closed":
      return "border-emerald-100 bg-emerald-50 text-emerald-600";
    default:
      return "border-slate-100 bg-slate-50 text-slate-600";
  }
}

export function priorityLabel(priority: TicketPriority) {
  switch (priority) {
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    default:
      return priority;
  }
}

export function priorityTone(priority: TicketPriority) {
  switch (priority) {
    case "high":
      return "border-red-100 bg-red-50 text-red-600";
    case "medium":
      return "border-orange-100 bg-orange-50 text-orange-600";
    case "low":
      return "border-emerald-100 bg-emerald-50 text-emerald-600";
    default:
      return "border-slate-100 bg-slate-50 text-slate-600";
  }
}

export function knowledgeStatusLabel(status: "draft" | "published" | "archived") {
  switch (status) {
    case "draft":
      return "草稿";
    case "published":
      return "已发布";
    case "archived":
      return "已归档";
    default:
      return status;
  }
}

export function knowledgeStatusTone(status: "draft" | "published" | "archived") {
  switch (status) {
    case "published":
      return "border-emerald-100 bg-emerald-50 text-emerald-600";
    case "draft":
      return "border-orange-100 bg-orange-50 text-orange-600";
    case "archived":
      return "border-slate-100 bg-slate-100 text-slate-600";
    default:
      return "border-slate-100 bg-slate-50 text-slate-600";
  }
}

export function parseTags(raw: string | null | undefined) {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
