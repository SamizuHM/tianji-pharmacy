# P0 事故复盘：Qdrant 知识库索引被批量删除

## 摘要

2026-04-28，生产环境发生一次 P0 级知识库检索事故。SQLite 中仍保有 84 条 `knowledgeChunk` 主数据，但 Qdrant `pharmacy_kb` collection 最终只剩 1 个 point，导致绝大多数知识无法被向量召回，聊天问题大量退化为大模型兜底回答。

典型现象：

- 用户问题：`医保电脑不能进ERP`
- SQLite 中存在精确相关知识：`医保电脑无法进ERP、小7无法签到，该如何排查？`
- Qdrant 中没有该知识对应 point
- 检索只召回了无关的 `读卡N`
- `rerankScore=0.6771`，低于阈值 `0.72`
- 最终走大模型兜底，未命中知识库

本次事故的直接原因是代码在稳定 Qdrant point id 迁移后，错误地将当前有效 point 判断为 legacy point，并在 upsert 后立即创建 delete 任务，导致大量有效索引被删除。

修复提交：

- `c81fb63 fix(kb): avoid deleting stable qdrant points`

## 影响范围

受影响能力：

- 知识库召回
- 知识库命中率统计
- 门店问答准确性
- 人工闭环知识沉淀后的可检索性

未受影响的数据：

- SQLite 主数据未丢失
- `knowledgeItem` / `knowledgeChunk` 仍保留
- 会话、工单、用户数据未发现异常

影响性质：

- 这是派生索引损坏事故，不是主数据丢失事故。
- 由于线上查询依赖 Qdrant 召回，因此实际用户体验等同于知识库大面积不可用。

## 时间线

以下时间均为北京时间。

### 2026-04-28 13:05 左右

Qdrant 启动并加载 `pharmacy_kb`。

日志显示 collection 中存在 84 个左右的 point：

```text
Migrating 11 points
Migrating 10 points
...
Recovered collection pharmacy_kb
```

说明此时 Qdrant 索引基本完整。

### 2026-04-28 15:14:35 开始

Qdrant 收到来自 web 容器的连续写删请求：

```text
PUT /collections/pharmacy_kb/points?wait=true
POST /collections/pharmacy_kb/points/delete?wait=true
```

请求来源：

```text
source ip: 172.22.0.5
user-agent: qdrant-js/1.17.0
```

该来源对应 `tianji-web` 容器。

### 2026-04-28 16:21 - 16:22

仍可观察到同样模式：

```text
PUT point
DELETE point
```

生产 `KnowledgeIndexTask` 中也能看到大量同一 chunk 同时存在：

- `upsert completed`
- `delete completed`

### 2026-04-28 22:11 左右

Qdrant 再次启动时，日志显示：

```text
Recovered collection pharmacy_kb: 1/1
```

此时 Qdrant 实际只剩 1 个 point。

### 2026-04-28 22:13 左右

用户问题 `医保电脑不能进ERP` 未命中知识库，走大模型兜底。

会话：

```text
conversationId=cmoim9j1k00gtse08a61qgyat
```

## 根因分析

### 直接原因

稳定 point id 改造后，Qdrant point id 不再等于 `knowledgeChunk.id`，而是由 chunk id 派生出的 UUID。

期望关系：

```text
knowledgeChunk.id = cmohm27bu002so107qfwe989s
knowledgeChunk.qdrantPointId = 490c15e1-96f5-545e-bd85-882fbf4b71e5
Qdrant point id = 490c15e1-96f5-545e-bd85-882fbf4b71e5
```

但旧的 legacy cleanup 判断仍然使用：

```ts
chunk.qdrantPointId !== chunk.id;
```

在稳定 UUID 策略下，这个条件对所有正常 chunk 都成立。

于是系统错误认为所有当前有效 point 都是 legacy point，需要删除。

### 具体故障链路

当知识条目被重新导入或更新时：

