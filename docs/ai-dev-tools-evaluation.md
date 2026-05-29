# 从需求到上线：AI 驱动的全栈智能体开发实践

> 以「天济大药房门店问答助手 Demo」为案例，完整介绍一个 AI 智能体从需求定义、视觉设计、架构规划、编码实现到公网部署的全过程，以及其中使用的 AI 工具链。同时覆盖当前主流 Coding Agent、第三方模型、API 中转站等基础知识的科普。

---

> **阅读提示**：AI 开发工具领域变化极快，本文内容基于 2026 年 5 月的调研。工具的功能、定价和生态可能在你读到本文时已发生变化，建议结合官方最新信息参考。

---

## 第一部分：项目案例 —— 天济大药房门店问答助手

### 项目概述

天济大药房门店问答助手是一个面向药店门店场景的智能客服系统，核心目标是帮助药店员工和顾客快速获得药品咨询、医保政策、收银流程等方面的准确回答。系统采用 RAG（检索增强生成）架构，将药店专业知识库与大语言模型结合，同时提供人工转接机制作为兜底。

**核心功能**：

- **RAG 知识库问答**：基于向量数据库（Qdrant）的检索增强生成，支持文本、图片、PDF、Word 等多格式知识导入，经过 Embedding 向量化后支持语义检索
- **多模态对话**：支持文字和图片混合输入的流式对话，后端采用 DashScope 的 qwen3.5-27b 多模态模型
- **人工转接工单系统**：用户请求人工帮助时自动创建工单，支持人工客服认领、专家转办、解决闭环的完整流程
- **知识反馈闭环**：已解决的工单自动提取为 QA 知识文档，写回知识库并生成检索投影，系统越用越聪明
- **管理后台**：数据看板（7 天趋势图）、历史问答记录、工单管理、知识库 CRUD 管理等

**技术架构**：

```
┌─────────────────────────────────────────────────┐
│                  用户浏览器                       │
│          Next.js App Router + React 19           │
│        TypeScript + Tailwind + shadcn/ui         │
└────────────────────┬────────────────────────────┘
                     │ API 调用
         ┌───────────┴───────────┐
         ▼                       ▼
┌─────────────────┐    ┌─────────────────┐
│   Web 后端       │    │   ML 服务        │
│  Next.js API    │    │   FastAPI        │
│  Prisma ORM     │    │   Python 3.11   │
│  业务逻辑        │    │   Embedding     │
│  工单流程        │    │   Reranking     │
└────────┬────────┘    │   文档解析       │
         │             └────────┬────────┘
         ▼                      │
┌─────────────────┐    ┌────────┴────────┐
│  PostgreSQL     │    │  Qdrant         │
│  业务数据        │    │  向量数据库      │
│  用户/工单/消息   │    │  知识库索引      │
└─────────────────┘    └─────────────────┘
```

部署方式为 Docker Compose，通过 Cloudflare Tunnel + 自有域名实现公网访问。

---

### 开发全流程

以下按照实际开发顺序，逐步介绍每个阶段使用的 AI 工具和工作方式。

#### 阶段一：需求定义与视觉设计

**使用的工具：ChatGPT Plus + Google Stitch**

任何项目的第一步都是明确需求。在这个阶段，使用 ChatGPT Plus 进行多轮对话，将模糊的"做一个药店问答助手"逐步细化为具体的功能列表和交互流程。

**用 GPT Image 生成视觉稿**：在需求讨论到一定程度后，直接在 ChatGPT 中使用 GPT Image（gpt-image-2 模型）生成界面视觉稿。通过自然语言描述界面布局、配色方案和交互元素，GPT Image 会生成对应的 UI 效果图。这比从零开始设计快得多——你可以快速获得多个视觉方向的参考。

```
提示词示例：
"设计一个药店智能问答助手的聊天界面，左侧是侧边栏显示历史对话和功能菜单，
右侧是主对话区域，整体风格简洁专业，使用蓝紫色系配色"
```

**用 Google Stitch 精细化设计**：将 GPT Image 生成的视觉稿图片交给 Google Stitch（Google Labs 出品的免费 UI 设计工具，基于 Gemini 模型），Stitch 可以基于图片或文字描述进一步生成更详细的 UI 设计，并支持导出为 HTML 文件。这个导出的 HTML 文件在后续编码阶段会成为重要的参考——Coding Agent 可以直接"看到"目标界面的结构和样式。

```
视觉稿流程：
ChatGPT（需求讨论 + gpt-image-2 生成初稿）
    → Google Stitch（细化设计 + 导出参考 HTML）
        → 交给 Coding Agent 作为实现目标
```

> **为什么需要视觉稿？** 直接告诉 Coding Agent "做一个聊天界面"，它可能会做出一个功能正确但视觉平庸的页面。有了视觉稿作为目标，Agent 可以更精确地还原设计意图，包括配色、间距、组件布局等细节。

#### 阶段二：架构设计与计划

**使用的工具：Claude Code / Codex CLI（Plan 模式）**

有了需求和视觉设计后，进入架构设计阶段。这一步充分利用 Coding Agent 的 Plan（规划）模式。

**具体做法**：

