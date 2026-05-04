# 药店门店智能问答 Web Demo

基于 `Next.js + Prisma + PostgreSQL + FastAPI + Qdrant` 的最小可运行 Demo。  
支持：

- 固定 3 角色登录
- 纯文字 / 纯图片 / 图文混合提问
- 先检索知识库，未命中再走大模型兜底
- 检索阶段与最终回答阶段都支持多模态图片输入
- 聊天回答以流式打字机效果输出
- 一键转人工工单
- 人工1 / 人工2 实时待办提醒与浏览器通知
- 人工1回复、升级人工2、关闭工单
- 关闭工单后真实写回知识库并立即可检索
- 历史会话支持软删除
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
- 业务数据库：PostgreSQL + Prisma ORM
- 向量库：Qdrant
- 模型接入：
  - 多模态问答与图片理解：OpenAI-compatible `qwen3.5-27b`
  - Embedding：DashScope 多模态 `qwen3-vl-embedding`
  - Rerank：DashScope 多模态 `qwen3-vl-rerank`

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
POSTGRES_DB="tianji_pharmacy"
POSTGRES_USER="tianji"
POSTGRES_PASSWORD="change_me_strong_password"
DATABASE_URL="postgresql://tianji:change_me_strong_password@127.0.0.1:5432/tianji_pharmacy?schema=public"
OPENAI_BASE_URL="https://your-openai-compatible-endpoint/v1"
OPENAI_API_KEY="your_api_key"
OPENAI_MODEL="qwen3.5-27b"
RETRIEVAL_TOP_K="8"
RERANK_TOP_N="5"
KB_HIT_THRESHOLD="0.72"
MAX_CONTEXT_TURNS="6"
UPLOAD_DIR="./uploads"
SERVICE_HOTLINE="027-xxxx"
QDRANT_URL="http://127.0.0.1:6333"
EMBEDDING_SERVICE_URL="http://127.0.0.1:8001/embed"
RERANK_SERVICE_URL="http://127.0.0.1:8001/rerank"
ML_SERVICE_URL="http://127.0.0.1:8001"
SESSION_TTL_HOURS="72"
```

说明：

- 上面这组地址是给 `pnpm dev` 本地联调用的（`127.0.0.1`）。
- Docker 方式启动时，容器内地址由 `docker-compose.yml` 注入（例如 `qdrant:6333`、`ml-service:8001`），不依赖这些本机回环地址。

## 一键初始化

```bash
bash scripts/init.sh
```

它会完成：

- 安装 pnpm 依赖
- Prisma generate
- 执行 Prisma migration
- 固定账号 seed
- 创建 `uploads/`

## 启动方式

本项目支持两种启动方式：

1. `pnpm dev`（本地开发模式）
2. `docker compose up -d --build`（容器部署模式）

### 两种方式区别

| 对比项 | `pnpm dev` 本地开发 | `docker compose up -d --build` 容器部署 |
|---|---|---|
| 进程位置 | Web/ML 在宿主机进程运行 | Web/ML/PostgreSQL/Qdrant/cloudflared 全在容器内 |
| 配置来源 | 根目录 `.env` 由脚本/框架加载 | `docker-compose.yml` 注入容器环境变量 |
| 服务互联地址 | `127.0.0.1` | 服务名（`postgres`、`qdrant`、`ml-service`、`web`） |
| 端口暴露 | 本地直接监听 `3000/8001` | 仅容器内 `expose`，通过 `cloudflared` 对外 |
| 数据落盘 | 本地 PostgreSQL + 本地 `uploads/` | `postgres_data` / `uploads_data` / `qdrant_storage` volume |
| 适用场景 | 开发调试、看日志、改代码热更新 | 稳定运行、隔离部署、对外发布 |

### 方式一：`pnpm dev`（推荐开发时使用）

1. 安装依赖并初始化：

```bash
bash scripts/init.sh
```

2. 确认本地依赖服务已启动（初始化脚本会自动启动 PostgreSQL 和 Qdrant）：

```bash
docker compose up -d postgres qdrant
```

3. 首次开发时准备 `ml-service` Python 环境：

```bash
cd app/ml-service
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ../..
```

4. 启动开发模式（会自动 `db:migrate`，并并发启动 Web + ML）：

```bash
pnpm dev
```

说明：

- `dev:ml` 会优先使用 `app/ml-service/.venv`，并自动加载根目录 `.env`。
- 若 Python 环境缺依赖，会给出明确安装命令（`pip install -r app/ml-service/requirements.txt`）。

### 方式二：`docker compose up -d --build`（部署时使用）

1. 先配置根目录 `.env` 至少这些字段：

```env
OPENAI_BASE_URL=...
OPENAI_API_KEY=...
OPENAI_MODEL=qwen3.5-27b
CF_TUNNEL_TOKEN=...
```

2. 启动容器：

```bash
docker compose up -d --build
```

3. 查看状态与日志：

```bash
docker compose ps
docker compose logs -f web
docker compose logs -f ml-service
```

注意：

- 当前 compose 设计是内部通信优先：`qdrant`、`ml-service` 不暴露宿主机端口。
- 对外访问通过 `cloudflared` 隧道转发到 `web:3000`。
- 首次启动容器会初始化数据库与 seed，后续重启不会重复导入知识。
- 如果你更关注首次启动速度，可以在 `.env` 中设置 `AUTO_IMPORT_KNOWLEDGE_ON_FIRST_BOOT=false`，启动后再手动执行知识导入。

### 本地健康检查（`pnpm dev`）

```bash
curl http://127.0.0.1:8001/health
curl http://127.0.0.1:6333/collections
curl -X POST http://127.0.0.1:3000/api/auth/login
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

