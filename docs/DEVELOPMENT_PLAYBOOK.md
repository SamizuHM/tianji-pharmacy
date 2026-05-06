# 开发任务手册

## 目标

本文面向“接手后要开始改需求”的开发者。

它回答：

- 常见需求应该改哪些文件。
- 改完后怎么验证。
- 哪些地方有风险。
- 提交前应该检查什么。

---

## 通用开发流程

### 1. 开始前

```bash
git status
git branch --show-current
```

确认：

- 工作区是否有未提交改动。
- 未提交改动是否是你自己的。
- 当前分支是否正确。

不要覆盖别人改动。

### 2. 启动本地环境

首次：

```bash
bash scripts/init.sh
```

准备 ML 环境：

```bash
cd app/ml-service
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ../..
```

启动：

```bash
pnpm dev
```

如果只改前端静态样式，并且依赖服务已经跑着，可以只启 Web：

```bash
pnpm dev:web
```

### 3. 修改代码

优先顺序：

1. 先定位页面或 API 入口。
2. 再定位 service。
3. 最后才改底层工具或数据模型。

不要一开始就改共享底层逻辑。

### 4. 验证

至少执行：

```bash
pnpm --filter web exec tsc --noEmit
```

根据改动类型追加验证：

| 改动类型 | 建议验证 |
|---|---|
| 前端 UI | 浏览器手动验证桌面和移动端 |
| API | curl 或页面触发 |
| Prisma schema | `pnpm db:migrate` + 检查 migration.sql |
| RAG/知识库 | 问答命中、`pnpm kb:reconcile` |
| Docker | `docker compose config` + 对应 compose rebuild |
| ML Service | `curl /health` + 相关接口样例 |

### 5. 提交

```bash
git diff --stat
git status
git add ...
git commit -m "..."
```

提交信息建议：

```text
feat: ...
fix: ...
refactor: ...
docs: ...
style: ...
```

---

## 修改聊天页 UI

主要文件：

```text
app/web/components/chat/chat-client.tsx
app/web/app/staff/chat/page.tsx
```

常见需求：

- 调整输入框。
- 调整消息气泡。
- 调整移动端布局。
- 调整会话历史。
- 调整删除确认。
- 调整进度展示。

判断规则：

- 页面初始数据、权限、服务端查询：看 `page.tsx`。
- 用户交互、状态、弹窗、SSE、上传：看 `chat-client.tsx`。

验证：

1. 打开 `/staff/chat`。
2. 无 `conversationId` 时应显示新会话界面。
3. 发送第一条消息后才创建会话。
4. 历史会话切换正常。
5. 删除会话有确认。
6. 移动端主体不可纵向滚动，聊天区域滚动正常。

注意：

- 不要让 PC 端主页面出现整体纵向滚动。
- 移动端要保留底部输入框。
- SSE 状态不要重复追加消息。

---

## 修改聊天发送和回答链路

核心文件：

```text
app/web/app/api/conversations/[id]/messages/route.ts
app/web/lib/services/retrieval.ts
app/web/lib/openai.ts
app/web/lib/chat-progress.ts
```

这条链路高风险。

修改前先读：

```text
docs/RAG_MULTIMODAL_PIPELINE.md
docs/POSTGRES_QDRANT_INDEX_CONSISTENCY.md
```

关键点：

- API 使用 SSE 返回进度和最终答案。
- 客户端可能断开连接。
- 服务端要避免在 stream controller close 后继续 enqueue。
- 用户消息和 assistant 消息都要正确入库。
- `retrievalDebugJson` 对排查很重要，不要随意删。

验证：

1. 纯文字提问。
2. 纯图片提问。
3. 图文混合提问。
4. 知识库命中。
5. 大模型兜底。
6. 浏览器刷新或中断流时服务端不应报 `Controller is already closed`。

---

## 修改 RAG 检索策略

核心文件：

