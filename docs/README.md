# 文档索引

## 推荐阅读顺序

如果你需要接手本项目后续开发，建议按下面顺序阅读。

### 1. 建立项目主线

| 文档                                                 | 作用                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| [ONBOARDING.md](./ONBOARDING.md)                     | 项目接手路线图，说明接手首日应该看什么、跑什么、验证什么       |
| [CODEBASE_MAP.md](./CODEBASE_MAP.md)                 | 代码地图，说明页面、API、service、脚本、Docker 文件在哪里      |
| [DOMAIN_MODEL.md](./DOMAIN_MODEL.md)                 | 业务模型，说明会话、消息、工单、知识库、索引任务之间的关系     |
| [GLOSSARY.md](./GLOSSARY.md)                         | 名词表，解释当前术语和历史表述差异                             |
| [DEVELOPMENT_PLAYBOOK.md](./DEVELOPMENT_PLAYBOOK.md) | 开发任务手册，说明常见需求应该改哪些文件、如何验证             |
| [ACCEPTANCE_CHECKLIST.md](./ACCEPTANCE_CHECKLIST.md) | 接手验收清单和回归测试清单                                     |
| [USER_MANUAL.md](./USER_MANUAL.md)                   | 用户视角操作手册，用完整案例说明问答、工单、转派、知识回写闭环 |

### 2. 启动、部署、运维

| 文档                                                       | 作用                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| [DOCKER_DEPLOYMENT_GUIDE.md](./DOCKER_DEPLOYMENT_GUIDE.md) | Docker Compose、Dockerfile、entrypoint、Prisma migration 和部署链路说明 |
| [API_GUIDE.md](./API_GUIDE.md)                             | API、环境变量、启动方式、接口示例                                       |
| [DEMO_GUIDE.md](./DEMO_GUIDE.md)                           | 演示流程和业务场景验证                                                  |

### 3. RAG、知识库和索引一致性

| 文档                                                                                           | 作用                                                  |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [RAG_MULTIMODAL_PIPELINE.md](./RAG_MULTIMODAL_PIPELINE.md)                                     | RAG 多模态检索、重排、生成链路                        |
| [POSTGRES_QDRANT_INDEX_CONSISTENCY.md](./POSTGRES_QDRANT_INDEX_CONSISTENCY.md)                 | PostgreSQL 与 Qdrant 一致性原则                       |
| [KNOWLEDGE_IMPORT_GUIDE.md](./KNOWLEDGE_IMPORT_GUIDE.md)                                       | 知识文档导入规范                                      |
| [INCIDENT_2026-04-28_QDRANT_INDEX_DELETION.md](./INCIDENT_2026-04-28_QDRANT_INDEX_DELETION.md) | Qdrant 索引误删事故复盘，说明为什么索引删除逻辑要谨慎 |

### 4. 方案演进

| 文档                                                     | 作用                                   |
| -------------------------------------------------------- | -------------------------------------- |
| [NOTIFICATION_WS_TO_SSE.md](./NOTIFICATION_WS_TO_SSE.md) | 通知方案从 WebSocket 切换到 SSE 的原因 |

---

## 按任务查文档

### 我要跑起来

先看：

1. [ONBOARDING.md](./ONBOARDING.md)
2. [ACCEPTANCE_CHECKLIST.md](./ACCEPTANCE_CHECKLIST.md)
3. [DOCKER_DEPLOYMENT_GUIDE.md](./DOCKER_DEPLOYMENT_GUIDE.md)

### 我要理解用户怎么使用系统

先看：

1. [USER_MANUAL.md](./USER_MANUAL.md)
2. [DEMO_GUIDE.md](./DEMO_GUIDE.md)
3. [ACCEPTANCE_CHECKLIST.md](./ACCEPTANCE_CHECKLIST.md)

### 我要改聊天页

先看：

1. [CODEBASE_MAP.md](./CODEBASE_MAP.md)
2. [DEVELOPMENT_PLAYBOOK.md](./DEVELOPMENT_PLAYBOOK.md)
3. [RAG_MULTIMODAL_PIPELINE.md](./RAG_MULTIMODAL_PIPELINE.md)

如果涉及消息编辑、重新发送、重新生成或 Markdown 展示，也要对照 [API_GUIDE.md](./API_GUIDE.md) 的消息接口说明。

### 我要改工单

先看：

1. [DOMAIN_MODEL.md](./DOMAIN_MODEL.md)
2. [CODEBASE_MAP.md](./CODEBASE_MAP.md)
3. [DEVELOPMENT_PLAYBOOK.md](./DEVELOPMENT_PLAYBOOK.md)

### 我要改知识库或索引

先看：

1. [DOMAIN_MODEL.md](./DOMAIN_MODEL.md)
2. [POSTGRES_QDRANT_INDEX_CONSISTENCY.md](./POSTGRES_QDRANT_INDEX_CONSISTENCY.md)
3. [RAG_MULTIMODAL_PIPELINE.md](./RAG_MULTIMODAL_PIPELINE.md)
4. [INCIDENT_2026-04-28_QDRANT_INDEX_DELETION.md](./INCIDENT_2026-04-28_QDRANT_INDEX_DELETION.md)

### 我要改 Docker 或部署

先看：

1. [DOCKER_DEPLOYMENT_GUIDE.md](./DOCKER_DEPLOYMENT_GUIDE.md)
2. [DEVELOPMENT_PLAYBOOK.md](./DEVELOPMENT_PLAYBOOK.md)

### 我看到历史名词不理解

先看：

1. [GLOSSARY.md](./GLOSSARY.md)

---

## 文档维护原则

1. 当前实现优先。

   如果文档和代码冲突，以代码和 `prisma/schema.prisma` 为准，并更新文档。

2. 历史文档保留语境。

   事故复盘、方案演进文档不一定会把所有旧称改成新称，否则会破坏历史上下文。遇到旧称先看 [GLOSSARY.md](./GLOSSARY.md)。

3. 接手型文档要保持主线清晰。

   `ONBOARDING.md`、`CODEBASE_MAP.md`、`DOMAIN_MODEL.md`、`DEVELOPMENT_PLAYBOOK.md` 应优先服务“快速定位和继续开发”，不要写成源码逐行解释。

4. 模块文档要保留技术细节。

   RAG、Qdrant 一致性、Docker、API 文档可以更详细，因为它们用于排查复杂问题。
