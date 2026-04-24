import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "药店门店智能问答 Demo",
  description: "支持知识库检索、多模态问答、人工工单流转与知识回写的本地演示项目。"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