1. 将视觉设计 HTML 文件放在项目目录中
2. 在 Claude Code 或 Codex CLI 中，使用 Plan 模式告诉 Agent：
   - 项目的完整需求描述
   - 参考的视觉设计 HTML
   - 期望的技术约束

3. Agent 会分析需求，提出详细的架构方案和实施计划

**在本项目中，Agent 提出的技术方案**：

```
前端：Next.js (App Router) + React 19 + TypeScript + Tailwind CSS + shadcn/ui
后端：Next.js API Routes（业务逻辑）+ FastAPI Python 服务（ML 相关）
数据库：PostgreSQL（Prisma ORM）+ Qdrant 向量数据库
AI 模型：DashScope API（通义千问 qwen3.5-27b 多模态 + qwen3-vl-embedding + qwen3-vl-rerank）
部署：Docker Compose + Cloudflare Tunnel
```

Agent 将整个开发拆分为多个阶段，每个阶段有明确的交付物和验证标准。在确认计划合理后，逐步执行。

#### 阶段三：编码实现与迭代

**使用的工具：Claude Code / Codex CLI（主力）+ ChatGPT（辅助）**

进入编码阶段后，Claude Code 和 Codex CLI 是绝对的主力。这两个工具在这一步扮演相同的角色——它们都能读取本地项目文件、理解代码结构、直接修改文件并运行命令。

**日常工作流**：

```
1. 向 Agent 描述要实现的功能（参照 Plan 中的阶段划分）
2. Agent 读取相关文件，理解当前代码结构
3. Agent 生成/修改代码，直接写入文件
4. Agent 运行测试或开发服务器进行验证
5. 发现问题则继续修复，没有问题则 Git 提交
6. 进入下一个功能点
```

**配合 Git 进行版本控制**：Claude Code 和 Codex CLI 都能自主执行 Git 操作。每完成一个功能模块，Agent 会自动提交代码，形成清晰的提交历史。这意味着：

- 每次修改都有记录，随时可以回退
- 可以按功能模块查看变更历史
- 出问题时 `git diff` 和 `git revert` 是安全网

**遇到外部知识盲区时的两种解决路径**：

路径一：**人工切换到 ChatGPT**。当 Agent 遇到不熟悉的 API、最新文档中的变更、或需要对比多种方案时，开发者手动切换到 ChatGPT 网页端：

- 查询 DashScope API 的最新调用方式
- 对比不同 Embedding 模型的效果
- 讨论 Qdrant 索引优化策略
- 将 UI 截图发给 ChatGPT 讨论交互改进

路径二：**让 Agent 自主通过 MCP/Skills 获取知识**。这是更高效的方式，Agent 无需人工介入即可获取最新信息：

- 通过 **Context7 MCP Server** 实时查询 Next.js、Prisma、Qdrant 等库的最新文档和 API 变更
- 通过 **shadcn/ui Skill** 获取组件的最新用法和最佳实践，避免使用过时的 API
- 通过 **Playwright CLI MCP** 启动浏览器验证 UI 渲染效果，截取页面截图进行自检
- 通过 **Chrome DevTools MCP** 读取 Console 错误日志和网络请求，定位前端 Bug

在实际开发中，两种路径通常是混合使用的：MCP/Skills 解决已知的文档查询需求，ChatGPT 处理更开放的讨论和方案比较。

**人工验证与测试**：AI 生成的代码并非总是正确的。每个功能模块完成后，需要人工验证：

- 界面是否还原了视觉设计
- 功能逻辑是否正确
- 边界情况是否处理
- 与已有代码的集成是否无冲突

发现问题后，将问题描述给 Agent，由它定位并修复。这个"Agent 编码 → 人工验证 → 反馈修复"的循环会持续进行，直到质量达标。

#### 阶段四：部署上线

**使用的工具：Docker Compose + Cloudflare Tunnel**

开发完成后，通过 Docker Compose 将 Web 服务和 ML 服务容器化部署。使用 Cloudflare Tunnel 将本地或服务器上的服务安全地暴露到公网，配合自定义域名实现正式访问。

```
部署架构：
Docker Compose
├── web（Next.js 应用）
├── ml-service（FastAPI ML 服务）
├── postgres（PostgreSQL 数据库）
├── qdrant（向量数据库）
└── cloudflared（Cloudflare Tunnel 隧道）
```

## 第二部分：AI 编程工具基础信息

> 本部分介绍当前主流的 AI 编程工具、它们的定位和定价。信息截至 2026 年 5 月，请以官方最新信息为准。

### Coding Agent（编码代理）

Coding Agent 是指能够直接操作本地文件系统、理解项目上下文、执行命令并完成编码任务的 AI 工具。它们与传统的代码补全工具不同——Agent 不仅能"建议"代码，还能"动手写"。

#### Claude Code

**Anthropic 推出**的终端 AI 编程助手，直接在命令行中运行。

- **核心能力**：读取整个项目文件、理解跨文件依赖关系、编辑代码、运行命令、执行 Git 操作、多步骤任务拆分与跟踪
- **模型**：Claude Sonnet 4.6 / Claude Opus 4.6
- **特色功能**：MCP（Model Context Protocol）工具集成，支持连接外部数据源和服务；Plan 模式用于复杂任务的规划
- **订阅方式**：

