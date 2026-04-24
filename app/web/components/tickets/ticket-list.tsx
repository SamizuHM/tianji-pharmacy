"use client";

import Link from "next/link";

import { Ticket } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

type TicketWithUsers = Ticket & {
  createdBy?: {
    displayName: string;
  };
  closedBy?: {
    displayName: string;
  } | null;
};

export function TicketList(props: {
  title: string;
  basePath: string;
  tickets: TicketWithUsers[];
  currentStatus: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>{props.title}</CardTitle>
          <p className="mt-1 text-sm text-muted">支持筛选待处理、升级中、已关闭工单，并查看完整处理轨迹。</p>
        </div>
        <form>
          <Select
            defaultValue={props.currentStatus}
            onChange={(event) => {
              const url = new URL(window.location.href);
              url.searchParams.set("status", event.target.value);
              window.location.href = url.toString();
            }}
          >
            <option value="all">全部状态</option>
            <option value="pending_l1">待人工1</option>
            <option value="pending_l2">待人工2</option>
            <option value="closed">已关闭</option>
          </Select>
        </form>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.tickets.map((ticket) => (
          <Link key={ticket.id} href={`${props.basePath}/${ticket.id}`} className="block rounded-2xl border border-border p-4 hover:bg-secondary/40">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{ticket.ticketNo}</Badge>
              <Badge className="bg-primary/10 text-primary">{statusLabel(ticket.status)}</Badge>
              <Badge className="bg-secondary text-foreground">{assigneeLabel(ticket.currentAssigneeRole)}</Badge>
            </div>
            <h3 className="mt-3 text-lg font-semibold">{ticket.title}</h3>
            <p className="mt-2 text-sm text-muted">{ticket.latestUserQuestion}</p>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
              <span>发起人：{ticket.createdBy?.displayName || "-"}</span>
              <span>关闭人：{ticket.closedBy?.displayName || "未关闭"}</span>
            </div>
          </Link>
        ))}
        {!props.tickets.length ? <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">暂无工单</div> : null}
      </CardContent>
    </Card>
  );
}

function statusLabel(status: Ticket["status"]) {
  switch (status) {
    case "pending_l1":
      return "待人工1";
    case "pending_l2":
      return "待人工2";
    case "closed":
      return "已关闭";
    default:
      return status;
  }
}

function assigneeLabel(role: Ticket["currentAssigneeRole"]) {
  return role === "human_l1" ? "当前人工1" : "当前人工2";
}
