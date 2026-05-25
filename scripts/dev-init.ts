import fs from "node:fs";
import path from "node:path";

import {
  hasCommand,
  hasPlaceholderEnv,
  loadDotEnv,
  parseUrl,
  repoRoot,
  run,
  waitForHttp,
  waitForTcp,
} from "./dev-utils";

async function main() {
  await requireCommand("pnpm");
  await requireCommand("docker");

  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(path.join(repoRoot, ".env.example"), envPath);
    console.log("已根据 .env.example 生成 .env。");
  }

  loadDotEnv();
  guardPostgresUrl();

  await run("pnpm", ["install"]);
  await run("pnpm", ["db:generate"]);
  await run("pnpm", ["ml:install"]);
  await run("pnpm", ["dev:deps"]);

  const database = parseUrl(
    process.env.DATABASE_URL ?? "postgresql://127.0.0.1:5432",
    "127.0.0.1",
    5432
  );
  const qdrant = process.env.QDRANT_URL ?? "http://127.0.0.1:6333";

  await waitForTcp({ ...database, label: "PostgreSQL" });
  await waitForHttp(`${qdrant.replace(/\/$/, "")}/collections`, "Qdrant");

  await run("pnpm", ["db:migrate"]);
  await run("pnpm", ["db:seed"]);

  fs.mkdirSync(path.join(repoRoot, "uploads"), { recursive: true });

  const placeholders = hasPlaceholderEnv(["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"]);
  if (placeholders.length) {
    console.log(`请在 .env 中确认模型配置：${placeholders.join(", ")}`);
  }

  console.log("基础初始化完成。下一步执行：pnpm dev");
  console.log("如需导入种子知识库，可执行：pnpm kb:import");
}

function guardPostgresUrl() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (databaseUrl.startsWith("file:")) {
    throw new Error(
      '检测到 .env 仍在使用 SQLite DATABASE_URL。请改为 PostgreSQL，例如：DATABASE_URL="postgresql://tianji:tianji_password@127.0.0.1:5432/tianji_pharmacy?schema=public"'
    );
  }
}

async function requireCommand(command: string) {
  if (!(await hasCommand(command))) {
    throw new Error(`未找到 ${command}，请先安装后再执行 pnpm dev:init。`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