| 计划    | 月费     | 说明                                                                         |
| ------- | -------- | ---------------------------------------------------------------------------- |
| Pro     | $20      | Claude Code 访问权限（2026 年 4 月曾短暂移除后恢复），适合个人开发者         |
| Max 5x  | $100     | 5 倍使用量，适合重度使用                                                     |
| Max 20x | $200     | 20 倍使用量，适合专业开发                                                    |
| API     | 按量计费 | Haiku 4.5 $1/$5，Sonnet 4.6 $3/$15，Opus 4.7 $5/$25（输入/输出每百万 token） |

#### OpenAI Codex

**OpenAI 推出**的开源命令行编程工具，与 ChatGPT 生态深度整合。

- **核心能力**：本地终端 Agent，读取/修改文件，运行命令，支持 GitHub 事件自动触发和插件系统
- **模型**：gpt-5.5（旗舰，复杂编码与研究）、gpt-5.4（日常编码）、gpt-5.4-mini（快速低成本）、gpt-5.3-codex（编码优化）、gpt-5.2（长时 Agent 任务）
- **特色功能**：Rust 构建的轻量运行时，沙箱执行环境，GitHub Actions 集成，Codex Web 网页端（沙箱环境中异步执行任务）
- **订阅方式**：无独立订阅，包含在 ChatGPT Plus 以上订阅中

| 包含 Codex 的 ChatGPT 计划 | 月费 | Codex 权限                    |
| -------------------------- | ---- | ----------------------------- |
| Plus                       | $20  | 标准 Codex 访问               |
| Pro                        | $100 | 最大 Codex 访问权限，旗舰模型 |

也可通过 OpenAI API 按量计费（GPT-5.4 约 $2.50/$15 每百万输入/输出 token）

#### Cursor

**AI 原生 IDE**，基于 VS Code 深度改造，是目前独立开发者最主流的编码工具之一。2025 年 8 月推出 Cursor CLI，将 Agent 能力从 IDE 扩展到终端环境。

- **核心能力**：AI Tab 补全、多模型支持、Agent 模式（可自动编辑多文件）、上下文感知
- **Cursor CLI**：终端 Agent，支持在终端、GitHub Actions 等 CI/CD 环境中运行编码 Agent，可用于自动更新文档、触发安全审查、批量代码修改等场景
- **特色功能**：可视化 Diff、多模型切换、代码库索引、MCP/Skills/Hooks 支持
- **订阅方式**：

| 计划  | 月费   | 说明                   |
| ----- | ------ | ---------------------- |
| Free  | $0     | 基础功能，有限 AI 请求 |
| Pro   | $20    | 高级模型访问，适合个人 |
| Pro+  | $60    | 更多额度               |
| Ultra | $200   | 无限制使用             |
| Teams | $40/人 | 团队协作               |

> **Claude Code vs Codex vs Cursor 的选择**：三者定位有重叠但各有侧重。Claude Code 和 Codex 最初是终端工具，后续也已发布桌面端面向更广泛的用户。Cursor 最初是 IDE，后来推出 CLI 进入终端领域。Cursor IDE 在可视化编辑体验上有优势（图形化 Diff、Tab 补全），而 Claude Code/Codex 在终端深度操作和长任务自动化方面更成熟。很多开发者会组合使用——Cursor IDE 日常编码 + Claude Code/Codex CLI 处理复杂任务。

#### GitHub Copilot

**微软推出**的 AI 编程助手，深度集成于 VS Code 和 GitHub 生态。

- **核心能力**：代码补全、内联 Chat、多文件编辑（Agent 模式）、MCP 工具集成
- **特色功能**：与 GitHub 仓库/PR/Issues 深度联动，支持自定义 Copilot 扩展，企业版提供知识库索引
- **订阅方式**：

| 计划       | 月费   | 说明                                |
| ---------- | ------ | ----------------------------------- |
| Free       | $0     | 基础补全和聊天，有限额              |
| Pro        | $10    | 高级模型访问，Agent 模式            |
| Pro+       | $39    | 旗舰模型（Opus、GPT-5.5），更高速率 |
| Business   | $19/人 | 团队管理，策略控制                  |
| Enterprise | $39/人 | 知识库索引，组织级定制              |

#### 其他值得关注的产品

| 工具                       | 定位          | 月费              | 特点                                                               |
| -------------------------- | ------------- | ----------------- | ------------------------------------------------------------------ |
| **Windsurf**（原 Codeium） | AI IDE        | Free / Pro $15-20 | 被 Cognition 收购，免费层最慷慨，Cascade Agent                     |
| **Lovable**                | Prompt-to-App | 免费起步          | 自然语言生成完整应用                                               |
| **Bolt**（StackBlitz）     | Prompt-to-App | 免费起步          | 浏览器内全栈开发                                                   |
| **v0**（Vercel）           | UI 生成       | 免费起步          | 专注前端组件生成，与 shadcn/ui 生态深度整合                        |
| **Gemini CLI**             | 终端 Agent    | 免费起步          | Google 推出，Gemini 模型驱动。Coding Agent 能力目前落后于 CC/Codex |

