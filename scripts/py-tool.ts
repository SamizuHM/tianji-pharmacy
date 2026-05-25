import fs from "node:fs";

import { mlDir, run, venvToolPath } from "./dev-utils";

async function main() {
  const [tool, ...args] = process.argv.slice(2);
  if (!tool) {
    throw new Error("缺少 Python 工具名，例如：pnpm lint:py");
  }

  const executable = venvToolPath(tool);
  if (!fs.existsSync(executable)) {
    throw new Error(`未找到 ${tool}。请先执行：pnpm ml:install`);
  }

  await run(executable, args, { cwd: mlDir });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
