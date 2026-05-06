# Docker 与部署链路说明

## 目录

- [目标](#目标)
- [一张总图](#一张总图)
- [当前服务组成](#当前服务组成)
- [常用启动命令](#常用启动命令)
- [Docker Compose 启动顺序](#docker-compose-启动顺序)
- [Web 容器启动时做了什么](#web-容器启动时做了什么)
- [数据库迁移与初始化](#数据库迁移与初始化)
- [Prisma migrations 的作用](#prisma-migrations-的作用)
- [镜像构建与文件拷贝](#镜像构建与文件拷贝)
- [运行时数据与 volumes](#运行时数据与-volumes)
- [服务间访问地址](#服务间访问地址)
- [本地开发与容器部署的区别](#本地开发与容器部署的区别)
- [边界情况与风险](#边界情况与风险)
- [后续可优化方向](#后续可优化方向)

---

## 目标

本文用于解释当前项目的 Docker Compose、Dockerfile、entrypoint、Prisma migration 和部署启动链路。

核心结论：

- 当前 Compose 是一个偏部署模式的编排，不是单纯的本地开发启动脚本。
- `web` 容器是系统中枢，不只是运行 Next.js，还承担数据库迁移、seed 和首次知识库导入触发。
- `prisma/migrations` 是数据库版本历史，仍然有用，不能随便删除。
- 当前 Dockerfile 是多阶段构建：构建阶段需要源码，最终运行镜像主要保留运行产物、初始化脚本和种子知识文件。
- 除默认 `docker-compose.yml` 的 cloudflared 入口外，也提供 `docker-compose.public-web.yml`，用于直接把 Web 映射到宿主机公网端口。

---

## 一张总图

```text
外部用户
  |
  v
cloudflared 容器
  |
  v
web 容器 Next.js :3000
  |        |        |
  |        |        +--> ml-service 容器 :8001
  |        |              - embedding
  |        |              - rerank
  |        |              - 文档解析
  |        |              - 多模态对话流
  |        |
  |        +--> qdrant 容器 :6333
  |               - 向量库
  |
  +--> postgres 容器 :5432
          - 业务数据库
```

系统可以按三层理解：

```text
入口层：
  cloudflared

业务层：
  web

基础能力层：
  postgres
  qdrant
  ml-service
```

---

## 当前服务组成

当前 `docker-compose.yml` 有 5 个服务：

| 服务 | 作用 | 端口策略 |
|---|---|---|
| `postgres` | PostgreSQL，存用户、会话、消息、工单、知识库元数据 | `ports: 5432:5432`，宿主机可访问 |
| `qdrant` | 向量数据库，存知识库 chunk 向量 | `expose: 6333/6334`，仅 Compose 内部访问 |
| `ml-service` | Python FastAPI，负责 embedding、rerank、文档解析、多模态能力 | `expose`/容器内部端口，未映射宿主机 |
| `web` | Next.js 主应用，业务入口 | `expose: 3000`，未映射宿主机 |
| `cloudflared` | Cloudflare Tunnel，把外网流量转发到 `web:3000` | 通过 tunnel 对外 |

注意：

- `expose` 只让同一个 Docker 网络里的服务能访问。
- `ports` 才会映射到宿主机。
- 当前只有 PostgreSQL 映射到了宿主机 `5432`。
- `web`、`ml-service`、`qdrant` 默认都不是通过宿主机端口直接访问。

### 直接公网暴露 Web 的替代 Compose

如果不使用 cloudflared，可以使用：

```bash
docker compose -f docker-compose.public-web.yml up -d --build
```

该文件只把 `web` 映射到宿主机：

```env
WEB_PUBLIC_PORT=80
```

安全边界：

- `postgres`、`qdrant`、`ml-service` 不配置宿主机 `ports`。
- 这些服务只在同一个 Compose 网络内被 `web` 访问。
- 云服务器安全组/防火墙仍需只放行 `WEB_PUBLIC_PORT` 对应端口，例如 80/443。

---

## 常用启动命令

根目录 `package.json` 中的 Compose 相关脚本：

```json
{
  "compose:up": "docker compose up -d",
  "compose:rebuild:web": "docker compose up -d --build web cloudflared",
  "compose:rebuild:ml": "docker compose up -d --build ml-service web cloudflared",
  "compose:rebuild:all": "docker compose up -d --build"
}
```

对应含义：

```bash
pnpm compose:up
```

启动已有镜像，不强制重建。

```bash
pnpm compose:rebuild:web
```

重建并启动 `web` 和 `cloudflared`。

```bash
pnpm compose:rebuild:ml
```

重建并启动 `ml-service`，同时启动依赖它的 `web` 和入口 `cloudflared`。

```bash
pnpm compose:rebuild:all
```

全量重建所有服务。

---

## Docker Compose 启动顺序

执行：

```bash
docker compose up -d --build
```

大致流程：

1. 构建 `ml-service` 镜像。
2. 构建 `web` 镜像。
3. 启动 `postgres`。
4. 启动 `qdrant`。
5. 启动 `ml-service`。
6. 等待 `postgres` healthcheck 通过。
7. 等待 `ml-service` healthcheck 通过。
8. 启动 `web`。
9. 启动 `cloudflared`。

`web` 的依赖关系：

```yaml
depends_on:
  postgres:
    condition: service_healthy
  qdrant:
    condition: service_started
  ml-service:
    condition: service_healthy
```

含义：

- `postgres` 必须健康后，`web` 才启动。
- `ml-service` 必须健康后，`web` 才启动。
- `qdrant` 只要求已经启动，不等待健康检查。

---

## Web 容器启动时做了什么

`web` 容器不是直接启动 Next.js。

`Dockerfile.web` 中：

```dockerfile
ENTRYPOINT ["/app/docker-entrypoint.sh"]
```

所以 `web` 容器启动时会先执行 `docker-entrypoint.sh`。

当前 entrypoint 做的事情：

```text
[0/3] 执行数据库迁移
  npx prisma migrate deploy

[1/3] 写入基础种子数据
  npx tsx prisma/seed.ts

启动 Next.js 到后台
  node app/web/server.js &

等待 Next.js ready
  curl http://localhost:3000/

如果 AUTO_IMPORT_KNOWLEDGE_ON_FIRST_BOOT=true:
  执行 scripts/should-import-knowledge.ts
  如果判断需要导入:
    调用 /api/auth/login 获取 cookie
    调用 /api/knowledge 触发知识库导入

最后 wait Next.js 进程
```

因此当前 `web` 容器启动职责包括：

- 数据库迁移。
- 基础 seed。
- 启动 Next.js。
- 判断是否首次导入知识库。
- 通过调用自己的 API 触发知识导入和向量化。
- 保持 Next.js 主进程运行。

这也是当前启动链路看起来复杂的主要原因。

---

## 数据库迁移与初始化

根目录数据库脚本：

```json
{
  "db:generate": "prisma generate",
  "db:migrate": "prisma migrate dev",
  "db:deploy": "prisma migrate deploy",
  "db:reset": "prisma migrate reset"
}
```

这些命令通过 `prisma/schema.prisma` 中的 datasource 读取 `DATABASE_URL` 连接数据库。

### db:generate

```bash
pnpm db:generate
```

等价于：

```bash
prisma generate
```

作用：

- 不修改数据库。
- 根据 `schema.prisma` 生成 Prisma Client。
- 让 TypeScript 代码可以使用 `prisma.user.findMany()` 这类类型安全 API。

触发时机：

- Docker 构建 `web` 镜像时会执行。
- 修改 `schema.prisma` 后可能需要手动执行。
- Prisma Client 类型异常时可以手动执行。

### db:migrate

```bash
pnpm db:migrate
```

等价于：

```bash
prisma migrate dev
```

作用：

- 开发环境使用。
- 对比 `schema.prisma` 与已有 migration。
- 生成新的 `prisma/migrations/.../migration.sql`。
- 把 migration 应用到开发数据库。
- 通常也会触发 Prisma Client generate。

触发时机：

- 本地 `pnpm dev` 会先执行 `pnpm db:migrate`。
- 修改 `schema.prisma` 后需要生成 migration 时手动执行。

### db:deploy

```bash
pnpm db:deploy
```

等价于：

```bash
prisma migrate deploy
```

作用：

- 部署/生产环境使用。
- 不生成新的 migration。
- 只执行仓库中已经存在、但数据库还没有应用过的 migration。

触发时机：

- Docker `web` 容器启动时由 entrypoint 自动执行。
- 不走 Docker entrypoint 的部署环境中，可以手动执行。

### db:reset

```bash
pnpm db:reset
```

等价于：

```bash
prisma migrate reset
```

作用：

- 删除/重建数据库 schema。
- 从头应用所有 migration。
- 通常会重新 seed。
- 会清空已有业务数据。

使用场景：

- 本地开发数据库乱了。
- 本地需要从零恢复干净数据。
- 测试 seed 和初始化流程。

不要在生产环境使用。

---

## Prisma migrations 的作用

当前目录：

```text
prisma/migrations/migration_lock.toml
prisma/migrations/20260505000000_init_postgresql/migration.sql
prisma/migrations/20260505091948_add_user_sidebar_theme/migration.sql
```

这些文件通常由：

```bash
pnpm db:migrate
```

生成。

### 20260505000000_init_postgresql

这是 PostgreSQL 初始迁移。

它创建：

- enum。
- 基础业务表。
- 索引。
- 唯一约束。
- 外键关系。

新数据库从空库开始时，需要靠这个 migration 建出基础结构。

### 20260505091948_add_user_sidebar_theme

该迁移给 `User` 表新增：

```sql
ALTER TABLE "User" ADD COLUMN "sidebarTheme" TEXT NOT NULL DEFAULT 'blue';
```

对应当前 `schema.prisma` 中：

```prisma
sidebarTheme String @default("blue")
```

### migration_lock.toml

当前内容：

```toml
provider = "postgresql"
```

它记录这套 migration 历史属于 PostgreSQL。

### 现在还有用吗

有用。

`schema.prisma` 是当前数据库模型快照。

`prisma/migrations` 是数据库从空库演进到当前结构的施工记录。

Prisma 在每个数据库中还会维护 `_prisma_migrations` 表，用来记录该数据库已经执行过哪些 migration。

部署时：

```text
容器内 /app/prisma/migrations
  -> prisma migrate deploy
  -> 查询数据库 _prisma_migrations
  -> 只执行尚未应用过的 migration
```

因此 `prisma/migrations` 不能随便删除。

---

## 镜像构建与文件拷贝

### Next.js 是否必须在生产容器内构建

不必须。

可以在 CI 或构建机中先执行：

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter web build
```

然后只把 `.next/standalone`、`.next/static` 和必要运行文件打进生产镜像。

但当前项目采用更常见、更稳妥的 Docker 多阶段构建：

```text
deps 阶段：
  安装依赖

builder 阶段：
  拷源码
  prisma generate
  next build

runner 阶段：
  只拷生产运行需要的产物和初始化脚本
```

优点：

- 构建环境是 Linux，和生产运行环境更一致。
- 避免 macOS 本地构建产物在 Linux 容器中因为 native 依赖不兼容而出问题。
- Prisma、Next.js standalone tracing、monorepo workspace 更容易保持一致。

### Web 镜像构建阶段拷贝了什么

依赖安装阶段拷贝：

```text
pnpm-lock.yaml
pnpm-workspace.yaml
package.json
app/web/package.json
packages/shared/package.json
prisma/schema.prisma
```

构建阶段拷贝：

```text
app/web/
packages/shared/
prisma/
```

其中 `prisma/` 包括：

```text
schema.prisma
migrations/
seed.ts
```

### Web 运行镜像中拷贝了什么

最终 `web` runner 镜像中主要包含：

```text
Next.js standalone 产物
app/web/.next/static
prisma/
Prisma Client 运行文件
packages/shared
bcryptjs
dotenv
prisma/seed.ts
scripts/import-seed-knowledge.ts
scripts/should-import-knowledge.ts
seed_knowledge/
药店门店智能问答轻量级知识库.docx
信息部常见问题详解/
docker-entrypoint.sh
```

这些文件的用途：

| 文件/目录 | 用途 |
|---|---|
| `.next/standalone` | Next.js 生产运行代码 |
| `.next/static` | 前端静态资源 |
| `prisma/` | schema、migrations、seed、Prisma 迁移所需文件 |
| Prisma Client 运行文件 | 运行时访问数据库 |
| `packages/shared` | seed/import 脚本和应用运行可能依赖的共享类型/逻辑 |
| `bcryptjs`、`dotenv` | seed/import 脚本运行依赖 |
| `scripts/import-seed-knowledge.ts` | 导入种子知识 |
| `scripts/should-import-knowledge.ts` | 判断是否需要首次导入 |
| `seed_knowledge/`、docx、`信息部常见问题详解/` | 初始知识库来源 |
| `docker-entrypoint.sh` | Web 容器启动入口 |

注意：

- `prisma/migrations` 是构建镜像时复制进去的，不是 volume 挂载。
- 本地修改 migration 后，需要重新 build `web` 镜像，容器内才会拿到新 migration。

---

## 运行时数据与 volumes

Compose 定义了 4 个 volume：

```yaml
volumes:
  postgres_data:
  qdrant_storage:
  app_state:
  uploads_data:
```

用途：

| volume | 挂载位置 | 用途 |
|---|---|---|
| `postgres_data` | `/var/lib/postgresql/data` | PostgreSQL 数据 |
| `qdrant_storage` | `/qdrant/storage` | Qdrant 向量数据 |
| `app_state` | `/app/data` | Web 应用状态数据，目前主要是预留/运行状态 |
| `uploads_data` | `/app/uploads` | 上传文件 |

`uploads_data` 同时挂给了 `web` 和 `ml-service`。

原因：

```text
用户上传图片/文件
  -> web 保存到 /app/uploads
  -> ml-service 通过同一个 volume 读取文件
```

---

## 服务间访问地址

本地开发模式常见地址：

```env
DATABASE_URL=postgresql://...@127.0.0.1:5432/...
QDRANT_URL=http://127.0.0.1:6333
EMBEDDING_SERVICE_URL=http://127.0.0.1:8001/embed
RERANK_SERVICE_URL=http://127.0.0.1:8001/rerank
ML_SERVICE_URL=http://127.0.0.1:8001
```

容器部署模式使用 Compose service name：

```env
DATABASE_URL=postgresql://...@postgres:5432/...
QDRANT_URL=http://qdrant:6333
EMBEDDING_SERVICE_URL=http://ml-service:8001/embed
RERANK_SERVICE_URL=http://ml-service:8001/rerank
ML_SERVICE_URL=http://ml-service:8001
```

原因：

- 宿主机访问容器端口时使用 `127.0.0.1`。
- 容器访问另一个容器时使用 Compose service name。

---

## 本地开发与容器部署的区别

| 对比项 | `pnpm dev` 本地开发 | `docker compose up -d --build` 容器部署 |
|---|---|---|
| Web 进程 | 宿主机 Next.js dev server | `web` 容器 Next.js standalone |
| ML 进程 | 宿主机 Python venv | `ml-service` 容器 |
| PostgreSQL | 容器或本机，通常通过 `127.0.0.1:5432` | `postgres` 容器 |
| Qdrant | 通常用容器，宿主机访问 `127.0.0.1:6333` | `qdrant` 容器 |
| 服务地址 | localhost/127.0.0.1 | service name |
| 数据库迁移 | `pnpm dev` 前置 `pnpm db:migrate` | `web` entrypoint 执行 `prisma migrate deploy` |
| 构建 | 热更新开发模式 | Docker build 生产产物 |
| 对外入口 | 直接访问本地端口 | cloudflared tunnel |

如果使用 `docker-compose.public-web.yml`，对外入口不是 cloudflared，而是宿主机 `WEB_PUBLIC_PORT -> web:3000`。

---

## 边界情况与风险

当前方式是合理的工程基础，但不是万能数据库变更保险。

### Prisma migration 的边界

这些通常较稳定：

- 新增表。
- 新增可空字段。
- 新增有默认值的字段。
- 新增索引。
- 新增 enum 值。
- 新增关系表。
- 已提交 migration 后由 `migrate deploy` 应用到部署环境。

这些需要人工审查：

- 删除字段，可能丢数据。
- 字段改名，可能被 Prisma 识别为删除旧字段再新增字段。
- 已有数据表新增非空字段但没有默认值，可能失败。
- 拆表、合表、JSON 字段拆关系表等复杂业务数据迁移。
- 大表加索引或改字段类型，可能锁表。
- migration 中途失败，需要人工处理 `_prisma_migrations` 状态。
- 多分支并行开发产生 migration 冲突。

安全规则：

```text
简单 schema 变化：
  pnpm db:migrate
  检查 migration.sql
  提交 schema.prisma + migrations

生产已有数据的危险变更：
  不要盲信自动生成 SQL
  手动审查 migration.sql
  必要时分阶段迁移或写数据回填脚本
```

### Seed 的边界

Docker `web` 每次启动都会执行：

```bash
npx tsx prisma/seed.ts
```

所以 `seed.ts` 必须尽量幂等。

如果 seed 不幂等，可能出现：

- 重复用户。
- 重复配置。
- 唯一键冲突。
- 容器重启时覆盖业务数据。

### EntryPoint 职责过重

当前 `web` entrypoint 混合了：

```text
数据库迁移
基础 seed
启动 Next.js
等待 Next.js ready
自动登录
调用 API 导入知识库
触发向量化
```

优点：

- 一条命令从零启动，部署简单。

缺点：

- 启动链路不直观。
- 首次启动慢。
- Web 容器职责偏重。
- 知识库导入失败时，容易和 Web 启动问题混在一起排查。

---

## 后续可优化方向

如果要让部署链路更清晰，可以考虑拆分职责。

### 方案一：保留当前方式，只整理命令和文档

适合当前阶段。

改动小，继续使用：

```text
web entrypoint
  -> migrate
  -> seed
  -> start web
  -> first boot import
```

需要补强：

- 文档。
- 日志。
- 失败提示。
- seed 幂等性。

### 方案二：拆出一次性 init 服务

将迁移和 seed 从 `web` entrypoint 中拆出：

```text
migrate:
  prisma migrate deploy

seed:
  tsx prisma/seed.ts

web:
  只启动 Next.js
```

优点：

- Web 容器职责更清晰。
- 数据库初始化失败更容易定位。

缺点：

- Compose 编排更复杂。
- 要处理 init 服务的重试和依赖顺序。

### 方案三：知识库导入独立成 job/worker

把首次知识库导入从 `web` entrypoint 中拆出：

```text
kb-import:
  判断是否需要导入
  导入 seed knowledge
  写 Postgres
  写 Qdrant
```

优点：

- Web 启动更快。
- 知识库导入失败不会影响 Web 主服务启动。
- 更容易重跑和观测。

缺点：

- 需要明确 job 的执行时机。
- 需要处理并发导入和失败重试。

### 方案四：CI 构建产物，生产镜像只打包运行文件

当前 Dockerfile 在 `builder` 阶段复制源码并构建。

可替代方案：

```text
CI Linux 环境
  -> pnpm install
  -> pnpm db:generate
  -> pnpm --filter web build
  -> docker build runner-only image
```

优点：

- 生产镜像构建更快。
- 构建与运行职责更分离。

注意：

- 不建议用 macOS 本机构建产物直接上 Linux 生产。
- Prisma Client、Next.js standalone tracing、monorepo workspace 和 native 依赖要保持一致。

---

## 最简心智模型

当前项目 Docker 部署可以这样记：

```text
docker compose 负责拉起 5 个服务

web 是主服务
  但 web 启动前会顺手做数据库迁移和 seed

postgres 存业务数据
qdrant 存向量
ml-service 做 AI 辅助能力
cloudflared 做外部入口

prisma/migrations 是数据库版本历史
  Docker build 会复制进 web 镜像
  web entrypoint 启动时用 migrate deploy 执行

seed_knowledge 和文档文件也被复制进 web/ml 镜像
  首次启动可能触发知识库导入
```
