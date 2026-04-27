import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).default("file:./dev.db"),
  OPENAI_BASE_URL: z.string().min(1).default("http://127.0.0.1:9999/v1"),
  OPENAI_API_KEY: z.string().min(1).default("demo-key"),
  OPENAI_MODEL: z.string().min(1).default("qwen3.5-27b"),
  RETRIEVAL_TOP_K: z.coerce.number().int().min(1).default(8),
  RERANK_TOP_N: z.coerce.number().int().min(1).default(5),
  KB_HIT_THRESHOLD: z.coerce.number().min(0).max(1).default(0.72),
  MAX_CONTEXT_TURNS: z.coerce.number().int().min(1).default(6),
  UPLOAD_DIR: z.string().default("./uploads"),
  SERVICE_HOTLINE: z.string().default("027-xxxx"),
  QDRANT_URL: z.string().min(1).default("http://127.0.0.1:6333"),
  EMBEDDING_SERVICE_URL: z.string().min(1).default("http://127.0.0.1:8001/embed"),
  RERANK_SERVICE_URL: z.string().min(1).default("http://127.0.0.1:8001/rerank"),
  ML_SERVICE_URL: z.string().min(1).default("http://127.0.0.1:8001"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(72)
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL ?? "file:./dev.db",
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? "http://127.0.0.1:9999/v1",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "demo-key",
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "qwen3.5-27b",
  RETRIEVAL_TOP_K: process.env.RETRIEVAL_TOP_K,
  RERANK_TOP_N: process.env.RERANK_TOP_N,
  KB_HIT_THRESHOLD: process.env.KB_HIT_THRESHOLD,
  MAX_CONTEXT_TURNS: process.env.MAX_CONTEXT_TURNS,
  UPLOAD_DIR: process.env.UPLOAD_DIR,
  SERVICE_HOTLINE: process.env.SERVICE_HOTLINE,
  QDRANT_URL: process.env.QDRANT_URL ?? "http://127.0.0.1:6333",
  EMBEDDING_SERVICE_URL: process.env.EMBEDDING_SERVICE_URL ?? "http://127.0.0.1:8001/embed",
  RERANK_SERVICE_URL: process.env.RERANK_SERVICE_URL ?? "http://127.0.0.1:8001/rerank",
  ML_SERVICE_URL: process.env.ML_SERVICE_URL ?? "http://127.0.0.1:8001",
  SESSION_TTL_HOURS: process.env.SESSION_TTL_HOURS
});

export const repoRoot =
  process.cwd().endsWith(path.join("app", "web")) ? path.resolve(process.cwd(), "..", "..") : process.cwd();

export const uploadDirAbsolute = path.isAbsolute(env.UPLOAD_DIR)
  ? env.UPLOAD_DIR
  : path.resolve(repoRoot, env.UPLOAD_DIR.replace(/^\.\//, ""));
