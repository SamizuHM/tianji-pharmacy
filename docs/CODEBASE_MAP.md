# 代码地图

## 目标

本文说明当前代码目录中“什么文件负责什么事”。它不是逐文件 API 文档，而是帮助接手者快速定位需求入口。

读完本文后，你应该能判断：

- 页面入口在哪里。
- API route 在哪里。
- 业务逻辑在哪个 service。
- 数据模型在哪里。
- RAG 和知识库索引链路在哪里。
- Docker/部署脚本在哪里。

---

## 顶层目录

```text
tianji-pharmacy/
├─ app/
│  ├─ web/                  # Next.js 主应用
│  └─ ml-service/           # Python FastAPI ML 服务
├─ packages/shared/         # 前后端共享类型、常量、工具
├─ prisma/                  # Prisma schema、migrations、seed
├─ scripts/                 # 初始化、知识库维护、环境检查脚本
├─ docs/                    # 项目文档
├─ seed_knowledge/          # 种子知识文件
├─ uploads/                 # 本地上传文件目录
├─ docker-compose.yml       # 容器编排
├─ Dockerfile.web           # Web 生产镜像构建
├─ Dockerfile.ml            # ML 服务镜像构建
└─ docker-entrypoint.sh     # Web 容器启动入口
```

---

## Web 应用结构

```text
app/web/
├─ app/                     # Next.js App Router 页面与 API
├─ components/              # React 组件
├─ lib/                     # 服务层、基础设施、工具
├─ tailwind.config.ts       # Tailwind 主题配置
├─ components.json          # shadcn CLI 配置
└─ package.json
```

当前项目大部分页面入口是 Server Component，复杂交互再下沉到 Client Component。

典型模式：

```text
app/.../page.tsx
  -> 读取 session / 初始数据
  -> 渲染业务 Client Component

components/.../*.tsx
  -> 处理交互、表单、弹窗、SSE、状态

app/api/.../route.ts
  -> 权限校验、参数校验、调用 lib/services

lib/services/*.ts
  -> 真正业务逻辑
```

---

## 页面路由地图

### 登录

| 路径     | 文件                         | 说明                 |
| -------- | ---------------------------- | -------------------- |
| `/login` | `app/web/app/login/page.tsx` | 登录页               |
| `/`      | `app/web/app/page.tsx`       | 根据登录态和角色跳转 |

相关组件：

```text
app/web/components/forms/login-form.tsx
app/web/components/login/particles-background.tsx
```

相关 API：

```text
app/web/app/api/auth/login/route.ts
app/web/app/api/auth/logout/route.ts
app/web/app/api/me/route.ts
```

相关服务：

```text
app/web/lib/auth/session.ts
```

### 员工端

| 路径                  | 文件                                      | 说明                   |
| --------------------- | ----------------------------------------- | ---------------------- |
| `/staff/chat`         | `app/web/app/staff/chat/page.tsx`         | 员工智能问答页         |
| `/staff/tickets`      | `app/web/app/staff/tickets/page.tsx`      | 员工查看自己提交的工单 |
| `/staff/tickets/[id]` | `app/web/app/staff/tickets/[id]/page.tsx` | 员工工单详情           |
| `/staff/*` layout     | `app/web/app/staff/layout.tsx`            | 员工端布局             |

关键组件：

```text
app/web/components/chat/chat-client.tsx
app/web/components/tickets/ticket-list.tsx
app/web/components/tickets/ticket-detail-client.tsx
```

### 人工处理端

| 路径                  | 文件                                      | 说明             |
| --------------------- | ----------------------------------------- | ---------------- |
| `/agent/tickets`      | `app/web/app/agent/tickets/page.tsx`      | 人工处理工单列表 |
| `/agent/tickets/[id]` | `app/web/app/agent/tickets/[id]/page.tsx` | 人工工单详情     |
| `/agent/*` layout     | `app/web/app/agent/layout.tsx`            | 人工端布局       |

人工角色当前在 Prisma 中统一为：

```text
UserRole.agent
```

历史文档里的人工1、人工2、L1、L2 是业务分层称呼，不是当前数据库 enum。

