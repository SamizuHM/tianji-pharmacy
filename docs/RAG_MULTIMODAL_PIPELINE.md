# RAG 多模态检索与重排链路说明

## 版本基线

本文档基于当前实现整理，代码基线为：

- `8cb4e3d fix(openai): exclude contextSummary from multimodal query generation`

该版本的关键约束是：

- 检索阶段不使用完整会话上下文，避免上一轮助手回答污染当前轮召回。
- 生成阶段继续使用会话上下文，用于承接多轮对话语义。
- `enable_thinking` 只用于最终大模型生成链路，不用于 embedding / rerank。

## 总体原则

当前系统采用 数据库 + Qdrant + ML Service 的 RAG 架构：

- PostgreSQL 中的 `knowledgeItem` / `knowledgeChunk` 是知识库主数据。
- Qdrant 是可重建的向量索引。
- ML Service 负责多模态 embedding、rerank、图片理解和多模态最终回答。

多轮对话场景下，本项目采用的默认策略是：

- 检索只看当前轮用户输入和当前轮图片。
- 生成看当前轮输入、检索命中内容和会话上下文。

这符合常见 RAG 系统的稳健设计：检索侧优先避免历史回答污染召回，生成侧再利用上下文提升表达连贯性。

## 在线问答链路

### 1. 用户输入保存

入口：

- `app/web/app/api/conversations/[id]/messages/route.ts`

用户发送文字和图片后，系统先保存用户消息，再进入 RAG 检索。

图片字段来源：

- 前端上传得到 `AttachmentItem.path`
- 后端整理为 `attachmentImagePaths`

### 2. 上下文摘要

位置：

- `app/web/lib/services/retrieval.ts`
- `summarizeContext(conversationId, maxTurns)`

系统会读取最近若干轮消息，生成 `contextSummary`。

用途：

- 不再参与检索 query 构造。
- 仍参与最终答案生成 prompt。

当前配置项：

- `MAX_CONTEXT_TURNS`

### 3. 检索 query 构造

位置：

- `app/web/lib/openai.ts`
- `buildMultimodalQueryText(...)`

无图场景：

```text
queryText = 当前用户问题
```

有图场景：

```text
queryText = 多模态模型基于“当前用户问题 + 当前轮全部图片”生成的检索文本
```

注意：

- 不传入历史上下文。
- 不把上一轮助手答案、上一轮 retrievalHints 或知识库候选内容拼进 query。

### 4. 向量召回

位置：

- Web: `app/web/lib/services/retrieval.ts`
- ML Service: `app/ml-service/app/main.py`

Web 侧调用：

```ts
embedMultimodal([
  {
    text: queryText,
    image_path: input.imagePaths[0],
    image_paths: input.imagePaths
  }
])
```

ML Service 侧使用：

- `qwen3-vl-embedding`
- 维度：`1024`

召回目标：

- Qdrant collection: `pharmacy_kb`

召回数量：

- `RETRIEVAL_TOP_K`

### 5. Rerank 重排

位置：

- Web: `app/web/lib/services/retrieval.ts`
- ML Service: `app/ml-service/app/main.py`

输入：

- query: `queryText`
- query images: 当前轮用户图片
- documents: Qdrant 召回的候选 chunk 文本和候选知识图片

模型：

- `qwen3-vl-rerank`

输出：

```json
{
  "scores": [0.91, 0.73, 0.42]
}
```

系统将 rerank 分数写入 `retrievalDebug`，并按 `rerankScore` 降序排序。

命中规则：

```text
rerankScore >= KB_HIT_THRESHOLD
```

当前默认阈值：

- `KB_HIT_THRESHOLD=0.72`

### 6. 命中决策

位置：

- `app/web/lib/services/retrieval.ts`
- `decide_source`

如果存在超过阈值的候选：

- 回表校验 `knowledgeChunk` / `knowledgeItem`
- 校验通过后走知识库答案整理
- 校验失败则投递脏 point 清理任务

如果没有超过阈值的候选：

- 走大模型保守兜底回答

### 7. 最终生成

无图场景：

- `streamKbStyledAnswer`
- `streamConservativeAnswer`

有图场景：

- `streamMultimodalChat`
- 当前轮用户图片会传给多模态最终回答模型

生成 prompt 会携带：

- 当前用户问题
- 会话上下文摘要
- 知识库命中内容，或未命中的 retrieval hints

## 知识入库与索引链路

### 1. 知识主数据

主数据位于 数据库：

- `knowledgeItem`
- `knowledgeChunk`

