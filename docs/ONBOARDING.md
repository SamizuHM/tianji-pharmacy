# 项目接手路线图

## 目标

本文是交接主入口。目标是让一个没有参与过本项目开发的工程师，在 1 天内完成以下事情：

1. 知道系统解决什么业务问题。
2. 能在本地把项目跑起来。
3. 知道核心页面、API、服务、数据库模型分别在哪里。
4. 能判断一个需求应该改哪些文件。
5. 能完成一次小改动、验证、提交。
6. 遇到知识库、Qdrant、Docker、Prisma 相关问题时知道先看哪篇文档。

如果你只读一篇文档，请先读这篇。

---

## 项目一句话说明

本项目是“药店门店智能问答系统”。

主要能力：

- 门店员工在 `/staff/chat` 提问。
- 系统先走知识库 RAG 检索。
- 命中知识库时返回标准答案。
- 未命中时走大模型兜底。
- 员工可以把会话转成人工工单。
- 部门人员在 `/department/tickets` 处理分发或转派到本部门的工单。
- 管理员在 `/admin/*` 维护区域、部门、用户、知识库和系统设置。
- 工单解决后可以沉淀为新知识。
- 知识主数据在 PostgreSQL，向量索引在 Qdrant。
- 多模态 embedding、rerank、图片理解由 Python `ml-service` 提供。

最重要的心智模型：

```text
Next.js Web = 业务中枢
PostgreSQL = 权威主数据
Qdrant = 可重建的派生向量索引
ML Service = AI 能力辅助服务
```

---

## 接手首日建议路线

### 第 0 步：先确认你在正确分支和干净工作区

```bash
git status
git branch --show-current
```

如果工作区有别人未提交的改动，不要直接覆盖。先问清楚或只在不冲突文件上工作。

### 第 1 小时：读这 5 个入口文件

按顺序读：

1. `README.md`
   - 看系统功能、启动方式、环境变量。

2. `docs/ONBOARDING.md`
   - 当前这篇，建立主线。

3. `docs/CODEBASE_MAP.md`
   - 看代码地图，知道页面、API、服务层在哪里。

4. `docs/DOMAIN_MODEL.md`
   - 看业务模型，理解会话、消息、工单、知识库、索引任务的关系。

5. `docs/DEVELOPMENT_PLAYBOOK.md`
   - 看常见开发任务怎么改、怎么验证。

这 5 篇读完，你应该能回答：

- 聊天页入口在哪里？
- 发送消息的 API 在哪里？
- RAG 检索在哪里？
- 工单创建和处理在哪里？
- 知识库写入后怎么同步到 Qdrant？
- Docker 启动时为什么会迁移数据库和导入知识？

### 第 2 小时：本地跑起来

推荐本地开发模式：

```bash
pnpm dev:init
pnpm dev
```

`pnpm dev:init` 会准备 pnpm 依赖、Python 虚拟环境、PostgreSQL、Qdrant、Prisma migration、seed 和 `uploads/`。

`pnpm dev` 会先检查 `.env`、PostgreSQL、Qdrant、Python venv，再执行：

```text
pnpm db:migrate
并发启动 web 和 ml
```

其中 `pnpm dev:web` 最终执行 `next dev --turbopack`。如果只需要启动基础依赖，执行 `pnpm dev:deps`；它会通过 `docker-compose.dev.yml` 把 PostgreSQL 暴露到本机 `127.0.0.1:5432`，把 Qdrant 暴露到本机 `127.0.0.1:6333`。如果只需要修复 ML 环境，执行 `pnpm ml:install`。

如果你只想启动 Web：

```bash
pnpm dev:web
```

如果你只想启动 ML：

```bash
pnpm dev:ml
```

健康检查：

```bash
curl http://127.0.0.1:8001/health
curl http://127.0.0.1:6333/collections
```

打开：

```text
http://127.0.0.1:3000
```

### 第 3 小时：跑一遍主业务流程

参考：

- `docs/ACCEPTANCE_CHECKLIST.md`
- `docs/DEMO_GUIDE.md`

最小流程：

1. 登录员工账号。
2. 进入 `/staff/chat`。
3. 新建会话提问。
4. 看是否知识库命中。
5. 未解决时转人工。
6. 登录人工账号。
7. 认领/回复/转派/提交处理方案。
8. 员工确认已解决后，生成待入库知识草稿，再关闭工单写回知识库。
9. 到知识库管理页确认数据。
10. 重建索引后再问一次。

### 第 4 小时：读核心代码路径

按业务链路读，而不是按目录树读：

