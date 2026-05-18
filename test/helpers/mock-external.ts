import { vi } from "vitest";

// OpenAI 模块 mock
export function mockOpenAI() {
  return {
    streamChatText: vi.fn(),
    buildMultimodalQueryText: vi.fn(),
    generateTicketKnowledgeDraftWithModel: vi.fn(),
    streamKbStyledAnswer: vi.fn(),
    streamGeneralPharmacyAnswer: vi.fn(),
  };
}

// ML 服务 mock
export function mockMLService() {
  return {
    embedMultimodal: vi.fn(),
    rerankMultimodal: vi.fn(),
    rerank: vi.fn(),
    embedTexts: vi.fn(),
    parseDocument: vi.fn(),
    streamMultimodalChat: vi.fn(),
  };
}

// Qdrant 客户端 mock
export function mockQdrant() {
  return {
    search: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    getCollections: vi.fn(),
    createCollection: vi.fn(),
    ensureCollection: vi.fn(),
    ensureQdrantWriteReady: vi.fn(),
  };
}

// 通知服务 mock
export function mockNotifications() {
  return {
    broadcastTicketNotification: vi.fn(),
    getPendingTicketCounts: vi.fn(),
  };
}
