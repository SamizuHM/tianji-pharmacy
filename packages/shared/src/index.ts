export type UserRole = "staff" | "human_l1" | "human_l2";

export type TicketStatus = "pending_l1" | "pending_l2" | "closed";

export type MessageRole = "user" | "assistant" | "human_l1" | "human_l2" | "system";

export type MessageSourceType = "kb" | "llm" | "manual" | "system";

export type InputMode = "text" | "image" | "mixed";

export type AttachmentItem = {
  name: string;
  path: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
};

export type RetrievalDebugItem = {
  knowledgeItemId: string;
  chunkId: string;
  question: string;
  answer: string;
  sourceFile?: string | null;
  rerankScore: number;
  vectorScore?: number | null;
};

export type AskResponse = {
  conversationId: string;
  assistantMessageId: string;
  answer: string;
  sourceType: MessageSourceType;
  sourceLabel: "知识库" | "大模型" | "人工";
  retrievalDebug: RetrievalDebugItem[];
};

export type KnowledgeImportResult = {
  importedFiles: number;
  importedChunks: number;
  skippedFiles: number;
  errors: Array<{
    file: string;
    reason: string;
  }>;
};

export const FIXED_ASSISTANT_SUFFIX = "如以上操作仍无法解决，建议您转人工进行咨询";

export const FIXED_USERS = [
  { username: "药店工作人员", password: "demo123", displayName: "药店工作人员", role: "staff" as const },
  { username: "人工处理1", password: "demo123", displayName: "人工处理1", role: "human_l1" as const },
  { username: "人工处理2", password: "demo123", displayName: "人工处理2", role: "human_l2" as const }
];