```text
app/web/lib/services/retrieval.ts
app/web/lib/openai.ts
app/web/lib/services/settings.ts
app/web/lib/retrieval/ml-service.ts
app/web/lib/retrieval/qdrant.ts
```

主流程：

```text
rewrite query
  -> embed
  -> qdrant search
  -> rerank
  -> threshold decision
  -> PostgreSQL 校验
```

常见需求：

- 调整命中阈值。
- 调整 topK。
- 调整 rerank topN。
- 调整 query rewrite prompt。
- 调整多轮上下文是否参与检索。
- 调整图片参与检索方式。

验证：

- 找一条已知知识，确认能命中。
- 找一条无关问题，确认不会误命中。
- 查看 `retrievalDebugJson`。
- 注意 rerank 分数和阈值。

原则：

```text
检索侧优先稳健，避免历史回答污染当前轮召回。
生成侧可以使用会话上下文提升表达连贯性。
```

---

## 修改知识库管理

页面和组件：

```text
app/web/app/admin/knowledge/page.tsx
app/web/components/knowledge/knowledge-admin.tsx
app/web/components/knowledge/knowledge-table.tsx
app/web/components/knowledge/rich-editor.tsx
```

API：

```text
app/web/app/api/knowledge/route.ts
app/web/app/api/knowledge/[id]/route.ts
app/web/app/api/knowledge/bulk/route.ts
app/web/app/api/knowledge/reindex/[id]/route.ts
app/web/app/api/knowledge/rebuild-index/route.ts
```

服务：

```text
app/web/lib/services/knowledge.ts
app/web/lib/services/knowledge-index.ts
```

注意：

- 改 KnowledgeItem 通常会影响 KnowledgeChunk。
- 改 KnowledgeChunk 通常会影响 Qdrant。
- 删除/更新知识后要考虑索引任务。

验证：

1. 新增知识。
2. 编辑知识。
3. 删除知识。
4. 单条重建索引。
5. 全量重建索引。
6. 回到聊天页验证可命中。

---

## 修改知识导入

入口：

```text
app/web/app/api/knowledge/import-documents/route.ts
scripts/import-seed-knowledge.ts
scripts/should-import-knowledge.ts
```

核心服务：

```text
app/web/lib/services/knowledge.ts
app/ml-service/app/main.py
```

导入来源：

```text
seed_knowledge/
药店门店智能问答轻量级知识库.docx
信息部常见问题详解/
```

支持范围见：

```text
docs/KNOWLEDGE_IMPORT_GUIDE.md
```

验证：

```bash
pnpm kb:import
pnpm kb:reconcile
```

然后去 `/admin/knowledge` 和 `/staff/chat` 验证。

注意：

- `import` 是导入知识主数据。
- `rebuild` 是用已有主数据重建 Qdrant。
- 不要混淆。

---

## 修改 Qdrant 索引逻辑

最高风险文件：

```text
app/web/lib/services/knowledge-index.ts
```

相关：

```text
app/web/lib/services/knowledge.ts
app/web/lib/services/retrieval.ts
scripts/drain-knowledge-index.ts
scripts/rebuild-knowledge-index.ts
scripts/reconcile-knowledge-index.ts
```

必须先读：

```text
docs/POSTGRES_QDRANT_INDEX_CONSISTENCY.md
docs/INCIDENT_2026-04-28_QDRANT_INDEX_DELETION.md
```

核心原则：

```text
PostgreSQL 是主数据。
Qdrant 是派生索引。
修复方向永远是用 PostgreSQL 修 Qdrant。
```

验证：

```bash
pnpm kb:reconcile
pnpm kb:rebuild
pnpm kb:reconcile
```

再执行一次已知知识问答。

不要做：

- 因为 Qdrant 缺 point 就删除 PostgreSQL chunk。
- 没有保护条件就批量创建 delete task。
- 修改稳定 point id 规则但不写迁移/兼容逻辑。

---

## 修改工单流程

页面：

