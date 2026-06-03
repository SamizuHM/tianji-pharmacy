# 接手验收清单

## 目标

本文用于验证一个接手者是否已经具备继续开发本项目的基本上下文。

它也可以作为改动后的回归检查清单。

---

## 0. 基础环境检查

### 代码状态

```bash
git status
git branch --show-current
```

预期：

- 当前分支明确。
- 工作区改动可解释。

### 依赖版本

```bash
node -v
pnpm -v
python3 --version
docker --version
docker compose version
```

参考要求：

- Node.js 20+。
- pnpm 10+。
- Python 3.11 或 3.12 更稳。
- Docker / Docker Compose 可用。

---

## 1. 本地开发启动验收

### 初始化

```bash
pnpm dev:init
```

预期：

- pnpm 依赖安装完成。
- ML Python 虚拟环境和依赖安装完成。
- PostgreSQL 和 Qdrant 已启动。
- Prisma generate 成功。
- migration 成功。
- seed 成功。
- `uploads/` 存在。

### 依赖服务

```bash
pnpm dev:deps
```

检查：

```bash
docker compose ps
```

预期：

- `postgres` 运行。
- `qdrant` 运行。

### ML Service

```bash
pnpm ml:install
pnpm dev:ml
```

另开终端检查：

```bash
curl http://127.0.0.1:8001/health
```

预期：

```json
{ "status": "ok" }
```

### Web

```bash
pnpm dev:web
```

打开：

```text
http://127.0.0.1:3000
```

预期：

- 能进入登录页。
- 不报 Next.js 编译错误。

---

## 2. 登录与角色验收

### 登录

使用 seed 账号登录。

预期：

- staff 能进入员工端。
- department 能进入部门工单端。
- admin 能进入管理端。
- 管理入口按当前权限策略显示。

如果不知道账号，查看：

```text
prisma/seed.ts
```

### 退出

点击退出或调用：

```text
POST /api/auth/logout
```

预期：

- session cookie 清除。
- 重新访问受保护页面会跳回登录。

---

## 3. 员工问答验收

入口：

```text
/staff/chat
```

### 默认新会话

访问：

```text
/staff/chat
```

预期：

- 不自动打开第一条历史会话。
- 不立即创建数据库会话。
- 页面主体是新问答界面。

### 发送第一条消息

输入一个普通问题。

预期：

- 发送后创建会话。
- URL 更新为带 `conversationId`。
- 消息出现在聊天区。
- assistant 回答流式出现。
- 会话历史中出现新会话。

### 知识库命中

输入一条已知知识库中存在的问题。

预期：

- 进度展示包含检索相关步骤。
- 回答来源为知识库或 debug 中能看到命中。
- `retrievalDebugJson` 有召回记录。

### 大模型兜底

输入一条知识库明显没有的问题。

预期：

- 不应错误命中低相关知识。
- 走大模型兜底。

### 图片上传

上传图片后提问。

预期：

- 图片能显示在消息中。
- 后端能处理 `imagePaths`。
- ML Service 不报图片路径错误。

### 消息操作

对已完成的聊天消息执行复制、下载、编辑、删除、重新发送和重新生成。

预期：

- 助手消息 Markdown 表格、列表、代码块显示正常。
- 复制 Markdown 保留格式，复制纯文本去除 Markdown 标记。
- 编辑用户消息后只保存，不会自动重新生成回答。
- 点击重新发送后，该用户消息之后的旧消息被删除，并生成新的助手回复。
- 点击重新生成助手消息后，原助手消息被清空并复用，不新增重复助手消息。
- 正在生成中的消息不能编辑或删除，接口返回 `409`。
- 重新发送或重新生成期间，会话中不能并发启动另一个助手回复。

### 会话删除

点击历史会话删除按钮。

预期：

- 弹出 Dialog 确认。
- 点击取消不删除。
- 点击确认后会话从列表消失。
- 如果删除当前会话，回到 `/staff/chat` 新会话状态。

---

## 4. 工单流程验收

