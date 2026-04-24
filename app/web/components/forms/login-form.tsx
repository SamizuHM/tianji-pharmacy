"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  async function handleSubmit(formData: FormData) {
    setError("");

    const payload = {
      username: String(formData.get("username") || ""),
      password: String(formData.get("password") || "")
    };

    startTransition(async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
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
    <Card className="w-full max-w-xl overflow-hidden">
      <CardHeader className="bg-secondary/60">
        <CardTitle className="text-3xl">登录 Demo</CardTitle>
        <p className="mt-2 text-sm text-muted">固定账号：药店工作人员 / 人工处理1 / 人工处理2，密码均为 demo123</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="space-y-5"
          action={async (formData) => {
            await handleSubmit(formData);
          }}
        >
          <div>
            <Label htmlFor="username">用户名</Label>
            <Input id="username" name="username" placeholder="请输入固定账号名称" defaultValue="药店工作人员" />
          </div>
          <div>
            <Label htmlFor="password">密码</Label>
            <Input id="password" name="password" type="password" placeholder="请输入密码" defaultValue="demo123" />
          </div>
          {error ? <Alert className="border-destructive bg-destructive/10 text-destructive">{error}</Alert> : null}
          <Button className="w-full" disabled={pending}>
            {pending ? "登录中..." : "登录"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

