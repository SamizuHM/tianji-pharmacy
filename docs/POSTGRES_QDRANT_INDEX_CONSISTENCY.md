# PostgreSQL 与 Qdrant 知识索引一致性说明

## 核心原则

本项目的知识库一致性模型是：

```text
数据库 = 权威主数据
Qdrant = 可删除、可重建的派生向量索引
```

开发时必须坚持以下约束：

1. 业务真相只看数据库，不看 Qdrant。
2. `KnowledgeDocument`、`KnowledgeDocumentVersion`、`KnowledgeParseRun`、`KnowledgeChunkSet` 和 `KnowledgeChunk` 是知识库主数据。
3. `KnowledgeItem` 是检索兼容和索引投影载体，不再是后台知识库管理主对象。
4. Qdrant 只负责向量召回，不承载业务真相。
5. Qdrant point 可以随时从数据库全量重建。
6. 任何对齐、修复、重建都必须以数据库为准。
7. 不允许为了迁就 Qdrant 状态反向删除或修改数据库主数据。

如果 PostgreSQL 与 Qdrant 不一致，正确修复方向永远是：

```text
按数据库修复 Qdrant
```

## 数据结构职责

### `KnowledgeDocument`

知识文档主表，表示后台知识库管理的唯一主对象。上传文件、手动 QA、工单写回和种子导入都会落到文档视图。

典型字段：

- `sourceType`
- `businessCategory`
- `scopeLevel`
- `cityName`
- `status`

关联对象：

- `KnowledgeDocumentVersion`：原始文件、解析文本和内容 hash。
- `KnowledgeParseRun`：一次解析记录。
- `KnowledgeChunkSet`：一次切片结果，active chunk set 代表当前生效切片。
- `KnowledgeChunk`：可索引的最小文本片段。
- `KnowledgeItem`：兼容旧接口和 Qdrant payload 的标准问答投影。

后台只展示和维护文档视图。点开文档后查看 active chunk set 里的 chunk。

### `KnowledgeItem`

知识检索投影表，保存标准问答字段、统计命中和兼容旧接口。

典型字段：

- `question`
- `answer`
- `sourceType`
- `sourceFile`
- `documentId`
- `chunkSetId`
- `imagePath`
- `imagePathsJson`

它仍参与检索回表、命中统计和部分兼容 API，但不应再作为后台主表单独维护。

### `KnowledgeChunk`

知识切片表，表示可被 embedding 和检索的最小单位。

关键字段：

- `id`：数据库 chunk 主键。
- `knowledgeItemId`：所属检索投影。
- `documentId`：所属知识文档。
- `chunkSetId`：所属切片结果。
- `chunkText`：用于 embedding 和检索的文本。
- `qdrantPointId`：对应 Qdrant point id。
- `metadataJson`：索引相关元数据快照。
- `scopeLevel` / `cityName`：chunk 级检索范围，当前支持通用和湖北城市专属。
- `overrideScope`：必要时绕过文档范围限制的索引投影开关。
- `bm25SearchText` / `bm25DocLength`：BM25 关键词召回文本和长度。
- `hypotheticalQuestionsJson`：HQ 检索投影问题。

### `KnowledgeBm25Term`

BM25 倒排表，记录每个 chunk 的 term frequency、文档长度和范围信息。

典型字段：

- `chunkId`
- `term`
- `termFrequency`
- `docLength`
- `scopeLevel`
- `cityName`

当前 Qdrant point id 由 `knowledgeChunk.id` 稳定派生：

```ts
buildStablePointId(chunkId);
```

同一个 chunk 无论重建多少次，都应该写入同一个 point id。

### `KnowledgeIndexTask`

数据库 outbox 表，记录待投影到 Qdrant 的索引任务。

关键字段：

- `taskType`: `upsert` 或 `delete`
- `status`: `pending` / `processing` / `completed` / `failed`
- `knowledgeItemId`
- `chunkId`
- `pointId`
- `payloadJson`
- `retryCount`
- `lastError`
- `availableAt`

它的作用是把“主数据写入 数据库”和“派生索引写入 Qdrant”解耦。数据库 事务提交后，即使 Qdrant 短暂失败，也可以留下可重试任务。

后台知识文档详情页会展示 chunk 对应索引任务状态，并支持对失败任务发起重试；也可以用 `pnpm kb:drain` 手动消化任务。

## 写入链路

知识新增、导入、编辑、工单沉淀现在分两类：