### 2. 索引投影

位置：

- `app/web/lib/services/knowledge-index.ts`

每个 chunk 会构造 embedding 输入：

```ts
{
  text: chunk.chunkText,
  image_path: imagePaths[0],
  image_paths: imagePaths
}
```

生成向量后写入 Qdrant。

Qdrant point id 由 chunk id 稳定派生 UUID，避免随机 id 造成重复索引。

## 首图与补充图片线索

这里的“首图”和“补充图片线索”不是模型标准术语，而是当前代码实现策略。

### 首图

如果一个输入包含多张图片，当前 ML Service 会把 `image_paths[0]` 当作主图片传给 embedding / rerank。

示意：

```python
if image_paths:
    query_input["image"] = encode(image_paths[0])
```

### 补充图片线索

如果存在第二张及之后的图片，当前实现不会把它们全部作为图片输入给 embedding / rerank，而是调用多模态聊天模型先生成一段文字摘要。

示意：

```text
原始文本
补充图片线索：第二张图显示了 xxx，第三张图显示了 yyy
```

相关函数：

- `summarize_images_for_retrieval`

触发位置：

- query 多图 embedding 前
- query 多图 rerank 前
- candidate 多图 rerank 前
- knowledge chunk 多图 embedding 前

## 当前过度利用风险

### 1. Rerank 阶段可能触发额外大模型调用

标准 rerank 通常是：

```text
query + candidates -> rerank model -> scores
```

当前实现为了支持多图，会在 rerank 前对多张图做额外摘要。这会产生额外模型调用。

风险：

- 延迟上升
- 成本上升
- 摘要噪声影响 rerank 排序

### 2. 候选知识多图会放大开销

如果 Qdrant 召回 topK=8，且多个候选知识条目都有多张图，则每个候选都可能触发补充图片摘要。

这会导致一次用户请求背后出现多次视觉摘要调用。

### 3. 最终生成和检索可能重复看同一批用户图片

用户上传图片时：

- 检索 query 构造会看图
- embedding 会看图
- rerank 会看图
- 最终回答也会看图

这对截图类问题通常是合理的，但如果图片只是辅助材料，可能存在成本偏高的问题。

## 推荐边界

当前建议保留：

- 当前轮用户图片参与 query 构造。
- 当前轮用户图片参与 query embedding。
- 知识图片参与知识 chunk embedding。
- 最终回答在用户本轮上传图片时看用户图片。

建议收敛：

- rerank 阶段不要临时调用大模型生成候选图片摘要。
- 多图知识的摘要应在入库或重建索引阶段预先生成，并固定为 chunk 文本或 metadata。
- rerank 只消费稳定输入：query text、query 主图、candidate chunk text、candidate 主图。

## 后续可选改造

### 方案 A：保守收敛 rerank

改动：

- 移除 rerank 阶段的 `summarize_images_for_retrieval`。
- rerank 只使用主图和文本。

优点：

- 降低延迟和成本。
- 排序链路更可解释。

代价：

- 多图候选的非首图信息不再参与在线 rerank。

### 方案 B：入库阶段生成多图摘要

改动：

- 文档解析或知识保存时，对多图生成固定摘要。
- 将摘要写入 `knowledgeChunk.chunkText` 或 metadata。
- 在线检索不再临时总结候选图片。

优点：

- 多图信息仍可参与检索。
- 在线链路稳定。

代价：

- 入库和重建索引成本上升。

### 方案 C：增加意图门控

改动：

- 对“你好、在吗、谢谢、好的”等寒暄或无业务意图输入，跳过知识库检索。

优点：

- 避免无意义 query 误命中知识库。

代价：

- 需要维护一层轻量规则或分类器。

## 调试字段

聊天消息的 `retrievalDebugJson` 会记录：

- `knowledgeItemId`
- `chunkId`
- `question`
- `answer`
- `sourceFile`
- `rerankScore`
- `vectorScore`

这些字段用于解释一次回答为什么命中知识库或为什么走大模型。

## 当前已知案例

会话：

- `conversationId=cmoi54fmv000784uxhsx3vf8s`

现象：

- 第一次输入“你好”走大模型。
- 第二次输入“你好”曾经误命中知识库。

原因：

- 旧实现将会话上下文拼入检索 query。
- 第一次大模型回答包含知识库候选提示。
- 第二次“你好”的检索 query 被上一轮助手回答污染，导致 rerank 分数超过阈值。

当前处理：

- 已改为检索不带上下文。
- 生成仍带上下文。
