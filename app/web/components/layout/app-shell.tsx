import Link from "next/link";

import { UserRole } from "@prisma/client";
import { BarChart3, BookOpen, MessageCircle, Tickets, UserRoundCog } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const navByRole: Record<UserRole, Array<{ href: string; label: string; icon: typeof MessageCircle }>> = {
  staff: [
    { href: "/staff/chat", label: "智能问答", icon: MessageCircle },
    { href: "/staff/tickets", label: "我的工单", icon: Tickets },
    { href: "/admin/stats", label: "统计看板", icon: BarChart3 },
    { href: "/admin/knowledge", label: "知识库管理", icon: BookOpen }
  ],
  human_l1: [
    { href: "/l1/tickets", label: "人工1工单", icon: Tickets },
    { href: "/admin/stats", label: "统计看板", icon: BarChart3 },
    { href: "/admin/knowledge", label: "知识库管理", icon: BookOpen }
  ],
  human_l2: [
    { href: "/l2/tickets", label: "人工2工单", icon: Tickets },
    { href: "/admin/stats", label: "统计看板", icon: BarChart3 },
    { href: "/admin/knowledge", label: "知识库管理", icon: BookOpen }
  ]
};

export function AppShell(props: {
  role: UserRole;
  displayName: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="page-shell md:flex-row md:gap-6">
      <aside className="panel mb-4 flex w-full flex-col gap-4 p-4 md:sticky md:top-6 md:mb-0 md:h-[calc(100vh-3rem)] md:w-72">
        <div className="space-y-2">
          <Badge className="bg-primary/10 text-primary">药店门店智能问答 Demo</Badge>
          <h1 className="text-2xl">{props.displayName}</h1>
          <p className="text-sm text-muted">角色：{roleLabel(props.role)}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-2">
          {navByRole[props.role].map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition hover:bg-secondary"
              >
                <Icon className="h-4 w-4" />
                {item.label}
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

