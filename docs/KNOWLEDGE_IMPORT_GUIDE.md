# 知识文档导入与切片规范

## 功能定位

后台「知识库管理」以 **文档** 为唯一管理入口。所有来源都会落到 `KnowledgeDocument`：

- 上传的 Word、PDF、Markdown、TXT、图片等业务资料。
- 手动新增的标准问答。
- 工单关闭时写回的优质问答。
- `pnpm kb:import` 导入的种子知识和参考文档。

`KnowledgeItem` 仍作为检索兼容和索引投影载体存在，但后台只维护文档视图。管理员点开文档后查看该文档当前 active chunk set 中的 chunk。

## 导入入口

### 后台页面

路径：

```text
/admin/knowledge
```

流程：

1. 在「知识入库」中选择「导入文档」。
2. 上传文件。
3. 选择切片模式、业务分类和适用范围。
4. 点击「预览切片」检查前几个 chunk。
5. 点击「解析入库」。
6. 在「知识文档」表格中打开文档，检查 chunk 内容。

### 运维脚本

导入种子知识：

```bash
pnpm kb:import
```

导入范围由 `collectKnowledgeSourceFiles()` 决定，包括：

- `seed_knowledge/` 下的 `.txt/.md/.docx/.doc/.pdf/.png/.jpg/.jpeg/.webp`
- `药店门店智能问答轻量级知识库.docx`
- `信息部常见问题详解/full.md`

## 支持文件

前端上传和脚本导入当前支持：

- `.doc`
- `.docx`
- `.txt`
- `.md`
- `.pdf`
- `.png`
- `.jpg`
- `.jpeg`
- `.webp`

`.docx` 会优先在 Web 侧用 `mammoth` 提取纯文本；其他格式会调用 ML 服务 `/parse-document`。旧版 `.doc` 依赖 ML 服务侧的转换/解析工具，部署环境建议安装 LibreOffice。

## 切片模式

当前切片实现参考 Dify 的导入体验，但在本项目内用 TypeScript 改写，统一由 `app/web/lib/services/document-chunking.ts` 提供。

### 通用文档

默认模式。适合政策、制度、操作手册、FAQ 长文档。

默认规则：

- 预处理：移除多余空格，保留 URL 和邮箱。
- 主分隔符：空行 `\n\n`。
- 最大长度：`1024` 字符。
- overlap：`50` 字符。
- 超长片段会继续按 `\n\n`、`\n`、`。`、`. `、空格、字符递归切分。

### 父子切片

适合章节长、上下文依赖强的政策或说明文。

默认规则：

- 父片段：按空行切，最大 `1024` 字符。
- 子片段：按换行切，最大 `512` 字符。
- 子片段 overlap：`50` 字符。
- 检索索引使用子片段，chunk metadata 中保留父片段上下文。

### QA 文档

适合手动新增知识、工单写回知识，以及明确一问一答结构的导入资料。

规则：

- 每个问答生成一个独立 chunk。
- chunk 文本格式为：

```text
问题：...
答案：...
```

- 手动新增和工单写回会直接创建 QA 文档、版本、解析记录、chunk set 和 chunk。

## 文档管理语义

### 同名上传覆盖

上传同名文档时，系统会删除旧的同名上传文档和旧 chunk，并为旧 Qdrant point 写入 delete task，然后创建新的文档版本与 active chunk set。

这样可以避免反复导入同一份文档导致后台重复记录和检索污染。

### 旧 QA 自动归并

后台知识库页面加载时会执行 `ensureKnowledgeItemsHaveDocuments()`：

- 找出历史上 `documentId=null` 的旧 QA 或工单知识。
- 自动补建 QA 文档、版本、解析记录和 chunk set。
- 更新原有 `KnowledgeItem` 与 `KnowledgeChunk` 的 `documentId/chunkSetId`。
- 为受影响 chunk 重新写入 upsert 索引任务。

归并完成后，后台只从文档视图维护知识库。

## 业务分类

导入文档和手动新增 QA 时可以手工填写“业务分类”，例如 `医保`、`用药`、`收银打印`。

当前规则：

- 系统保存用户手工填写的业务分类。
- 未填写时为 `null`，后台列表显示 `-`。
- 工单自动写回、自动生成的 QA 文档默认业务分类为 `null`。
- 系统不再根据一级/二级分类或文本内容自动推断业务分类。

## 地域范围

文档可配置适用范围：

- 通用：所有用户可检索。
- 城市专属：只对所在城市匹配的用户可检索，当前城市列表限定为湖北省内城市。

检索时会根据用户所属区域过滤文档。当前范围模型是 `scopeLevel=common|city` 加 `cityName`，不再使用省/市/区/门店多级代码。

## 导入后的校验

导入完成后应检查：

1. 文档是否出现在「知识文档」表格中。
2. 文档业务分类和适用范围是否正确。
3. 点击「查看 chunk」后，active chunk set 是否符合预览结果。
4. QA 文档是否保持一问一答粒度。
5. 同名重复导入是否覆盖旧文档，而不是新增重复文档。
6. `pnpm kb:reconcile` 是否无异常。
7. 必要时执行 `pnpm kb:rebuild` 后验证问答命中。

## 索引维护

常用命令：

```bash
pnpm kb:drain
pnpm kb:reconcile
pnpm kb:rebuild
```

- `kb:drain`：处理当前待执行的 `KnowledgeIndexTask`。
- `kb:reconcile`：清理 Qdrant 孤儿 point，并回补数据库中缺失的 point。
- `kb:rebuild`：以 PostgreSQL 中启用且已发布的 chunk 为准，全量重建 `pharmacy_kb`。

## 不建议的导入内容

以下内容可以上传，但召回质量不可保证：

1. 扫描件、截图型 PDF、低清晰度图片。
2. 没有标题、段落或问答边界的长篇混排文本。
3. 复杂嵌套表格、合并单元格严重的表格。
4. 文本框、页眉页脚、脚注、批注中的关键内容。
5. 同一问题在同一来源文件中重复出现。

如果导入效果不理想，优先调整文档结构和切片模式，再重新导入。
