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
2. **人工工单流转** — AI 无法解决时转人工，自动分发到部门，支持未认领和已认领状态下转派到其他部门
3. **知识库闭环** — 工单处理结果自动写入知识库，持续提升 AI 命中率
4. **图片理解** — 支持上传图片，AI 自动提取信息用于检索与最终回答
5. **流式聊天输出** — 聊天回答采用 SSE 打字机效果
6. **实时通知** — 部门人员支持待认领/已转派数量、站内通知、浏览器通知
7. **数据统计** — 问答量、知识库命中率、工单处理情况

**技术栈**：Next.js 15 + TypeScript + Prisma/数据库 + Python FastAPI + Qdrant + 阿里云 DashScope

---

## 环境准备与启动

本项目支持两种启动方式：

1. `pnpm dev` 本地开发模式
2. `docker compose up -d --build` 容器部署模式

差异简表：

| 对比项     | `pnpm dev`     | `docker compose up -d --build`         |
| ---------- | -------------- | -------------------------------------- |
| 进程位置   | 宿主机本地进程 | 容器内进程                             |
| 服务地址   | `127.0.0.1`    | `qdrant` / `ml-service` / `web` 服务名 |
| 端口策略   | 本地监听端口   | 内网 `expose` + `cloudflared` 对外     |
| 数据持久化 | 本地文件       | Docker volumes                         |

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
pnpm dev:init
pnpm dev
```

说明：

- `pnpm dev:init` 会准备 pnpm 依赖、Python 虚拟环境、PostgreSQL、Qdrant、Prisma migration、seed 和 `uploads/`。
- `pnpm dev` 会先检查 `.env`、PostgreSQL、Qdrant、Python venv，再并发启动 `web` 与 `ml-service`。
- Web 侧 `app/web/lib/env.ts` 会在进程启动时读取项目根目录 `.env`，因此从根目录或 `app/web` 目录启动都能拿到同一套环境变量。
- `pnpm dev:deps` 只启动本地 PostgreSQL/Qdrant，并通过 `docker-compose.dev.yml` 把 PostgreSQL 绑定到 `127.0.0.1:5432`、把 Qdrant 绑定到 `127.0.0.1:6333/6334`；`pnpm ml:install` 只修复 ML Python 环境。

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

| 用户名       | 密码    | 角色       | 部门       | 首页                |
| ------------ | ------- | ---------- | ---------- | ------------------- |
| 药店工作人员 | demo123 | staff      | 无         | /staff/chat         |
| 管理员       | demo123 | admin      | 无         | /admin/stats        |
| 营运-张伟    | demo123 | department | 营运部     | /department/tickets |
| 采购-李娜    | demo123 | department | 采购部     | /department/tickets |
| 培训-王芳    | demo123 | department | 培训部     | /department/tickets |
| 人事-赵敏    | demo123 | department | 人事部     | /department/tickets |
| 财务-刘洋    | demo123 | department | 财务部     | /department/tickets |
| 医保办-陈静  | demo123 | department | 医保办     | /department/tickets |
| 其他-周宁    | demo123 | department | 其他部门   | /department/tickets |
| 技术-孙鹏    | demo123 | department | 技术服务部 | /department/tickets |

**角色权限**：

- `staff`：发起对话、创建工单、查看自己的工单
- `department`：认领、回复、转派、提交处理方案、生成待入库知识、在满足条件时关闭工单
- `admin`：维护区域、部门、用户、知识库和系统设置，可查看全部工单

---

## 接口总览

### ML Service（端口 8001）

| 方法 | 路径                    | 说明           |
| ---- | ----------------------- | -------------- |
| GET  | /health                 | 健康检查       |
| POST | /embed                  | 文本向量化     |
| POST | /rerank                 | 重排序         |
| POST | /parse-document         | 文档解析       |
| POST | /chat-multimodal-stream | 多模态流式回答 |

### Web API（端口 3000）

| 方法   | 路径                                  | 说明                       | 权限                   |
| ------ | ------------------------------------- | -------------------------- | ---------------------- |
| POST   | /api/auth/login                       | 登录                       | 公开                   |
| POST   | /api/auth/logout                      | 登出                       | 已登录                 |
| GET    | /api/me                               | 当前用户信息               | 已登录                 |
| POST   | /api/uploads                          | 文件上传                   | 已登录                 |
| GET    | /api/conversations                    | 会话列表                   | staff                  |
| POST   | /api/conversations                    | 创建会话                   | staff                  |
| DELETE | /api/conversations/[id]               | 软删除会话                 | staff                  |
| GET    | /api/conversations/[id]/messages      | 消息历史                   | staff                  |
| POST   | /api/conversations/[id]/messages      | 发送消息                   | staff                  |
| GET    | /api/conversations/[id]/resume        | 查询是否有可续接的流式回复 | staff                  |
| GET    | /api/conversations/[id]/stream        | 订阅指定助手消息的续接流   | staff                  |
| POST   | /api/conversations/[id]/stop          | 停止当前生成中的回复       | staff                  |
| PATCH  | /api/messages/[id]                    | 编辑单条聊天消息           | 已登录且可访问会话     |
| DELETE | /api/messages/[id]                    | 删除单条聊天消息           | 已登录且可访问会话     |
| POST   | /api/messages/[id]/resend             | 编辑用户消息后重新发送     | 已登录且可访问会话     |
| POST   | /api/messages/[id]/regenerate         | 重新生成助手消息           | 已登录且可访问会话     |
| GET    | /api/notifications/stream             | 订阅实时通知 SSE 流        | 已登录                 |
| GET    | /api/tickets                          | 工单列表                   | 已登录                 |
| POST   | /api/tickets                          | 创建工单                   | staff                  |
| GET    | /api/tickets/[id]                     | 工单详情                   | 已登录                 |
| POST   | /api/tickets/[id]/reply               | 回复工单                   | department/admin       |
| POST   | /api/tickets/[id]/escalate            | 转派工单                   | department/admin       |
| POST   | /api/tickets/[id]/submit-resolution   | 提交处理方案               | department/admin       |
| POST   | /api/tickets/[id]/resolve             | 员工确认问题已解决         | staff                  |
| GET    | /api/tickets/[id]/knowledge-materials | 获取待入库材料             | 已登录且可访问工单     |
| POST   | /api/tickets/[id]/knowledge-draft     | 生成待入库知识草稿         | department/admin       |
| POST   | /api/tickets/[id]/close               | 关闭并写回知识库           | staff/department/admin |
| GET    | /api/stats/summary                    | 统计摘要                   | 已登录                 |
| GET    | /api/stats/trends                     | 趋势数据                   | 已登录                 |
| GET    | /api/settings                         | 获取检索与问答参数         | admin                  |
| PUT    | /api/settings                         | 更新检索与问答参数         | admin                  |
| PUT    | /api/settings/theme                   | 更新当前用户个人偏好       | 已登录                 |
| GET    | /api/admin/regions                    | 区域列表                   | admin                  |
| POST   | /api/admin/regions                    | 创建区域                   | admin                  |
| PATCH  | /api/admin/regions/[id]               | 更新区域                   | admin                  |
| DELETE | /api/admin/regions/[id]               | 删除区域                   | admin                  |
| GET    | /api/admin/departments                | 部门列表                   | admin                  |
| PATCH  | /api/admin/departments/[id]           | 更新部门区域归属           | admin                  |
| GET    | /api/admin/users                      | 用户列表                   | admin                  |
| POST   | /api/admin/users                      | 创建用户                   | admin                  |
| PATCH  | /api/admin/users/[id]                 | 更新用户                   | admin                  |
| GET    | /api/auth/demo-users                  | 内置演示用户列表           | 公开                   |
| GET    | /api/knowledge                        | 兼容知识条目查询           | 已登录                 |
| POST   | /api/knowledge                        | 手动新增 QA 文档或全量导入 | 管理员                 |
| GET    | /api/knowledge/documents              | 知识文档列表               | 管理员                 |
| GET    | /api/knowledge/documents/[id]         | 知识文档详情与 chunk       | 管理员                 |
| PATCH  | /api/knowledge/documents/[id]         | 更新知识文档元数据         | 管理员                 |
| DELETE | /api/knowledge/documents/[id]         | 删除知识文档               | 管理员                 |
| POST   | /api/knowledge/import-documents       | 上传文档导入               | 管理员                 |
| POST   | /api/knowledge/preview-chunks         | 上传文档切片预览           | 管理员                 |
| GET    | /api/knowledge/chunks/[id]            | 查看单个 chunk             | 已登录且范围可见       |
| GET    | /api/knowledge/index-tasks            | 查询索引任务               | 管理员                 |
| POST   | /api/knowledge/index-tasks/retry      | 重试失败索引任务           | 管理员                 |
| POST   | /api/knowledge/rebuild-index          | 全量重建索引               | 管理员                 |
| POST   | /api/knowledge/reindex/[id]           | 兼容单条重建入口（501）    | 管理员                 |
| GET    | /api/files/[...path]                  | 文件访问                   | 已登录                 |

---

## ML Service 接口

### GET /health

健康检查。

**响应**：

```json
{ "status": "ok" }
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
{ "error": "用户名或密码错误" }
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
{ "title": "可选，默认'新会话'" }
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
{ "success": true }
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
      "status": "completed",
      "createdAt": "2026-04-23T17:51:27.077Z"
    },
    {
      "id": "cmobs4kx...",
      "role": "assistant",
      "sourceType": "llm",
      "contentText": "以下为通用建议：...",
      "status": "completed",
      "retrievalDebugJson": "[]",
      "createdAt": "2026-04-23T17:52:37.104Z"
    }
  ],
  "fixedSuffix": "如以上操作仍无法解决，建议您转人工进行咨询"
}
```

### POST /api/conversations/[id]/messages

**核心接口** — 发送消息并获取 AI 回答。完整流程：

1. 用户消息入库，首次提问会刷新会话标题。
2. 读取最近 `MAX_CONTEXT_TURNS` 轮已完成消息作为上下文，历史助手消息会先移除可能存在的旧固定转人工提示后再进入模型上下文。
3. 构建 multimodal 查询文本（有图片时调用 DashScope Vision API）。
4. 文本向量化（DashScope Embedding）。
5. Qdrant 向量检索 top-K 候选。
6. Rerank 重排序（DashScope Rerank）。
7. 如果最高分 >= 阈值(0.72)，命中知识库。
8. 无图片且历史上下文无图片时，直接调用文本模型流式回答。
9. 当前消息或历史上下文包含图片时，调用 ML Service 的 `/chat-multimodal-stream`，让最终回答也参考图片内容。
10. 助手消息先以 `status=streaming` 入库，流式过程中增量更新内容，完成后变为 `completed`。
11. 统一以 SSE 事件流返回前端，并同步写入可续接的进程内流。

**请求**：

```json
{
  "text": "药店收银系统怎么操作？",
  "attachments": [{ "path": "uploads/image.png" }]
}
```

**响应**：

该接口返回 `text/event-stream`，事件类型如下：

- `meta`：来源信息
- `debug`：命中来源和图片路径
- `progress`：生成步骤、耗时和首字/首包延迟信息
- `delta`：增量文本
- `done`：结束事件
- `error`：错误事件

约束：

- 同一会话存在 `streaming` 助手消息时，再次发送会返回 `409`。
- 前端刷新后可通过 `GET /api/conversations/[id]/resume` 和 `GET /api/conversations/[id]/stream?messageId=...` 续接仍活跃的回复。
- 用户点击停止生成时调用 `POST /api/conversations/[id]/stop`。
- 固定转人工提示由共享常量维护，前端单独展示，不再作为新助手消息正文写入数据库，避免它污染后续模型上下文。
- 聊天页支持 Markdown 渲染，渲染链路使用 GFM 和 HTML sanitize。

**SSE 示例**：

```text
event: meta
data: {"conversationId":"cmobs2y8...","sourceType":"kb","sourceLabel":"知识库"}