```text
app/web/app/staff/tickets/page.tsx
app/web/app/staff/tickets/[id]/page.tsx
app/web/app/agent/tickets/page.tsx
app/web/app/agent/tickets/[id]/page.tsx
```

组件：

```text
app/web/components/tickets/ticket-list.tsx
app/web/components/tickets/ticket-detail-client.tsx
app/web/components/tickets/org-tree-select.tsx
```

API：

```text
app/web/app/api/tickets/*
```

服务：

```text
app/web/lib/services/tickets.ts
```

常见需求：

- 修改工单状态流转。
- 修改列表筛选。
- 修改认领逻辑。
- 修改升级逻辑。
- 修改关闭逻辑。
- 修改知识草稿生成。

验证：

1. 员工转人工。
2. agent 能看到待认领工单。
3. agent 认领后状态变为 processing。
4. agent 回复。
5. agent 升级到部门或人员。
6. agent 提交解决方案。
7. 关闭工单。
8. 可生成并写回知识库。

注意：

- `canAccessTicket()` 是权限判断关键函数。
- 改权限一定要同时验证 staff 和 agent。
- 工单事件会触发 SSE 通知。

---

## 修改通知

当前通知使用 SSE，不使用独立 WebSocket 端口。

核心文件：

```text
app/web/app/api/notifications/stream/route.ts
app/web/lib/notifications/server.ts
```

历史背景：

```text
docs/NOTIFICATION_WS_TO_SSE.md
```

验证：

1. 打开 agent 工单页。
2. 员工创建工单。
3. agent 页面待办数量更新。
4. 工单回复/关闭后通知变化正常。

注意：

- 不要重新引入独立 `3001` 端口，除非同步修改 cloudflared/部署方案。
- 当前部署入口是 `cloudflared -> web:3000`。

---

## 修改登录、角色、权限

核心文件：

```text
app/web/lib/auth/session.ts
app/web/app/api/auth/login/route.ts
app/web/components/forms/login-form.tsx
prisma/seed.ts
prisma/schema.prisma
```

角色相关：

```text
UserRole.staff
UserRole.agent
```

如果要新增角色：

1. 修改 `schema.prisma` enum。
2. 生成 migration。
3. 修改 seed。
4. 修改 session/权限判断。
5. 修改 AppShell 导航。
6. 修改中间件或页面跳转。
7. 验证所有角色登录。

这是中高风险变更。

---

## 修改 UI 基础组件

基础组件：

```text
app/web/components/ui/*
```

主题：

```text
app/web/tailwind.config.ts
app/web/app/globals.css
app/web/components.json
```

注意：

- 本项目使用本地 shadcn 风格组件。
- shadcn 组件是源码复制进项目，不是运行时远程依赖。
- 当前 Button 已有项目定制风格。
- 修改 Button 会影响全站。

验证：

- 登录页。
- 聊天页。
- 工单列表。
- 知识库表格。
- 设置页。
- 移动端。

---

## 修改 Prisma schema

流程：

```bash
pnpm db:migrate
pnpm --filter web exec tsc --noEmit
```

必须检查：

```text
prisma/migrations/.../migration.sql
```

安全判断：

| 变更 | 风险 |
|---|---|
| 新增可空字段 | 低 |
| 新增有默认值字段 | 中低 |
| 新增非空无默认字段 | 高，已有数据会失败 |
| 字段改名 | 高，可能变成 drop + add |
| 删除字段 | 高，会丢数据 |
| 拆表/合表 | 高，需要数据迁移脚本 |
| enum 删除值 | 高，已有数据可能不兼容 |

部署环境只用：

```bash
pnpm db:deploy
```

Docker 中由 entrypoint 自动执行：

```bash
npx prisma migrate deploy
```

不要在生产运行：

```bash
pnpm db:reset
```

---

## 修改 Docker 或部署

相关文件：

```text
docker-compose.yml
Dockerfile.web
Dockerfile.ml
docker-entrypoint.sh
docs/DOCKER_DEPLOYMENT_GUIDE.md
```

