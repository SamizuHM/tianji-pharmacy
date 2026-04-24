#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "已根据 .env.example 生成 .env，请先补充模型配置后继续。"
fi

pnpm install
pnpm db:generate
pnpm db:push
pnpm db:seed

mkdir -p uploads

echo "基础初始化完成。"
echo "下一步："
echo "1. docker compose up -d qdrant"
echo "2. 在 app/ml-service 下安装 requirements.txt"
echo "3. 启动 Python 服务和 Next.js"
echo "4. 执行 pnpm kb:import 导入知识库"

