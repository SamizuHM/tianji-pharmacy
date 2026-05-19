import "dotenv/config";

const required = [
  "DATABASE_URL",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "QDRANT_URL",
  "EMBEDDING_SERVICE_URL",
  "RERANK_SERVICE_URL",
  "ML_SERVICE_URL",
];

const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`缺少环境变量：${missing.join(", ")}`);
  process.exit(1);
}

console.log("环境变量检查通过。");