event: debug
data: {"retrievalDebug":[{"knowledgeItemId":"cmobs52u...","rerankScore":0.878}],"imagePaths":[]}

event: progress
data: {"stepKey":"retrieve_vector","label":"向量检索","status":"completed","durationMs":128}

event: delta
data: {"text":"根据知识库："}

event: delta
data: {"text":"直接退出 ERP 程序，重新登录即可。"}

event: done
data: {"assistantMessageId":"cmobs4kx...","answer":"根据知识库：..."}
```

> `sourceType` 取值：`kb`（知识库命中）| `llm`（大模型兜底）
> 有图片时，最终回答也会进入多模态模型，不再只是检索阶段看图。

### PATCH /api/messages/[id]

编辑一条聊天消息。

**请求**：

```json
{
  "contentText": "修改后的消息内容",
  "imagePaths": ["uploads/example.png"]
}
```

说明：

- `staff` 只能编辑自己会话中的消息；其他已登录角色必须能访问该会话。
- `streaming` 状态的消息不能编辑，返回 `409`。
- 用户消息不能为空，除非原消息带有附件。
- 编辑助手消息时可同步更新 `retrievalDebugJson.imagePaths`，用于调整展示的来源图片。

### DELETE /api/messages/[id]

删除一条聊天消息。

说明：

- `streaming` 状态的消息不能删除，返回 `409`。
- 删除是单条消息硬删除，不等同于删除整个会话。

### POST /api/messages/[id]/resend

编辑某条用户消息后，删除该消息之后的会话消息，并基于新内容重新生成助手回复。

**请求**：

```json
{
  "contentText": "重新发送的问题"
}
```

说明：

- `id` 必须指向 `role=user` 的消息。
- 如果会话中已有正在生成的助手消息，返回 `409`。
- 原用户消息的附件会被保留；请求体只更新文本内容。
- 响应同样是 `text/event-stream`，事件类型与发送消息接口一致。

### POST /api/messages/[id]/regenerate

基于某条助手消息之前最近的用户问题，重新生成该助手消息。

说明：

- `id` 必须指向 `role=assistant` 的消息。
- 目标助手消息会被清空、标记为 `streaming`，完成后恢复为 `completed`。
- 重新生成时不会新增一条助手消息，而是在原助手消息上更新内容。
- 如果会话中已有其他正在生成的助手消息，返回 `409`。
- 响应同样是 `text/event-stream`，事件类型与发送消息接口一致。

### GET /api/conversations/[id]/resume

查询当前会话是否存在可续接的助手回复。

**响应**：

```json
{
  "streamingMessageId": "cmobs4kx...",
  "contentText": "已生成的部分内容",
  "sourceType": "kb",
  "active": true
}
```

说明：

- 没有正在生成的回复时返回 `{}`。
- `active=false` 表示数据库仍有 `streaming` 消息，但当前进程内流已不可订阅，前端应刷新消息列表。
- 该接口会顺带清理超过 5 分钟的过期流。

### GET /api/conversations/[id]/stream

订阅指定助手消息的续接流。

**查询参数**：

- `messageId`：正在生成的助手消息 ID。

**响应**：

返回 `text/event-stream`，事件包括：

- `delta`：续接增量文本。
- `done`：流结束。
- `error`：无法订阅或消息不存在。

### POST /api/conversations/[id]/stop

停止当前会话里最后一条 `streaming` 助手消息。

**响应**：

```json
{ "messageId": "cmobs4kx..." }
```

说明：

- 没有正在生成的消息时返回 `404`。
- 当前实现会把该助手消息标记为 `completed`，并关闭进程内订阅流。

### GET /api/settings

获取当前检索与问答参数。

**响应**：

```json
{
  "settings": {
    "retrievalTopK": 8,
    "rerankTopN": 5,
    "kbHitThreshold": 0.72,
    "maxContextTurns": 6,
    "cityScopeWeight": 1.3,
    "rerankAlpha": 0.7
  }
}
```

### PUT /api/settings

更新全局检索与问答参数。

**请求**：

```json
{
  "retrievalTopK": 8,
  "rerankTopN": 5,
  "kbHitThreshold": 0.72,
  "maxContextTurns": 6,
  "cityScopeWeight": 1.3,
  "rerankAlpha": 0.7
}
```

约束：

- `retrievalTopK`、`rerankTopN` 范围为 1 到 50。
- `kbHitThreshold` 范围为 0 到 1。
- `maxContextTurns` 范围为 1 到 20。
- `cityScopeWeight` 范围为 1 到 3，用于城市专属知识的召回加权。
- `rerankAlpha` 范围为 0 到 1，用于控制 rerank 分与 RRF 分的融合权重。
- `rerankTopN` 不能大于 `retrievalTopK`。

### PUT /api/settings/theme

更新当前登录用户的个人偏好。

**请求**：

```json
{
  "theme": "light",
  "colorMode": "system"
}
```

说明：

- `theme` 可选，取值为 `blue` 或 `light`。
- `colorMode` 可选，取值为 `light`、`dark` 或 `system`。
- 请求中至少要包含一个可更新字段。
- 偏好写入当前用户的 `sidebarTheme` 和 `colorMode` 字段，不影响其他用户。

### GET /api/notifications/stream

订阅当前用户的实时通知 SSE 流。

**响应头**：

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`