### 员工转人工

在聊天页点击转人工。

预期：

- 创建 Ticket。
- 员工能在 `/staff/tickets` 看到该工单。
- 工单状态为 `pending_claim`。

### department 查看待认领

登录目标部门人员账号。

打开：

```text
/department/tickets
```

预期：

- 能看到待认领工单。
- 待办数量合理。

### 认领

点击认领。

预期：

- 工单状态变为 `processing`。
- `claimedByUserId` 指向当前 department 用户。

### 回复

发送人工回复。

预期：

- 新增 `TicketMessage`。
- 员工侧能看到回复。
- 通知流更新。

### 转派

如果页面支持转派，选择部门或人员转派。

预期：

- 工单状态变为 `escalated`。
- `escalatedToDept` 或 `escalatedToUserId` 正确。
- 目标部门人员可见。

### 提交解决方案并确认解决

部门人员填写解决方案，员工确认问题已解决。

预期：

- `resolutionText` 存在。
- 员工确认后状态为 `resolved`。
- `closedAt` 此时可以为空。
- 关闭前必须先生成 `TicketKnowledgeDraft`，且 `knowledgeStatus` 变为 `pending_writeback`。

---

## 5. 知识库闭环验收

### 生成知识草稿

在工单进入 `resolved` 后，由部门人员在工单详情中选择材料生成知识草稿。

预期：

- 生成 `TicketKnowledgeDraft`。
- 问题、答案、分类、标签合理。

### 写回知识库

确认关闭工单并写回知识库。

预期：

- `closedAt` 存在。
- 状态为 `closed`。
- `knowledgeStatus` 为 `written`。
- 只有提交工单的员工、当前处理部门人员或管理员可以关闭。
- 管理端「知识文档」列表出现工单 QA 文档。
- 生成或更新 `KnowledgeItem` 检索投影。
- 生成或更新 `KnowledgeDocument`、`KnowledgeDocumentVersion`、`KnowledgeParseRun`、`KnowledgeChunkSet`。
- 生成或更新 `KnowledgeChunk`。
- 生成并 drain `KnowledgeIndexTask`。
- Qdrant 中有对应 point。

### 再次问答命中

回到 `/staff/chat`，输入刚沉淀的问题。

预期：

- 能命中新写入知识。
- 不需要重新导入种子知识。

---

## 6. 知识库管理验收

入口：

```text
/admin/knowledge
```

## 6.1 系统设置验收

入口：

```text
/admin/settings
```

### 主题和颜色模式

切换侧边栏主题和颜色模式。

预期：

- 侧边栏主题可在蓝色经典和简约白色之间切换。
- 颜色模式可在白天、夜间、跟随系统之间切换。
- 切换后刷新页面仍保持当前用户的选择。
- `User.sidebarTheme` 和 `User.colorMode` 按当前用户更新。
- 不同账号的偏好互不影响。

### 列表

预期：

- 能看到知识文档。
- 搜索、分页、状态筛选正常。

### 新增

新增一条 QA 知识，预期创建为 QA 文档，并能在文档详情中看到对应 chunk。

预期：

- `KnowledgeDocument` 写入。
- `KnowledgeItem` 检索投影写入。
- `KnowledgeChunk` 写入。
- Qdrant point 写入。

### 编辑

编辑问题或答案。

预期：

- 主数据更新。
- chunk 和索引同步更新。
- 再问答能用新内容。

### 删除

删除一条测试知识。

预期：

- 主数据删除或状态更新符合当前实现。
- Qdrant 对应 point 被清理。

### 重建索引

点击后台重建索引，或执行：

```bash
pnpm kb:rebuild
```

预期：

- 不重新导入知识。
- 用现有 PostgreSQL chunks 重建 Qdrant。
- `pnpm kb:reconcile` 结果一致。

---

## 7. 通知验收

当前通知使用 SSE。

打开 部门工单页，同时在员工端创建/更新工单。

预期：

