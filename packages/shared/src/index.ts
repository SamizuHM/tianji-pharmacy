export type UserRole = "staff" | "agent";

export type TicketStatus = "pending_claim" | "processing" | "escalated" | "resolved" | "closed";

export type TicketKnowledgeStatus = "not_ready" | "pending_writeback" | "written";

export type TicketPriority = "low" | "medium" | "high";

export type MessageRole = "user" | "assistant" | "agent" | "system";

export type MessageSourceType = "kb" | "llm" | "manual" | "system";

export type MessageFeedback = "helpful" | "unhelpful";

export type KnowledgeStatus = "draft" | "published" | "archived";

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

export function stripFixedAssistantSuffix(content: string) {
  let normalized = content.trimEnd();
  while (normalized.endsWith(FIXED_ASSISTANT_SUFFIX)) {
    normalized = normalized.slice(0, -FIXED_ASSISTANT_SUFFIX.length).trimEnd();
  }
  return normalized;
}

export const DEPARTMENTS = [
  { name: "营运部", description: "门店运营、日常管理" },
  { name: "采购部", description: "商品采购、供应商管理" },
  { name: "培训部", description: "员工培训、业务学习" },
  { name: "人事部", description: "人事管理、考勤排班" },
  { name: "财务部", description: "财务结算、发票管理" },
  { name: "医保办", description: "医保政策、结算对接" },
];

export const FIXED_USERS = [
  {
    username: "药店工作人员",
    password: "demo123",
    displayName: "药店工作人员",
    role: "staff" as const,
    department: null as string | null,
  },
  {
    username: "人工处理1",
    password: "demo123",
    displayName: "人工处理1",
    role: "agent" as const,
    department: null,
  },
  {
    username: "人工处理2",
    password: "demo123",
    displayName: "人工处理2",
    role: "agent" as const,
    department: null,
  },
  {
    username: "人工处理3",
    password: "demo123",
    displayName: "人工处理3",
    role: "agent" as const,
    department: null,
  },
  {
    username: "营运-张伟",
    password: "demo123",
    displayName: "张伟",
    role: "agent" as const,
    department: "营运部",
  },
  {
    username: "采购-李娜",
    password: "demo123",
    displayName: "李娜",
    role: "agent" as const,
    department: "采购部",
  },
  {
    username: "培训-王芳",
    password: "demo123",
    displayName: "王芳",
    role: "agent" as const,
    department: "培训部",
  },
  {
    username: "人事-赵敏",
    password: "demo123",
    displayName: "赵敏",
    role: "agent" as const,
    department: "人事部",
  },
  {
    username: "财务-刘洋",
    password: "demo123",
    displayName: "刘洋",
    role: "agent" as const,
    department: "财务部",
  },
  {
    username: "医保办-陈静",
    password: "demo123",
    displayName: "陈静",
    role: "agent" as const,
    department: "医保办",
  },
];
