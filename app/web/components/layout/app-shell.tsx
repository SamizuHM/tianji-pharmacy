"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { UserRole } from "@prisma/client";
import { BarChart3, BookOpen, Bell, MessageCircle, Tickets, UserRoundCog } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const navByRole: Record<UserRole, Array<{ href: string; label: string; icon: typeof MessageCircle; countKey?: "human_l1" | "human_l2" }>> = {
  staff: [
    { href: "/staff/chat", label: "智能问答", icon: MessageCircle },
    { href: "/staff/tickets", label: "我的工单", icon: Tickets },
    { href: "/admin/stats", label: "统计看板", icon: BarChart3 },
    { href: "/admin/knowledge", label: "知识库管理", icon: BookOpen }
  ],
  human_l1: [
    { href: "/l1/tickets", label: "人工1工单", icon: Tickets, countKey: "human_l1" },
    { href: "/admin/stats", label: "统计看板", icon: BarChart3 },
    { href: "/admin/knowledge", label: "知识库管理", icon: BookOpen }
  ],
  human_l2: [
    { href: "/l2/tickets", label: "人工2工单", icon: Tickets, countKey: "human_l2" },
    { href: "/admin/stats", label: "统计看板", icon: BarChart3 },
    { href: "/admin/knowledge", label: "知识库管理", icon: BookOpen }
  ]
};

type PendingCounts = {
  human_l1: number;
  human_l2: number;
};

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  createdAt: string;
};

export function AppShell(props: {
  role: UserRole;
  displayName: string;
  title: string;
  description?: string;
  initialPendingCounts?: PendingCounts;
  children: React.ReactNode;
}) {
  const [pendingCounts, setPendingCounts] = useState<PendingCounts>(
    props.initialPendingCounts ?? { human_l1: 0, human_l2: 0 }
  );
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let disposed = false;

    function connect() {
      eventSource = new EventSource("/api/notifications/stream");

      const handlePayload = (raw: string) => {
        const payload = JSON.parse(raw) as {
          type: string;
          title?: string;
          message?: string;
          createdAt?: string;
          pendingCounts?: PendingCounts;
        };

        if (payload.pendingCounts) {
          setPendingCounts(payload.pendingCounts);
        }

        if (payload.type === "snapshot" || payload.type === "ping" || !payload.title || !payload.message) {
          return;
        }

        const item: NotificationItem = {
          id: crypto.randomUUID(),
          title: payload.title,
          message: payload.message,
          createdAt: payload.createdAt || new Date().toISOString()
        };
        setNotifications((current) => [item, ...current].slice(0, 4));

        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          new Notification(payload.title, { body: payload.message });
        }

        window.setTimeout(() => {
          setNotifications((current) => current.filter((entry) => entry.id !== item.id));
        }, 5000);
      };

      eventSource.addEventListener("snapshot", (event) => {
        if (disposed) return;
        handlePayload((event as MessageEvent).data);
      });

      eventSource.addEventListener("ticket", (event) => {
        if (disposed) return;
        handlePayload((event as MessageEvent).data);
      });

      eventSource.addEventListener("ping", () => {
        // 心跳仅用于保活，不需要 UI 响应。
      });

      eventSource.onerror = () => {
        if (disposed) {
          return;
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      eventSource?.close();
    };
  }, []);

  const navItems = useMemo(() => navByRole[props.role], [props.role]);

  return (
    <div className="page-shell md:flex-row md:gap-6">
      <aside className="panel mb-4 flex w-full flex-col gap-4 p-4 md:sticky md:top-6 md:mb-0 md:h-[calc(100vh-3rem)] md:w-72">
        <div className="space-y-2">
          <Badge className="bg-primary/10 text-primary">药店门店智能问答 Demo</Badge>
          <h1 className="text-2xl">{props.displayName}</h1>
          <p className="text-sm text-muted">角色：{roleLabel(props.role)}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const count = item.countKey ? pendingCounts[item.countKey] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between rounded-2xl px-3 py-3 text-sm transition hover:bg-secondary"
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-4 w-4" />
                  {item.label}
                </span>
                {item.countKey ? <Badge className="bg-primary/10 text-primary">{count}</Badge> : null}
              </Link>
            );
          })}
        </nav>
        <form action="/api/auth/logout" method="post">
          <Button className="w-full" variant="outline">
            退出登录
          </Button>
        </form>
      </aside>
      <main className="flex-1 space-y-6">
        {notifications.length ? (
          <div className="fixed right-6 top-6 z-50 space-y-3">
            {notifications.map((item) => (
              <div key={item.id} className="w-80 rounded-2xl border border-border bg-white p-4 shadow-xl">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Bell className="h-4 w-4 text-primary" />
                  {item.title}
                </div>
                <div className="text-sm text-muted">{item.message}</div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="panel overflow-hidden">
          <div className="border-b border-border px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-3xl">{props.title}</h2>
                {props.description ? <p className="mt-2 text-sm text-muted">{props.description}</p> : null}
              </div>
              <UserRoundCog className="h-8 w-8 text-primary" />
            </div>
          </div>
          <div className="p-6">{props.children}</div>
        </div>
      </main>
    </div>
  );
}

function roleLabel(role: UserRole) {
  switch (role) {
    case "staff":
      return "药店工作人员";
    case "human_l1":
      return "人工处理1";
    case "human_l2":
      return "人工处理2";
    default:
      return role;
  }
}
