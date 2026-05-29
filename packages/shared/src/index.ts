export type UserRole = "staff" | "department" | "admin";

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
  {
    name: "营运部",
    description:
      "门店日常运营与商品管理，包括：库存盘点、效期管理、商品价格调整、陈列规范、门店促销活动执行、GSP合规检查、处方药销售规范、执业药师在岗管理等",
  },
  {
    name: "采购部",
    description:
      "商品采购与供应商管理，包括：订货补货、进货验收、供应商对账、退货给供应商、新品引进、采购合同、缺货处理等",
  },
  {
    name: "培训部",
    description:
      "员工培训与业务学习，包括：新员工入职培训、业务知识考试、带教安排、培训计划制定、岗位技能考核、产品知识学习等",
  },
  {
    name: "人事部",
    description:
      "人事管理与行政事务，包括：考勤打卡、排班调班、请假审批、加班记录、薪资查询、社保公积金、入离职手续、劳动合同等",
  },
  {
    name: "财务部",
    description:
      "财务与票据管理，包括：财务报销、发票开具与管理、收银对账、营业款结算、费用审批、税票处理、备用金管理、银行对账等",
  },
  {
    name: "医保办",
    description:
      "医保政策与结算对接，包括：医保刷卡、统筹报销、医保目录查询、报销比例说明、医保系统对接、医保资质审核、特殊病种结算等",
  },
  {
    name: "技术服务部",
    description:
      "软硬件技术支持，包括：收银系统故障、小票打印机异常、扫码枪问题、数据库错误、系统登录问题、网络故障、POS设备维修、软件升级、系统权限配置等",
  },
  {
    name: "其他部门",
    description: "无法明确归属、跨部门协作或兜底处理的工单",
  },
];

export const REGIONS = [
  { name: "武汉", code: "wuhan", description: "武汉市" },
  { name: "黄石", code: "huangshi", description: "黄石市" },
  { name: "十堰", code: "shiyan", description: "十堰市" },
  { name: "宜昌", code: "yichang", description: "宜昌市" },
  { name: "襄阳", code: "xiangyang", description: "襄阳市" },
  { name: "鄂州", code: "ezhou", description: "鄂州市" },
  { name: "荆门", code: "jingmen", description: "荆门市" },
  { name: "孝感", code: "xiaogan", description: "孝感市" },
  { name: "荆州", code: "jingzhou", description: "荆州市" },
  { name: "黄冈", code: "huanggang", description: "黄冈市" },
  { name: "咸宁", code: "xianning", description: "咸宁市" },
  { name: "随州", code: "suizhou", description: "随州市" },
  { name: "恩施", code: "enshi", description: "恩施土家族苗族自治州" },
];

export const FIXED_USERS = [
  {
    username: "药店工作人员",
    password: "demo123",
    displayName: "张店员",
    role: "staff" as const,
    department: null as string | null,
  },
  {
    username: "管理员",
    password: "demo123",
    displayName: "系统管理员",
    role: "admin" as const,
    department: null,
  },
  {
    username: "营运-张伟",
    password: "demo123",
    displayName: "张伟",
    role: "department" as const,
    department: "营运部",
  },
  {
    username: "采购-李娜",
    password: "demo123",
    displayName: "李娜",
    role: "department" as const,
    department: "采购部",
  },
  {
    username: "培训-王芳",
    password: "demo123",
    displayName: "王芳",
    role: "department" as const,
    department: "培训部",
  },
  {
    username: "人事-赵敏",
    password: "demo123",
    displayName: "赵敏",
    role: "department" as const,
    department: "人事部",
  },
  {
    username: "财务-刘洋",
    password: "demo123",
    displayName: "刘洋",
    role: "department" as const,
    department: "财务部",
  },
  {
    username: "医保办-陈静",
    password: "demo123",
    displayName: "陈静",
    role: "department" as const,
    department: "医保办",
  },
  {
    username: "其他-周宁",
    password: "demo123",
    displayName: "周宁",
    role: "department" as const,
    department: "其他部门",
  },
  {
    username: "技术-孙鹏",
    password: "demo123",
    displayName: "孙鹏",
    role: "department" as const,
    department: "技术服务部",
  },
];