### 管理端

| 路径               | 文件                                   | 说明       |
| ------------------ | -------------------------------------- | ---------- |
| `/admin/knowledge` | `app/web/app/admin/knowledge/page.tsx` | 知识库管理 |
| `/admin/settings`  | `app/web/app/admin/settings/page.tsx`  | 系统设置   |
| `/admin/stats`     | `app/web/app/admin/stats/page.tsx`     | 统计       |
| `/admin/*` layout  | `app/web/app/admin/layout.tsx`         | 管理端布局 |

关键组件：

```text
app/web/components/knowledge/knowledge-admin.tsx
app/web/components/knowledge/knowledge-table.tsx
app/web/components/knowledge/rich-editor.tsx
app/web/components/settings/settings-form.tsx
app/web/components/settings/theme-settings.tsx
app/web/components/stats/trend-chart.tsx
```

---

## API 路由地图

### Auth

```text
app/web/app/api/auth/login/route.ts
app/web/app/api/auth/logout/route.ts
app/web/app/api/me/route.ts
```

职责：

- 登录。
- 退出。
- 获取当前用户。
- 维护 session cookie。

底层：

```text
app/web/lib/auth/session.ts
```

### Conversations

```text
app/web/app/api/conversations/route.ts
app/web/app/api/conversations/[id]/route.ts
app/web/app/api/conversations/[id]/messages/route.ts
app/web/app/api/messages/[id]/route.ts
app/web/app/api/messages/[id]/resend/route.ts
app/web/app/api/messages/[id]/regenerate/route.ts
```

职责：

- 会话列表。
- 新建会话。
- 软删除会话。
- 发送消息。
- 编辑或删除单条消息。
- 编辑用户消息后重新发送。
- 重新生成助手消息。
- SSE 流式返回进度和答案。

底层：

```text
app/web/lib/services/conversations.ts
app/web/lib/services/chat-generation.ts
app/web/lib/services/retrieval.ts
app/web/lib/openai.ts
```

最复杂的是：

```text
app/web/lib/services/chat-generation.ts
```

它被发送消息、重新发送、重新生成三类入口复用，同时处理：

- 用户消息入库。
- 附件解析。
- RAG 检索。
- 大模型或知识库答案生成。
- SSE 输出进度。
- assistant 消息入库。
- 错误和断流处理。
- 固定转人工提示从历史上下文中剥离。

`app/web/app/api/conversations/[id]/messages/route.ts` 现在主要负责权限校验、请求解析和调用生成服务。

修改前一定先读 `docs/RAG_MULTIMODAL_PIPELINE.md`。

### Tickets

```text
app/web/app/api/tickets/route.ts
app/web/app/api/tickets/[id]/route.ts
app/web/app/api/tickets/[id]/claim/route.ts
app/web/app/api/tickets/[id]/reply/route.ts
app/web/app/api/tickets/[id]/escalate/route.ts
app/web/app/api/tickets/[id]/submit-resolution/route.ts
app/web/app/api/tickets/[id]/resolve/route.ts
app/web/app/api/tickets/[id]/knowledge-materials/route.ts
app/web/app/api/tickets/[id]/knowledge-draft/route.ts
app/web/app/api/tickets/[id]/close/route.ts
```

职责：

- 从会话创建工单。
- 工单列表和详情。
- 认领。
- 回复。
- 升级。
- 提交处理结果。
- 员工确认解决。
- 生成知识草稿。
- 关闭并写回知识库。

底层：

```text
app/web/lib/services/tickets.ts
```

### Knowledge

```text
app/web/app/api/knowledge/route.ts
app/web/app/api/knowledge/[id]/route.ts
app/web/app/api/knowledge/bulk/route.ts
app/web/app/api/knowledge/import-documents/route.ts
app/web/app/api/knowledge/rebuild-index/route.ts
app/web/app/api/knowledge/reindex/[id]/route.ts
```

职责：

- 知识条目列表。
- 新增/编辑/删除知识。
- 批量操作。
- 上传文档导入。
- 单条重建索引。
- 全量重建索引。

底层：

