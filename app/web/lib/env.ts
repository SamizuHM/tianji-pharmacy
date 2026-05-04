import path from "node:path";

function stringEnv(key: string, fallback: string) {
  const value = process.env[key];
  return value && value.trim() ? value : fallback;
}

function numberEnv(key: string, fallback: number, options?: { integer?: boolean; min?: number; max?: number }) {
  const raw = process.env[key];
  const value = raw && raw.trim() ? Number(raw) : fallback;
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const normalized = options?.integer ? Math.trunc(value) : value;
  if (options?.min !== undefined && normalized < options.min) {
    return fallback;
  }
  if (options?.max !== undefined && normalized > options.max) {
    return fallback;
  }

  return normalized;
}

export const env = {
  DATABASE_URL: stringEnv("DATABASE_URL", "postgresql://tianji:tianji_password@127.0.0.1:5432/tianji_pharmacy?schema=public"),
  OPENAI_BASE_URL: stringEnv("OPENAI_BASE_URL", "http://127.0.0.1:9999/v1"),
  OPENAI_API_KEY: stringEnv("OPENAI_API_KEY", "demo-key"),
  OPENAI_MODEL: stringEnv("OPENAI_MODEL", "qwen3.5-27b"),
  RETRIEVAL_TOP_K: numberEnv("RETRIEVAL_TOP_K", 8, { integer: true, min: 1 }),
  RERANK_TOP_N: numberEnv("RERANK_TOP_N", 5, { integer: true, min: 1 }),
  KB_HIT_THRESHOLD: numberEnv("KB_HIT_THRESHOLD", 0.72, { min: 0, max: 1 }),
  MAX_CONTEXT_TURNS: numberEnv("MAX_CONTEXT_TURNS", 6, { integer: true, min: 1 }),
  UPLOAD_DIR: stringEnv("UPLOAD_DIR", "./uploads"),
  SERVICE_HOTLINE: stringEnv("SERVICE_HOTLINE", "027-xxxx"),
  QDRANT_URL: stringEnv("QDRANT_URL", "http://127.0.0.1:6333"),
  EMBEDDING_SERVICE_URL: stringEnv("EMBEDDING_SERVICE_URL", "http://127.0.0.1:8001/embed"),
  RERANK_SERVICE_URL: stringEnv("RERANK_SERVICE_URL", "http://127.0.0.1:8001/rerank"),
  ML_SERVICE_URL: stringEnv("ML_SERVICE_URL", "http://127.0.0.1:8001"),
  SESSION_TTL_HOURS: numberEnv("SESSION_TTL_HOURS", 72, { integer: true, min: 1 })
};

export const repoRoot =
  process.cwd().endsWith(path.join("app", "web")) ? path.resolve(process.cwd(), "..", "..") : process.cwd();

export const uploadDirAbsolute = path.isAbsolute(env.UPLOAD_DIR)
  ? env.UPLOAD_DIR
  : path.resolve(repoRoot, env.UPLOAD_DIR.replace(/^\.\//, ""));