1. 系统为 chunk 生成稳定 UUID point id。
2. 创建 upsert 任务，将 point 写入 Qdrant。
3. legacy cleanup 逻辑错误判断 `qdrantPointId !== chunk.id`。
4. 系统又为同一个 point id 创建 delete 任务。
5. drain outbox 时先 upsert，再 delete。
6. Qdrant 中有效 point 被删除。
7. SQLite 主数据仍存在，但 Qdrant 派生索引缺失。

生产任务表印证了该链路：

```text
同一个 chunkId / pointId 同时存在 upsert completed 和 delete completed
```

### 修复逻辑

修复后，legacy cleanup 只在旧 point id 与新计划 point id 不一致时触发：

```ts
const nextPlan = chunkPlans.find((plan) => plan.id === chunk.id);
return Boolean(nextPlan && chunk.qdrantPointId && chunk.qdrantPointId !== nextPlan.qdrantPointId);
```

这能正确区分：

- 旧随机 point id：需要删除
- 当前稳定 UUID point id：不能删除

## 为什么没有提前发现

### 1. 缺少索引一致性验收

缺少明确的部署后检查：

```text
Qdrant point count == SQLite knowledgeChunk count
```

如果该检查存在，事故会在导入或发布后立即暴露。

### 2. 缺少“upsert 后不能紧跟 delete 同一 point”的任务不变量

索引任务表中出现大量同一 point 的 `upsert completed` 和 `delete completed`，这是明显异常。

但系统没有检测以下模式：

```text
same pointId:
  upsert completed
  delete completed
  SQLite chunk still exists
```

### 3. 缺少针对迁移逻辑的回归测试

稳定 point id 迁移涉及三种 id：

- `knowledgeChunk.id`
- `knowledgeChunk.qdrantPointId`
- Qdrant point id

测试没有覆盖“已有 chunk 更新时不应删除当前稳定 point”的场景。

### 4. 派生索引失败没有强告警

Qdrant 从 84 个 point 下降到 1 个 point，属于严重异常。

系统没有指标、日志或管理页提示：

```text
SQLite chunk count = 84
Qdrant point count = 1
```

### 5. 问答层过度兜底掩盖了故障

知识库召回失败后，系统自动走大模型兜底。

这对用户体验有短期缓冲，但也会掩盖知识库不可用问题，使事故不够显性。

## 事故性质反思

这次事故不是 Qdrant 稳定性问题，而是应用层索引投影逻辑缺陷。

核心教训：

1. 派生索引也必须有强一致性观测。
2. Outbox 模式降低了双写风险，但不会自动保证任务语义正确。
3. 迁移 id 体系时，必须把旧 id、新 id、删除条件全部作为不变量测试。
4. 自动兜底能力不能替代系统健康检查。
5. “可重建”不等于“可以没有监控”，索引损坏仍然是线上事故。

## 已完成修复

### 代码修复

提交：

```text
c81fb63 fix(kb): avoid deleting stable qdrant points
```

修复内容：

- 修正 legacy point cleanup 判断条件。
- 只有旧 `qdrantPointId` 与新计划 `qdrantPointId` 不一致时才创建 delete 任务。

验证：

```bash
pnpm build
```

结果：

```text
通过
```

## 生产恢复建议

恢复步骤必须按顺序执行。

### 1. 先部署修复提交

必须先部署：

```text
c81fb63 fix(kb): avoid deleting stable qdrant points
```

原因：

- 旧代码仍可能在重建或更新知识时继续错误删除稳定 point。
- 直接重建索引但不部署修复，会存在再次被删除的风险。

### 2. 重建 Qdrant 索引

部署后执行：

```bash
docker exec tianji-web pnpm kb:rebuild
```

### 3. 对账

执行：

```bash
docker exec tianji-web pnpm kb:reconcile
```

验收标准：

```text
SQLite knowledgeChunk count = Qdrant point count
```

当前应接近：

```text
84 = 84
```

### 4. 回归验证

验证问题：

```text
医保电脑不能进ERP
```

预期：