- 上传文档和种子文件先进入 `KnowledgeDocument` / `KnowledgeDocumentVersion` / `KnowledgeParseRun` / `KnowledgeChunkSet`，再生成 `KnowledgeItem` 和 `KnowledgeChunk` 投影。
- 手动 QA 和工单写回走 `upsertQaKnowledgeDocument`，创建或更新 QA 文档，再复用 `persistKnowledgeItem` 写投影与索引任务。

流程：

```text
输入知识内容
→ 生成或复用 knowledgeDocument.id
→ 生成 documentVersion / parseRun / chunkSet
→ 生成或复用 knowledgeItem.id
→ 生成或复用 knowledgeChunk.id
→ 计算稳定 qdrantPointId
→ 生成 embedding payload
→ PostgreSQL 事务内 upsert document / version / parseRun / chunkSet / knowledgeItem / knowledgeChunk
→ PostgreSQL 事务内写 KnowledgeIndexTask
→ 事务提交后 tryDrainKnowledgeIndexTasks
→ Qdrant upsert/delete
```

重要约束：

1. `knowledgeChunk.qdrantPointId` 必须稳定。
2. upsert 同一个 `pointId` 必须幂等。
3. delete 同一个 `pointId` 必须幂等。
4. 不再保留 legacy point cleanup 逻辑。
5. 删除 Qdrant point 只能来自真实的 stale chunk、替换文档、删除文档或删除兼容知识投影。

## 删除与更新链路

### 更新文档或 QA 文档

更新时会按 chunk index 尽量复用已有 chunk id：

```text
旧 chunk 仍存在于新计划中 → upsert 同一个稳定 point
旧 chunk 不再存在 → stale chunk
```

`staleChunks` 是“数据库 更新后不再应该存在的旧 chunk”。

对 stale chunk 的处理：

1. 数据库 删除对应 `knowledgeChunk`。
2. 写入 Qdrant delete task。
3. drain 后删除对应 Qdrant point。

### 删除文档或兼容知识投影

删除文档或兼容知识投影前，会为相关 chunk 创建 Qdrant delete task，然后删除 PostgreSQL 主数据或投影。

`KnowledgeChunk` 同时关联 `KnowledgeItem`、`KnowledgeDocument` 和 `KnowledgeChunkSet`，删除上游对象后 chunk 会按 schema 级联或置空策略处理；删除前必须先写入对应的 Qdrant delete task。

## Qdrant point 内容

Qdrant collection 名称：

```text
pharmacy_kb
```

point id：

```text
knowledgeChunk.qdrantPointId
```

vector：

```text
embedMultimodal(chunkText + 可选图片)
```

payload 包含：

- `knowledgeItemId`
- `chunkId`
- `chunkIndex`
- `chunkText`
- `question`
- `answer`
- `sourceFile`
- `docType`
- `businessCategory`
- `scopeLevel`
- `cityName`
- `retrievalBasis`
- `retrievalBasisType`
- `imagePath`
- `imagePaths`

payload 是检索阶段的候选展示和 rerank 输入，不是业务真相。命中后必须回 数据库 校验。

## 检索回表校验

检索链路会先查 Qdrant，再做 rerank 和阈值判断。

但 Qdrant 命中后不能直接信任 payload，必须回 数据库 校验：

```text
Qdrant point id
→ 查 knowledgeChunk.id 或 knowledgeChunk.qdrantPointId
→ include knowledgeItem / document
```

如果 Qdrant point 找不到对应 数据库 chunk，说明它是脏索引：

1. 当前候选跳过。
2. 创建 `retrieval_stale_point` delete task。
3. 尝试 drain。
4. 继续检查后续候选。

这样可以避免 Qdrant 孤儿 point 误导回答。

## 维护命令

### `kb:drain`

处理当前待执行的 `KnowledgeIndexTask`。

适用场景：

- Qdrant 曾短暂不可用。
- 有 pending task 积压。
- 想手动推动 outbox 投影。

### `kb:reconcile`

对账修复 PostgreSQL 与 Qdrant。

逻辑：

```text
扫描 数据库 knowledgeChunk.qdrantPointId
扫描 Qdrant 所有 point id
Qdrant 有但 数据库 没有 → 删除 orphan point
数据库 有但 Qdrant 没有 → 重新生成 upsert task 并 drain
```

适用场景：

- 日常巡检。
- 小范围缺失或孤儿 point。
- 启动自检。
- 删除/新增过程中出现短暂失败。

注意：

`reconcile` 不清空 collection，只修补差异，因此对线上问答影响较小。

### `kb:rebuild`

全量重建 Qdrant。

逻辑：

```text
等待 Qdrant 可写
规范化 knowledgeChunk.qdrantPointId
读取 数据库 所有 knowledgeChunk
删除 Qdrant pharmacy_kb collection
清理 pending/processing index task
重新生成所有 embedding
写入 upsert task
drain 所有任务
```

