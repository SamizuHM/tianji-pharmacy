# 业务模型与数据流

## 目标

本文解释当前系统的核心业务对象、数据库表、关系和数据流。

重点不是枚举所有字段，而是回答：

- 一次问答会产生哪些数据？
- 会话如何转工单？
- 工单如何写回知识库？
- 知识库主数据和 Qdrant 向量索引是什么关系？
- 索引任务为什么存在？
- 哪些数据可以重建，哪些不能随便删？

---

## 总体模型

当前系统可以分为 5 个业务域：

```text
账号域：
  Department
  User
  Session

问答域：
  Conversation
  ChatMessage

工单域：
  Ticket
  TicketMessage
  TicketKnowledgeDraft

知识库域：
  KnowledgeItem
  KnowledgeChunk
  KnowledgeIndexTask
  ImportJob

配置域：
  AppSetting
```

主数据关系：

```text
User
  ├─ Session
  ├─ Conversation
  │    ├─ ChatMessage
  │    └─ Ticket
  ├─ Ticket(createdBy)
  └─ TicketMessage(sender)

Ticket
  ├─ TicketMessage
  └─ TicketKnowledgeDraft

KnowledgeItem
  └─ KnowledgeChunk
        └─ qdrantPointId -> Qdrant point

KnowledgeIndexTask
  -> 描述对 Qdrant 的 upsert/delete 任务
```

---

## 账号域

### Department

部门。

典型用途：

- 专家或人工处理人员所属部门。
- 工单升级时可以指定目标部门。

重要关系：

```text
Department 1 -> N User
```

### User

用户。

当前角色 enum：

```prisma
enum UserRole {
  staff
  agent
}
```

含义：

| 角色 | 说明 |
|---|---|
| `staff` | 门店员工，主要使用问答和查看自己工单 |
| `agent` | 人工处理人员，处理待认领或升级工单，也可访问管理能力，具体权限由页面和服务逻辑控制 |

历史说明：

- 旧文档里可能出现 `人工1`、`人工2`、`L1`、`L2`、`human_l1`、`human_l2`。
- 当前数据库角色已经统一为 `staff` / `agent`。
- 工单是否属于“一线待认领”或“升级到某部门/某人”，由 `Ticket.status`、`claimedByUserId`、`escalatedToDept`、`escalatedToUserId` 表达。

关键字段：

```text
username
displayName
passwordHash
role
sidebarTheme
departmentId
```

### Session

登录会话。

关键字段：

```text
token
userId
expiresAt
```

登录后服务端通过 cookie 识别 session。

相关代码：

```text
app/web/lib/auth/session.ts
app/web/app/api/auth/login/route.ts
app/web/app/api/auth/logout/route.ts
```

---

## 问答域

### Conversation

会话。

一个员工可以有多个会话。

关键字段：

```text
title
userId
deletedAt
createdAt
updatedAt
```

注意：

- 删除会话是软删除，写入 `deletedAt`。
- 当前 `/staff/chat` 默认不自动创建会话。
- 只有用户发送第一条消息时才创建 `Conversation`。

相关代码：

```text
app/web/lib/services/conversations.ts
app/web/app/api/conversations/route.ts
app/web/app/api/conversations/[id]/route.ts
```

### ChatMessage

会话消息。

关键字段：

```text
conversationId
role
sourceType
contentText
attachmentsJson
retrievalDebugJson
feedback
```

`role`：

| 值 | 含义 |
|---|---|
| `user` | 员工问题 |
| `assistant` | 系统回答 |
| `agent` | 人工回复 |
| `system` | 系统消息 |

`sourceType`：

| 值 | 含义 |
|---|---|
| `kb` | 知识库回答 |
| `llm` | 大模型兜底回答 |
| `manual` | 人工回答 |
| `system` | 系统消息 |

`retrievalDebugJson` 用来记录检索调试信息，例如：

- 命中的知识问题。
- 来源文件。
- vector score。
- rerank score。

这对排查“为什么看起来命中了但没走知识库”很重要。

---

## 一次问答的数据流

入口：

```text
app/web/components/chat/chat-client.tsx
  -> POST /api/conversations
  -> POST /api/conversations/[id]/messages
```

简化流程：

```text
用户在 /staff/chat 输入问题
  |
  | 如果当前没有 conversationId
  v
创建 Conversation
  |
  v
创建 user ChatMessage
  |
  v
retrieveAnswer()
  |
  +--> buildMultimodalQueryText()
  +--> ML Service embed
  +--> Qdrant search
  +--> ML Service rerank
  +--> PostgreSQL 校验 KnowledgeChunk / KnowledgeItem
  |
  +--> 命中知识库
  |      -> sourceType = kb
  |      -> 用知识库答案整理回复
  |
  +--> 未命中
         -> sourceType = llm
         -> 走大模型兜底
  |
  v
创建 assistant ChatMessage
  |
  v
SSE 返回进度和最终答案给前端
```

