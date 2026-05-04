#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "已根据 .env.example 生成 .env，请先补充模型配置后继续。"
fi

if grep -q 'DATABASE_URL="file:' .env 2>/dev/null || grep -q "DATABASE_URL='file:" .env 2>/dev/null; then
  echo "检测到 .env 仍在使用 SQLite DATABASE_URL。"
  echo "请改为 PostgreSQL，例如：DATABASE_URL=\"postgresql://tianji:tianji_password@127.0.0.1:5432/tianji_pharmacy?schema=public\""
  exit 1
fi

pnpm install
pnpm db:generate
docker compose up -d postgres qdrant
pnpm db:migrate
pnpm db:seed

mkdir -p uploads

echo "基础初始化完成。"
echo "下一步："
echo "1. 在 app/ml-service 下安装 requirements.txt"
echo "2. 启动 Python 服务和 Next.js"
echo "3. 执行 pnpm kb:import 导入知识库"
