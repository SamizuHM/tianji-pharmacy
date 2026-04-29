# Docker 启动与知识索引鲁棒性待办

## 背景

当前系统约定 SQLite 是知识库主数据源，Qdrant 是可重建的派生向量索引。这个方向是正确的，但当前 Docker 启动链路还没有完全体现这个约束：首次初始化、知识导入、Qdrant 对账和索引重建仍然缺少强校验与自动恢复。

因此，在从 0 clone 到新设备并执行 `docker compose up -d --build` 时，只要环境变量、外网、DashScope、ML 服务和 Qdrant 都正常，系统大概率可以启动；但它还不能保证长期运行中自动从 Qdrant 空库、半导入、导入失败或 pending index task 中自愈。

## 当前风险

1. `docker-entrypoint.sh` 使用 HTTP 登录再调用 `/api/knowledge` 做首次导入。

   这条链路依赖 Next.js 已启动、登录接口可用、Cookie 获取成功、知识导入 API 正常返回。它更像业务接口调用，不是可靠的启动初始化流程。

2. 知识导入接口可能部分失败但仍返回 200。

   `importKnowledgeFromFiles` 会记录 `errors`，但 API 层仍返回 JSON。entrypoint 只要 curl 成功，就会继续写入 `/app/data/.initialized`。这会导致“初始化标记已完成，但知识库没有完整导入”。

3. `.initialized` 只适合表示 SQLite 基础数据初始化完成，不能表示 Qdrant 索引健康。

   如果 `db_data` 仍存在，但 `qdrant_storage` 被删除、损坏或回滚，entrypoint 会因为 `.initialized` 存在而跳过知识导入，也不会自动 rebuild/reconcile Qdrant。

4. 当前没有常驻 outbox drain worker。

   请求尾部会尝试 drain 一次索引任务，但如果当时 Qdrant 不可用，任务会留在 SQLite。后续如果没有新的写入或人工执行脚本，pending task 不会被持续处理。

5. Compose 里的 `depends_on: service_started` 不保证 Qdrant API 已经可写。

   Qdrant 容器启动和 Qdrant 服务可写之间存在时间差。首次导入如果过早写索引，可能失败。

6. `ml-service` healthcheck 只检查 `/health`。

   它没有验证 DashScope API Key、Embedding 模型、Rerank 模型是否实际可用。首次导入依赖 embedding，外部模型不可用时仍可能进入部分失败状态。

## 目标状态

Docker 启动后应满足：

1. SQLite schema 一定同步完成。
2. 基础用户和系统配置一定 seed 完成。
3. 如果 SQLite 没有知识数据，则导入 seed knowledge；导入失败时启动应失败或至少不写初始化成功标记。
4. 每次启动都对 Qdrant 做健康校验。
5. 每次启动都 drain SQLite outbox 中未完成的索引任务。
6. 每次启动都 reconcile SQLite 与 Qdrant。
7. 如果 SQLite chunk 数量大于 0，但 Qdrant point 数量明显不一致，应自动 rebuild 或显式失败退出。
8. Qdrant 丢失 volume 后，只要 SQLite 仍在，系统能自动恢复索引。

## 推荐改造

### 1. 拆分初始化语义

保留 `.initialized`，但只表示 SQLite 基础初始化完成：

```text
/app/data/.db_initialized
```

不要把 Qdrant 索引健康绑定到这个 marker。

### 2. 新增启动级索引恢复脚本

新增脚本，例如：

```text
scripts/bootstrap-knowledge-index.ts
```

职责：

1. 等待 Qdrant 可写。
2. 统计 SQLite `knowledgeChunk` 数量。
3. 如果 chunk 数为 0，则导入 seed knowledge。
4. drain pending/processing index tasks。
5. 执行 reconcile。
6. 再次检查 SQLite chunk 数和 Qdrant point 数。
7. 如果数量不一致，执行 rebuild。
8. rebuild 后仍不一致则退出非 0。

### 3. entrypoint 不再通过 HTTP API 导入知识

`docker-entrypoint.sh` 应直接调用脚本，而不是先启动 Next.js、登录、拿 Cookie、再 curl `/api/knowledge`。

推荐顺序：

```bash
npx prisma db push --skip-generate
npx tsx prisma/seed.ts
npx tsx scripts/bootstrap-knowledge-index.ts
node app/web/server.js
```

如果希望 Next.js 尽快启动，也可以先启动服务，但索引恢复失败时必须让容器失败退出，不能静默继续。

### 4. 启动时强校验导入结果

导入 seed knowledge 时，必须检查：

```text
importedChunks > 0
errors.length === 0
```

如果已有 SQLite 知识，则不重复导入，但仍然要 reconcile/rebuild Qdrant。

### 5. 增加 outbox drain worker

至少实现一个轻量级循环：

```text
每 10-30 秒 drainKnowledgeIndexTasks({ limit: 50 })
```

它可以放在 Web 进程旁边，也可以作为单独容器。长期更推荐单独 worker：

```yaml
knowledge-index-worker:
  build: .
  command: npx tsx scripts/drain-knowledge-index-worker.ts
```

### 6. 增加健康检查

建议增加一个内部健康检查脚本或 API，检查：

1. SQLite 可访问。
2. Qdrant 可访问。
3. SQLite chunk 数。
4. Qdrant point 数。
5. pending/failed index task 数。
6. ML embedding 是否可用。

返回结果应该区分：

```text
ready: 服务可对外提供问答
degraded: 服务可运行但知识索引异常
unhealthy: 必须人工介入或自动重启
```

## 验收标准

1. 新设备从 0 clone 后，配置 `.env`，执行：

```bash
docker compose up -d --build
```

最终 SQLite `knowledgeChunk` 数量大于 0，Qdrant `pharmacy_kb` point 数与 SQLite chunk 数一致。

2. 删除 Qdrant volume，保留 SQLite volume，再执行：

```bash
docker compose up -d
```

系统应自动恢复 Qdrant 索引。

3. 人为制造一个 Qdrant orphan point，重启后应被 reconcile 清理。

4. 人为删除一个 Qdrant point，重启后应被 reconcile 或 rebuild 回补。

5. 关闭 Qdrant 后启动 Web，容器应明确失败或进入不可用状态，不能静默标记初始化成功。

6. 关闭 ML 服务或配置错误 API Key 后首次导入，容器应明确失败，不能写入“初始化已完成”标记。

7. 连续重启多次后，Qdrant point 数不增长，且与 SQLite chunk 数保持一致。

## 当前临时运维命令

在现有代码完全改造前，如果发现 SQLite 有知识但 Qdrant 空库，应在 `tianji-web` 容器内执行重建或等价脚本。

理想命令是：

```bash
docker exec -w /app tianji-web npx tsx scripts/rebuild-knowledge-index.ts
docker exec -w /app tianji-web npx tsx scripts/reconcile-knowledge-index.ts
```

如果生产镜像缺少脚本运行依赖，则需要先修 Dockerfile，确保 `tsx`、脚本文件和运行时依赖在 runner 镜像中可用。

## 优先级

P0：

1. entrypoint 不再通过 HTTP API 导入知识。
2. 每次启动都执行 Qdrant reconcile。
3. SQLite chunk 与 Qdrant point 不一致时自动 rebuild 或失败退出。

P1：

1. 增加 outbox drain worker。
2. 增加健康检查和可观测日志。
3. 补充启动恢复相关测试。

P2：

1. 将 worker 拆成独立 compose service。
2. 管理后台展示索引健康状态。