核心代码：

```text
app/web/app/api/conversations/[id]/messages/route.ts
app/web/lib/services/retrieval.ts
app/web/lib/openai.ts
app/web/lib/retrieval/ml-service.ts
app/web/lib/retrieval/qdrant.ts
```

---

## 工单域

### Ticket

工单。

创建来源通常是员工从会话点击“转人工”。

关键字段：

```text
ticketNo
status
priority
createdByUserId
conversationId
title
category
tagsJson
latestUserQuestion
inputMode
aiAnswerSnapshot
conversationSnapshot
claimedByUserId
escalatedToDept
escalatedToUserId
resolutionText
knowledgeStatus
closedAt
```

`status`：

| 状态 | 含义 |
|---|---|
| `pending_claim` | 待认领 |
| `processing` | 处理中 |
| `escalated` | 已升级 |
| `closed` | 已关闭 |

`knowledgeStatus`：

| 状态 | 含义 |
|---|---|
| `not_ready` | 暂不适合沉淀 |
| `pending_writeback` | 待写回知识库 |
| `written` | 已写入知识库 |

### TicketMessage

工单消息。

用于记录人工回复、员工补充、系统消息等。

关键字段：

```text
ticketId
senderRole
senderUserId
messageType
content
attachments
createdAt
```

### TicketKnowledgeDraft

工单知识草稿。

当人工处理结果适合沉淀为知识库时，系统会根据工单材料生成知识草稿。

关键字段：

```text
ticketId
selectedMaterialsJson
categoryL1
categoryL2
question
answer
tagsJson
imagePathsJson
generatedByUserId
confirmedAt
writtenKnowledgeItemId
```

它不是最终知识库主数据。

最终写回后才会生成或更新：

```text
KnowledgeItem
KnowledgeChunk
KnowledgeIndexTask
Qdrant point
```

---

## 工单数据流

### 从会话转工单

```text
Conversation
  └─ ChatMessage[]
        |
        v
createTicketFromConversation()
        |
        v
Ticket
  - latestUserQuestion
  - aiAnswerSnapshot
  - conversationSnapshot
  - priority
  - category
```

相关代码：

```text
app/web/lib/services/tickets.ts
app/web/app/api/tickets/route.ts
```

### 人工处理

```text
agent 打开工单
  -> claim
  -> reply
  -> 可 escalate
  -> submit resolution
  -> close
```

相关 API：

```text
app/web/app/api/tickets/[id]/claim/route.ts
app/web/app/api/tickets/[id]/reply/route.ts
app/web/app/api/tickets/[id]/escalate/route.ts
app/web/app/api/tickets/[id]/submit-resolution/route.ts
app/web/app/api/tickets/[id]/close/route.ts
```

### 写回知识库

```text
Ticket + TicketMessage + Conversation Snapshot
  |
  v
选择材料
  |
  v
生成 TicketKnowledgeDraft
  |
  v
人工确认
  |
  v
upsertKnowledgeItem()
  |
  v
KnowledgeItem + KnowledgeChunk
  |
  v
KnowledgeIndexTask
  |
  v
Qdrant upsert
```

---

## 知识库域

### KnowledgeItem

知识条目主表。

表示一条标准问答知识。

关键字段：

```text
categoryL1
categoryL2
question
answer
tagsJson
status
sourceType
sourceTicketId
sourceFile
docType
imagePath
imagePathsJson
hitCount
lastHitAt
```

`status`：

| 值 | 含义 |
|---|---|
| `draft` | 草稿 |
| `published` | 已发布，可被检索命中 |
| `archived` | 归档，不应作为有效知识命中 |

`sourceType`：

| 值 | 含义 |
|---|---|
| `seed_doc` | 种子文档导入 |
| `image_doc` | 图片/图文文档 |
| `manual_ticket` | 工单人工经验沉淀 |
| `manual` | 后台手动维护 |

### KnowledgeChunk

知识分块。

RAG 检索的最小索引单位。

关键字段：

```text
knowledgeItemId
chunkIndex
chunkText
originalText
sourceFile
docType
qdrantPointId
metadataJson
```

关系：

```text
KnowledgeItem 1 -> N KnowledgeChunk
KnowledgeChunk.qdrantPointId -> Qdrant point id
```

当前原则：

```text
KnowledgeChunk 是主数据的一部分。
Qdrant point 是 KnowledgeChunk 的派生索引。
```

### KnowledgeIndexTask

知识索引任务。

用于记录需要对 Qdrant 执行的操作。

关键字段：

```text
taskType
status
knowledgeItemId
chunkId
pointId
payloadJson
retryCount
lastError
availableAt
processedAt
```

`taskType`：

| 值 | 含义 |
|---|---|
| `upsert` | 写入或更新 Qdrant point |
| `delete` | 删除 Qdrant point |

`status`：

| 值 | 含义 |
|---|---|
| `pending` | 待处理 |
| `processing` | 处理中 |
| `completed` | 已完成 |

