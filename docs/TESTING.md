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

| 依赖                     | Mock 方式                                               | 位置                           |
| ------------------------ | ------------------------------------------------------- | ------------------------------ |
| Prisma Client            | `vi.mock("@/lib/db")` 全局 mock                         | `test/setup.ts`                |
| 环境变量                 | `vi.mock("@/lib/env")` 全局 mock                        | `test/setup.ts`                |
| Next.js cookies/redirect | `vi.mock("next/headers")`, `vi.mock("next/navigation")` | `test/setup.ts`                |
| OpenAI SDK               | `vi.mock("@/lib/openai")` 按需 mock                     | 各服务测试文件                 |
| ML 服务                  | `vi.mock("@/lib/retrieval/ml-service")` 按需 mock       | retrieval/knowledge 测试       |
| Qdrant                   | `vi.mock("@/lib/retrieval/qdrant")` 按需 mock           | retrieval/knowledge-index 测试 |
| 通知服务                 | `vi.mock("@/lib/notifications/server")` 按需 mock       | tickets 测试                   |

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
const departmentUser = buildUser({ role: "department", departmentId: "dept-1" });
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

| 层级                                     | 语句覆盖率目标 |
| ---------------------------------------- | -------------- |
| 纯工具函数（lib/utils, presentation 等） | 90%+           |
| 服务层（services/\*）                    | 80%+           |
| API 路由（app/api/\*）                   | 70%+           |
| 整体项目                                 | 70%+           |

---

## 写测试的实战经验

下面是在本项目中写测试时踩过的坑和总结的方法论。写新测试前建议通读一遍，避免重复踩坑。

### 原则一：先读懂实现，再写测试

测试不是对着函数签名猜行为。你必须知道函数内部走了哪些路径、对数据做了什么变换。

**踩过的坑**：测试 `generateTicketKnowledgeDraft` 时，传了 `selectedMaterialIds: ["tm:user1"]`，但函数内部会先调用 `getTicketKnowledgeMaterials()`，给每条消息的 ID 加上 `"ticketMessage:"` 前缀，再用前缀后的 ID 去匹配。传入的 `"tm:user1"` 永远匹配不上 `"ticketMessage:tm:user1"`，直接抛错。

这个前缀逻辑藏在代码中间，不看完整实现根本发现不了。

**怎么避免**：

1. 先通读被测函数的完整代码，画出它内部调用了哪些函数
2. 特别注意内部函数对数据的变换（加前缀、格式转换、过滤）
3. 确认错误在哪个阶段抛出——有些变量在错误发生时可能还没初始化

### 原则二：Mock 链要完整，缺一不可

被测函数内部每一条语句都可能依赖某个 mock 的返回值。如果 mock 返回了 `undefined`（忘记设置），后续代码对 `undefined` 调用方法就会报错。

**踩过的坑**：测试 `createAssistantGenerationStream` 的错误处理路径。错误处理中有：

```typescript
await prisma.chatMessage.update({...}).catch(() => undefined);
```

没有 mock `prisma.chatMessage.update`，它返回 `undefined`。`undefined` 没有 `.catch()` 方法，抛出 TypeError，流卡住永远不关闭，测试超时 5 秒。

错误信息看起来像"测试太慢"，实际是 **mock 不完整导致代码执行路径中断**。

**怎么避免**：

- 每次只写一个 mock、一个断言，跑通再加下一个
- 不要一口气写完所有 mock 再跑——报错后很难定位是哪个 mock 的问题
- 如果测试超时，优先检查异步代码中的 `.catch()`、`.then()` 链上是否有 mock 返回了 `undefined`

### 原则三：Promise.all 中的调用顺序不可预测

当被测函数使用 `Promise.all` 并发调用多个 mock 方法时，`mockResolvedValueOnce` 的顺序可能和预期不一致。

**踩过的坑**：`listKnowledgeItems` 内部：

```typescript
const [items, total, summary, categories] = await Promise.all([
  prisma.knowledgeItem.findMany(...),   // 调用 A
  prisma.knowledgeItem.count(...),      // 调用 B
  getKnowledgeSummary(),                // 内部有 8 个 count/aggregate
  prisma.knowledgeItem.findMany(...),   // 调用 C
]);
```

`getKnowledgeSummary` 内部也调用了 `prisma.knowledgeItem.count`。这些并发调用竞争同一个 mock 方法，`mockResolvedValueOnce` 的排队顺序可能和 `Promise.all` 的执行顺序不一致。

**怎么避免**：

- 对 `Promise.all` 内部的并发调用，精确排列 `mockResolvedValueOnce` 可以工作但很脆弱
- 更稳妥的做法：测试只验证返回值的结构和类型，不验证来自并发查询的具体数值
- 或者把并发的 mock 调用拆到不同的 mock 方法上（如果可能的话）

### 原则四：有些代码不适合单元测试，不强求

以下类型的代码在 Vitest 单元测试中强行 mock 成本极高、收益很低：

| 代码类型                           | 为什么难测                      | 推荐方式                                    |
| ---------------------------------- | ------------------------------- | ------------------------------------------- |
| Next.js `cookies()` / `redirect()` | 依赖 async storage，mock 不生效 | 通过 API 路由测试间接覆盖                   |
| SSE 流式响应（ReadableStream）     | 需要消费整个流才能触发内部逻辑  | 测内部辅助函数 + 端到端测试                 |
| 外部 API 调用（OpenAI、Qdrant）    | mock 和真实行为可能有偏差       | 单元测试验证分支逻辑 + 手动脚本验证真实 API |
| React 组件                         | 需要 jsdom 环境和渲染器         | Playwright E2E 测试                         |

**核心判断标准**：如果一个函数的依赖需要 mock 3 层以上（A 依赖 B 依赖 C 依赖 D），说明这个函数的单元测试成本已经超过收益。改为：

- 测它的纯函数子部分
- 或用集成/E2E 测试覆盖完整路径

### 原则五：每个 bug 修复都应伴随一个测试

这是投入产出比最高的写测试时机：

1. 先写一个能复现 bug 的测试（此时测试会失败）
2. 修复 bug
3. 测试通过

这样这个 bug 以后不会再出现（回归测试）。比"空闲时补测试"更有针对性，也更容易写——因为你已经知道 bug 的具体表现。

### 开发流程建议：什么时候写测试

```
改动类型                          写测试时机
─────────────────────────────────────────────
lib/services/ 下的业务逻辑变更    改之前先写测试（TDD）
修 bug                           先写复现测试，再修
API 路由新增/修改                 改完立刻补测试
前端 UI 调整                     不强制，复杂组件推荐加
数据库 schema 变更                更新 factories + 受影响的测试
```

### 常见报错和排查思路

| 报错                                             | 常见原因                              | 排查方向                                                   |
| ------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------- |
| `TypeError: Cannot read properties of undefined` | mock 方法返回了 `undefined`           | 检查 `mockResolvedValue` 是否覆盖了所有被调用的方法        |
| `expected X to be Y`（数值不对）                 | `Promise.all` 中 mock 调用顺序错      | 检查并发调用了几次同一个 mock 方法                         |
| 测试超时 5000ms                                  | 异步流卡住（mock 链断裂）             | 检查 ReadableStream/Promise 链上是否有 `undefined.catch()` |
| `vi.mock` 不生效                                 | pnpm 模块解析路径和 mock 标识符不匹配 | 在测试文件顶部用 `vi.mock` 覆盖 setup.ts 的全局 mock       |
| `Cannot find module '../../helpers/factories'`   | 相对路径层级算错                      | 从测试文件位置往上数到 `test/` 根目录的层级                |
