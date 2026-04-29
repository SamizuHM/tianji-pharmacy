#!/usr/bin/env bash
set -euo pipefail

ML_DIR="app/ml-service"
VENV_PY="$ML_DIR/.venv/bin/python"
SYSTEM_PY="$(command -v python3 || true)"

# 本地开发时，web 由 Next 自动加载 .env；ml-service 需要手动导入。
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

if [ -x "$VENV_PY" ]; then
  PYTHON_BIN="$VENV_PY"
else
  if [ -z "$SYSTEM_PY" ]; then
    echo "未找到 python3，请先安装 Python 3。"
    exit 1
  fi
  PYTHON_BIN="$SYSTEM_PY"
fi

if ! "$PYTHON_BIN" -c "import uvicorn" >/dev/null 2>&1; then
  echo "当前 Python 环境缺少 uvicorn。"
  echo "请执行：$PYTHON_BIN -m pip install -r $ML_DIR/requirements.txt"
  exit 1
fi

if [ -z "${DASHSCOPE_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "未检测到 DASHSCOPE_API_KEY 或 OPENAI_API_KEY，无法调用多模态 Embedding/Rerank。"
  echo "请先在项目根目录 .env 中配置至少一个 key。"
  exit 1
fi

exec "$PYTHON_BIN" -m uvicorn app.main:app \
  --reload \
  --reload-dir "$ML_DIR/app" \
  --host 0.0.0.0 \
  --port 8001 \
  --app-dir "$ML_DIR"