验证：

```bash
docker compose config
pnpm compose:rebuild:web
docker compose ps
docker compose logs -f web
```

如果改 ML：

```bash
pnpm compose:rebuild:ml
docker compose logs -f ml-service
```

注意：

- `web` 没有映射宿主机 `3000`，默认通过 cloudflared 对外。
- `ml-service` 和 `qdrant` 也没有映射宿主机端口。
- `prisma/migrations` 是 build 时拷进 web 镜像的。
- 改 migration 后要重建 web 镜像。
- entrypoint 要保持幂等。

---

## 修改 ML Service

核心文件：

```text
app/ml-service/app/main.py
app/ml-service/requirements.txt
Dockerfile.ml
scripts/dev-ml.sh
```

接口：

```text
GET  /health
POST /embed
POST /embed-multimodal
POST /rerank
POST /rerank-multimodal
POST /parse-document
POST /chat-multimodal-stream
```

验证：

```bash
curl http://127.0.0.1:8001/health
```

如果改了 Docker：

```bash
pnpm compose:rebuild:ml
```

注意：

- `web` 和 `ml-service` 通过 `/app/uploads` 共享上传文件。
- 容器内 `ROOT_DIR=/app`。
- 本地开发和 Docker 下路径不同，路径处理要谨慎。

---

## 常见故障处理

### Web 启动失败，提示数据库连不上

检查：

```bash
docker compose ps
echo $DATABASE_URL
```

本地开发要用：

```text
127.0.0.1:5432
```

Docker 容器内要用：

```text
postgres:5432
```

### ML Service 失败

检查：

```bash
curl http://127.0.0.1:8001/health
docker compose logs -f ml-service
```

常见原因：

- Python venv 没装依赖。
- API key 未配置。
- DashScope endpoint 或模型名错误。
- 上传文件路径在本地和容器内不一致。

### 问答一直走大模型

检查：

1. 是否有 `KnowledgeItem`。
2. 是否有 `KnowledgeChunk`。
3. Qdrant collection 是否有 points。
4. rerank score 是否超过阈值。
5. `KnowledgeItem.status` 是否是 `published`。

执行：

```bash
pnpm kb:reconcile
```

必要时：

```bash
pnpm kb:rebuild
```

### 修改 schema 后类型报错

执行：

```bash
pnpm db:generate
pnpm --filter web exec tsc --noEmit
```

如果是新增 schema 变更：

```bash
pnpm db:migrate
```

### Docker 首次启动很慢

原因通常是：

- 构建镜像。
- Prisma migrate。
- seed。
- 首次知识库导入。
- embedding 和 Qdrant 写入。

如果只想快速启动 Web：

```env
AUTO_IMPORT_KNOWLEDGE_ON_FIRST_BOOT=false
```

---

## 提交前检查清单

通用：

```bash
git status
git diff --stat
pnpm --filter web exec tsc --noEmit
```

如果改 Prisma：

```bash
pnpm db:migrate
```

检查：

```text
prisma/migrations/.../migration.sql
```

如果改知识库索引：

```bash
pnpm kb:reconcile
```

如果改 Docker：

```bash
docker compose config
```

如果改 UI：

- 桌面端看一遍。
- 移动端看一遍。
- 登录页、聊天页、工单页至少抽查。

---

## 开发原则

1. **PostgreSQL 优先**

   业务真相在 PostgreSQL，不在 Qdrant。

2. **先 service 后 API**

   业务逻辑尽量放 `lib/services`，API route 做权限、参数和响应。

3. **危险 schema 变更必须看 SQL**

   不要盲信自动生成的 migration。

4. **Docker entrypoint 保持幂等**

   容器重启会重新执行 entrypoint。

5. **RAG 链路改动必须可观测**

   保留 debug 信息、进度事件和日志。

6. **移动端和 PC 端都要验证**

   聊天页尤其如此。

7. **不要扩大无关改动**

   小需求不要顺手重构大模块。

