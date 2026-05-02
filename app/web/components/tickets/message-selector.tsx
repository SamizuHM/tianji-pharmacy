"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/presentation";

type MessageItem = {
  id: string;
  senderRole: string;
  senderUser?: { displayName: string } | null;
  content: string;
  createdAt: string;
};

export function MessageSelector(props: {
  messages: MessageItem[];
  onConfirm: (selected: { question: string; answer: string }) => void;
  onCancel: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleConfirm() {
    const selected = props.messages.filter((m) => selectedIds.has(m.id));
    // User messages become questions, human/system messages become answers
    const questions = selected.filter((m) => m.senderRole === "user").map((m) => m.content);
    const answers = selected
      .filter((m) => m.senderRole !== "user" && m.senderRole !== "system")
      .map((m) => `${m.senderUser?.displayName || "处理人"}：${m.content}`);

    props.onConfirm({
      question: questions.join("\n") || selected[0]?.content || "",
      answer: answers.join("\n\n") || ""
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium text-slate-900">选择消息录入知识库</div>
      <div className="text-xs text-muted">勾选相关消息，系统会自动将用户问题作为问题、人工回复作为答案预填到知识条目表单。</div>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
        {props.messages.map((msg) => {
          const checked = selectedIds.has(msg.id);
          return (
            <label
              key={msg.id}
              className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                checked={checked}
                onChange={() => toggle(msg.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge className="text-[11px]">
                    {msg.senderUser?.displayName || senderLabel(msg.senderRole)}
                  </Badge>
                  <span className="text-[11px] text-muted">{formatDateTime(msg.createdAt)}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-slate-600">{msg.content}</div>
              </div>
            </label>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={selectedIds.size === 0} onClick={handleConfirm}>
          确认选择（{selectedIds.size} 条）
        </Button>
        <Button size="sm" variant="outline" onClick={props.onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

function senderLabel(role: string) {
  switch (role) {
    case "user":
      return "药店工作人员";
    case "agent":
      return "人工客服";
    case "system":
      return "系统";
    default:
      return role;
  }
}