**事件类型**：

- `snapshot`：初次连接时返回当前待办数量
- `ticket`：工单新建、转派、回复、关闭通知
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
{ "conversationId": "cmobs2y8..." }
```

**响应**：

```json
{
  "ticket": {
    "id": "cmobs52u...",
    "ticketNo": "TK20260424357323",
    "status": "pending_claim",
    "title": "药店收银系统怎么操作？",
    "aiAnswerSnapshot": "以下为通用建议：...",
    "conversationSnapshot": "user: ...\nassistant: ..."
  }
}
```

### GET /api/tickets

获取工单列表，按角色过滤。

角色过滤规则：

- `staff` 只能看到自己创建的工单。
- `department` 可以看到自己已认领的工单、分发/转派到本部门且未认领的工单，以及本部门已关闭工单。
- `admin` 可以查看全部工单。

当前 `pending_claim` 和 `escalated` 都表示“已经到达某个部门，但尚未被具体人员认领”。区别是前者来自系统自动分发，后者来自人工转派。

**查询参数**：

- `status`：`pending_claim` | `processing` | `escalated` | `resolved` | `closed` | `all`
- `statusGroup`：`pending` | `processing` | `escalated` | `resolved` | `closed` | `all`

**响应**：

```json
{
  "tickets": [
    {
      "id": "cmobs52u...",
      "ticketNo": "TK20260424357323",
      "status": "pending_claim",
      "title": "药店收银系统怎么操作？",
      "escalatedToDept": "技术服务部",
      "createdBy": { "username": "药店工作人员", "role": "staff" },
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
    "status": "escalated",
    "createdBy": {...},
    "closedBy": null,
    "messages": [
      {"senderRole": "system", "content": "系统已创建工单..."},
      {"senderRole": "user", "content": "药店收银系统怎么操作？"},
      {"senderRole": "agent", "content": "请问是哪个品牌？"},
      {"senderRole": "system", "content": "营运-张伟 已将工单转派至营运部。"}
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
  "attachments": [{ "path": "uploads/screenshot.png" }]
}
```

**响应**：

```json
{
  "message": {
    "id": "cmobs5ik...",
    "ticketId": "cmobs52u...",
    "senderRole": "agent",
    "content": "您好，请问是哪个品牌的收银系统？",
    "createdAt": "2026-04-23T17:53:30.000Z"
  }
}
```

### POST /api/tickets/[id]/escalate

将工单转派到目标部门或目标人员（`department` / `admin` 可用）。

**请求**：

```json
{ "targetDept": "营运部", "targetUserId": null }
```

**响应**：

```json
{
  "ticket": {
    "status": "escalated",
    "escalatedToDept": "营运部",
    "escalatedToUserId": null
  }
}
```

### POST /api/tickets/[id]/submit-resolution

当前认领部门人员提交处理方案。

**请求**：

```json
{ "resolutionText": "已确认为智云系统，远程指导完成收银模块配置。" }
```

**响应**：

```json
{
  "ticket": {
    "status": "processing",
    "resolutionText": "已确认为智云系统..."
  }
}
```

### POST /api/tickets/[id]/resolve

提交工单的药店工作人员确认问题已解决。

前置条件：

- 已有部门人员提交的 `resolutionText`。
- 当前用户必须是该工单创建人。

**响应**：

```json
{
  "ticket": {
    "status": "resolved"
  }
}
```

### GET /api/tickets/[id]/knowledge-materials

获取工单中可用于生成知识草稿的对话材料。

权限：

- 当前用户必须已登录。
- 当前用户必须有权限访问该工单。

**响应**：

```json
{
  "materials": [
    {
      "id": "ticketMessage:cmobs5ik...",
      "source": "ticket",
      "messageId": "cmobs5ik...",
      "role": "agent",
      "sourceType": "ticket",
      "roleLabel": "营运-张伟",
      "sourceLabel": "人工回复",
      "contentText": "已确认为智云系统...",
      "attachments": [],
      "createdAt": "2026-04-23T17:53:30.000Z"
    }
  ]
}
```

说明：

- 系统消息不会作为可选材料返回。
- 前端通常把这里返回的 `id` 作为 `knowledge-draft` 的 `selectedMaterialIds`。

### POST /api/tickets/[id]/knowledge-draft

部门人员在工单已 `resolved` 后选择材料生成待入库知识草稿。

**请求**：

```json
{ "selectedMaterialIds": ["ticketMessage:cmobs5ik..."] }
```

### POST /api/tickets/[id]/close

关闭工单并写回知识库。

前置条件：

- 工单状态为 `resolved`。
- 已生成待入库知识草稿，且 `knowledgeStatus=pending_writeback`。
- 当前用户是提交工单的员工、当前处理部门人员或管理员。

**响应**：

```json
{
  "ticket": {
    "status": "closed",
    "closedBy": { "username": "营运-张伟" },
    "closedAt": "2026-04-23T17:54:47.688Z",
    "knowledgeStatus": "written"
  }
}
```

> 关闭工单时，系统会把已生成的待入库知识草稿写入知识库，后续相同问题将被 AI 直接命中。

流程上应先由部门人员在 `resolved` 状态下选择材料生成知识草稿，再由允许的关闭人执行关闭写回。没有草稿时，关闭接口会拒绝执行。

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
  "agentClosed": 1,
  "kbHitRate": 0.16,
  "closedRate": 1
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

兼容接口，返回 `KnowledgeItem` 查询结果。后台管理页不再使用独立 QA 条目表，而是以 `/api/knowledge/documents` 的文档视图为准。

**响应**：

```json
{
  "items": [
    {
      "id": "cmobs52u...",
      "question": "药店收银系统怎么操作？",
      "answer": "已确认为智云系统...",
      "sourceType": "manual_ticket",
      "sourceFile": null,
      "createdAt": "2026-04-23T17:54:47.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 10,
  "pageCount": 1
}
```

### POST /api/knowledge

`application/json` 时手动新增 QA 文档；非 JSON 时触发全量知识库导入。

手动新增请求：

```json
{
  "businessCategory": "医保",
  "question": "医保卡消磁了怎么处理？",
  "answer": "引导顾客到当地医保经办机构或发卡银行处理。",
  "imagePaths": []
}
```

手动新增响应：

```json
{ "ok": true, "item": { "id": "cm..." } }
```

这条知识会被创建为 QA 文档，而不是后台独立 QA 条目。

全量导入响应：

**响应**：

```json
{
  "importedFiles": 2,
  "importedChunks": 45,
  "skippedFiles": 0,
  "errors": []
}
```

### GET /api/knowledge/documents

获取后台知识文档列表。文档可能来自上传文件、手动 QA、工单写回或种子导入。

### GET /api/knowledge/documents/[id]

获取单个知识文档详情，包括版本、解析记录、chunk set、active chunks、BM25/HQ 元数据和索引任务状态。

### PATCH /api/knowledge/documents/[id]

更新知识文档元数据。当前支持更新：

- `businessCategory`
- `scopeLevel`
- `cityName`

更新范围后会同步 active chunk 的范围字段，并为受影响 chunk 写入 upsert 索引任务。

### DELETE /api/knowledge/documents/[id]

删除知识文档及其 chunk，并为相关 Qdrant point 写入 delete 索引任务。

### POST /api/knowledge/import-documents

上传文档并入库。支持 `multipart/form-data`：

- `files`：一个或多个文件。
- `chunkingConfig`：切片配置 JSON。
- `businessCategory`：业务分类，可空；手动填写时保存用户输入，自动写回或未填写时为 `null`。
- `scopeTarget` / `scopeLevel`：适用范围。当前支持 `common` 和湖北城市专属。
- `cityName`：城市专属知识的城市名，必须是湖北省内城市。

### POST /api/knowledge/preview-chunks

上传文件并返回前几个切片预览，不写入知识库。

### GET /api/knowledge/chunks/[id]

查看单个 chunk 详情。普通登录用户只能访问通用知识或与自己所属城市匹配的城市专属 chunk；管理员可查看全部。

### GET /api/knowledge/index-tasks

查询知识索引任务，可按 `chunkId`、`status` 等条件过滤，用于后台展示 chunk 对应的索引投影状态。

### POST /api/knowledge/index-tasks/retry

重试失败索引任务。

**请求**：

```json
{ "taskIds": ["cm..."] }
```

### POST /api/knowledge/reindex/[id]

兼容保留接口。当前版本返回 501，推荐使用全量 `kb:rebuild` 或后台「重建索引」。

**响应**：

```json
{ "ok": false, "message": "最小版本暂未单条重建索引，请使用全量导入。" }
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
# → {"ticket":{"id":"ticket-001","ticketNo":"TK20260424001","status":"pending_claim"}}
```

### 第三步：部门人员处理

```bash
# 5. 部门人员登录
curl -s -c dept.txt -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"营运-张伟","password":"demo123"}'

# 6. 查看待处理工单
curl -s -b dept.txt "http://127.0.0.1:3000/api/tickets?statusGroup=pending"
# → {"tickets":[...]}

# 7. 回复工单
curl -s -b dept.txt -X POST http://127.0.0.1:3000/api/tickets/ticket-001/reply \
  -H "Content-Type: application/json" \
  -d '{"content":"请问您使用的是哪个品牌的收银系统？"}'

# 8. 提交处理方案
curl -s -b dept.txt -X POST http://127.0.0.1:3000/api/tickets/ticket-001/submit-resolution \
  -H "Content-Type: application/json" \
  -d '{"resolutionText":"已确认为智云系统，远程指导完成收银模块配置。"}'
```

### 第四步：员工确认解决，部门人员写回知识库

```bash
# 9. 员工确认问题已解决
curl -s -b staff.txt -X POST http://127.0.0.1:3000/api/tickets/ticket-001/resolve
# → {"ticket":{"status":"resolved",...}}

# 10. 部门人员选择材料生成待入库知识
curl -s -b dept.txt -X POST http://127.0.0.1:3000/api/tickets/ticket-001/knowledge-draft \
  -H "Content-Type: application/json" \
  -d '{"selectedMaterialIds":["ticketMessage:..."]}'

# 11. 关闭工单并写回知识库
curl -s -b dept.txt -X POST http://127.0.0.1:3000/api/tickets/ticket-001/close \
  -H "Content-Type: application/json" \
  -d '{}'
# → {"ticket":{"status":"closed",...}}
# 系统自动将此答案写成 QA 文档，并进入知识文档视图。
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

# 12. 知识文档列表
curl -s -b staff.txt http://127.0.0.1:3000/api/knowledge/documents
# → {"items":[{"title":"工单知识：药店收银系统怎么操作？","sourceType":"manual_ticket",...}]}
```

---

## 故障排查

### ML Service 启动失败

```bash
# 检查 Python 版本（建议 3.11 / 3.12）
python --version

# 重新安装 ML 依赖
pnpm ml:install
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
