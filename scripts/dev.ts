import fs from "node:fs";
import path from "node:path";

import {
  getRequiredEnv,
  hasPlaceholderEnv,
  loadDotEnv,
  parseUrl,
  repoRoot,
  run,
  venvPythonPath,
  waitForHttp,
  waitForTcp,
} from "./dev-utils";

async function main() {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error("未找到 .env。请先执行：pnpm dev:init");
  }

  loadDotEnv();

  const missing = getRequiredEnv([
    "DATABASE_URL",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "QDRANT_URL",
    "EMBEDDING_SERVICE_URL",
    "RERANK_SERVICE_URL",
    "ML_SERVICE_URL",
  ]);
  if (missing.length) {
    throw new Error(`缺少环境变量：${missing.join(", ")}。请检查 .env 或执行 pnpm dev:init。`);
  }

  if (!process.env.OPENAI_API_KEY?.trim() && !process.env.DASHSCOPE_API_KEY?.trim()) {
    throw new Error("缺少 OPENAI_API_KEY 或 DASHSCOPE_API_KEY。请检查 .env。");
  }

  const placeholders = hasPlaceholderEnv(["OPENAI_BASE_URL", "OPENAI_API_KEY"]);
  if (placeholders.length) {
    console.warn(`模型配置仍像占位值，请确认 .env：${placeholders.join(", ")}`);
  }

  if (!fs.existsSync(venvPythonPath())) {
    throw new Error("未找到 ML Python 虚拟环境。请先执行：pnpm ml:install");
  }

  const database = parseUrl(process.env.DATABASE_URL!, "127.0.0.1", 5432);
  await waitForTcp({
    ...database,
    label: "PostgreSQL",
    timeoutMs: 5000,
    hint:
      "如果只是关闭了本地 Docker 依赖，请先执行：pnpm dev:deps，以启动 Docker 容器中的 PostgreSQL 服务。\n" +
      "如果是首次运行，请先执行：pnpm dev:init，以创建数据库、安装依赖并准备环境配置。",
  });
  await waitForHttp(
    `${process.env.QDRANT_URL!.replace(/\/$/, "")}/collections`,
    "Qdrant",
    5000,
    "如果只是关闭了本地 Docker 依赖，请先执行：pnpm dev:deps，以启动 Docker 容器中的 Qdrant 服务。\n" +
      "如果是首次运行，请先执行：pnpm dev:init，以创建数据库、安装依赖并准备环境配置。"
  );

  await run("pnpm", ["db:migrate"]);
  await run("concurrently", ["-n", "web,ml", "-c", "blue,green", "pnpm dev:web", "pnpm dev:ml"]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
