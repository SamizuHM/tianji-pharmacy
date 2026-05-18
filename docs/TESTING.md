# 测试指南

## 快速开始

```bash
# 运行全部测试
pnpm test

# 监听模式（开发时使用）
pnpm test:watch

# 生成覆盖率报告
pnpm test:coverage
```

覆盖率报告生成在 `coverage/index.html`，用浏览器打开即可查看。

## 测试架构

### 技术栈

- **Vitest** — 测试框架，原生 TypeScript + ESM 支持
- **@vitest/coverage-v8** — 覆盖率收集

### 目录结构

```
test/
  setup.ts                     # 全局 mock（Prisma、env、Next.js）
  helpers/
    mock-prisma.ts             # Prisma mock 工厂（含类型导出）
    mock-external.ts           # OpenAI、ML 服务、Qdrant mock 工厂
    factories.ts               # 测试数据工厂函数
  packages/
    shared/
      index.test.ts            # 共享类型和常量测试
  app/
    web/
      lib/
        utils.test.ts          # 纯工具函数
        presentation.test.ts   # 展示层函数
        chat-progress.test.ts  # 进度步骤定义
        active-streams.test.ts # SSE 流缓冲管理
        auth/
          session.test.ts      # 认证纯函数
        services/
          settings.test.ts     # 运行时设置
          conversations.test.ts # 会话管理
          stats.test.ts        # 统计聚合
          tickets.test.ts      # 工单生命周期（核心）
          knowledge.test.ts    # 知识库管理
          knowledge-index.test.ts # 向量索引
          retrieval.test.ts    # RAG 检索管线
      middleware.test.ts       # 路由保护中间件
      api/
        auth-login.test.ts     # 登录 API
        settings.test.ts       # 设置 API
```

### Mock 策略

| 依赖 | Mock 方式 | 位置 |
|------|----------|------|
| Prisma Client | `vi.mock("@/lib/db")` 全局 mock | `test/setup.ts` |
| 环境变量 | `vi.mock("@/lib/env")` 全局 mock | `test/setup.ts` |
| Next.js cookies/redirect | `vi.mock("next/headers")`, `vi.mock("next/navigation")` | `test/setup.ts` |
| OpenAI SDK | `vi.mock("@/lib/openai")` 按需 mock | 各服务测试文件 |
| ML 服务 | `vi.mock("@/lib/retrieval/ml-service")` 按需 mock | retrieval/knowledge 测试 |
| Qdrant | `vi.mock("@/lib/retrieval/qdrant")` 按需 mock | retrieval/knowledge-index 测试 |
| 通知服务 | `vi.mock("@/lib/notifications/server")` 按需 mock | tickets 测试 |

**关键设计**：`test/setup.ts` 中的全局 mock 确保测试永不连接真实数据库或读取真实文件系统。每个测试文件只需在 `beforeEach` 中调用 `vi.clearAllMocks()` 重置状态，然后用 `prisma.xxx.mockResolvedValue()` 设置特定返回值。

### Prisma $transaction Mock

```typescript
// setup.ts 中的 mock 实现支持事务
prisma.$transaction = vi.fn(async (fn) => fn(prisma));
```

事务回调接收到同一个 mock prisma 对象，内部操作自动使用已 mock 的方法。

## 编写新测试

### 1. 纯函数测试

直接导入函数测试，无需 mock：

```typescript
import { describe, it, expect } from "vitest";
import { myHelper } from "@/lib/my-module";

describe("myHelper", () => {
  it("正常工作", () => {
    expect(myHelper("input")).toBe("expected");
  });
});
```

### 2. 服务层测试

使用全局 mock 的 prisma + 按需 mock 外部服务：

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { myService } from "@/lib/services/my-service";

vi.mock("@/lib/external-dep", () => ({
  externalCall: vi.fn(),
}));

describe("myService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("调用数据库并返回结果", async () => {
    prisma.myModel.findMany.mockResolvedValue([{ id: "1" }]);

    const result = await myService();

    expect(prisma.myModel.findMany).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });
});
```

### 3. 使用数据工厂

```typescript
import { buildUser, buildTicket } from "../../helpers/factories";

// 使用默认值
const user = buildUser();

// 覆盖部分字段
const agent = buildUser({ role: "agent", departmentId: "dept-1" });
```

### 4. API 路由测试

Mock `getCurrentUser` + mock 服务函数 → 构造 Request → 断言响应：

```typescript
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: vi.fn(),
}));

import { POST } from "@/app/api/my-endpoint/route";

it("未登录返回 401", async () => {
  (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

  const request = new Request("http://localhost/api/my-endpoint", {
    method: "POST",
    body: JSON.stringify({}),
    headers: { "Content-Type": "application/json" },
  });

  const response = await POST(request);
  expect(response.status).toBe(401);
});
```

## 注意事项

### Next.js 运行时依赖

`lib/auth/session.ts` 中的 `createSession`、`destroySession`、`getCurrentUser`、`requireUser` 依赖 Next.js 的 async storage，无法在 Vitest 中直接 mock。这些函数通过 API 路由测试间接覆盖。

### 新增 Prisma Model

如果新增了 Prisma model，需要在 `test/setup.ts` 的 `prisma` 对象中添加对应的 mock model：

```typescript
// 在 setup.ts 中添加
prisma.newModel = createMockModel();
```

### 新增外部服务

如果引入了新的外部服务依赖，在 `test/helpers/mock-external.ts` 中添加对应的 mock 工厂，然后在需要的测试文件中用 `vi.mock` 引入。

## 覆盖率目标

| 层级 | 语句覆盖率目标 |
|------|--------------|
| 纯工具函数（lib/utils, presentation 等） | 90%+ |
| 服务层（services/*） | 80%+ |
| API 路由（app/api/*） | 70%+ |
| 整体项目 | 70%+ |