```text
页面入口：
  app/web/app/staff/chat/page.tsx

聊天客户端：
  app/web/components/chat/chat-client.tsx

会话创建/列表/删除：
  app/web/app/api/conversations/route.ts
  app/web/app/api/conversations/[id]/route.ts
  app/web/lib/services/conversations.ts

消息发送和 SSE：
  app/web/app/api/conversations/[id]/messages/route.ts
  app/web/lib/services/chat-generation.ts

消息编辑、重新发送、重新生成：
  app/web/app/api/messages/[id]/route.ts
  app/web/app/api/messages/[id]/resend/route.ts
  app/web/app/api/messages/[id]/regenerate/route.ts

RAG 检索：
  app/web/lib/services/retrieval.ts
  app/web/lib/retrieval/qdrant.ts
  app/web/lib/retrieval/ml-service.ts

大模型调用：
  app/web/lib/openai.ts

工单：
  app/web/lib/services/tickets.ts
  app/web/components/tickets/ticket-list.tsx
  app/web/components/tickets/ticket-detail-client.tsx

知识库：
  app/web/lib/services/knowledge.ts
  app/web/lib/services/knowledge-index.ts
  app/web/components/knowledge/knowledge-admin.tsx

ML 服务：
  app/ml-service/app/main.py
```

### 第 5-6 小时：做一个小改动

建议从低风险任务开始：

- 修改某个按钮文案。
- 调整某个页面布局。
- 增加一个列表字段。
- 调整工单筛选。
- 增加一条运行时设置。

不要接手首日直接改这些高风险链路：

- `app/web/app/api/conversations/[id]/messages/route.ts`
- `app/web/lib/services/retrieval.ts`
- `app/web/lib/services/knowledge-index.ts`
- `prisma/schema.prisma`
- `docker-entrypoint.sh`

这些不是不能改，而是必须先完整理解数据流和验证方式。

### 第 7 小时：跑验证

至少执行：

```bash
pnpm --filter web exec tsc --noEmit
```

如果改了 Docker：

```bash
docker compose config
pnpm compose:rebuild:web
docker compose logs -f web
```

如果改了 Prisma schema：

```bash
pnpm db:migrate
pnpm --filter web exec tsc --noEmit
```

如果改了知识库或索引：

```bash
pnpm kb:reconcile
pnpm kb:rebuild
```

### 第 8 小时：交付说明

提交前：

```bash
git status
git diff --stat
```

提交时说明：

- 改了什么。
- 为什么这样改。
- 验证了什么。
- 是否有未验证风险。

---

## 你最应该先理解的 7 条主线

### 1. 登录与角色

入口：

```text
app/web/app/login/page.tsx
app/web/components/forms/login-form.tsx
app/web/app/api/auth/login/route.ts
app/web/lib/auth/session.ts
```

当前 Prisma 角色：

```text
staff
department
admin
```

历史文档里可能出现：

```text
人工1
人工2
L1
L2
human_l1
human_l2
```

这些是历史称呼或业务分层称呼。当前数据库角色已经统一为 `staff` / `department` / `admin`，具体可见 `docs/GLOSSARY.md`。

### 2. 员工问答

入口：

```text
/staff/chat
```

核心文件：

```text
app/web/app/staff/chat/page.tsx
app/web/components/chat/chat-client.tsx
app/web/app/api/conversations/[id]/messages/route.ts
```

关键行为：

- 访问 `/staff/chat` 默认是空的新会话界面。
- 点击“新建会话”不立即写数据库。
- 用户发送第一条消息时才创建 `Conversation`。
- 消息 API 用 SSE 流式返回进度和答案。
- 聊天生成逻辑集中在 `chat-generation.ts`，发送、编辑后重发、重新生成都复用它。
- 助手消息展示支持 Markdown，固定转人工提示由前端单独展示，新助手消息不再把它写入正文。
- 编辑用户消息后重新发送会删除该消息之后的旧消息；重新生成助手消息会复用原助手消息。

### 3. RAG 检索

核心文件：

```text
app/web/lib/services/retrieval.ts
app/web/lib/retrieval/ml-service.ts
app/web/lib/retrieval/qdrant.ts
app/web/lib/openai.ts
```

主流程：

```text
用户问题
  -> 多模态 query rewrite
  -> 多 query 向量召回
  -> BM25 关键词召回
  -> RRF 合并并按城市范围加权
  -> 多模态 rerank
  -> 读取 PostgreSQL knowledgeChunk / knowledgeItem 校验
  -> 分数超过阈值则用知识库
  -> 否则走大模型兜底
```

注意：

- Qdrant 不是权威数据。
- Qdrant 命中后仍要回 PostgreSQL 校验 chunk 是否存在。
- 如果 Qdrant point 已陈旧，会创建删除任务清理。
- 医保、用药等强约束问题未命中可靠知识时会拒答，不让大模型自由编造。

### 4. 工单

入口：

```text
/staff/tickets
/department/tickets
```

核心文件：

```text
app/web/lib/services/tickets.ts
app/web/components/tickets/ticket-list.tsx
app/web/components/tickets/ticket-detail-client.tsx
app/web/app/api/tickets/*
```

主流程：

```text
员工会话
  -> 转人工
  -> 创建 Ticket
  -> 自动分发到部门
  -> department 认领/处理/转派
  -> department 提交处理方案
  -> staff 确认问题已解决
  -> department 生成知识草稿
  -> 关闭并写回 QA 知识文档
```

