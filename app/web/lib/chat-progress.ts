export const PROGRESS_STEP_LABELS = {
  save_input: "记录问题",
  summarize_context: "整理上下文",
  rewrite_query: "理解问题与图片",
  embed_query: "生成检索向量",
  search_qdrant: "检索知识库",
  rerank: "重排候选结果",
  decide_source: "判断知识命中",
  await_first_token: "等待模型响应",
  reasoning_answer: "模型推理中",
  stream_answer: "流式生成回答",
} as const;

export const PROGRESS_STEP_ORDER = Object.keys(PROGRESS_STEP_LABELS) as ProgressStepKey[];

export type ProgressStepKey = keyof typeof PROGRESS_STEP_LABELS;

export type ProgressStepStatus = "started" | "completed";

export type ProgressEventPayload = {
  stepKey: ProgressStepKey;
  label: string;
  status: ProgressStepStatus;
  startedAtMs: number;
  endedAtMs?: number;
  durationMs?: number;
  elapsedTotalMs: number;
  detail?: string;
};

export type ProgressSummaryItem = {
  stepKey: ProgressStepKey;
  label: string;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  detail?: string;
};

export type ProgressDonePayload = {
  assistantMessageId: string;
  answer: string;
  totalDurationMs: number;
  stepsSummary: ProgressSummaryItem[];
  firstResponseLatencyMs?: number | null;
  firstTokenLatencyMs?: number | null;
  reasoningAnswerMs?: number;
  waitFirstTokenMs?: number;
  streamAnswerMs?: number;
};

export function formatDurationSeconds(durationMs: number) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}