### 视觉设计工具

| 工具                          | 定位            | 费用             | 说明                                            |
| ----------------------------- | --------------- | ---------------- | ----------------------------------------------- |
| **GPT Image**（ChatGPT 内置） | 图片生成/视觉稿 | ChatGPT Plus $20 | gpt-image-2 模型，文字描述即可生成 UI 效果图    |
| **Google Stitch**             | UI 设计         | 免费             | 输入图片或文字，生成 UI 设计并可导出 HTML/Figma |
| **v0**（Vercel）              | 前端组件生成    | 免费起步         | 文字描述生成 React 组件代码                     |

### 对话类工具（知识获取与设计讨论）

| 工具          | 月费                                                       | 核心用途                                                                               |
| ------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **ChatGPT**   | Free $0 / Go $8 / Plus $20 / Pro $100                      | 多模态对话、联网搜索、图片生成、需求讨论；Plus 及以上含 Codex 编码智能体               |
| **Claude.ai** | Free $0 / Pro $20 / Max $100-$200                          | 长文本分析、代码理解、深度推理                                                         |
| **Gemini**    | Free $0 / AI Plus $7.99 / AI Pro $19.99 / AI Ultra $249.99 | 多模态理解、Google 生态集成；Pro 含 Gemini CLI、Jules 编码 Agent、Antigravity 开发平台 |

### MCP 与 Skills：让 Agent 连接真实世界

Coding Agent 虽然强大，但默认只能操作本地文件和运行命令。当它需要访问外部服务、查阅最新文档、或执行浏览器操作时，就需要借助扩展机制。目前最主要的两个概念是 **MCP** 和 **Skills**。

#### MCP（Model Context Protocol）

MCP 是 Anthropic 于 2024 年底推出的开放标准协议，目的是让 AI 模型能够安全、标准化地连接外部数据源和工具。可以把它理解为"AI 的 USB 接口"——只要一个服务实现了 MCP 协议，任何支持 MCP 的 AI 工具都可以调用它。

**工作原理**：

```
AI Agent（Claude Code / Cursor / Copilot 等）
         │
         │  MCP 协议（标准化的 JSON-RPC 通信）
         │
    ┌────┴────┬──────────┬──────────┐
    ▼         ▼          ▼          ▼
 GitHub   数据库     浏览器      文档系统
 MCP      MCP        MCP         MCP
 Server   Server     Server      Server
```

每个 MCP Server 提供三类能力：

- **Resources**（资源）：暴露数据给 Agent 读取（如数据库记录、文件内容）
- **Tools**（工具）：让 Agent 执行操作（如运行测试、发 HTTP 请求、操作浏览器）
- **Prompts**（提示模板）：预定义的提示词模板，帮助 Agent 更好地完成特定任务

**实际开发中常用的 MCP Server**：

| MCP Server              | 用途         | 说明                                                                          |
| ----------------------- | ------------ | ----------------------------------------------------------------------------- |
| **Context7**            | 库文档查询   | Agent 实时查询任何 npm/Python 包的最新文档和 API 用法，解决训练数据过时的问题 |
| **Playwright CLI**      | 浏览器自动化 | Agent 可以启动浏览器、导航页面、截图、点击元素，用于 UI 测试和网页数据提取    |
| **Chrome DevTools**     | 浏览器调试   | 连接 Chrome 开发者工具，读取 Console 日志、网络请求、DOM 结构等调试信息       |
| **Postgres / Supabase** | 数据库操作   | 直接查询和操作数据库，无需手写 SQL 脚本                                       |
| **GitHub**              | 代码托管     | 操作 PR、Issues、代码审查等 GitHub 工作流                                     |

#### Skills（技能文档）

Skills 是 Claude Code 的另一种扩展机制。与 MCP 的实时连接不同，Skills 是**静态的知识文档**，在需要时注入 Agent 的上下文中。

**与 MCP 的区别**：

|              | MCP                                  | Skills                 |
| ------------ | ------------------------------------ | ---------------------- |
| **形式**     | 运行中的服务进程                     | 静态 Markdown 文档     |
| **连接方式** | 实时 JSON-RPC 通信                   | 文本注入上下文         |
| **适用场景** | 需要动态交互（查询 API、操作浏览器） | 提供领域知识和最佳实践 |

**实际开发中使用的 Skills 示例**：

- **shadcn/ui Skill**：在本项目中，当 Agent 需要使用 shadcn/ui 组件时，通过 shadcn skill 获取组件的 API、用法和最佳实践，确保生成的代码符合最新版本的规范
- **自定义项目 Skill**：可以为自己的项目编写 Skill 文档，描述项目架构、编码规范、部署流程等，让 Agent 更好地理解项目上下文

> **为什么这些扩展机制重要？** 没有 MCP 和 Skills 时，Agent 只能依赖训练数据中的知识。对于快速更新的库（如 Next.js、shadcn/ui）或项目特定的规范，训练数据可能已过时。MCP 和 Skills 让 Agent 能够获取**实时、准确**的信息，大幅提升代码生成的准确性。

---

## 第三部分：第三方模型与 API 中转

### OpenAI 兼容 API 生态