为什么需要任务表：

- 写 PostgreSQL 和写 Qdrant 不是同一个事务系统。
- 先写主数据，再写索引，失败时可以重试。
- Qdrant 是派生数据，可以 drain/rebuild/reconcile。

### ImportJob

导入任务记录。

用于记录文档导入来源、状态和摘要。

---

## 知识库与 Qdrant 的一致性模型

核心原则：

```text
PostgreSQL = 权威主数据
Qdrant = 可删除、可重建的派生向量索引
```

正确修复方向永远是：

```text
按 PostgreSQL 修复 Qdrant
```

不是：

```text
按 Qdrant 反向删除 PostgreSQL
```

在线检索时：

```text
Qdrant 返回 point
  |
  v
用 point id 或 qdrantPointId 回查 PostgreSQL KnowledgeChunk
  |
  +--> 找到 chunk 且 KnowledgeItem published
  |      -> 可以作为知识命中
  |
  +--> 找不到 chunk
         -> 认为 Qdrant point 陈旧
         -> 创建 delete task
```

相关文档：

```text
docs/POSTGRES_QDRANT_INDEX_CONSISTENCY.md
docs/INCIDENT_2026-04-28_QDRANT_INDEX_DELETION.md
```

---

## 配置域

### AppSetting

运行时设置。

典型配置：

- 检索 topK。
- rerank topN。
- 知识库命中阈值。
- 服务热线。
- UI/业务配置。

相关代码：

```text
app/web/lib/services/settings.ts
app/web/app/api/settings/route.ts
app/web/app/api/settings/theme/route.ts
```

---

## 附件与上传

上传文件通常保存到：

```text
uploads/
```

Docker 中挂载为：

```text
/app/uploads
```

`web` 和 `ml-service` 共享 `uploads_data` volume。

原因：

```text
用户上传文件
  -> web 保存
  -> ml-service 需要读取同一文件做图片理解、文档解析、embedding
```

相关代码：

```text
app/web/app/api/uploads/route.ts
app/web/app/api/files/[...path]/route.ts
app/web/lib/uploads.ts
app/web/lib/retrieval/ml-service.ts
app/ml-service/app/main.py
```

---

## 哪些数据不能随便删

不要随便删：

```text
PostgreSQL 业务表数据
prisma/migrations
KnowledgeItem
KnowledgeChunk
Ticket
Conversation
ChatMessage
uploads_data volume
postgres_data volume
```

可以重建，但要按流程：

```text
Qdrant collection / points
KnowledgeIndexTask pending 状态
```

原因：

- Qdrant 是派生索引。
- 但删除 Qdrant 前必须确认 PostgreSQL 主数据完整。
- 重建应使用 `pnpm kb:rebuild` 或后台“重建索引”。

---

## 常见数据问题判断

### 知识库后台有数据，但问答不命中

优先查：

1. `KnowledgeItem.status` 是否是 `published`。
2. `KnowledgeChunk` 是否存在。
3. Qdrant point 是否存在。
4. rerank score 是否超过阈值。
5. `retrievalDebugJson` 中召回了什么。
6. 是否存在陈旧 Qdrant point。

参考：

```text
docs/POSTGRES_QDRANT_INDEX_CONSISTENCY.md
```

### Qdrant 命中，但最终走大模型

可能原因：

- rerank 分数低于 `KB_HIT_THRESHOLD`。
- Qdrant point 对应的 `KnowledgeChunk` 已不存在。
- `KnowledgeItem.status` 不是 `published`。
- 查询被 rewrite 成了不合适的表达。

### 后台点击重建索引做了什么

它不是重新导入种子知识。

它的语义是：

```text
基于 PostgreSQL 当前 KnowledgeChunk
重新写入 Qdrant 向量索引
```

如果 PostgreSQL 里没有知识主数据，重建索引不会凭空生成知识。

### import / rebuild / reconcile 的区别

| 操作 | 作用 |
|---|---|
| `import` | 从种子文档或上传文档导入知识主数据 |
| `rebuild` | 用 PostgreSQL 现有 chunks 重建 Qdrant |
| `reconcile` | 检查 PostgreSQL 与 Qdrant 是否一致 |
| `drain` | 处理 pending 的 KnowledgeIndexTask |

---

## 修改数据模型时的原则

修改 `prisma/schema.prisma` 前先判断：

1. 只是新增可空字段？
2. 是否有已有数据？
3. 是否会删除字段？
4. 是否是字段改名？
5. 是否需要数据回填？
6. 是否影响 Qdrant payload？
7. 是否影响 seed？
8. 是否影响 API 返回结构？

开发流程：

```bash
pnpm db:migrate
pnpm --filter web exec tsc --noEmit
```

提交必须包含：

```text
prisma/schema.prisma
prisma/migrations/.../migration.sql
相关代码修改
```

危险变更要手动检查 `migration.sql`。

