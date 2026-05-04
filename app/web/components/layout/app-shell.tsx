"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { UserRole } from "@prisma/client";
import {
  BarChart3,
  Bell,
  BookOpen,
  ChevronDown,
  LifeBuoy,
  Menu,
  MessageCircle,
  Search,
  Settings,
  Tickets,
  X
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { roleLabel, statusLabel } from "@/lib/presentation";
import { cn } from "@/lib/utils";

function getNavItems(role: UserRole, userDepartmentName?: string | null): Array<{ href: string; label: string; icon: typeof MessageCircle; countKey?: "pendingClaim" | "escalated" }> {
  if (role === "staff") {
    return [
      { href: "/staff/chat", label: "问答工作台", icon: MessageCircle },
      { href: "/staff/tickets", label: "人工工单", icon: Tickets },
      { href: "/admin/knowledge", label: "知识库管理", icon: BookOpen },
      { href: "/admin/stats", label: "统计分析", icon: BarChart3 },
      { href: "/admin/settings", label: "系统设置", icon: Settings }
    ];
  }
  const countKey: "pendingClaim" | "escalated" = userDepartmentName ? "escalated" : "pendingClaim";
  return [
    { href: "/agent/tickets", label: "人工工单", icon: Tickets, countKey },
    { href: "/admin/knowledge", label: "知识库管理", icon: BookOpen },
    { href: "/admin/stats", label: "统计分析", icon: BarChart3 },
    { href: "/admin/settings", label: "系统设置", icon: Settings }
  ];
}

type PendingCounts = {
  pendingClaim: number;
  escalated: number;
};

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  createdAt: string;
};

type SearchResult = {
  tickets: Array<{ id: string; ticketNo: string; title: string; status: string }>;
  knowledge: Array<{ id: string; question: string; categoryL1: string; categoryL2: string; hitCount: number }>;
  conversations: Array<{ id: string; title: string }>;
  messages: Array<{ id: string; conversationId: string; contentText: string; sourceType: string }>;
};