### 5. 知识库

入口：

```text
/admin/knowledge
```

核心文件：

```text
app/web/lib/services/knowledge.ts
app/web/lib/services/knowledge-index.ts
app/web/components/knowledge/knowledge-admin.tsx
app/web/app/api/knowledge/*
```

主原则：

```text
PostgreSQL = 主数据
Qdrant = 派生索引
```

这条原则非常重要。任何一致性修复都应该以 PostgreSQL 为准修 Qdrant，而不是反过来。

### 6. Docker 部署

看：

```text
docs/DOCKER_DEPLOYMENT_GUIDE.md
docker-compose.yml
Dockerfile.web
Dockerfile.ml
docker-entrypoint.sh
```

关键点：

- `web` 容器启动时会执行 `docker-entrypoint.sh`。
- entrypoint 会执行 `prisma migrate deploy` 和 `prisma/seed.ts`。
- 首次启动还可能自动导入知识库。
- `web`、`ml-service`、`qdrant` 通过 Compose service name 通信。

### 7. 数据库迁移

核心文件：

```text
prisma/schema.prisma
prisma/migrations
prisma/seed.ts
```

开发改 schema：

```bash
pnpm db:migrate
```

部署应用 migration：

```bash
pnpm db:deploy
```

Docker 中由 `web` entrypoint 自动执行：

```bash
npx prisma migrate deploy
```

---

## 文档阅读顺序

### 快速接手

1. `docs/ONBOARDING.md`
2. `docs/CODEBASE_MAP.md`
3. `docs/DOMAIN_MODEL.md`
4. `docs/DEVELOPMENT_PLAYBOOK.md`
5. `docs/ACCEPTANCE_CHECKLIST.md`

### 部署与 Docker

1. `docs/DOCKER_DEPLOYMENT_GUIDE.md`
2. `README.md` 的启动章节
3. `docker-compose.yml`
4. `Dockerfile.web`
5. `docker-entrypoint.sh`

### RAG 与知识库

1. `docs/RAG_MULTIMODAL_PIPELINE.md`
2. `docs/POSTGRES_QDRANT_INDEX_CONSISTENCY.md`
3. `docs/KNOWLEDGE_IMPORT_GUIDE.md`
4. `docs/INCIDENT_2026-04-28_QDRANT_INDEX_DELETION.md`

### API 和演示

1. `docs/API_GUIDE.md`
2. `docs/DEMO_GUIDE.md`

### 历史方案

1. `docs/NOTIFICATION_WS_TO_SSE.md`
2. `docs/INCIDENT_2026-04-28_QDRANT_INDEX_DELETION.md`

---

## 第一眼容易误解的地方

### 误解 1：Qdrant 是知识库主数据

不是。

```text
PostgreSQL 中的 KnowledgeDocument / KnowledgeChunkSet / KnowledgeChunk 是知识库主数据。
KnowledgeItem 是检索投影，Qdrant 只是派生索引。
```

### 误解 2：访问 /staff/chat 会自动创建会话

不是。

当前行为是：

```text
打开 /staff/chat
  -> 显示新会话界面
  -> 不写数据库
用户发送第一条消息
  -> 创建 Conversation
  -> 创建 ChatMessage
  -> 继续问答流程
```

### 误解 3：Docker 里的 web 只负责启动 Next.js

不是。

`web` entrypoint 还负责：

- migrate
- seed
- 等待 Next.js ready
- 首次知识库导入

### 误解 4：改了 migration 后容器会自动拿到

不是。

`prisma/migrations` 是 build 时复制到 `web` 镜像里的。改了 migration 后要重建 `web` 镜像。

### 误解 5：历史文档里的 SQLite 是当前状态

不是。

当前主数据库是 PostgreSQL。事故复盘里提到 SQLite，是历史事故发生时的背景或旧表述，阅读时以 `docs/GLOSSARY.md` 为准。

---

## 接手首日不要做什么

除非已经完整理解并有备份/验证方案，否则不要：

- 删除 `prisma/migrations`。
- 直接清空 Docker volumes。
- 手动删除 Qdrant collection。
- 在生产库运行 `pnpm db:reset`。
- 修改 `KnowledgeChunk.qdrantPointId` 的生成策略。
- 把 Qdrant 状态当作主数据反向修改 PostgreSQL。
- 在没有检查 `migration.sql` 的情况下提交危险 schema 变更。
- 在 `docker-entrypoint.sh` 中增加长耗时、不幂等、不可重试的逻辑。

---

## 推荐提问方式

如果接手时遇到问题，建议按这种格式描述：

```text
我在做什么：
  例如：修改聊天页发送消息后的状态展示

我改了哪些文件：
  app/web/components/chat/chat-client.tsx

我执行了什么：
  pnpm --filter web exec tsc --noEmit

实际现象：
  ...

预期现象：
  ...

相关日志：
  ...
```

这样更容易快速定位是前端状态、API、数据库、Qdrant、ML 服务还是 Docker 启动问题。