OpenAI 早期定义的 `/v1/chat/completions` 等 API 接口格式已成为事实上的行业标准。这意味着只要一个模型服务实现了这个接口格式，任何基于 OpenAI SDK 构建的工具（包括 Claude Code、Codex CLI）理论上都可以调用它。

这催生了一个繁荣的第三方模型生态。

### 国内主流第三方模型

以下国内模型提供商均支持 OpenAI 兼容 API，可通过修改 `base_url` 直接接入各种 Coding Agent：

| 提供商               | 代表模型                 | API 价格（每百万 token，输入/输出）                              | 特点                                                             |
| -------------------- | ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| **DeepSeek**         | V4-Pro, V4-Flash         | V4-Flash: ¥0.02-1 / ¥2；V4-Pro: ¥0.1-3 / ¥6（限时 2.5 折）       | 性价比极高，新用户送 500 万 token                                |
| **智谱 GLM**         | GLM-5.1, GLM-5, GLM-4.7  | GLM-5.1: ¥6-8 / ¥24-28；GLM-4.7: ¥2-4 / ¥8-16                    | 国产头部模型，GLM-5.1 面向长程任务设计，支持 8 小时自主工作      |
| **Kimi**（月之暗面） | K2.6                     | ¥6.5 / ¥27（缓存命中 ¥1.1）                                      | 262K 超长上下文，Agent 能力强                                    |
| **MiniMax**          | M2.7, M2.5               | M2.7: ¥2.1 / ¥8.4（缓存读取 ¥0.42）                              | M2.7 开源排名第一                                                |
| **小米 MiMo**        | MiMo-V2.5-Pro, MiMo-V2.5 | V2.5-Pro: ¥1.4-7.0 / ¥21（缓存命中 ¥1.4）；V2.5: ¥0.56-2.8 / ¥14 | 小米自研模型，支持全模态和语音合成，Artificial Analysis 排名靠前 |

### Coding Agent 订阅计划

除了使用 API 按量计费外，主流模型厂商都推出了专门的 Coding Agent 订阅计划，以固定月费提供封装好的编程工具体验。这些计划通常比自配 API 更易上手，且包含一定的用量额度。

**国际厂商**：

| 厂商          | Coding Agent                     | 订阅方式                               | 说明                                                                                                                     |
| ------------- | -------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Anthropic** | Claude Code                      | Pro $20 / Max $100 / Max $200          | 终端 + 桌面端编程 Agent，包含在 Claude 订阅中                                                                            |
| **OpenAI**    | Codex CLI                        | ChatGPT Plus $20 / Pro $100            | 包含在 ChatGPT 订阅中，Plus 含基础 Codex，Pro 含最大访问权限。无独立订阅                                                 |
| **Google**    | Gemini CLI + Jules + Antigravity | AI Pro $19.99 / AI Ultra $249.99       | Pro 含 Gemini CLI 和 Jules 异步编码 Agent；Ultra 含最高限额。CLI 的 Coding Agent 能力目前落后于 CC/Codex，生态影响力较小 |
| **Cursor**    | Cursor IDE + CLI                 | Free / Pro $20 / Pro+ $60 / Ultra $200 | IDE 起家，2025 年 8 月推出 CLI 进入终端领域，订阅覆盖 IDE 和 CLI 两种形态                                                |

**国内厂商**：

| 厂商                 | Coding Plan          | 月费 | 说明                                             |
| -------------------- | -------------------- | ---- | ------------------------------------------------ |
| **智谱 GLM**         | GLM Coding Lite      | ¥49  | 3x Claude Pro 用量额度，适合小型 Repo 轻量级迭代 |
| **智谱 GLM**         | GLM Coding Pro       | ¥149 | 5x Lite 用量额度，适合中型 Repo 日常开发         |
| **智谱 GLM**         | GLM Coding Max       | ¥469 | 20x Lite 用量额度，适合中大型 Repo 深度开发      |
| **Kimi**（月之暗面） | Kimi Code Andante    | ¥49  | 日常使用，支持多个编程会话                       |
| **Kimi**（月之暗面） | Kimi Code Moderato   | ¥99  | 效率升级，多设备登录共享额度                     |
| **Kimi**（月之暗面） | Kimi Code Allegretto | ¥199 | 专业优选，更高并发上限                           |
| **Kimi**（月之暗面） | Kimi Code Allegro    | ¥699 | 全能尊享，高强度开发需求                         |
| **MiniMax**          | Token Plan Starter   | ¥29  | 600 次请求/5 小时                                |
| **MiniMax**          | Token Plan Plus      | ¥49  | 1,500 次请求/5 小时                              |
| **MiniMax**          | Token Plan Max       | ¥119 | 4,500 次请求/5 小时                              |
| **小米 MiMo**        | Token Plan Lite      | ¥39  | 6,000 万 Credits/月，首购 ¥34.32                 |
| **小米 MiMo**        | Token Plan Standard  | ¥99  | 2 亿 Credits/月，首购 ¥87.12                     |
| **小米 MiMo**        | Token Plan Pro       | ¥329 | 7 亿 Credits/月，首购 ¥289.52                    |
| **小米 MiMo**        | Token Plan Max       | ¥659 | 16 亿 Credits/月，首购 ¥579.92                   |

