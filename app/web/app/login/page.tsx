import { redirect } from "next/navigation";

import { LoginForm } from "@/components/forms/login-form";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHome } from "@/lib/auth/session";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect(roleHome(user.role));
  }

  return (
    <main className="page-shell items-center justify-center">
      <div className="mb-8 max-w-2xl text-center">
        <h1 className="text-5xl">药店门店智能问答 Web Demo</h1>
        <p className="mt-4 text-base text-muted">
          最小可运行版本，支持知识库检索、多模态输入、转人工工单、工单闭环后知识回写与统计看板。
        </p>
      </div>
      <LoginForm />
    </main>
  );
}