适用场景：

- 更换 embedding 模型。
- 更改 embedding 输入策略。
- 向量维度变化。
- Qdrant 数据严重损坏。
- Qdrant collection 丢失或不可信。
- 事故恢复。

注意：

当前 `rebuild` 会删除 collection，执行期间用户问答可能出现检索失败或临时未命中。生产环境应低峰操作，或后续改造成蓝绿 collection 切换。

## 生产 Docker 操作

生产 Docker 环境中，命令应在 `tianji-web` 容器内执行，因为它使用的是容器内网络和 数据库 volume。

查看数据库数量：

```bash
docker exec -w /app tianji-web node -e "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); Promise.all([p.knowledgeDocument.count(),p.knowledgeItem.count(),p.knowledgeChunk.count(),p.knowledgeIndexTask.count()]).then(v=>console.log({knowledgeDocument:v[0],knowledgeItem:v[1],knowledgeChunk:v[2],knowledgeIndexTask:v[3]})).finally(()=>p.$disconnect())"
```

查看 Qdrant point 数：

```bash
docker exec -w /app tianji-web node -e "fetch(process.env.QDRANT_URL + '/collections/pharmacy_kb/points/count', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({exact:true})}).then(r=>r.text()).then(console.log)"
```

日常对账：

```bash
docker exec -w /app tianji-web npx tsx scripts/reconcile-knowledge-index.ts
```

全量重建：

```bash
docker exec -w /app tianji-web npx tsx scripts/rebuild-knowledge-index.ts
docker exec -w /app tianji-web npx tsx scripts/reconcile-knowledge-index.ts
```

如果容器中缺少 `npx`、`tsx` 或脚本文件，说明生产镜像不是最新构建，必须先重新构建 web 镜像。

## 换模型时是否需要重建

需要重建 Qdrant 的情况：

1. 更换 embedding 模型。
2. embedding 向量维度变化。
3. embedding 输入拼接逻辑变化。
4. 文本/图片融合策略变化。
5. chunkText 生成规则变化。

不需要重建 Qdrant 的情况：

1. 只更换回答生成模型。
2. 只修改回答 prompt。
3. 只更换 rerank 模型。
4. 只调整 `KB_HIT_THRESHOLD`。
5. 只调整 `RETRIEVAL_TOP_K` 或 `RERANK_TOP_N`。

换 embedding 后必须执行：

```bash
pnpm kb:rebuild
pnpm kb:reconcile
```

生产 Docker 环境中则执行对应的 `docker exec` 命令。

## 监控与告警建议

最低限度应监控：

```text
数据库 knowledgeChunk count
Qdrant pharmacy_kb point count
pending KnowledgeIndexTask count
processing KnowledgeIndexTask count
最近一次 reconcile/rebuild 是否成功
Qdrant 连接失败次数
检索阶段 stale point 命中次数
```

最重要的异常：

```text
数据库 knowledgeChunk count != Qdrant point count
```

出现该异常时：

1. 先执行 `reconcile`。
2. 如果仍不一致，再低峰执行 `rebuild`。
3. 如果 Qdrant 不可达，不要无限重建，应告警并等待服务恢复。

## 开发注意事项

### 不要做的事

1. 不要在业务逻辑中把 Qdrant 当权威数据源。
2. 不要根据 Qdrant 结果删除 数据库 知识。
3. 不要使用随机 point id。
4. 不要重新引入 legacy point cleanup。
5. 不要在未回表校验的情况下信任 Qdrant payload。
6. 不要在请求路径里同步要求 Qdrant 写入成功后才提交 数据库 主数据。

### 应该做的事

1. 新增/更新/删除知识时，先写 数据库 主数据和 outbox task。
2. Qdrant 写入失败时，保留 pending task 和 lastError。
3. 检索命中后必须回 数据库 校验。
4. 维护脚本必须以 数据库 为输入修复 Qdrant。
5. 生产恢复优先 `reconcile`，严重不一致再 `rebuild`。
6. 对 Qdrant count 大幅下降必须告警。

## 后续改进方向

1. 启动时自动执行 Qdrant 健康检查和 `reconcile`。
2. 增加独立 `knowledge-index-worker` 定期 drain outbox。
3. 增加索引健康 API 和管理后台提示。
4. 增加蓝绿 collection rebuild，避免重建期间影响线上问答。
5. 增加 delete task 保护：如果 PostgreSQL 中仍存在该 `pointId` 对应 chunk，则拒绝删除。
6. 增加一致性回归测试，覆盖导入、更新、删除、reconcile、rebuild 和脏 point 跳过。
