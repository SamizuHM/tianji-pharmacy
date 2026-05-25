import fs from "node:fs";

import { getRequiredEnv, loadDotEnv, mlDir, repoRoot, run, venvPythonPath } from "./dev-utils";

async function main() {
  loadDotEnv();

  const python = venvPythonPath();
  if (!fs.existsSync(python)) {
    throw new Error("未找到 ML Python 虚拟环境。请先执行：pnpm ml:install");
  }

  const missingKeys = getRequiredEnv(["OPENAI_API_KEY"]);
  if (missingKeys.length && !process.env.DASHSCOPE_API_KEY?.trim()) {
    throw new Error(
      "未检测到 OPENAI_API_KEY 或 DASHSCOPE_API_KEY，请先在 .env 中配置模型 API key。"
    );
  }

  await run(python, ["-c", "import uvicorn"], { cwd: mlDir }).catch(() => {
    throw new Error("当前 Python 虚拟环境缺少 uvicorn。请执行：pnpm ml:install");
  });

  await run(
    python,
    [
      "-m",
      "uvicorn",
      "app.main:app",
      "--reload",
      "--reload-dir",
      "app/ml-service/app",
      "--host",
      "0.0.0.0",
      "--port",
      "8001",
      "--app-dir",
      "app/ml-service",
    ],
    { cwd: repoRoot }
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
