import { redirect } from "next/navigation";
import { BarChart3, BookOpen, Bot, ShieldCheck } from "lucide-react";

import { LoginForm } from "@/components/forms/login-form";
import { ParticlesBackground } from "@/components/login/particles-background";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHome } from "@/lib/auth/session";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect(roleHome(user.role));
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#faf8ff_0%,#e8eeff_100%)] text-slate-900">
      <ParticlesBackground />
      <div className="relative z-10 flex w-full max-w-[1200px]">
        <section className="hidden flex-1 flex-col justify-between overflow-hidden px-16 py-12 lg:flex">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-blue-100 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <span className="text-lg font-semibold">药店门店智能问答</span>
          </div>
          <div className="relative z-10 my-auto max-w-xl">
            <h1 className="text-4xl font-bold tracking-normal text-slate-950">药店门店智能问答</h1>
            <h2 className="mt-3 text-2xl font-medium text-primary">智能赋能 · 专业高效</h2>
            <div className="mt-12 flex flex-col gap-8">
              {[
                { icon: Bot, title: "AI 智能问答", text: "基于知识库的智能问答，快速精准解答门店业务问题" },
                { icon: BookOpen, title: "知识统一管理", text: "知识集中沉淀与管理，保障信息准确与一致" },
                { icon: BarChart3, title: "数据驱动决策", text: "多维度统计分析，洞察业务趋势，助力科学决策" },
                { icon: ShieldCheck, title: "安全合规可靠", text: "企业级安全防护与权限管控，确保数据安全合规" }
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="flex items-start gap-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-blue-50 bg-white text-primary shadow-sm">
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>
                      <p className="mt-1 text-sm text-muted">{item.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="text-xs text-muted">© 2025 智慧医药科技 V1.0.0</div>
        </section>
        <section className="flex w-full shrink-0 items-start justify-center overflow-y-auto p-6 lg:h-screen lg:w-[540px] xl:w-[600px]">
          <div className="my-auto w-full">
            <LoginForm />
          </div>
        </section>
      </div>
    </main>
  );
}