> **选择建议**：如果你主要使用 Claude Code 或 Codex，直接订阅 Anthropic/OpenAI 官方计划即可。如果预算有限或需要使用国内模型，国产 Coding Plan 的性价比很高——GLM Coding Lite 仅 ¥49/月就提供相当于 3x Claude Pro 的额度。许多国内 Coding Plan 还支持接入 Claude Code、Cursor 等主流编程工具，通过兼容 API 即可使用。

**Claude Code 和 Codex CLI 的兼容方式**：

- **Claude Code**：通过 `ANTHROPIC_BASE_URL` 环境变量指向自定义端点，官方支持 LLM Gateway 配置。社区有 claude-code-proxy 等项目可将 Anthropic API 请求转换为 OpenAI 兼容格式，从而使用其他模型后端
- **Codex CLI**：原生支持 `OPENAI_BASE_URL` 环境变量，可直接指向任何 OpenAI 兼容端点

### 第三方 API 中转站

#### 什么是 API 中转站？

API 中转站（也称 API 代理、API Relay）是位于开发者和 LLM 官方服务之间的中间层服务。开发者将请求发给中转站，中转站转发给官方 API，再把响应返回给开发者。

#### 为什么有开发者使用中转站？

1. **支付便利**：国内开发者可能无法直接用国际信用卡支付 OpenAI / Anthropic 的 API 费用
2. **价格优势**：中转站通过批量采购或订阅制转售，单价可能低于官方按量计费
3. **统一接口**：一个 API Key 调用多家模型（OpenAI、Anthropic、Google、国内模型等）
4. **地区可用性**：解决部分地区的网络访问限制

#### 主流中转服务

| 类型     | 代表                            | 说明                                  |
| -------- | ------------------------------- | ------------------------------------- |
| 开源网关 | **LiteLLM**（45K+ Stars）       | Python 网关，支持 100+ 模型，自建部署 |
| 开源平台 | **One API**（29K+ Stars）       | 国内开发者社区维护，支持十余种模型    |
| 商业平台 | 302.ai、硅基流动、AIHubProxy 等 | 即开即用，按量计费                    |

#### 风险与弊端（必须了解）

| 风险类型         | 说明                                                          |
| ---------------- | ------------------------------------------------------------- |
| **数据隐私**     | 所有请求经过第三方，存在被截获、记录或分析的可能性            |
| **服务稳定性**   | 中转站依赖官方 API Key 池，官方风控可能导致批量封禁、服务中断 |
| **合规灰色地带** | 转售 API 可能违反官方服务条款                                 |
| **资金安全**     | 小型中转站存在跑路风险，预充值的余额可能无法追回              |
| **性能损耗**     | 多一跳网络链路，可能增加延迟或超时                            |

> **建议**：涉及敏感业务数据或生产环境时，优先使用官方 API。中转站适合个人学习、原型验证等非敏感场景。

---

## 第四部分：模型与 Agent 能力评估