```text
app/web/lib/services/knowledge.ts
app/web/lib/services/knowledge-index.ts
```

### 上传和文件访问

```text
app/web/app/api/uploads/route.ts
app/web/app/api/files/[...path]/route.ts
```

职责：

- 上传图片/文档。
- 提供上传文件访问。

底层：

```text
app/web/lib/uploads.ts
app/web/lib/utils.ts
```

### 通知

```text
app/web/app/api/notifications/stream/route.ts
app/web/lib/notifications/server.ts
```

职责：

- SSE 实时通知。
- 工单待办数量变化。

历史说明：

```text
docs/NOTIFICATION_WS_TO_SSE.md
```

### 统计和设置

```text
app/web/app/api/stats/summary/route.ts
app/web/app/api/stats/trends/route.ts
app/web/app/api/settings/route.ts
app/web/app/api/settings/theme/route.ts
app/web/app/api/departments/route.ts
```

底层：

```text
app/web/lib/services/stats.ts
app/web/lib/services/settings.ts
app/web/lib/themes.ts
```

---

## 服务层地图

### `app/web/lib/db.ts`

Prisma Client 单例。

所有数据库访问最终都通过它。

### `app/web/lib/env.ts`

运行时配置读取。

该文件会先计算仓库根目录，再主动加载根目录 `.env` 中尚未存在于 `process.env` 的变量。这样从项目根目录运行 `pnpm dev` 或从 `app/web` 目录单独启动 Web 时，环境变量来源保持一致。

重要配置包括：

```text
QDRANT_URL
EMBEDDING_SERVICE_URL
RERANK_SERVICE_URL
ML_SERVICE_URL
KB_HIT_THRESHOLD
RETRIEVAL_TOP_K
RERANK_TOP_N
UPLOAD_DIR
```

本地开发通常是 `127.0.0.1`。

Docker Compose 中由 service name 注入，例如 `http://ml-service:8001`。

### `app/web/lib/services/conversations.ts`

会话服务。

负责：

- 创建会话。
- 查询会话列表。
- 查询会话消息。
- 追加消息。
- 刷新会话标题。
- 软删除会话。

### `app/web/lib/services/retrieval.ts`

RAG 检索决策核心。

负责：

- query rewrite。
- 调 ML service embedding。
- 调 Qdrant search。
- 调 ML service rerank。
- 根据阈值判断走知识库还是大模型。
- 回 PostgreSQL 校验 Qdrant 命中的 chunk 是否真实存在。
- 清理陈旧 Qdrant point。

### `app/web/lib/services/knowledge.ts`

知识库主数据服务。

负责：

- 列表查询。
- 新增/更新 KnowledgeItem。
- 维护 KnowledgeChunk。
- 生成 KnowledgeIndexTask。
- 文档导入。
- 删除和批量操作。

### `app/web/lib/services/knowledge-index.ts`

Qdrant 索引任务服务。

负责：

- 构建稳定 point id。
- 生成 upsert/delete 任务。
- drain pending tasks。
- rebuild/reconcile 相关能力。

改这个文件需要非常谨慎，先读：

```text
docs/POSTGRES_QDRANT_INDEX_CONSISTENCY.md
docs/INCIDENT_2026-04-28_QDRANT_INDEX_DELETION.md
```

### `app/web/lib/services/tickets.ts`

工单服务。

负责：

- 从会话创建工单。
- 判断工单访问权限。
- 列表筛选。
- 认领、回复、升级、关闭。
- 生成知识草稿。
- 写回知识库。
- 广播通知。

### `app/web/lib/openai.ts`

大模型调用封装。

负责：

- query rewrite。
- 最终回答。
- 工单知识草稿生成。
- 多模态 prompt 构造。

### `app/web/lib/retrieval/ml-service.ts`

Web 访问 Python ML Service 的 HTTP client。

封装：

- `embed`
- `embed-multimodal`
- `rerank`
- `rerank-multimodal`
- `parse-document`
- `chat-multimodal-stream`

### `app/web/lib/retrieval/qdrant.ts`

Qdrant client 和 collection 名称。

当前知识库 collection：

```text
pharmacy_kb
```

