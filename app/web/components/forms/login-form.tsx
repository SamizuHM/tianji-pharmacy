"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Info, Lock, UserRound } from "lucide-react";

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

  async function handleSubmit() {
    setError("");

    startTransition(async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ username, password })
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
    <div className="w-full rounded-2xl border border-slate-100 bg-white p-8 shadow-[0_8px_30px_rgba(15,23,42,0.06)] sm:p-10">
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

        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
            内置角色说明
            <Info className="size-4 text-slate-400" />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {FIXED_USERS.map((user) => (
              <button
                key={user.username}
                type="button"
                className="flex flex-col items-center rounded-lg border border-transparent p-2 text-center transition hover:border-blue-100 hover:bg-white"
                onClick={() => {
                  setUsername(user.username);
                  setPassword(user.password);
                }}
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-primary">
                  {user.displayName.slice(0, 1)}
                </span>
                <span className="mt-2 text-xs font-medium text-slate-700">{roleLabel(user.role)}</span>
                <span className="mt-1 text-[10px] text-muted">
                  {user.role === "staff" ? "门店日常问答" : "人工工单处理"}
                </span>
              </button>
            ))}
          </div>
        </div>

        {error ? <Alert className="border-destructive bg-red-50 text-destructive">{error}</Alert> : null}
        <Button className="w-full" disabled={pending}>
          {pending ? "登录中..." : "登录"}
        </Button>
      </form>

      <div className="mt-8 rounded-xl border border-blue-100 bg-blue-50/60 p-5">
        <div className="text-sm font-semibold text-slate-900">演示账号</div>
        <p className="mt-2 text-xs text-muted">
          密码统一为：<span className="font-mono text-primary">{FIXED_USERS[0]?.password}</span>
        </p>
        <table className="mt-3 w-full text-left text-xs">
          <thead className="border-b border-blue-100 text-muted">
            <tr>
              <th className="py-2 font-medium">账号</th>
              <th className="py-2 font-medium">角色</th>
              <th className="py-2 font-medium">说明</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-blue-100/70">
            {FIXED_USERS.map((user) => (
              <tr key={user.username}>
                <td className="py-2 font-medium text-slate-900">{user.username}</td>
                <td className="py-2">{roleLabel(user.role)}</td>
                <td className="py-2 text-muted">{user.role === "staff" ? "门店日常问答使用账号" : "人工工单处理账号"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