索引维护命令：

```bash
pnpm kb:drain
pnpm kb:reconcile
pnpm kb:rebuild
```

- `kb:drain`：处理当前待投影的索引任务
- `kb:reconcile`：对账 PostgreSQL 与 Qdrant，删除孤儿 point 并回补缺失 point
- `kb:rebuild`：以 PostgreSQL 中现存 `knowledgeChunk` 为准，全量重建 `pharmacy_kb`

升级说明：

- 当前代码启用了 Qdrant 版本兼容校验，`docker-compose.yml` 已同步升级到 `qdrant/qdrant:v1.17.0`
- 如果你从旧版本升级，请在重启容器后执行一次 `pnpm kb:rebuild`

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

## 当前实现说明

聊天问答当前是两段式：

1. 检索阶段  
   会把“当前文本 + 最近上下文 + 图片”一起送入多模态检索链路，完成 query rewrite、embedding、Qdrant 检索和 rerank。

2. 回答阶段  
   - 无图片：直接走文本流式回答
   - 有图片：走 Python ML Service 的 `MultiModalConversation` 流式接口，让最终回答也真正参考图片内容

这意味着当前版本已经修复了“检索能看图，但最终回答看不到图”的问题。

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
- 最终回答也会参考图片内容，不再只说“无法查看图片”
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

### 场景 10：实时提醒与会话管理

预期：

- 人工1 / 人工2 页面左侧能看到待处理工单数量
- 新建工单或升级工单后，人工侧无需刷新即可看到数量变化和站内提醒
- 浏览器授权通知后，可收到系统通知
- 药店工作人员可删除历史会话，删除后会话从列表消失，但工单与统计不受影响

## 常用命令

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
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

### 2. 模型接口调用失败

先确认 `OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL` 与 DashScope 的 embedding / rerank 配置可用。

如果你启用了图片问答最终回答，还需要确认：

- Python ML Service 已启动
- `OPENAI_MODEL` 指向支持多模态输入的模型，例如 `qwen3.5-27b`
- DashScope Key 可同时用于 `MultiModalConversation`

### 3. Qdrant 启动了但检索报错

先确认：

```bash
curl http://127.0.0.1:6333/collections
```

### 4. OpenAI-compatible Qwen 接口未配置

多模态图片解析、检索改写和 LLM 兜底都会失败。  
等你配置好后，我再继续做完整联调与功能验收。

### 5. 检索分数很高但仍然没有走知识库

优先检查 PostgreSQL 与 Qdrant 是否同步。

如果你更换过数据库、重建过表、但没有同步重建向量索引，可能出现：

- Qdrant 命中了旧的 `knowledgeItemId`
- PostgreSQL 里查不到该条知识
- 最终退回到 LLM 兜底

建议直接执行一次全量重建：

```bash
pnpm kb:rebuild
pnpm kb:reconcile
```