> 本部分数据来源于 [Artificial Analysis](https://artificialanalysis.ai/)，一个独立的 AI 模型和 Agent 评测平台，综合多个基准测试给出综合评分。数据截至 2026 年 5 月，随模型更新排名会持续变化。

### Artificial Analysis Intelligence Index（模型智能指数）

Intelligence Index 是 Artificial Analysis 的核心模型能力综合评分，基于多个学术和行业基准测试加权计算，反映模型的通用智能水平。

**当前排名（Top 10）**：

| 排名 | 模型                | 指数得分 | 提供商    |
| ---- | ------------------- | -------- | --------- |
| 1    | **GPT-5.5**         | 60       | OpenAI    |
| 2    | **Claude Opus 4.7** | 57       | Anthropic |
| 2    | **Gemini 3.1 Pro**  | 57       | Google    |
| 4    | **Kimi K2.6**       | 54       | 月之暗面  |
| 5    | **Mimo V2.5 Pro**   | —        | 小米      |
| 6    | **Grok 4.3**        | —        | xAI       |
| 7    | **DeepSeek V4 Pro** | —        | DeepSeek  |
| 8    | **GLM-5.1**         | —        | 智谱      |

> **观察**：前三名差距仅在 3 分以内，竞争极其激烈。值得注意的还有国内模型 Kimi K2.6 排名第四，表明国产模型正在快速追赶。

### Artificial Analysis Coding Agent Index（编码 Agent 指数）

Coding Agent Index 是 Artificial Analysis 2026 年新推出的评测体系，它不只评测模型本身，而是评测**模型 + Agent 平台的组合效果**。这更贴近开发者实际体验——同一个模型在 Claude Code 和 Cursor 中的表现可能不同。

**评测方法**：综合三个基准测试的平均 pass@1 得分：

| 基准测试              | 任务数 | 测试内容                                         |
| --------------------- | ------ | ------------------------------------------------ |
| SWE-Bench-Pro-Hard-AA | 150    | 真实代码库中的复杂编程任务（来自 Scale AI）      |
| Terminal-Bench v2     | 84     | 终端环境下的系统管理、加密、机器学习等多步骤任务 |
| SWE-Atlas-QnA         | 124    | 代码库技术问答，测试对代码行为的理解能力         |

**当前排名**：

| 排名 | Agent + 模型组合                   | 指数得分 | 每任务成本 | 每任务时间 |
| ---- | ---------------------------------- | -------- | ---------- | ---------- |
| 1    | **Opus 4.7 in Cursor CLI**         | 61       | —          | —          |
| 2    | **GPT-5.5 in Codex**               | 60       | $2.21      | —          |
| 2    | **Opus 4.7 in Claude Code**        | 60       | —          | ~6 分钟    |
| 4    | **GPT-5.5 in Cursor CLI**          | 58       | —          | —          |
| 5    | **GLM-5.1 in Claude Code**         | 53       | $2.26      | —          |
| 6    | **Kimi K2.6 in Claude Code**       | 50       | $0.76      | ~40 分钟   |
| 6    | **DeepSeek V4 Pro in Claude Code** | 50       | $0.35      | —          |
| 8    | **Gemini 3.1 Pro in Gemini CLI**   | 43       | —          | —          |

**关键发现**：

1. **Opus 4.7 + Cursor CLI 组合以 61 分领先**，但 Claude Code 中的 Opus 4.7 以 60 分紧随其后，差距极小
2. **开源模型竞争力提升**：GLM-5.1 得分 53，Kimi K2.6 和 DeepSeek V4 Pro 均得 50 分，虽仍落后于闭源头部，但差距在缩小
3. **性价比差异巨大**：每任务成本从 Composer 2 的 $0.07 到 GLM-5.1 的 $2.26，相差超 30 倍
4. **Token 效率差异显著**：Opus 4.7 在 Claude Code 中每任务仅消耗 1.7M token，而 GLM-5.1 消耗 4.8M token（部分原因是模型在某些任务上陷入循环）
5. **Gemini CLI 是短板**：Gemini 3.1 Pro 在 Intelligence Index 上与 GPT-5.5、Opus 4.7 并驾齐驱，但在 Gemini CLI 中的 Coding Agent 表现仅 43 分，说明 Agent 平台的优化同样关键

> **对开发者的启示**：选择 Coding Agent 时，不能只看模型能力排名，还需要考虑模型与 Agent 平台的组合效果。同一个 Opus 4.7，在 Cursor CLI 和 Claude Code 中的表现差异达到 1 分。此外，成本和时间效率对日常开发体验影响很大——Opus 4.7 在 Claude Code 中每任务仅约 6 分钟，而 Kimi K2.6 需要 40 分钟。

---

## 第五部分：行业动态与独立开发者趋势

> 本部分综合了 X（Twitter）上独立开发者社区、技术博客和论坛的热门讨论。

### 当前主流的独立开发者工作流

根据 Addy Osmani（Google 工程师）等知名开发者分享的工作流，以及独立开发者社区的讨论，2025-2026 年的主流 AI 辅助开发模式包括：

**1. Spec 先行模式**

先写详细的产品规格说明（Product Spec），再交给 AI 编码。这是 Addy Osmani 推荐的核心方法论——人类负责"想清楚做什么"，AI 负责"高效地做"。

```
产品需求文档 → 技术设计文档 → AI Agent 编码 → 人工审查 → 迭代
```

**2. Vibe Coding（氛围编程）**

用自然语言描述想要的效果，AI 生成代码，快速迭代。适合原型验证和 MVP 开发。2025 年这个词成为热门话题。

**3. 多 Agent 协作**

2026 年的趋势是让多个专业 Agent 分工协作：规划 Agent 负责拆分任务，编码 Agent 负责实现，测试 Agent 负责验证。

**4. $0 启动（穷鬼套餐）**

中文独立开发者社区流行的低成本启动策略：利用免费额度（Cloudflare Workers、Supabase、Vercel）+ 开源工具 + 免费 API 额度，实现零成本上线。

### 独立开发者推荐的技术栈

**前端**：

- **Next.js** — "一体化 + AI 友好"的全栈框架，首选推荐
- **shadcn/ui** — 与 V0 协同效应强，可复制组件库
- **Tailwind CSS** — AI 生成 Tailwind 代码的质量普遍较高

**后端与数据库**：

- **Supabase** / **Neon** — 独立开发者首选后端平台，免费额度充足
- **Cloudflare Workers + D1** — 低成本、高性能的边缘部署方案

**部署**：

- **Vercel** — Next.js 最佳部署平台，免费层够用
- **Cloudflare Tunnel** — 自托管服务的公网暴露方案
- **Docker Compose** — 全栈应用的容器化部署

### 趋势展望：软件的 CLI 化与 Agent-Native 生态

随着 Coding Agent 能力的持续提升，一个深层问题浮出水面：**Agent 如何操作那些只有 GUI（图形界面）而没有命令行接口的软件？**

当前主流的 Coding Agent 都运行在终端环境中，通过读取文件、执行命令来完成任务。这意味着 Agent 能高效操作的一切——代码编辑器、构建工具、数据库、Git——本质上都拥有良好的 CLI（命令行接口）。但大量专业软件（图像编辑、3D 建模、办公套件、视频剪辑等）仅有图形界面，Agent 无法直接调用它们的完整功能。

这一局限正在被打破。**让所有软件具备 CLI 接口，使其能被 AI Agent 原生调用**，正在成为学术界和开源社区关注的前沿方向。

#### CLI-Anything：让所有软件 Agent 化

**[CLI-Anything](https://github.com/HKUDS/CLI-Anything)** 是由香港大学数据科学实验室（HKUDS）黄超教授课题组发布的开源项目（34.4K Stars），核心理念是 **"Making ALL Software Agent-Native"**——通过自动化流程为任意软件生成标准化的命令行接口，使 AI Agent 能够像人类操作 GUI 一样完整地使用这些软件。

**自动化生成管线**：CLI-Anything 设计了一套 7 阶段自动化管线，无需人工干预即可为任意软件生成完整的 CLI：

```
Analyze（分析软件功能）
    → Design（设计 CLI 架构）
        → Implement（实现 CLI 代码）
            → Plan Tests（规划测试）
                → Write Tests（编写测试）
                    → Document（生成文档）
                        → Publish（发布到注册中心）
```

**已覆盖的软件生态**：项目已为 40+ 主流软件自动生成了 CLI，涵盖多个领域：

| 领域      | 已 CLI 化的软件  |
| --------- | ---------------- |
| 图像/设计 | GIMP, Inkscape   |
| 3D/建模   | Blender, FreeCAD |
| 办公套件  | LibreOffice      |
| 视频/直播 | OBS Studio       |
| 音频处理  | Audacity         |
| 开发工具  | Arduino IDE      |

所有生成的 CLI 均通过了 2,280 项测试，通过率 100%。

**与 Coding Agent 的集成**：生成的 CLI 可直接被 Claude Code、Codex CLI、Cursor、GitHub Copilot CLI 等主流 Coding Agent 调用。项目还提供了 **CLI-Hub**——一个集中式注册中心，Agent 可以在其中发现、搜索和安装所需软件的 CLI，类似 npm 之于 Node.js 生态。

**深远影响**：CLI-Anything 代表了一种重要的范式转变——过去，软件是为人设计的；未来，软件需要同时服务于人类用户和 AI Agent。当一个 Coding Agent 能够通过 CLI 操控 Blender 完成 3D 建模、通过 CLI 操控 GIMP 处理图像、通过 CLI 操控 LibreOffice 生成报表时，Agent 的能力边界将从"写代码"扩展到"完成任何软件操作"。

> 这也意味着，**软件产品如果要充分被 AI Agent 生态采纳，提供 CLI 接口将从"加分项"变为"必选项"**。正如 API 化是云计算时代的基础要求，CLI 化可能成为 Agent 时代的基础要求。

### 值得关注的内容

| 资源                                                                                                                                       | 说明                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| [Addy Osmani - My LLM Coding Workflow Going Into 2026](https://medium.com/@addyosmani/my-llm-coding-workflow-going-into-2026-52fe1681325e) | Google 工程师的 AI 编码工作流详解                    |
| [Guangzheng Li - 独立开发穷鬼套餐](https://guangzhengli.com/blog/zh/indie-hacker-poor-stack)                                               | 中文独立开发者低成本技术栈推荐                       |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)                                                        | 1000+ AI Agent 技能合集                              |
| [ShiftMag - 6 天用 AI 构建全栈应用](https://shiftmag.dev/how-i-built-a-full-stack-app-in-6-days-with-the-help-of-ai-7564/)                 | AI 辅助全栈开发实战                                  |
| [CLI-Anything](https://github.com/HKUDS/CLI-Anything)                                                                                      | 让所有软件具备 CLI 接口，成为 Agent 可调用的原生工具 |

---

## 写在最后

AI 编程工具领域正处于爆发式增长阶段，几乎每个月都有新产品发布、新模型上线、新功能更新。本文描述的工具和定价在你读到时可能已经发生变化。

从天济大药房 Demo 的开发实践来看，核心经验是：

1. **不同工具各有所长，组合使用效果最好**：视觉设计用 ChatGPT + Google Stitch，架构和编码用 Claude Code / Codex CLI，知识查询用 ChatGPT
2. **AI 是加速器，不是替代品**：Agent 生成的代码仍需人工审查和测试，尤其是业务逻辑和边界情况
3. **视觉先行显著提升效果**：先出视觉稿再编码，比纯文字描述需求的效果好得多
4. **Git 是你的安全网**：让 Agent 自动提交代码，任何改动都可以回退
5. **Plan 模式值得用**：面对复杂任务，先让 Agent 规划再执行，比直接开干更可控

对于智能体这类 AI 原生应用，AI 编程工具的表现尤其出色——因为 RAG、向量数据库、LLM 接入等技术本身就是训练数据中的热门领域。这可能是目前 AI 辅助开发最甜区的场景之一。

---

_本文基于天济大药房门店问答助手 Demo（Tianji Pharmacy）的实际开发经验撰写。技术栈：Next.js + TypeScript + Prisma + Qdrant + FastAPI + DashScope，部署于 Docker Compose + Cloudflare Tunnel。文中工具信息基于 2026 年 5 月调研，可能已非最新。_