- 部门人员页面待办数更新。
- 不需要浏览器连接 `3001` 端口。
- 网络请求中应看到 `/api/notifications/stream`。

相关文档：

```text
docs/NOTIFICATION_WS_TO_SSE.md
```

---

## 8. RAG 与索引一致性验收

### 一致性检查

```bash
pnpm kb:reconcile
```

预期：

- PostgreSQL chunks 与 Qdrant points 基本一致。
- 如果不一致，输出能指明缺失或陈旧项。

### 重建

```bash
pnpm kb:rebuild
pnpm kb:reconcile
```

预期：

- 重建后趋于一致。

### 陈旧 point

如果 Qdrant point 对应不到 PostgreSQL chunk：

预期：

- 系统应把它视为陈旧索引。
- 不应该反向删除 PostgreSQL 主数据。

---

## 9. Docker 部署验收

### 配置检查

```bash
docker compose config
```

预期：

- 配置能正常展开。
- 必要环境变量已配置。

### 构建启动

```bash
docker compose up -d --build
```

检查：

```bash
docker compose ps
docker compose logs -f web
docker compose logs -f ml-service
```

预期：

- `postgres` healthy。
- `ml-service` healthy。
- `web` 启动并执行 migrate/seed。
- `cloudflared` 启动，前提是 `CF_TUNNEL_TOKEN` 正确。

### Web entrypoint

`web` 日志应能看到类似：

```text
[0/3] Applying database migrations...
[1/3] Seeding baseline users and settings...
Starting Next.js server in background...
Waiting for Next.js...
Next.js is ready.
```

如果首次导入开启，还会看到知识导入日志。

### 快速启动选项

如果只想跳过首次知识导入：

```env
AUTO_IMPORT_KNOWLEDGE_ON_FIRST_BOOT=false
```

---

## 10. 类型与构建验收

### TypeScript

```bash
pnpm --filter web exec tsc --noEmit
```

预期：

- 无类型错误。

### Web build

```bash
pnpm --filter web build
```

预期：

- Next.js build 成功。

### Docker web build

```bash
pnpm compose:rebuild:web
```

预期：

- 镜像构建成功。
- 容器启动成功。

---

## 11. 文档交接验收

接手者应能根据文档回答：

1. `/staff/chat` 的页面入口和客户端组件分别在哪里？
2. 发送消息的 API 在哪里？
3. RAG 检索在哪个 service？
4. Qdrant 为什么不是主数据？
5. 工单从会话创建的入口在哪里？
6. 工单写回知识库经过哪些表？
7. `pnpm kb:import` 和 `pnpm kb:rebuild` 有什么区别？
8. Docker 启动时 `web` entrypoint 做了什么？
9. 改 `schema.prisma` 后应该提交哪些文件？
10. 历史文档里的 SQLite 和当前 PostgreSQL 如何理解？
11. 消息编辑、重新发送、重新生成分别走哪些 API？
12. 用户颜色模式保存在哪里，支持哪些取值？

如果答不上来，优先阅读：

```text
docs/ONBOARDING.md
docs/CODEBASE_MAP.md
docs/DOMAIN_MODEL.md
docs/DEVELOPMENT_PLAYBOOK.md
docs/GLOSSARY.md
docs/DOCKER_DEPLOYMENT_GUIDE.md
```

---

## 12. 最小接手完成标准

满足以下条件，可以认为已经具备继续开发的基本上下文：

- 能本地启动 Web 和 ML Service。
- 能登录 staff、department 和 admin。
- 能完成一次问答。
- 能转人工、提交处理方案、确认解决并关闭工单。
- 能解释 KnowledgeDocument、KnowledgeItem 投影、KnowledgeChunk、Qdrant point 的关系。
- 能执行并理解 `pnpm kb:reconcile`。
- 能说明 Docker 中 web entrypoint 的职责。
- 能解释聊天消息编辑、重新发送、重新生成的差异。
- 能说明侧边栏主题和颜色模式的持久化字段。
- 能完成一次小 UI 改动并通过 TypeScript 检查。
