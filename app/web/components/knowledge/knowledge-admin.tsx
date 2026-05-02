"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageLightbox } from "@/components/knowledge/image-lightbox";
import { RichEditor } from "@/components/knowledge/rich-editor";

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
  const imgTags = imagePaths.map((p) => `<img src="/api/files/${p}" alt="">`).join("");
  return `${textP}${imgTags}`;
}

/* ---------- 导入按钮 ---------- */

export function KnowledgeImportButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  return (
    <div className="space-y-3">
      <Button
        onClick={() => {
          startTransition(async () => {
            setMessage("");
            const response = await fetch("/api/knowledge", { method: "POST" });
            const data = await response.json();
            if (!response.ok) {
              setMessage(data.error || "导入失败");
              return;
            }
            setMessage(`导入完成：成功文件 ${data.importedFiles}，切片 ${data.importedChunks}，跳过 ${data.skippedFiles}`);
            router.refresh();
          });
        }}
        disabled={pending}
      >
        {pending ? "导入中..." : "导入 seed_knowledge 与参考 Word 文档"}
      </Button>
      {message ? <Alert>{message}</Alert> : null}
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
  const [answerHtml, setAnswerHtml] = useState(initialAnswer ? buildEditorHtml(initialAnswer, []) : "");
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
    const imagePaths = imageSrcs
      .map((src) => src.replace(/^\/api\/files\//, ""))
      .filter(Boolean);

    startTransition(async () => {
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryL1: categoryL1.trim() || "手动录入",
          categoryL2: categoryL2.trim() || "手动新增",
          question: question.trim(),
          answer: answerText,
          imagePaths
        })
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
          <label className="block text-sm font-medium mb-1">一级分类</label>
          <Input
            value={categoryL1}
            onChange={(e) => setCategoryL1(e.target.value)}
            placeholder="如：设备维护"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">二级分类</label>
          <Input
            value={categoryL2}
            onChange={(e) => setCategoryL2(e.target.value)}
            placeholder="如：打印机"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">问题</label>
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="请输入问题"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">答案</label>
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
  onCancel
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
    const newImagePaths = srcs
      .map((s) => s.replace(/^\/api\/files\//, ""))
      .filter(Boolean);

    startTransition(async () => {
      const response = await fetch(`/api/knowledge/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryL1: categoryL1.trim() || "手动录入",
          categoryL2: categoryL2.trim() || "手动新增",
          question: question.trim(),
          answer: answerText,
          imagePaths: newImagePaths
        })
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
          <label className="block text-sm font-medium mb-1">一级分类</label>
          <Input value={categoryL1} onChange={(e) => setCategoryL1(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">二级分类</label>
          <Input value={categoryL2} onChange={(e) => setCategoryL2(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">问题</label>
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">答案</label>
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

export function KnowledgeItemActions({
  id,
  onEdit
}: {
  id: string;
  onEdit: () => void;
}) {
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
  item
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
                    src={`/api/files/${img}`}
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
