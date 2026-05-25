import fs from "node:fs";

import { mlDir, run, venvPythonPath } from "./dev-utils";

async function main() {
  const python = venvPythonPath();

  if (!fs.existsSync(python)) {
    await run("python3", ["-m", "venv", ".venv"], { cwd: mlDir }).catch(async (error) => {
      if (process.platform === "win32") {
        await run("python", ["-m", "venv", ".venv"], { cwd: mlDir });
        return;
      }
      throw error;
    });
  }

  await run(python, ["-m", "pip", "install", "-r", "requirements.txt"], { cwd: mlDir });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