### `app/web/lib/notifications/server.ts`

SSE 通知服务端内存管理。

处理：

- 连接注册。
- 广播工单通知。
- 计算待办数量。

---

## 组件地图

### 布局

```text
app/web/components/layout/app-shell.tsx
```

主应用布局，包含侧边栏、顶部栏、角色导航、账号菜单。

### 聊天

```text
app/web/components/chat/chat-client.tsx
```

职责很重：

- 会话历史。
- 移动端布局。
- 输入框。
- ScrollArea 滚动容器。
- 图片上传。
- SSE 接收。
- 断点续传和停止生成。
- 进度展示。
- 消息渲染。
- Markdown 渲染。
- 复制、下载、编辑、删除消息。
- 编辑用户消息后重新发送。
- 重新生成助手消息。
- 转人工。
- 删除会话确认。

改聊天页 UI 多半在这里。

Markdown 渲染单独在：

```text
app/web/components/chat/markdown-message.tsx
```

### 工单

```text
app/web/components/tickets/ticket-list.tsx
app/web/components/tickets/ticket-detail-client.tsx
app/web/components/tickets/org-tree-select.tsx
```

### 知识库

```text
app/web/components/knowledge/knowledge-admin.tsx
app/web/components/knowledge/knowledge-table.tsx
app/web/components/knowledge/rich-editor.tsx
app/web/components/knowledge/image-lightbox.tsx
```

### 设置和统计

```text
app/web/components/settings/settings-form.tsx
app/web/components/settings/theme-settings.tsx
app/web/components/stats/trend-chart.tsx
app/web/components/stats/mini-pager.tsx
```

`theme-settings.tsx` 同时管理侧边栏主题和颜色模式。颜色模式取值为 `light`、`dark`、`system`，由 `AppShell` 写入 `document.documentElement.classList`、`data-color-mode` 和 `color-scheme`。

### UI 基础组件

```text
app/web/components/ui/*
```

这是本地 shadcn 风格组件库。

注意：

- 这些组件不是不可修改的 npm 包。
- shadcn 的模式是把源码复制进项目。
- 本项目的 Button、Card、Sheet、DropdownMenu 等已经有项目定制风格。
- `dialog.tsx` 是通过 `pnpm dlx shadcn@latest add dialog --overwrite` 生成的官方结构，但内部按钮样式仍取决于项目本地 `button.tsx`。

---

## 数据模型入口

```text
prisma/schema.prisma
```

当前核心模型：

```text
Department
User
Session
Conversation
ChatMessage
Ticket
TicketMessage
TicketKnowledgeDraft
KnowledgeItem
KnowledgeChunk
KnowledgeIndexTask
AppSetting
ImportJob
```

更多说明：

```text
docs/DOMAIN_MODEL.md
```

---

## ML Service 地图

```text
app/ml-service/app/main.py
```

提供：

```text
GET  /health
POST /embed
POST /embed-multimodal
POST /rerank
POST /rerank-multimodal
POST /parse-document
POST /chat-multimodal-stream
```

主要职责：

- DashScope 多模态 embedding。
- DashScope rerank。
- 图片转 base64 data URL。
- 文档解析。
- 多模态聊天流。

Docker 镜像：

```text
Dockerfile.ml
```

本地开发启动脚本：

```text
scripts/dev.ts
scripts/dev-ml.ts
scripts/dev-init.ts
```

---

## 脚本地图

### 初始化

```text
scripts/dev-init.ts
```

通常做：

- 安装 pnpm 和 Python 依赖。
- 启动 PostgreSQL/Qdrant 本地依赖服务。
- Prisma generate/migrate。
- seed。
- 创建 uploads。

### 环境检查

```text
scripts/check-env.ts
```

检查关键环境变量。

### 知识库导入和索引维护

```text
scripts/import-seed-knowledge.ts
scripts/should-import-knowledge.ts
scripts/drain-knowledge-index.ts
scripts/rebuild-knowledge-index.ts
scripts/reconcile-knowledge-index.ts
```

对应命令：

```bash
pnpm kb:import
pnpm kb:drain
pnpm kb:rebuild
pnpm kb:reconcile
```

