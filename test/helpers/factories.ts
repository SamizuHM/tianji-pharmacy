export function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    username: "test-user",
    displayName: "测试用户",
    passwordHash: "$2a$10$hash",
    role: "staff",
    departmentId: null,
    department: null,
    createdAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function buildAgentUser(overrides: Record<string, unknown> = {}) {
  return buildUser({
    id: "agent-1",
    username: "agent-user",
    displayName: "测试客服",
    role: "agent",
    ...overrides,
  });
}

export function buildDepartment(overrides: Record<string, unknown> = {}) {
  return {
    id: "dept-1",
    name: "营运部",
    description: "门店运营、日常管理",
    ...overrides,
  };
}

export function buildConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    userId: "user-1",
    title: "测试会话",
    deletedAt: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function buildChatMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    role: "user",
    sourceType: "kb",
    contentText: "测试消息",
    status: "completed",
    attachmentsJson: null,
    retrievalDebugJson: null,
    feedback: null,
    createdAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function buildTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: "ticket-1",
    ticketNo: "TK20250518123456",
    title: "测试工单",
    status: "pending_claim",
    priority: "medium",
    category: "用药咨询",
    tags: null,
    latestUserQuestion: "测试问题",
    conversationId: "conv-1",
    createdByUserId: "user-1",
    claimedByUserId: null,
    escalatedToDept: null,
    escalatedToUserId: null,
    resolutionText: null,
    knowledgeStatus: "not_ready",
    closedBy: null,
    closedAt: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    createdBy: buildUser(),
    claimedBy: null,
    ...overrides,
  };
}

export function buildTicketMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "tmsg-1",
    ticketId: "ticket-1",
    role: "user",
    contentText: "测试工单消息",
    attachmentsJson: null,
    createdAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function buildKnowledgeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "ki-1",
    question: "测试问题",
    answer: "测试答案",
    categoryL1: "用药咨询",
    categoryL2: null,
    status: "published",
    tags: null,
    hitCount: 0,
    sourceFile: null,
    sourceType: "manual",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function buildKnowledgeChunk(overrides: Record<string, unknown> = {}) {
  return {
    id: "chunk-1",
    knowledgeItemId: "ki-1",
    chunkIndex: 0,
    contentText: "测试分块内容",
    pointId: null,
    createdAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    token: "test-token-uuid",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    createdAt: new Date("2025-01-01"),
    user: buildUser(),
    ...overrides,
  };
}
