# 药店门店智能问答 Web Demo

基于 `Next.js + Prisma + SQLite + FastAPI + Qdrant` 的最小可运行 Demo。  
支持：

- 固定 3 角色登录
- 纯文字 / 纯图片 / 图文混合提问
- 先检索知识库，未命中再走大模型兜底
- 一键转人工工单
- 人工1回复、升级人工2、关闭工单
- 关闭工单后真实写回知识库并立即可检索
- 统计指标、历史问答、历史工单、近 7 天趋势
- 从 `seed_knowledge/` 和根目录 Word 文档导入知识

## 目录结构

```text
tianji-pharmacy/
├─ app/
│  ├─ web/                  # Next.js 主应用
│  └─ ml-service/           # FastAPI embedding / rerank / 文档解析服务
├─ packages/shared/         # 共享类型与固定常量
├─ prisma/                  # Prisma schema 与 seed
├─ scripts/                 # 初始化、环境检查、知识导入
├─ seed_knowledge/          # 初始文本知识
├─ uploads/                 # 本地附件与知识图片抽取
├─ 药店门店智能问答轻量级知识库.docx
├─ 信息部常见问题详解.doc
├─ docker-compose.yml
├─ .env.example
└─ README.md
```

## 技术选型

- 前端与业务 API：Next.js App Router + TypeScript + Tailwind + 轻量 shadcn/ui 风格组件
- 业务数据库：SQLite + Prisma ORM
- 向量库：Qdrant
- 模型接入：
  - 多模态问答与图片理解：OpenAI-compatible `Qwen3.5`
  - Embedding：`BAAI/bge-m3`
  - Rerank：`BAAI/bge-reranker-v2-m3`

## 环境要求

- Node.js 20+
- pnpm 10+
- Python 3.11 或 3.12
- Docker / Docker Compose

说明：

- 当前机器安装的是 Python 3.14，但大多数本地推理依赖对 3.14 支持并不稳定。
- 建议给 `app/ml-service` 单独创建 Python 3.11 虚拟环境。

## 环境变量

先复制：

```bash
cp .env.example .env
```

然后至少配置以下变量：

```env
DATABASE_URL="file:./dev.db"
OPENAI_BASE_URL="https://your-openai-compatible-endpoint/v1"
OPENAI_API_KEY="your_api_key"
OPENAI_MODEL="qwen3.5-vl"
RETRIEVAL_TOP_K="8"
RERANK_TOP_N="5"
KB_HIT_THRESHOLD="0.72"
MAX_CONTEXT_TURNS="6"
UPLOAD_DIR="./uploads"
QDRANT_URL="http://127.0.0.1:6333"
EMBEDDING_SERVICE_URL="http://127.0.0.1:8001/embed"
RERANK_SERVICE_URL="http://127.0.0.1:8001/rerank"
ML_SERVICE_URL="http://127.0.0.1:8001"
SESSION_TTL_HOURS="72"
```

## 一键初始化

```bash
bash scripts/init.sh
```

它会完成：

- 安装 pnpm 依赖
- Prisma generate
- SQLite 建表
- 固定账号 seed
- 创建 `uploads/`

## 启动顺序

### 1. 启动 Qdrant

```bash
docker compose up -d qdrant
```

### 2. 启动 Python FastAPI 服务

推荐在 `app/ml-service` 下单独创建虚拟环境：

