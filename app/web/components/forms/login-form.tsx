"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, EyeOff, Info, Lock, UserRound } from "lucide-react";

import { FIXED_USERS } from "@pharmacy/shared";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { roleLabel } from "@/lib/presentation";

export function LoginForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [username, setUsername] = useState(FIXED_USERS[0]?.username ?? "");
  const [password, setPassword] = useState(FIXED_USERS[0]?.password ?? "");
  const [demoExpanded, setDemoExpanded] = useState(false);

  async function handleSubmit() {
    setError("");

    startTransition(async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "登录失败");
        return;
      }

      router.push(data.redirectTo);
      router.refresh();
    });
  }

  return (
    <div className="w-full rounded-2xl border border-white/40 bg-white/80 p-8 shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl sm:p-10">
      <div>
        <h2 className="text-2xl font-semibold text-slate-950">欢迎登录</h2>
        <p className="mt-2 text-sm text-muted">您好，欢迎使用药店门店智能问答系统</p>
      </div>

      <form
        className="mt-8 flex flex-col gap-5"
        action={async () => {
          await handleSubmit();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="username">账号</Label>
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              id="username"
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入账号"
              className="pl-10"
              required
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">密码</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              className="pl-10 pr-10"
              required
            />
            <EyeOff className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        <RoleScrollHint
          onSelect={(u, p) => {
            setUsername(u);
            setPassword(p);
          }}
        />

        {error ? (
          <Alert className="border-destructive bg-red-50 text-destructive">{error}</Alert>
        ) : null}
        <Button className="w-full" disabled={pending}>
          {pending ? "登录中..." : "登录"}
        </Button>
      </form>

      <div className="mt-6">
        <button
          type="button"
          className={`flex w-full items-center justify-between border border-blue-100 bg-blue-50/60 px-5 py-4 text-left transition-colors hover:bg-blue-50 ${demoExpanded ? "rounded-t-xl border-b-0" : "rounded-xl"}`}
          onClick={() => setDemoExpanded((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <Info className="size-4 text-primary" />
            <span className="text-sm font-semibold text-slate-900">演示账号</span>
            <span className="text-xs text-muted">密码统一为 {FIXED_USERS[0]?.password}</span>
          </div>
          <ChevronDown
            className={`size-4 text-slate-400 transition-transform duration-200 ${demoExpanded ? "rotate-180" : ""}`}
          />
        </button>
        <div
          className={`grid rounded-b-xl border border-t-0 border-blue-100 transition-all duration-200 ${demoExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] border-0 opacity-0"}`}
        >
          <div className="overflow-hidden">
            <div>
              <div className="grid grid-cols-[1fr_1fr_1.5fr] gap-2 border-b border-blue-100 px-4 py-2.5 text-xs font-medium text-muted">
                <span>账号</span>
                <span>角色</span>
                <span>说明</span>
              </div>
              {FIXED_USERS.map((user) => (
                <button
                  key={user.username}
                  type="button"
                  className="grid w-full grid-cols-[1fr_1fr_1.5fr] gap-2 px-4 py-2.5 text-left text-xs transition-colors hover:bg-blue-50/50"
                  onClick={() => {
                    setUsername(user.username);
                    setPassword(user.password);
                  }}
                >
                  <span className="font-medium text-slate-900">{user.username}</span>
                  <span className="text-slate-600">{roleLabel(user.role)}</span>
                  <span className="text-muted">
                    {user.role === "staff" ? "门店日常问答使用账号" : "人工工单处理账号"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 内置角色选择区 —— 横向滚动，首次 hover 自动滚动提示 */
function RoleScrollHint(props: { onSelect: (username: string, password: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hintPlayed = useRef(false);
  const [scrollState, setScrollState] = useState<"both" | "left" | "right" | "none">("none");

  function updateScrollState() {
    const el = scrollRef.current;
    if (!el) return;
    const atStart = el.scrollLeft < 2;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    if (atStart && atEnd) setScrollState("none");
    else if (atStart) setScrollState("right");
    else if (atEnd) setScrollState("left");
    else setScrollState("both");
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    updateScrollState();

    function playHint() {
      if (hintPlayed.current) return;
      hintPlayed.current = true;
      const target = scrollRef.current;
      if (!target) return;
      const scrollable = target.scrollWidth > target.clientWidth;
      if (!scrollable) return;

      target.scrollTo({ left: 80, behavior: "smooth" });
      setTimeout(() => {
        target.scrollTo({ left: 0, behavior: "smooth" });
      }, 350);
    }

    el.addEventListener("scroll", updateScrollState, { passive: true });
    el.addEventListener("mouseenter", playHint, { once: true });
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      el.removeEventListener("mouseenter", playHint);
    };
  }, []);

  const showLeft = scrollState === "left" || scrollState === "both";
  const showRight = scrollState === "right" || scrollState === "both";

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
        内置角色说明
        <Info className="size-4 text-slate-400" />
      </div>
      <div className="relative mt-3">
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 transition-opacity duration-200"
          style={{
            background: "linear-gradient(to right, rgb(248 250 252), transparent)",
            opacity: showLeft ? 1 : 0,
          }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 transition-opacity duration-200"
          style={{
            background: "linear-gradient(to left, rgb(248 250 252), transparent)",
            opacity: showRight ? 1 : 0,
          }}
        />
        <div ref={scrollRef} className="overflow-x-auto px-1">
          <div className="flex gap-2" style={{ width: "max-content" }}>
            {FIXED_USERS.map((user) => (
              <button
                key={user.username}
                type="button"
                className="flex w-[120px] shrink-0 flex-col items-center rounded-lg border border-transparent p-3 text-center transition hover:border-blue-100 hover:bg-white"
                onClick={() => {
                  props.onSelect(user.username, user.password);
                }}
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-primary">
                  {user.displayName.slice(0, 1)}
                </span>
                <span className="mt-2 truncate text-xs font-medium text-slate-700">
                  {roleLabel(user.role)}
                </span>
                <span className="mt-1 text-[10px] text-muted">
                  {user.role === "staff" ? "门店日常问答" : "人工工单处理"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
