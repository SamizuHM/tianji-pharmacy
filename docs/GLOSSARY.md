# 名词表与历史表述对照

## 目标

本文用于统一项目中的术语，尤其是处理历史文档、旧提交、业务口头说法和当前代码实现之间的差异。

阅读规则：

- 当前代码和 `prisma/schema.prisma` 优先。
- 历史事故复盘和方案演进文档保留原始语境。
- 如果历史文档中的术语和当前实现不一致，以本文说明为准。

---

## 当前核心技术名词

### Web

指 Next.js 主应用。

目录：

```text
app/web
```

职责：

- 页面渲染。
- 用户登录。
- 业务 API。
- 聊天 SSE。
- 工单流转。
- 知识库管理。
- 调用 PostgreSQL、Qdrant、ML Service。

Docker service 名：

```text
web
```

### ML Service

指 Python FastAPI 服务。

目录：

```text
app/ml-service
```

职责：

- embedding。
- rerank。
- 图片处理。
- 文档解析。
- 多模态对话流。

Docker service 名：

```text
ml-service
```

### PostgreSQL

当前主业务数据库。

存储：

- 用户。
- session。
- 会话。
- 消息。
- 工单。
- 知识库主数据。
- 知识 chunk。
- 知识索引任务。
- 系统设置。

当前原则：

```text
PostgreSQL 是权威主数据。
```

### Qdrant

向量数据库。

用途：

- 存储 `KnowledgeChunk` 对应的向量 point。
- 支持向量召回。

当前原则：

```text
Qdrant 是可重建的派生索引，不是主数据。
```

### Prisma

数据库 ORM 和 migration 工具。

核心文件：

```text
prisma/schema.prisma
prisma/migrations
prisma/seed.ts
```

常用命令：

```text
pnpm db:generate
pnpm db:migrate
pnpm db:deploy
pnpm db:reset
```

---

## 角色与业务称呼

### staff

当前 `UserRole`。

含义：

```text
门店工作人员 / 药店员工
```

主要入口：

```text
/staff/chat
/staff/tickets
```

主要能力：

- 智能问答。
- 上传图片。
- 查看历史会话。
- 转人工工单。
- 查看自己提交的工单。

### agent

当前 `UserRole`。

含义：

```text
人工处理人员
```

主要入口：

```text
/agent/tickets
```

主要能力：

- 查看待处理工单。
- 认领工单。
- 回复工单。
- 升级工单。
- 提交解决方案。
- 关闭工单。
- 沉淀知识。

### 人工1 / 人工2

历史业务称呼。

当前代码中不再作为 Prisma 用户角色存在。

大致语义：

| 历史称呼 | 当前实现对应 |
|---|---|
| 人工1 | 无部门 agent，主要处理待认领工单 |
| 人工2 | 有部门或被升级目标匹配的 agent |

当前实现不是通过 `UserRole.human_l1` / `UserRole.human_l2` 区分，而是通过：

```text
User.role = agent
User.departmentId
Ticket.status
Ticket.claimedByUserId
Ticket.escalatedToDept
Ticket.escalatedToUserId
```

共同判断可见性和处理权限。

### L1 / L2

历史或文档里的分层说法。

当前建议理解为：

```text
L1 = 一线待认领处理
L2 = 被升级到部门或专家处理
```

不要把它理解成当前数据库角色。

### human_l1 / human_l2

旧实现或旧文档中的角色名。

当前 `schema.prisma` 中已经没有这两个 enum 值。

看到它们时，应理解为历史上下文。

---

## 问答与消息名词

### Conversation

会话。

一个员工可以有多个会话。

当前行为：

- 打开 `/staff/chat` 不立即创建会话。
- 发送第一条消息时才创建会话。
- 删除会话是软删除，写 `deletedAt`。

### ChatMessage

会话消息。

可能角色：

```text
user
assistant
agent
system
```

可能来源：

```text
kb
llm
manual
system
```

### sourceType

消息来源类型。

| 值 | 含义 |
|---|---|
| `kb` | 知识库命中后的回答 |
| `llm` | 大模型兜底回答 |
| `manual` | 人工回复 |
| `system` | 系统消息 |

### retrievalDebugJson

检索调试信息。

常用于排查：

- Qdrant 召回了什么。
- rerank 分数是多少。
- 为什么没有达到知识库命中阈值。
- 是否命中了陈旧 point。

---

## RAG 与知识库名词

### RAG