语义：

- `import`：导入种子知识。
- `drain`：处理 pending index tasks。
- `rebuild`：根据 PostgreSQL chunks 全量重建 Qdrant 索引。
- `reconcile`：检查 PostgreSQL 与 Qdrant 一致性。

### 工单流程测试

```text
scripts/test-ticket-flow.ts
```

用于验证工单主流程。

---

## Docker 和部署文件地图

```text
docker-compose.yml
Dockerfile.web
Dockerfile.ml
docker-entrypoint.sh
docs/DOCKER_DEPLOYMENT_GUIDE.md
```

职责：

- `docker-compose.yml`：定义 5 个服务和 volumes。
- `Dockerfile.web`：构建 Next.js 生产镜像。
- `Dockerfile.ml`：构建 Python ML Service 镜像。
- `docker-entrypoint.sh`：Web 容器启动时执行 migrate、seed、启动 Next.js、首次知识导入。

---

## 常见需求应该从哪里下手

### 修改聊天页 UI

先看：

```text
app/web/components/chat/chat-client.tsx
```

如果涉及页面初始数据：

```text
app/web/app/staff/chat/page.tsx
```

### 修改发送消息逻辑

先看：

```text
app/web/app/api/conversations/[id]/messages/route.ts
app/web/lib/services/chat-generation.ts
```

再看：

```text
app/web/lib/services/retrieval.ts
app/web/lib/openai.ts
```

如果需求涉及“编辑后重发”或“重新生成”，还要看：

```text
app/web/app/api/messages/[id]/route.ts
app/web/app/api/messages/[id]/resend/route.ts
app/web/app/api/messages/[id]/regenerate/route.ts
```

### 修改知识库命中规则

先看：

```text
app/web/lib/services/retrieval.ts
app/web/lib/services/settings.ts
```

运行时设置可能来自：

```text
AppSetting
```

### 修改知识导入

先看：

```text
app/web/lib/services/knowledge.ts
app/web/app/api/knowledge/import-documents/route.ts
scripts/import-seed-knowledge.ts
app/ml-service/app/main.py
```

### 修改索引一致性逻辑

先看：

```text
app/web/lib/services/knowledge-index.ts
docs/POSTGRES_QDRANT_INDEX_CONSISTENCY.md
docs/INCIDENT_2026-04-28_QDRANT_INDEX_DELETION.md
```

### 修改工单流程

先看：

```text
app/web/lib/services/tickets.ts
app/web/app/api/tickets/*
app/web/components/tickets/ticket-detail-client.tsx
```

### 修改导航、侧边栏、布局

先看：

```text
app/web/components/layout/app-shell.tsx
app/web/app/staff/layout.tsx
app/web/app/agent/layout.tsx
app/web/app/admin/layout.tsx
```

### 修改 shadcn/ui 风格

先看：

```text
app/web/components/ui/*
app/web/tailwind.config.ts
app/web/app/globals.css
app/web/components.json
```

### 修改数据库字段

先看：

```text
prisma/schema.prisma
docs/DEVELOPMENT_PLAYBOOK.md
```

然后：

```bash
pnpm db:migrate
```

提交时必须包含：

```text
prisma/schema.prisma
prisma/migrations/.../migration.sql
```

---

## 最高风险文件

这些文件改动前要先读相关文档，并准备回归验证：

```text
app/web/app/api/conversations/[id]/messages/route.ts
app/web/lib/services/retrieval.ts
app/web/lib/services/knowledge-index.ts
app/web/lib/services/knowledge.ts
app/web/lib/services/tickets.ts
prisma/schema.prisma
docker-entrypoint.sh
docker-compose.yml
Dockerfile.web
```

风险原因：

- 聊天 SSE 链路容易出现断流、重复 close、客户端状态不同步。
- 断点续传依赖 `ChatMessage.status` 和 `app/web/lib/active-streams.ts`，刷新/停止生成都要回归。
- RAG 检索影响问答准确性。
- 知识索引影响 Qdrant 与 PostgreSQL 一致性。
- Prisma schema 影响数据安全。
- Docker entrypoint 影响生产启动。