export function AppShell(props: {
  role: UserRole;
  displayName: string;
  title: string;
  description?: string;
  initialPendingCounts?: PendingCounts;
  userDepartmentName?: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [pendingCounts, setPendingCounts] = useState<PendingCounts>(
    props.initialPendingCounts ?? { pendingClaim: 0, escalated: 0 }
  );
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const navItems = useMemo(() => getNavItems(props.role, props.userDepartmentName), [props.role, props.userDepartmentName]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let disposed = false;

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
      if (!disposed) handlePayload((event as MessageEvent).data);
    });
    eventSource.addEventListener("ticket", (event) => {
      if (!disposed) handlePayload((event as MessageEvent).data);
    });
    eventSource.addEventListener("ping", () => undefined);

    return () => {
      disposed = true;
      eventSource?.close();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-slate-900">
      <DesktopSidebar navItems={navItems} pathname={pathname} pendingCounts={pendingCounts} />
      <div className="min-h-screen lg:pl-60 lg:pt-4">
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-3 border-b border-border bg-white/90 px-4 shadow-sm backdrop-blur lg:top-4 lg:mx-4 lg:rounded-2xl lg:border lg:px-6 lg:shadow-[0_12px_32px_rgba(15,23,42,0.07)]">
          <div className="flex min-w-0 items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="max-w-72 border-0 bg-transparent p-0 shadow-none">
                <SheetHeader className="sr-only">
                  <SheetTitle>导航菜单</SheetTitle>
                </SheetHeader>
                <SheetBody className="h-full p-0">
                  <SidebarContent navItems={navItems} pathname={pathname} pendingCounts={pendingCounts} />
                </SheetBody>
              </SheetContent>
            </Sheet>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-slate-950">{props.title}</h1>
              {props.description ? <p className="hidden truncate text-xs text-muted md:block">{props.description}</p> : null}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
            <GlobalSearch role={props.role} />
            <button type="button" className="relative rounded p-2 text-slate-500 transition-all duration-150 hover:bg-slate-100 hover:text-slate-900 active:scale-95">
              <Bell className="size-5" />
              {pendingCounts.pendingClaim + pendingCounts.escalated > 0 ? (
                <span className="absolute right-1 top-1 size-2 rounded-full bg-red-500" />
              ) : null}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded px-2 py-1.5 transition-all duration-150 hover:bg-slate-100 active:scale-[0.98]">
                  <Avatar>
                    <AvatarFallback>{props.displayName.slice(0, 1)}</AvatarFallback>
                  </Avatar>
                  <span className="hidden min-w-0 flex-col text-left md:flex">
                    <span className="truncate text-sm font-medium text-slate-900">{props.displayName}</span>
                    <span className="truncate text-[11px] text-muted">{roleLabel(props.role)}</span>
                  </span>
                  <ChevronDown className="hidden size-4 text-muted md:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>当前账号</DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem>{roleLabel(props.role)}</DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <form action="/api/auth/logout" method="post">
                  <DropdownMenuItem asChild>
                    <button type="submit" className="w-full">
                      退出登录
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="min-w-0 p-4 lg:px-4 lg:py-6">{props.children}</main>
      </div>

      {notifications.length ? (
        <div className="fixed right-4 top-20 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3">
          {notifications.map((item) => (
            <div key={item.id} className="animate-slide-in-from-top rounded-lg border border-border bg-white p-4 shadow-xl">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                <button
                  type="button"
                  className="rounded p-1 text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-600"
                  onClick={() => setNotifications((current) => current.filter((entry) => entry.id !== item.id))}
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="mt-2 text-sm text-muted">{item.message}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DesktopSidebar(props: {
  navItems: Array<{ href: string; label: string; icon: typeof MessageCircle; countKey?: "pendingClaim" | "escalated" }>;
  pathname: string;
  pendingCounts: PendingCounts;
}) {
  return (
    <aside className="fixed left-4 top-4 z-50 hidden h-[calc(100vh-2rem)] w-56 lg:block">
      <SidebarContent {...props} />
    </aside>
  );
}

function SidebarContent(props: {
  navItems: Array<{ href: string; label: string; icon: typeof MessageCircle; countKey?: "pendingClaim" | "escalated" }>;
  pathname: string;
  pendingCounts: PendingCounts;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_52%,#f5f7fb_100%)] text-slate-700 shadow-[0_18px_42px_rgba(15,23,42,0.10)]">
      <div className="border-b border-slate-200/80 px-4 py-5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-primary shadow-sm">
            <LifeBuoy className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="whitespace-nowrap text-base font-semibold tracking-normal text-slate-950">药店门店智能问答</div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <span className="size-1.5 rounded-full bg-cyan-500" />
              智慧支持 · 专业高效
            </div>
          </div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1.5 px-3 py-5">
        {props.navItems.map((item) => {
          const Icon = item.icon;
          const active = props.pathname === item.href || props.pathname.startsWith(`${item.href}/`);
          const count = item.countKey ? props.pendingCounts[item.countKey] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-sm transition-all duration-150",
                active
                  ? "border-blue-100 bg-blue-50/90 font-semibold text-primary shadow-sm"
                  : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-950 hover:shadow-sm"
              )}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
                    active ? "bg-white text-primary" : "bg-slate-100 text-slate-500 group-hover:bg-blue-50 group-hover:text-primary"
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="truncate">{item.label}</span>
              </span>
              {item.countKey ? (
                <Badge className={cn(active ? "bg-primary text-white" : "bg-slate-100 text-slate-600")}>{count}</Badge>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="p-4">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">AI 赋能药店运营</div>
              <div className="mt-1 text-xs text-slate-500">智能问答 · 精准高效</div>
            </div>
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-cyan-100 bg-cyan-50 text-sm font-semibold text-cyan-700">
              AI
            </div>
          </div>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-primary to-cyan-500" />
          </div>
        </div>
        <div className="mt-4 text-center text-xs text-slate-400">© 2025 智慧医药科技 V1.0.0</div>
      </div>
    </div>
  );
}

function GlobalSearch({ role }: { role: UserRole }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
        signal: controller.signal
      }).catch(() => null);
      if (response?.ok) {
        setResults((await response.json()) as SearchResult);
        setOpen(true);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const ticketBase = role === "staff" ? "/staff/tickets" : "/agent/tickets";

  return (
    <div className="relative hidden w-full max-w-md md:block">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <Input
        value={query}
        onFocus={() => setOpen(Boolean(query.trim()))}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索问题、工单或知识点"
        className="h-9 rounded-lg bg-slate-50 pl-9 pr-12"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-white px-1.5 font-mono text-[11px] text-slate-400">
        ⌘K
      </span>
      {open && results ? (
        <div className="absolute right-0 top-11 z-50 w-full overflow-hidden rounded-lg border border-border bg-white shadow-xl">
          <SearchSection title="工单">
            {results.tickets.map((item) => (
              <Link key={item.id} href={`${ticketBase}/${item.id}`} className="block rounded px-3 py-2 transition-colors duration-100 hover:bg-slate-50" onClick={() => setOpen(false)}>
                <div className="text-sm font-medium text-slate-900">{item.ticketNo}</div>
                <div className="truncate text-xs text-muted">{item.title} · {statusLabel(item.status as never)}</div>
              </Link>
            ))}
          </SearchSection>
          <SearchSection title="知识库">
            {results.knowledge.map((item) => (
              <Link key={item.id} href={`/admin/knowledge?selected=${item.id}`} className="block rounded px-3 py-2 transition-colors duration-100 hover:bg-slate-50" onClick={() => setOpen(false)}>
                <div className="truncate text-sm font-medium text-slate-900">{item.question}</div>
                <div className="text-xs text-muted">{item.categoryL1} / {item.categoryL2} · 命中 {item.hitCount}</div>
              </Link>
            ))}
          </SearchSection>
          {role === "staff" ? (
            <SearchSection title="会话">
              {results.conversations.map((item) => (
                <Link key={item.id} href={`/staff/chat?conversationId=${item.id}`} className="block rounded px-3 py-2 transition-colors duration-100 hover:bg-slate-50" onClick={() => setOpen(false)}>
                  <div className="truncate text-sm font-medium text-slate-900">{item.title}</div>
                </Link>
              ))}
              {results.messages.map((item) => (
                <Link key={item.id} href={`/staff/chat?conversationId=${item.conversationId}`} className="block rounded px-3 py-2 transition-colors duration-100 hover:bg-slate-50" onClick={() => setOpen(false)}>
                  <div className="truncate text-sm font-medium text-slate-900">{item.contentText}</div>
                  <div className="text-xs text-muted">{item.sourceType}</div>
                </Link>
              ))}
            </SearchSection>
          ) : null}
          {!results.tickets.length && !results.knowledge.length && !results.conversations.length && !results.messages.length ? (
            <div className="px-3 py-6 text-center text-sm text-muted">没有找到匹配结果</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SearchSection(props: { title: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(props.children) ? props.children.length > 0 : Boolean(props.children);
  if (!hasChildren) {
    return null;
  }

  return (
    <div className="border-b border-border p-2 last:border-b-0">
      <div className="px-2 py-1 text-xs font-medium text-muted">{props.title}</div>
      {props.children}
    </div>
  );
}
