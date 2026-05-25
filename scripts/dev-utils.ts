import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export const repoRoot = process.cwd().endsWith(path.sep + "app" + path.sep + "web")
  ? path.resolve(process.cwd(), "..", "..")
  : process.cwd();
export const mlDir = path.join(repoRoot, "app", "ml-service");
export const isWindows = process.platform === "win32";

export function venvPythonPath() {
  return path.join(mlDir, ".venv", isWindows ? "Scripts/python.exe" : "bin/python");
}

export function venvToolPath(tool: string) {
  const executable = isWindows ? `${tool}.exe` : tool;
  return path.join(mlDir, ".venv", isWindows ? "Scripts" : "bin", executable);
}

export function loadDotEnv() {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  }
}

export function run(
  command: string,
  args: string[] = [],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
      shell: isWindows,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

export function hasCommand(command: string) {
  const probe = isWindows ? "where" : "sh";
  const args = isWindows ? [command] : ["-c", `command -v ${command}`];
  return new Promise<boolean>((resolve) => {
    const child = spawn(probe, args, { stdio: "ignore", shell: isWindows });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

export function getRequiredEnv(keys: string[]) {
  return keys.filter((key) => !process.env[key]?.trim());
}

export function hasPlaceholderEnv(keys: string[]) {
  return keys.filter((key) => {
    const value = process.env[key]?.trim() ?? "";
    return /your_|change_me|demo-key/i.test(value);
  });
}

export async function waitForTcp(input: {
  host: string;
  port: number;
  label: string;
  timeoutMs?: number;
  hint?: string;
}) {
  const timeoutMs = input.timeoutMs ?? 30000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await canConnectTcp(input.host, input.port)) {
      return;
    }
    await sleep(1000);
  }

  const hint = input.hint ? `\n${input.hint}` : "";
  throw new Error(
    `${input.label} 未就绪，${Math.round(timeoutMs / 1000)} 秒内无法连接 ${input.host}:${input.port}。${hint}`
  );
}

export async function waitForHttp(url: string, label: string, timeoutMs = 30000, hint?: string) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // 服务尚未就绪，继续等待。
    }
    await sleep(1000);
  }

  const resolvedHint = hint ? `\n${hint}` : "";
  throw new Error(
    `${label} 未就绪，${Math.round(timeoutMs / 1000)} 秒内无法访问 ${url}。${resolvedHint}`
  );
}

function canConnectTcp(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(1500);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseUrl(value: string, fallbackHost: string, fallbackPort: number) {
  try {
    const url = new URL(value);
    return {
      host: url.hostname || fallbackHost,
      port: Number(url.port) || fallbackPort,
    };
  } catch {
    return { host: fallbackHost, port: fallbackPort };
  }
}
