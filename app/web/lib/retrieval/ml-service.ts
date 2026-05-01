import { env } from "@/lib/env";
import type { ModelChatMessage } from "@/lib/openai";

export type ParsedKnowledgeItem = {
  categoryL1: string;
  categoryL2: string;
  question: string;
  answer: string;
  tags: string[];
  docType: string;
  sourceFile: string;
  imagePath?: string | null;
  imagePaths?: string[];
  originalText: string;
  normalizedText: string;
  chunkTexts: string[];
};

export async function embedTexts(texts: string[]) {
  const response = await fetch(env.EMBEDDING_SERVICE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ texts })
  });

  if (!response.ok) {
    throw new Error(`Embedding 服务调用失败：${response.status}`);
  }

  return (await response.json()) as { vectors: number[][] };
}

export type MultimodalEmbedInput = {
  text: string;
  image_path?: string;
  image_paths?: string[];
};

export async function embedMultimodal(items: MultimodalEmbedInput[]) {
  const response = await fetch(`${env.ML_SERVICE_URL}/embed-multimodal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ items })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`多模态 Embedding 服务调用失败：${response.status} ${message}`);
  }

  return (await response.json()) as { vectors: number[][] };
}

export async function rerank(query: string, documents: string[]) {
  const response = await fetch(env.RERANK_SERVICE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, documents })
  });

  if (!response.ok) {
    throw new Error(`Rerank 服务调用失败：${response.status}`);
  }

  return (await response.json()) as { scores: number[] };
}

export type MultimodalRerankDocument = {
  text: string;
  image_path?: string;
  image_paths?: string[];
};

export async function rerankMultimodal(
  query: string,
  queryImagePaths: string[],
  documents: MultimodalRerankDocument[]
) {
  const response = await fetch(`${env.ML_SERVICE_URL}/rerank-multimodal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, query_image_paths: queryImagePaths, documents })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`多模态 Rerank 服务调用失败：${response.status} ${message}`);
  }

  return (await response.json()) as { scores: number[] };
}

export async function parseDocument(filePath: string) {
  const response = await fetch(`${env.ML_SERVICE_URL}/parse-document`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file_path: filePath })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`文档解析失败：${message}`);
  }

  return (await response.json()) as { items: ParsedKnowledgeItem[] };
}

export async function streamMultimodalChat(input: {
  systemPrompt: string;
  userText?: string;
  imagePaths?: string[];
  messages?: ModelChatMessage[];
  model?: string;
}) {
  const response = await fetch(`${env.ML_SERVICE_URL}/chat-multimodal-stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      system_prompt: input.systemPrompt,
      user_text: input.userText,
      image_paths: input.imagePaths,
      messages: input.messages?.map((message) => ({
        role: message.role,
        text: message.content,
        image_paths: message.imagePaths ?? []
      })),
      model: input.model
    })
  });

  if (!response.ok || !response.body) {
    const message = await response.text();
    throw new Error(`多模态聊天流式服务调用失败：${response.status} ${message}`);
  }

  return response;
}
