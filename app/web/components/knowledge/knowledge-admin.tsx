"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileText, RefreshCw, UploadCloud } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ImageLightbox } from "@/components/knowledge/image-lightbox";
import { RichEditor } from "@/components/knowledge/rich-editor";
import { getFileUrl } from "@/lib/utils";

/* ---------- 工具函数 ---------- */

function extractTextFromHtml(html: string): string {
  if (typeof document === "undefined") return html;
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

function extractImageSrcs(html: string): string[] {
  const srcs: string[] = [];
  const regex = /src="([^"]+)"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    srcs.push(match[1]);
  }
  return srcs;
}

function pathsFromItem(item: {
  imagePathsJson: string | null;
  imagePath: string | null;
}): string[] {
  return item.imagePathsJson
    ? JSON.parse(item.imagePathsJson)
    : item.imagePath
      ? [item.imagePath]
      : [];
}

function buildEditorHtml(answer: string, imagePaths: string[]): string {
  const textP = answer ? `<p>${answer.replace(/\n/g, "</p><p>")}</p>` : "";
  const imgTags = imagePaths.map((p) => `<img src="${getFileUrl(p)}" alt="">`).join("");
  return `${textP}${imgTags}`;
}

/* ---------- 文档上传入库 ---------- */

export function KnowledgeDocumentUpload() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [previewPending, startPreviewTransition] = useTransition();
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"general" | "parent_child" | "qa">("general");
  const [businessCategory, setBusinessCategory] = useState("通用");
  const [answerPolicy, setAnswerPolicy] = useState<"allow_llm_fallback" | "kb_only">(
    "allow_llm_fallback"
  );
  const [scopeLevel, setScopeLevel] = useState<
    "national" | "province" | "city" | "district" | "store"
  >("national");
  const [preview, setPreview] = useState<
    Array<{
      fileName: string;
      totalChunks: number;
      chunks: Array<{ index: number; text: string; sectionPath: string | null }>;
    }>
  >([]);

  function buildChunkingConfig() {
    if (mode === "qa") {
      return {
        preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
        rule: { mode: "qa" },
      };
    }
    if (mode === "parent_child") {
      return {
        preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
        rule: {
          mode: "parent_child",
          parentMode: "paragraph",
          parentSeparator: "\\n\\n",
          parentMaxLength: 1024,
          childSeparator: "\\n",
          childMaxLength: 512,
          childOverlap: 50,
        },
      };
    }
    return {
      preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
      rule: {
        mode: "general",
        separator: "\\n\\n",
        maxLength: 1024,
        overlap: 50,
      },
    };
  }

  function selectFiles(fileList: FileList | null) {
    setMessage("");
    setError("");
    setFiles(Array.from(fileList ?? []));
  }

  function upload() {
    if (!files.length) {
      setError("请选择 .doc 或 .docx 文档");
      return;
    }

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    formData.append("chunkingConfig", JSON.stringify(buildChunkingConfig()));
    formData.append("businessCategory", businessCategory);
    formData.append("answerPolicy", answerPolicy);
    formData.append("scopeLevel", scopeLevel);

    startTransition(async () => {
      setMessage("");
      setError("");
      const response = await fetch("/api/knowledge/import-documents", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "导入失败");
        return;
      }

      setFiles([]);
      setPreview([]);
      setMessage(
        `导入完成：成功文件 ${data.importedFiles}，切片 ${data.importedChunks}，跳过 ${data.skippedFiles}`
      );
      router.refresh();
    });
  }

  function previewChunks() {
    if (!files.length) {
      setError("请选择要预览的文档");
      return;
    }

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    formData.append("chunkingConfig", JSON.stringify(buildChunkingConfig()));

    startPreviewTransition(async () => {
      setMessage("");
      setError("");
      const response = await fetch("/api/knowledge/preview-chunks", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "预览失败");
        return;
      }
      setPreview(data.previews ?? []);
    });
  }

  return (
    <div className="space-y-4">
      <label
        className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-blue-200 bg-blue-50/50 px-4 py-6 text-center transition-colors duration-150 hover:border-primary hover:bg-blue-50 dark:border-border dark:bg-secondary/50 dark:hover:border-primary/50 dark:hover:bg-secondary"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          selectFiles(event.dataTransfer.files);
        }}
      >
        <UploadCloud className="size-9 text-primary" />
        <span className="mt-3 text-sm font-medium text-slate-900 dark:text-foreground">
          上传文档并解析入库
        </span>
        <span className="mt-1 text-xs text-muted">
          支持 Word、PDF、Markdown、TXT 和图片，可拖拽或点击选择多个文件
        </span>
        <input
          type="file"
          accept=".doc,.docx,.pdf,.md,.txt,.png,.jpg,.jpeg,.webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          multiple
          className="sr-only"
          onChange={(event) => selectFiles(event.target.files)}
        />
      </label>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted">切片模式</span>
          <Select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
            <option value="general">通用文档</option>
            <option value="parent_child">父子切片</option>
            <option value="qa">QA 文档</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted">业务分类</span>
          <Input
            value={businessCategory}
            onChange={(event) => setBusinessCategory(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted">回答策略</span>
          <Select
            value={answerPolicy}
            onChange={(event) => setAnswerPolicy(event.target.value as typeof answerPolicy)}
          >
            <option value="allow_llm_fallback">允许大模型兜底</option>
            <option value="kb_only">仅知识库命中</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted">适用地域</span>
          <Select
            value={scopeLevel}
            onChange={(event) => setScopeLevel(event.target.value as typeof scopeLevel)}
          >
            <option value="national">全国</option>
            <option value="province">省级</option>
            <option value="city">市级</option>
            <option value="district">区县</option>
            <option value="store">门店</option>
          </Select>
        </label>
      </div>

      <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-border dark:bg-secondary/60 dark:text-muted">
        <div className="font-medium text-amber-900 dark:text-foreground">Dify 风格导入流程</div>
        <div className="mt-1">
          通用文档按段落优先切分，父子切片先保留父段上下文再切子段，QA
          文档会把每个问答作为独立知识片段。
        </div>
      </div>

      {files.length ? (
        <div className="space-y-2">
          {files.map((file) => (
            <div
              key={`${file.name}-${file.size}`}
              className="flex items-center justify-between gap-3 rounded border border-border bg-white px-3 py-2 text-sm dark:bg-card"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-blue-600 dark:text-muted" />
                <span className="truncate">{file.name}</span>
              </span>
              <span className="shrink-0 text-xs text-muted">{Math.ceil(file.size / 1024)} KB</span>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <Alert className="border-red-100 bg-red-50 text-red-600 dark:border-destructive/30 dark:bg-destructive/10 dark:text-destructive">
          {error}
        </Alert>
      ) : null}
      {message ? (
        <Alert className="border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-primary/30 dark:bg-primary/10 dark:text-foreground">
          {message}
        </Alert>
      ) : null}

      {preview.length ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          {preview.map((file) => (
            <div key={file.fileName} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{file.fileName}</span>
                <span className="text-xs text-muted">共 {file.totalChunks} 个 chunk</span>
              </div>
              <div className="grid gap-2">
                {file.chunks.map((chunk) => (
                  <div
                    key={chunk.index}
                    className="rounded border border-border bg-secondary/40 p-2 text-xs"
                  >
                    <div className="mb-1 text-muted">
                      #{chunk.index + 1} {chunk.sectionPath || ""}
                    </div>
                    <div className="line-clamp-4 whitespace-pre-wrap leading-5">{chunk.text}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">解析成功后会自动写入知识库并创建检索索引。</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={previewChunks}
            disabled={previewPending || !files.length}
          >
            {previewPending ? "预览中..." : "预览切片"}
          </Button>
          <Button onClick={upload} disabled={pending || !files.length}>
            {pending ? "解析中..." : "解析入库"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 新增知识表单 ---------- */

export function KnowledgeCreateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuestion = searchParams.get("question") || "";
  const initialAnswer = searchParams.get("answer") || "";
  const initialCategoryL1 = searchParams.get("categoryL1") || "";
  const initialCategoryL2 = searchParams.get("categoryL2") || "";

  const [categoryL1, setCategoryL1] = useState(initialCategoryL1);
  const [categoryL2, setCategoryL2] = useState(initialCategoryL2);
  const [question, setQuestion] = useState(initialQuestion);
  const [answerHtml, setAnswerHtml] = useState(
    initialAnswer ? buildEditorHtml(initialAnswer, []) : ""
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const handleSubmit = () => {
    setError("");
    if (!question.trim()) {
      setError("问题不能为空");
      return;
    }
    const answerText = extractTextFromHtml(answerHtml).trim();
    if (!answerText) {
      setError("答案不能为空");
      return;
    }

    const imageSrcs = extractImageSrcs(answerHtml);
    const imagePaths = imageSrcs.map((src) => src.replace(/^\/api\/files\//, "")).filter(Boolean);

    startTransition(async () => {
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryL1: categoryL1.trim() || "手动录入",
          categoryL2: categoryL2.trim() || "手动新增",
          question: question.trim(),
          answer: answerText,
          imagePaths,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "新增失败");
        return;
      }

      setCategoryL1("");
      setCategoryL2("");
      setQuestion("");
      setAnswerHtml("");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium">一级分类</label>
          <Input
            value={categoryL1}
            onChange={(e) => setCategoryL1(e.target.value)}
            placeholder="如：设备维护"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">二级分类</label>
          <Input
            value={categoryL2}
            onChange={(e) => setCategoryL2(e.target.value)}
            placeholder="如：打印机"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">问题</label>
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="请输入问题"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">答案</label>
        <RichEditor content={answerHtml} onChange={setAnswerHtml} />
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={pending}>
          {pending ? "提交中..." : "新增知识"}
        </Button>
      </div>
    </div>
  );
}

/* ---------- 编辑知识表单 ---------- */

export function KnowledgeEditForm({
  item,
  onCancel,
}: {
  item: {
    id: string;
    categoryL1: string;
    categoryL2: string;
    question: string;
    answer: string;
    imagePathsJson: string | null;
    imagePath: string | null;
  };
  onCancel: () => void;
}) {
  const router = useRouter();
  const imagePaths = pathsFromItem(item);
  const initialHtml = buildEditorHtml(item.answer, imagePaths);

  const [categoryL1, setCategoryL1] = useState(item.categoryL1);
  const [categoryL2, setCategoryL2] = useState(item.categoryL2);
  const [question, setQuestion] = useState(item.question);
  const [answerHtml, setAnswerHtml] = useState(initialHtml);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const handleSubmit = () => {
    setError("");
    if (!question.trim()) {
      setError("问题不能为空");
      return;
    }
    const answerText = extractTextFromHtml(answerHtml).trim();
    if (!answerText) {
      setError("答案不能为空");
      return;
    }

    const srcs = extractImageSrcs(answerHtml);
    const newImagePaths = srcs.map((s) => s.replace(/^\/api\/files\//, "")).filter(Boolean);

    startTransition(async () => {
      const response = await fetch(`/api/knowledge/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryL1: categoryL1.trim() || "手动录入",
          categoryL2: categoryL2.trim() || "手动新增",
          question: question.trim(),
          answer: answerText,
          imagePaths: newImagePaths,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "编辑失败");
        return;
      }

      router.refresh();
    });
  };

  return (
    <div className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="text-sm font-medium text-primary">编辑知识条目</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium">一级分类</label>
          <Input value={categoryL1} onChange={(e) => setCategoryL1(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">二级分类</label>
          <Input value={categoryL2} onChange={(e) => setCategoryL2(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">问题</label>
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">答案</label>
        <RichEditor content={answerHtml} onChange={setAnswerHtml} />
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          取消
        </Button>
        <Button onClick={handleSubmit} disabled={pending}>
          {pending ? "保存中..." : "保存修改"}
        </Button>
      </div>
    </div>
  );
}

/* ---------- 知识条目操作 ---------- */

export function KnowledgeItemActions({ id, onEdit }: { id: string; onEdit: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirm("确定删除此知识条目？此操作不可撤销。")) return;
    startTransition(async () => {
      await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
      router.refresh();
    });
  };

  return (
    <div className="flex gap-1">
      <Button variant="ghost" size="sm" onClick={onEdit}>
        编辑
      </Button>
      <Button variant="ghost" size="sm" onClick={handleDelete} disabled={pending}>
        删除
      </Button>
    </div>
  );
}

/* ---------- 知识条目详情展示 ---------- */

export function KnowledgeItemDetail({
  item,
}: {
  item: {
    id: string;
    question: string;
    answer: string;
    imagePathsJson: string | null;
    imagePath: string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const imagePaths = pathsFromItem(item);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-left text-sm text-primary hover:underline"
      >
        {open ? "收起" : "查看详情"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg bg-secondary/20 p-3 text-sm">
          <div>
            <span className="font-medium">答案：</span>
            {item.answer}
          </div>
          {imagePaths.length > 0 && (
            <div>
              <span className="font-medium">关联图片：</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {imagePaths.map((img, i) => (
                  <img
                    key={i}
                    src={getFileUrl(img)}
                    alt={`图片 ${i + 1}`}
                    className="h-24 cursor-pointer rounded border border-border object-contain transition hover:opacity-80"
                    onClick={() => {
                      setLightboxIndex(i);
                      setLightboxOpen(true);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <ImageLightbox
        images={imagePaths}
        initialIndex={lightboxIndex}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}

export function RebuildIndexButton() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function rebuild() {
    if (!confirm("确认重建全量向量索引？这会删除 Qdrant 中所有向量并重新生成，耗时较长。")) return;
    setPending(true);
    setResult(null);
    try {
      const res = await fetch("/api/knowledge/rebuild-index", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setResult(`重建完成，共处理 ${data.rebuiltChunks} 个分块`);
      } else {
        setResult(data.error || "重建失败");
      }
    } catch {
      setResult("请求失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={rebuild} disabled={pending}>
        <RefreshCw className={`mr-1 size-3.5 ${pending ? "animate-spin" : ""}`} />
        {pending ? "重建中..." : "重建索引"}
      </Button>
      {result ? <span className="text-xs text-muted">{result}</span> : null}
    </div>
  );
}