- Qdrant 能召回 `医保电脑无法进ERP、小7无法签到，该如何排查？`
- rerank 分数超过阈值
- sourceType 为 `kb`

## 后续预防措施

### P0：增加索引一致性启动检查

web 启动或健康检查中增加只读检查：

```text
sqliteChunkCount
qdrantPointCount
pendingIndexTaskCount
failedIndexTaskCount
```

当差异超过阈值时：

- 管理页展示红色告警
- 日志输出 error
- 可选：禁止标记知识库为健康状态

### P0：增加 outbox 不变量检查

新增脚本或管理接口，检查：

```text
SQLite chunk 存在，但该 chunk 的最新任务是 delete
同一 pointId 在短时间内 upsert 后紧跟 delete
delete task 的 reason 是否为允许值
Qdrant point 不存在但 SQLite chunk 存在
Qdrant point 存在但 SQLite chunk 不存在
```

### P1：为索引投影增加测试

至少覆盖：

1. 新增知识后 Qdrant point id 稳定。
2. 更新同一知识不产生重复 point。
3. 更新同一知识不删除当前稳定 point。
4. stale chunk 删除只删除真正移除的 chunk。
5. legacy random point cleanup 只删除旧 point，不删除新 point。
6. 连续两次导入后 Qdrant point count 不下降。

### P1：给 delete 任务增加更严格的保护

执行 delete 前先判断：

```text
如果 SQLite 中仍存在 chunk，且 chunk.qdrantPointId == task.pointId，则拒绝删除
```

这条保护可以阻断本次事故类型。

### P1：增强任务 payload 审计

delete task 必须记录：

- reason
- createdBy
- source operation
- oldPointId
- newPointId
- chunkStillExistsAtCreateTime

这样排查时不只依赖 Qdrant HTTP 日志。

### P1：增加部署后 smoke test

每次部署后自动执行：

```bash
pnpm kb:reconcile --check-only
```

并测试至少一个固定知识问题：

```text
医保电脑不能进ERP
ERP服务器故障出现小人头提示怎么办
```

要求返回 sourceType=`kb`。

### P2：让兜底回答暴露知识库健康状态

当知识库索引明显异常时，不应静默走普通大模型兜底。

建议在调试信息或管理后台中标识：

```text
知识库索引异常，当前回答为大模型兜底
```

## 长期改进方向

### 1. 索引投影器独立化

当前请求尾部 drain outbox 会让请求路径承担部分索引投影职责。

长期建议：

- 独立后台 worker 处理 outbox。
- 请求路径只提交 SQLite 事务和 outbox 任务。
- worker 有自己的监控、重试和告警。

### 2. 将 Qdrant 视为可观测派生系统

不仅要能 rebuild，还要能持续回答：

```text
现在索引是否完整？
最近一次完整对账是什么时候？
缺失多少 point？
孤儿 point 有多少？
最近 delete 任务是谁创建的？
```

### 3. 删除操作默认高风险

索引 delete 虽然不是主数据删除，但会直接影响线上回答质量。

建议：

- 批量 delete 必须有明确 reason。
- delete 数量异常时短路。
- 单轮 drain 中 delete 比例过高时停止并报警。

## 行动项

| 优先级 | 行动                              | 状态              |
| ------ | --------------------------------- | ----------------- |
| P0     | 修复 legacy cleanup 错误判断      | 已完成，`c81fb63` |
| P0     | 部署修复后重建 Qdrant 索引        | 待执行            |
| P0     | 重建后执行对账并确认 84/84        | 待执行            |
| P0     | 增加 delete 前 SQLite 保护        | 待实现            |
| P0     | 增加索引一致性检查脚本/健康检查   | 待实现            |
| P1     | 增加 outbox 投影回归测试          | 待实现            |
| P1     | 增加固定问题 smoke test           | 待实现            |
| P1     | 增强 delete task 审计字段         | 待实现            |
| P2     | 将 outbox drain 独立为后台 worker | 待设计            |