Retrieval-Augmented Generation。

当前系统里的 RAG 流程：

```text
问题
  -> query rewrite
  -> embedding
  -> Qdrant search
  -> rerank
  -> PostgreSQL 校验
  -> 命中知识库或走大模型
```

### KnowledgeItem

知识条目主表。

表示一条标准问答知识。

### KnowledgeChunk

知识分块。

RAG 检索的最小单位。

一个 `KnowledgeItem` 可以对应多个 `KnowledgeChunk`。

### qdrantPointId

`KnowledgeChunk` 对应的 Qdrant point id。

当前应保持稳定。

不要轻易修改生成策略。

### KnowledgeIndexTask

知识索引任务。

用于记录对 Qdrant 的 upsert/delete 操作。

为什么需要：

- PostgreSQL 和 Qdrant 不是一个事务系统。
- 先写主数据，再异步或同步 drain 索引任务。
- 失败可重试。

### import

导入知识主数据。

来源可能是：

- `seed_knowledge/`
- Word 文档。
- 图片文档。
- 后台上传。

命令：

```bash
pnpm kb:import
```

### rebuild

重建 Qdrant 索引。

语义：

```text
用 PostgreSQL 里现有 KnowledgeChunk 重新写 Qdrant。
```

它不会重新导入种子知识。

命令：

```bash
pnpm kb:rebuild
```

### reconcile

一致性检查。

语义：

```text
检查 PostgreSQL 与 Qdrant 是否一致。
```

命令：

```bash
pnpm kb:reconcile
```

### drain

处理 pending 索引任务。

命令：

```bash
pnpm kb:drain
```

---

## 工单名词

### Ticket

人工工单。

通常由员工从会话转人工生成。

### pending_claim

待认领。

通常是一线人工可见。

### processing

处理中。

工单已被某个 agent 认领。

### escalated

已升级。

可能升级到：

- 某个部门。
- 某个具体 agent。

### resolved

已确认解决。

药店工作人员已经确认人工处理方案解决了问题。进入该状态后，客服才能生成待入库知识草稿。

### closed

已关闭。

工单已完成知识写回或闭环结束。当前实现要求工单先进入 `resolved`，并完成待入库知识生成后才能关闭写回。

### TicketKnowledgeDraft

工单知识草稿。

不是最终知识库数据。

确认写回后才会生成或更新 `KnowledgeItem`。

---

## 部署名词

### Docker Compose

当前部署编排。

服务：

```text
postgres
qdrant
ml-service
web
cloudflared
```

### cloudflared

Cloudflare Tunnel 容器。

用途：

```text
外部访问 -> cloudflared -> web:3000
```

### expose

Docker Compose 中只对内部网络暴露端口。

### ports

映射到宿主机端口。

当前只有 PostgreSQL 默认映射了：

```text
5432:5432
```

### entrypoint

容器启动入口。

当前 Web 容器入口：

```text
docker-entrypoint.sh
```

它会执行：

- `prisma migrate deploy`
- `prisma/seed.ts`
- 启动 Next.js
- 等待 ready
- 可选首次知识库导入

---

## 历史冲突说明

### SQLite

当前主数据库是 PostgreSQL。

如果你在历史事故复盘中看到 SQLite，说明那篇文档记录的是事故发生时或旧版本上下文。

当前开发和部署请以：

```text
PostgreSQL + Prisma
```

为准。

### WebSocket / 3001

当前实时通知使用 SSE。

如果你看到旧文档里提到：

```text
WebSocket
3001
NOTIFICATION_WS_PORT
```

这是历史方案。

当前部署入口是：

```text
cloudflared -> web:3000
```

不再要求浏览器连接独立 `3001`。

### 首页自动进入第一条历史会话

旧行为可能是打开 `/staff/chat` 后自动进入第一条历史会话。

当前行为是：

```text
/staff/chat = 新会话界面
不立即创建数据库记录
用户发送第一条消息后才创建会话
```

### 拍照上传

曾经讨论过移动端拍照按钮。

由于浏览器兼容性问题，该功能已放弃。

当前保留的是普通图片上传能力。

---

## 判断当前事实的优先级

遇到文档不一致时，按这个顺序判断：

1. 当前代码。
2. `prisma/schema.prisma`。
3. 当前 README 和交接文档。
4. 模块说明文档。
5. 历史事故复盘和方案演进文档。
6. 旧提交说明。

如果仍不确定，优先用代码和数据库 schema 验证。