```bash
cd app/ml-service
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

首次启动时，`bge-m3` 与 `bge-reranker-v2-m3` 会自动下载，速度取决于网络环境。

### 3. 启动 Next.js

回到仓库根目录：

```bash
pnpm dev:web
```

也可以同时启动：

```bash
pnpm dev
```

## 导入种子知识

导入范围包括：

- `seed_knowledge/` 目录下的 `.txt/.md/.docx/.doc/.pdf/.png/.jpg/.jpeg/.webp`
- 仓库根目录下的：
  - `药店门店智能问答轻量级知识库.docx`
  - `信息部常见问题详解.doc`

执行导入：

```bash
pnpm kb:import
```

或者登录后打开：

- `/admin/knowledge`

点击“导入 seed_knowledge 与参考 Word 文档”。

## 关于你提供的两个 Word 文档

当前项目已经把以下两个文件纳入导入源：

- `药店门店智能问答轻量级知识库.docx`
- `信息部常见问题详解.doc`

导入策略：

- 会优先抽取其中的“具体问题 / 简要标准答案”结构
- 若文档里存在图片，会尝试抽取图片并保存到 `uploads/knowledge-assets/`
- 对图片文件本身，会调用 `Qwen3.5` 生成结构化索引文本
- 对旧版 `.doc`，优先尝试 `LibreOffice/soffice` 转换为 `docx`；若本机未安装，会回退 `antiword` 或 `catdoc`

建议：

- 为保证 `信息部常见问题详解.doc` 能稳定解析，安装 `LibreOffice` 最稳

## 登录账号

固定账号如下，密码均为 `demo123`：

- 药店工作人员
- 人工处理1
- 人工处理2

## 本地访问页面

- 登录页：`/login`
- 药店工作人员聊天页：`/staff/chat`
- 药店工作人员工单页：`/staff/tickets`
- 人工1工单页：`/l1/tickets`
- 人工2工单页：`/l2/tickets`
- 统计页：`/admin/stats`
- 知识库管理页：`/admin/knowledge`

## 验证路径

### 场景 1：纯文字命中知识库

用“药店工作人员”登录，在聊天页输入：

```text
医保结算页面提示未获取到医保结算参数怎么办？
```

预期：

- 返回来源标签为“知识库”
- 展示标准答案
- Debug 可看到命中来源

### 场景 2：未命中走大模型

输入一个知识库没有覆盖的问题，例如：

```text
店里电脑今天开机后时间总是慢十分钟怎么办？
```

预期：

- 返回来源标签为“大模型”
- 以“以下为通用建议：”开头
- 结尾追加固定提示

### 场景 3：图文混合输入

- 上传一张门店界面截图
- 同时补一句文字说明

预期：

- 系统能完成图片上传
- 检索 query 会结合图片和文字
- 正常进入知识检索或 LLM 兜底

### 场景 4：点击人工服务生成工单

预期：

- 自动生成工单
- 默认进入人工处理1列表

### 场景 5：人工1直接关闭

- 切换“人工处理1”
- 进入工单详情
- 回复处理结论并关闭

预期：

- 工单状态变为 `closed`
- 关闭系统消息写入时间线

### 场景 6：关闭后知识回写

预期：

- `/admin/knowledge` 能看到一条 `manual_ticket` 知识
- Qdrant 已新增向量点

### 场景 7：再次提问命中新知识

对相似问题重新提问，预期命中刚写回的知识。

### 场景 8：人工1升级给人工2

- 用新工单
- 人工1点击“升级到人工处理2”
- 切换人工2关闭工单

预期：

- 工单出现在人工2列表
- 统计页人工2处理数增加

### 场景 9：统计页查看汇总

进入 `/admin/stats`，预期看到：

- 指标卡片
- 历史问答表
- 历史工单表
- 最近 7 天趋势图

## 常用命令

```bash
pnpm install
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm check:env
pnpm kb:import
pnpm dev:web
pnpm dev:ml
pnpm dev
```

## 常见问题

### 1. `信息部常见问题详解.doc` 无法导入

原因通常是本机没有安装能处理旧版 `.doc` 的工具。  
建议安装 `LibreOffice`，确保命令行可用 `soffice` 或 `libreoffice`。

### 2. Python 模型下载很慢

首次加载 `bge-m3` 和 reranker 会下载模型文件，可提前配置镜像或手工缓存。

### 3. Qdrant 启动了但检索报错

先确认：

```bash
curl http://127.0.0.1:6333/collections
```

### 4. OpenAI-compatible Qwen 接口未配置

多模态图片解析、检索改写和 LLM 兜底都会失败。  
等你配置好后，我再继续做完整联调与功能验收。
