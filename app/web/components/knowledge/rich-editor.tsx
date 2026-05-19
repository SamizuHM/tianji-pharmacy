"use client";

import { useCallback } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";

import { Button } from "@/components/ui/button";

type RichEditorProps = {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
};

export function RichEditor({ content, onChange, placeholder }: RichEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Image.configure({ inline: false }),
      Placeholder.configure({
        placeholder: placeholder || "请输入答案内容，可插入图片…",
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  const uploadAndInsertImage = useCallback(
    async (file: File) => {
      if (!editor) return;
      const formData = new FormData();
      formData.append("files", file);

      const response = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) return;

      const data = await response.json();
      const uploadedPath = data.files?.[0]?.path;
      if (uploadedPath) {
        editor
          .chain()
          .focus()
          .setImage({ src: `/api/files/${uploadedPath.replace(/^uploads\//, "")}` })
          .run();
      }
    },
    [editor]
  );

  const addImage = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      await uploadAndInsertImage(file);
    };
    input.click();
  }, [uploadAndInsertImage]);

  if (!editor) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex gap-1 border-b border-border bg-secondary/30 px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={editor.isActive("bold") ? "bg-secondary" : ""}
        >
          <b>B</b>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={editor.isActive("italic") ? "bg-secondary" : ""}
        >
          <i>I</i>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={editor.isActive("bulletList") ? "bg-secondary" : ""}
        >
          列表
        </Button>
        <Button variant="ghost" size="sm" onClick={addImage}>
          插入图片
        </Button>
      </div>
      <EditorContent
        editor={editor}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData?.items ?? [])
            .filter((item) => item.type.startsWith("image/"))
            .map((item) => item.getAsFile())
            .filter((item): item is File => Boolean(item));
          if (!files.length) {
            return;
          }
          event.preventDefault();
          void (async () => {
            for (const file of files) {
              await uploadAndInsertImage(file);
            }
          })();
        }}
        className="prose prose-sm min-h-[200px] max-w-none px-3 py-3 focus:outline-none [&_.ProseMirror]:min-h-[180px] [&_.ProseMirror]:max-w-full [&_.ProseMirror]:overflow-x-auto [&_.ProseMirror]:outline-none [&_.ProseMirror_img]:h-auto [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child::before]:overflow-hidden [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
