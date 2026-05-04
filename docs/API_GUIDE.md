# 药店门店智能问答系统 — API 接口文档与使用教程

## 目录

- [系统概述](#系统概述)
- [环境准备与启动](#环境准备与启动)
- [服务架构](#服务架构)
- [认证与会话](#认证与会话)
- [接口总览](#接口总览)
- [ML Service 接口](#ml-service-接口)
- [Web API 接口](#web-api-接口)
- [完整演示流程](#完整演示流程)
- [故障排查](#故障排查)

---

## 系统概述

药店门店智能问答系统是一个面向药店门店的信息化支持平台，核心功能：

1. **AI 智能问答** — 基于知识库的 RAG 检索 + 大模型兜底回答
2. **人工工单流转** — AI 无法解决时转人工，支持 L1/L2 两级流转
3. **知识库闭环** — 工单处理结果自动写入知识库，持续提升 AI 命中率
4. **图片理解** — 支持上传图片，AI 自动提取信息用于检索与最终回答
5. **流式聊天输出** — 聊天回答采用 SSE 打字机效果
6. **实时通知** — 人工1 / 人工2 支持待办数量、站内通知、浏览器通知
7. **数据统计** — 问答量、知识库命中率、工单处理情况

**技术栈**：Next.js 15 + TypeScript + Prisma/数据库 + Python FastAPI + Qdrant + 阿里云 DashScope

---

## 环境准备与启动

本项目支持两种启动方式：

1. `pnpm dev` 本地开发模式
2. `docker compose up -d --build` 容器部署模式

差异简表：

| 对比项 | `pnpm dev` | `docker compose up -d --build` |
|---|---|---|
| 进程位置 | 宿主机本地进程 | 容器内进程 |
| 服务地址 | `127.0.0.1` | `qdrant` / `ml-service` / `web` 服务名 |
| 端口策略 | 本地监听端口 | 内网 `expose` + `cloudflared` 对外 |
| 数据持久化 | 本地文件 | Docker volumes |

### 1. 环境变量

项目根目录 `.env`：

```env
POSTGRES_DB="tianji_pharmacy"
POSTGRES_USER="tianji"
POSTGRES_PASSWORD="change_me_strong_password"
DATABASE_URL="postgresql://tianji:change_me_strong_password@127.0.0.1:5432/tianji_pharmacy?schema=public"
OPENAI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
OPENAI_API_KEY="sk-your-dashscope-api-key"
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

### 2. 本地开发模式（`pnpm dev`）

```bash
pnpm install
pnpm db:migrate
docker compose up -d qdrant
cd app/ml-service
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ../..
pnpm dev
```

说明：

- `pnpm dev` 会并发启动 `web` 与 `ml-service`。
- `dev:ml` 脚本会自动加载根目录 `.env`，并优先使用 `app/ml-service/.venv`。

### 3. 容器部署模式（`docker compose up -d --build`）

容器部署额外需要：

```env
CF_TUNNEL_TOKEN="your-cloudflared-token"
```

```bash
docker compose up -d --build
docker compose ps
```

说明：

- `qdrant`、`ml-service`、`web` 走容器内通信。
- 用户入口通过 `cloudflared` 隧道暴露，不依赖宿主机端口映射。

### 4. 验证启动（本地开发模式）

```bash
curl http://127.0.0.1:8001/health          # ML Service
curl http://127.0.0.1:6333/collections      # Qdrant
curl -X POST http://127.0.0.1:3000/api/auth/login   # Web 登录
```

---

## 服务架构

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Browser   │────▶│   Next.js (3000)  │────▶│  数据库 DB  │
└─────────────┘     │                   │     └─────────────┘
                    │  ┌─────────────┐  │
                    │  │  Web APIs   │  │     ┌─────────────────┐
                    │  └──────┬──────┘  │────▶│ Qdrant (6333)   │
                    └─────────┼─────────┘     └─────────────────┘
                              │
                              ▼
                    ┌──────────────────┐     ┌─────────────────┐
                    │ ML Service (8001) │────▶│  DashScope API  │
                    │                  │     │  - qwen3.5-27b   │
                    │ /embed           │     │  - qwen3-vl-embedding │
                    │ /rerank          │     │  - qwen3-vl-rerank    │
                    │ /parse-document  │     │  - MultiModalConversation │
                    │ /chat-multimodal-stream │└─────────────────┘
                    └──────────────────┘
```

---

## 认证与会话

系统使用 Cookie-based Session 认证，Cookie 名 `pharmacy_demo_session`。

**内置用户**：

| 用户名 | 密码 | 角色 | 首页 |
|--------|------|------|------|
| 药店工作人员 | demo123 | staff | /staff/chat |
| 人工处理1 | demo123 | human_l1 | /l1/tickets |
| 人工处理2 | demo123 | human_l2 | /l2/tickets |

**角色权限**：
- `staff`：发起对话、创建工单、查看自己的工单
- `human_l1`：处理 L1 工单、回复、升级、关闭
- `human_l2`：处理 L2 工单、回复、关闭

---

## 接口总览

### ML Service（端口 8001）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /health | 健康检查 |
| POST | /embed | 文本向量化 |
| POST | /rerank | 重排序 |
| POST | /parse-document | 文档解析 |
| POST | /chat-multimodal-stream | 多模态流式回答 |

### Web API（端口 3000）

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | /api/auth/login | 登录 | 公开 |
| POST | /api/auth/logout | 登出 | 已登录 |
| GET | /api/me | 当前用户信息 | 已登录 |
| POST | /api/uploads | 文件上传 | 已登录 |
| GET | /api/conversations | 会话列表 | staff |
| POST | /api/conversations | 创建会话 | staff |
| DELETE | /api/conversations/[id] | 软删除会话 | staff |
| GET | /api/conversations/[id]/messages | 消息历史 | staff |
| POST | /api/conversations/[id]/messages | 发送消息 | staff |
| GET | /api/notifications/stream | 订阅实时通知 SSE 流 | 已登录 |
| GET | /api/tickets | 工单列表 | 已登录 |
| POST | /api/tickets | 创建工单 | staff |
| GET | /api/tickets/[id] | 工单详情 | 已登录 |
| POST | /api/tickets/[id]/reply | 回复工单 | human_l1/l2 |
| POST | /api/tickets/[id]/escalate | 升级工单 | human_l1 |
| POST | /api/tickets/[id]/close | 关闭工单 | human_l1/l2 |
| GET | /api/stats/summary | 统计摘要 | 已登录 |
| GET | /api/stats/trends | 趋势数据 | 已登录 |
| GET | /api/knowledge | 知识库列表 | 已登录 |
| POST | /api/knowledge | 全量导入知识 | 已登录 |
| POST | /api/knowledge/reindex/[id] | 单条重建索引 | 已登录 |
| GET | /api/files/[...path] | 文件访问 | 已登录 |

---

## ML Service 接口

### GET /health

健康检查。

**响应**：
```json
{"status": "ok"}
```

### POST /embed

将文本列表转换为向量，兼容现有文本调用，底层仍走多模态 embedding 模型 `qwen3-vl-embedding`。

**请求**：
```json
{
  "texts": ["药店收银系统怎么操作", "医保卡怎么使用"]
}
```

**响应**：
```json
{
  "vectors": [[0.0123, -0.0456, ...], [0.0789, 0.0234, ...]]
}
```

> 向量维度：1024

**示例**：
```bash
curl -s -X POST http://127.0.0.1:8001/embed \
  -H "Content-Type: application/json" \
  -d '{"texts": ["测试文本"]}'
```

### POST /rerank

对候选文档按与 query 的相关性重新排序，兼容现有文本调用，底层仍走多模态 rerank 模型 `qwen3-vl-rerank`。

**请求**：
```json
{
  "query": "药店收银系统怎么操作",
  "documents": [
    "收银系统操作指南：点击收银按钮开始",
    "药品采购流程：联系供应商下单",
    "会员管理：登记顾客手机号"
  ]
}
```

**响应**：
```json
{
  "scores": [0.647, 0.279, 0.431]
}
```

> scores 数组与 documents 数组一一对应，分数越高越相关。

**示例**：
```bash
curl -s -X POST http://127.0.0.1:8001/rerank \
  -H "Content-Type: application/json" \
  -d '{"query": "药店收银", "documents": ["收银指南", "采购流程"]}'
```

### POST /parse-document

解析文档（txt/md/pdf/docx/doc/图片），提取结构化知识条目。

**请求**：
```json
{
  "file_path": "/path/to/document.docx"
}
```

**响应**：
```json
{
  "items": [
    {
      "categoryL1": "知识文档",
      "categoryL2": "未分类",
      "question": "医保卡怎么使用",
      "answer": "持卡到药店...",
      "tags": ["医保卡", "使用"],
      "docType": "txt",
      "sourceFile": "document.docx",
      "imagePath": null,
      "originalText": "...",
      "normalizedText": "...",
      "chunkTexts": ["..."]
    }
  ]
}
```

**支持的文件格式**：
- `.txt` / `.md` — 纯文本解析
- `.pdf` — PDF 文本提取
- `.docx` — Word 文档 + 图片提取
- `.doc` — 旧版 Word（需 LibreOffice/antiword）
- `.png` / `.jpg` / `.jpeg` / `.webp` — AI 图片理解

**示例**：
```bash
curl -s -X POST http://127.0.0.1:8001/parse-document \
  -H "Content-Type: application/json" \
  -d '{"file_path": "/tmp/knowledge.txt"}'
```

### POST /chat-multimodal-stream

调用 DashScope `MultiModalConversation` 生成最终多模态流式回答。

说明：

- 当聊天请求包含图片时，Web 端会调用这个接口
- 检索阶段仍然先走 embedding / rerank
- 本接口只负责“最终回答生成”

**请求**：
```json
{
  "system_prompt": "你是药店门店信息化支持助手...",
  "user_text": "用户当前问题：请根据图片判断设备问题",
  "image_paths": ["uploads/1776967973973-GhhKNm.png"],
  "model": "qwen3.5-27b"
}
```

**响应**：

- `text/plain` 流式输出
- 每个 chunk 是一段模型生成文本

**示例**：
```bash
curl -N -X POST http://127.0.0.1:8001/chat-multimodal-stream \
  -H "Content-Type: application/json" \
  -d '{
    "system_prompt":"你是药店门店信息化支持助手",
    "user_text":"请根据图片给出保守建议",
    "image_paths":["uploads/example.png"],
    "model":"qwen3.5-27b"
  }'
```

---

## Web API 接口

所有接口需要 Cookie `pharmacy_demo_session` 认证（登录接口除外）。

### POST /api/auth/login

用户登录。

**请求**：
```json
{
  "username": "药店工作人员",
  "password": "demo123"
}
```

**成功响应**：
```json
{
  "ok": true,
  "role": "staff",
  "redirectTo": "/staff/chat"
}
```

**失败响应**：
```json
{"error": "用户名或密码错误"}
```

**示例**：
```bash
curl -s -c cookies.txt -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"药店工作人员","password":"demo123"}'
```

### POST /api/auth/logout

退出登录，清除 Session。

**响应**：307 重定向到 `/login`

### GET /api/me

获取当前登录用户信息。

**响应**：
```json
{
  "user": {
    "id": "cmobly292...",
    "username": "药店工作人员",
    "displayName": "药店工作人员",
    "role": "staff",
    "createdAt": "2026-04-23T14:59:35.270Z"
  }
}
```

### POST /api/uploads

上传文件（支持多文件）。

**请求**：`multipart/form-data`，字段名 `files`

**响应**：
```json
{
  "files": [
    {
      "name": "report.pdf",
      "path": "uploads/1776966943356-u-W5ZD.pdf",
      "mimeType": "application/pdf",
      "size": 12345
    }
  ]
}
```

**示例**：
```bash
curl -s -b cookies.txt -X POST http://127.0.0.1:3000/api/uploads \
  -F "files=@/path/to/file.pdf"
```

### POST /api/conversations

创建新会话。

**请求**：
```json
{"title": "可选，默认'新会话'"}
```

**响应**：
```json
{
  "conversation": {
    "id": "cmobs2y8...",
    "title": "联调测试会话",
    "userId": "cmobly292...",
    "createdAt": "2026-04-23T17:51:21.042Z"
  }
}
```

### GET /api/conversations

获取当前用户的会话列表。

**响应**：
```json
{
  "conversations": [
    {
      "id": "cmobs2y8...",
      "title": "药店收银系统怎么操作？",
      "createdAt": "2026-04-23T17:51:21.042Z",
      "updatedAt": "2026-04-23T17:52:37.107Z"
    }
  ]
}
```

### DELETE /api/conversations/[id]

软删除当前会话。

说明：

- 只从默认会话列表中隐藏
- 不删除会话消息对应的工单快照
- 不影响统计和知识回写结果

**响应**：
```json
{"success": true}
```

### GET /api/conversations/[id]/messages

获取会话的消息历史。

**响应**：
```json
{
  "messages": [
    {
      "id": "cmobs32w...",
      "role": "user",
      "sourceType": "system",
      "contentText": "药店收银系统怎么操作？",
      "createdAt": "2026-04-23T17:51:27.077Z"
    },
    {
      "id": "cmobs4kx...",
      "role": "assistant",
      "sourceType": "llm",
      "contentText": "以下为通用建议：...",
      "retrievalDebugJson": "[]",
      "createdAt": "2026-04-23T17:52:37.104Z"
    }
  ],
  "fixedSuffix": "如以上操作仍无法解决，建议您转人工进行咨询"
}
```

### POST /api/conversations/[id]/messages

**核心接口** — 发送消息并获取 AI 回答。完整流程：

1. 构建 multimodal 查询文本（有图片时调用 DashScope Vision API）
2. 文本向量化（DashScope Embedding）
3. Qdrant 向量检索 top-K 候选
4. Rerank 重排序（DashScope Rerank）
5. 如果最高分 >= 阈值(0.72)，命中知识库
6. 无图片时，直接生成文本流式回答
7. 有图片时，再调用 ML Service 的 `/chat-multimodal-stream`，让最终回答也参考图片内容
8. 统一以 SSE 事件流返回前端

**请求**：
```json
{
  "text": "药店收银系统怎么操作？",
  "attachments": [{"path": "uploads/image.png"}]
}
```

**响应**：

该接口返回 `text/event-stream`，事件类型如下：

- `meta`：来源信息
- `debug`：命中来源和图片路径
- `delta`：增量文本
- `done`：结束事件
- `error`：错误事件

**SSE 示例**：
```text
event: meta
data: {"conversationId":"cmobs2y8...","sourceType":"kb","sourceLabel":"知识库"}

event: debug
data: {"retrievalDebug":[{"knowledgeItemId":"cmobs52u...","rerankScore":0.878}],"imagePaths":[]}

event: delta
data: {"text":"根据知识库："}

event: delta
data: {"text":"直接退出 ERP 程序，重新登录即可。"}

event: done
data: {"assistantMessageId":"cmobs4kx...","answer":"根据知识库：..."}
```

> `sourceType` 取值：`kb`（知识库命中）| `llm`（大模型兜底）
> 有图片时，最终回答也会进入多模态模型，不再只是检索阶段看图。

### GET /api/notifications/stream

订阅当前用户的实时通知 SSE 流。

**响应头**：

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`

**事件类型**：

- `snapshot`：初次连接时返回当前待办数量
- `ticket`：工单新建、升级、回复、关闭通知
- `ping`：保活心跳

**示例**：

```bash
curl -N -b cookies.txt http://127.0.0.1:3000/api/notifications/stream
```

说明：

- 前端通过同域 `EventSource("/api/notifications/stream")` 建立连接
- 无需额外 `3001` 端口
- 该流会随浏览器自动重连，适合当前 `cloudflared -> web:3000` 部署方式

### POST /api/tickets

将对话转为人工工单。

**请求**：
```json
{"conversationId": "cmobs2y8..."}
```

**响应**：
```json
{
  "ticket": {
    "id": "cmobs52u...",
    "ticketNo": "TK20260424357323",
    "status": "pending_l1",
    "currentAssigneeRole": "human_l1",
    "title": "药店收银系统怎么操作？",
    "aiAnswerSnapshot": "以下为通用建议：...",
    "conversationSnapshot": "user: ...\nassistant: ..."
  }
}
```

### GET /api/tickets

获取工单列表，按角色过滤。

**查询参数**：
- `status`：`pending_l1` | `pending_l2` | `closed` | `all`

**响应**：
```json
{
  "tickets": [
    {
      "id": "cmobs52u...",
      "ticketNo": "TK20260424357323",
      "status": "pending_l1",
      "title": "药店收银系统怎么操作？",
      "createdBy": {"username": "药店工作人员", "role": "staff"},
      "createdAt": "2026-04-23T17:53:00.321Z"
    }
  ]
}
```

### GET /api/tickets/[id]

获取工单详情，包含完整消息记录。

**响应**：
```json
{
  "ticket": {
    "id": "cmobs52u...",
    "ticketNo": "TK20260424357323",
    "status": "pending_l2",
    "createdBy": {...},
    "closedBy": null,
    "messages": [
      {"senderRole": "system", "content": "系统已创建工单..."},
      {"senderRole": "user", "content": "药店收银系统怎么操作？"},
      {"senderRole": "human_l1", "content": "请问是哪个品牌？"},
      {"senderRole": "system", "content": "系统已将工单升级至人工处理2。"}
    ]
  }
}
```

### POST /api/tickets/[id]/reply

回复工单。

**请求**：
```json
{
  "content": "您好，请问是哪个品牌的收银系统？",
  "attachments": [{"path": "uploads/screenshot.png"}]
}
```

**响应**：
```json
{
  "message": {
    "id": "cmobs5ik...",
    "ticketId": "cmobs52u...",
    "senderRole": "human_l1",
    "content": "您好，请问是哪个品牌的收银系统？",
    "createdAt": "2026-04-23T17:53:30.000Z"
  }
}
```

### POST /api/tickets/[id]/escalate

将工单从 L1 升级到 L2（仅 `human_l1` 可用）。

**响应**：
```json
{
  "ticket": {
    "status": "pending_l2",
    "currentAssigneeRole": "human_l2"
  }
}
```

### POST /api/tickets/[id]/close

关闭工单并写回知识库（仅 `human_l1`/`human_l2` 可用）。

**请求**：
```json
{"resolutionText": "已确认为智云系统，远程指导完成收银模块配置。"}
```

**响应**：
```json
{
  "ticket": {
    "status": "closed",
    "resolutionText": "已确认为智云系统...",
    "closedBy": {"username": "人工处理1"},
    "closedAt": "2026-04-23T17:54:47.688Z"
  }
}
```

> 关闭工单时，系统自动将处理结论写入知识库，后续相同问题将被 AI 直接命中。

### GET /api/stats/summary

获取统计摘要。

**响应**：
```json
{
  "totalQuestions": 6,
  "kbHits": 1,
  "llmAnswers": 5,
  "transferCount": 1,
  "totalTickets": 1,
  "closedTickets": 1,
  "human1Closed": 1,
  "human2Closed": 0
}
```

### GET /api/stats/trends

获取近 7 天趋势数据。

**响应**：
```json
{
  "trends": [
    {
      "day": "04-24",
      "questionCount": 6,
      "kbHitCount": 1,
      "ticketCreatedCount": 1,
      "ticketClosedCount": 1
    }
  ]
}
```

### GET /api/knowledge

获取知识库条目列表和导入任务记录。

**响应**：
```json
{
  "items": [
    {
      "id": "cmobs52u...",
      "categoryL1": "人工经验沉淀",
      "categoryL2": "工单闭环新增",
      "question": "药店收银系统怎么操作？",
      "answer": "已确认为智云系统...",
      "sourceType": "manual_ticket",
      "sourceFile": null,
      "createdAt": "2026-04-23T17:54:47.000Z"
    }
  ],
  "jobs": []
}
```

### POST /api/knowledge

触发全量知识库导入（从 `seed_knowledge/` 目录和根目录知识文档）。

**响应**：
```json
{
  "importedFiles": 2,
  "importedChunks": 45,
  "skippedFiles": 0,
  "errors": []
}
```

### POST /api/knowledge/reindex/[id]

单条知识重建索引。当前版本返回 501。

**响应**：
```json
{"ok": false, "message": "最小版本暂未单条重建索引，请使用全量导入。"}
```

### 索引维护命令

```bash
pnpm kb:drain
pnpm kb:reconcile
pnpm kb:rebuild
```

- `kb:drain`：处理 `KnowledgeIndexTask` 待执行任务
- `kb:reconcile`：清理 `Qdrant - 数据库` 孤儿 point，并回补 `数据库 - Qdrant` 缺失 point
- `kb:rebuild`：以 PostgreSQL 中现存 `knowledgeChunk` 为唯一权威输入，全量重建 `pharmacy_kb`

### GET /api/files/[...path]

访问上传的文件。

**示例**：
```bash
curl -b cookies.txt http://127.0.0.1:3000/api/files/uploads/1776966943356-u-W5ZD.txt
```

---

## 完整演示流程

以下演示完整的「提问 → AI 回答 → 转人工 → 处理 → 知识沉淀 → 再次命中」闭环。

### 第一步：药店员工提问

```bash
# 1. 登录
curl -s -c staff.txt -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"药店工作人员","password":"demo123"}'
# → {"ok":true,"role":"staff","redirectTo":"/staff/chat"}

# 2. 创建会话
curl -s -b staff.txt -c staff.txt -X POST http://127.0.0.1:3000/api/conversations \
  -H "Content-Type: application/json" \
  -d '{"title":"收银系统问题"}'
# → {"conversation":{"id":"conv-001",...}}

# 3. 发送问题（流式 SSE）
curl -N -b staff.txt -X POST http://127.0.0.1:3000/api/conversations/conv-001/messages \
  -H "Content-Type: application/json" \
  -d '{"text":"药店收银系统怎么操作？"}'
# → event: meta / event: delta / event: done
```

### 第二步：转人工处理

```bash
# 4. 创建工单
curl -s -b staff.txt -X POST http://127.0.0.1:3000/api/tickets \
  -H "Content-Type: application/json" \
  -d '{"conversationId":"conv-001"}'
# → {"ticket":{"id":"ticket-001","ticketNo":"TK20260424001","status":"pending_l1"}}
```

### 第三步：人工客服处理

```bash
# 5. L1 登录
curl -s -c l1.txt -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"人工处理1","password":"demo123"}'

# 6. 查看待处理工单
curl -s -b l1.txt "http://127.0.0.1:3000/api/tickets?status=pending_l1"
# → {"tickets":[...]}

# 7. 回复工单
curl -s -b l1.txt -X POST http://127.0.0.1:3000/api/tickets/ticket-001/reply \
  -H "Content-Type: application/json" \
  -d '{"content":"请问您使用的是哪个品牌的收银系统？"}'

# 8. 如果需要升级到 L2
curl -s -b l1.txt -X POST http://127.0.0.1:3000/api/tickets/ticket-001/escalate
# → {"ticket":{"status":"pending_l2","currentAssigneeRole":"human_l2"}}

# 9. 或者直接关闭工单（写回知识库）
curl -s -b l1.txt -X POST http://127.0.0.1:3000/api/tickets/ticket-001/close \
  -H "Content-Type: application/json" \
  -d '{"resolutionText":"已确认为智云系统，远程指导完成收银模块配置。"}'
# → {"ticket":{"status":"closed",...}}
# 系统自动将此答案写入知识库！
```

### 第四步：验证知识沉淀效果

```bash
# 10. 新会话提问相同问题
curl -s -b staff.txt -X POST http://127.0.0.1:3000/api/conversations \
  -H "Content-Type: application/json" \
  -d '{"title":"再次提问"}'
# → {"conversation":{"id":"conv-002",...}}

curl -N -b staff.txt -X POST http://127.0.0.1:3000/api/conversations/conv-002/messages \
  -H "Content-Type: application/json" \
  -d '{"text":"药店收银系统怎么操作？"}'
# → event: meta 中 sourceType = kb
# 第二次提问，知识库命中
```

### 第五步：查看统计

```bash
# 11. 统计摘要
curl -s -b staff.txt http://127.0.0.1:3000/api/stats/summary
# → {"totalQuestions":2,"kbHits":1,"llmAnswers":1,...}

# 12. 知识库列表
curl -s -b staff.txt http://127.0.0.1:3000/api/knowledge
# → {"items":[{"question":"药店收银系统怎么操作？","sourceType":"manual_ticket",...}]}
```

---

## 故障排查

### ML Service 启动失败

```bash
# 检查 Python 版本（建议 3.11 / 3.12）
python3.12 --version

# 重新安装依赖
cd app/ml-service
rm -rf .venv
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -i https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple
```

### Embed/Rerank 返回 502

- 检查 DashScope API Key 是否有效
- 检查网络连通性：`curl https://dashscope.aliyuncs.com`

### Qdrant 连接失败

```bash
# 检查容器状态
docker ps | grep qdrant

# 重启
docker restart qdrant
```

- 当前项目要求 Qdrant 服务端与 `@qdrant/js-client-rest` 保持兼容
- `docker-compose.yml` 默认已升级为 `qdrant/qdrant:v1.17.0`
- 如果你仍在使用旧的 `v1.13.x`，索引写入会被显式拒绝

### 消息发送返回 500

- 确保 Qdrant collection 存在（首次导入知识后自动创建）
- 确保 ML Service 的 embed 和 rerank 端点正常
- 如果是图文消息，还要确保 `/chat-multimodal-stream` 可用
- 检查 Next.js 控制台日志

### 知识库导入失败

- 确保文档文件路径正确
- 检查 `seed_knowledge/` 目录是否存在文档
- PDF 需要可提取文本（扫描件不支持）

### 检索命中分数很高但仍然回退到 LLM

通常是 PostgreSQL 与 Qdrant 索引不同步。建议执行：

```bash
pnpm kb:rebuild
pnpm kb:reconcile
```

这样会先按 数据库 全量重建索引，再清理遗留孤儿 point。
