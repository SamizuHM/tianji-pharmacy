import path from "node:path";
import mammoth from "mammoth";
import { env } from "@/lib/env";
import type { ModelChatMessage } from "@/lib/openai";

export type ParsedKnowledgeItem = {
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
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ texts }),
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
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ items }),
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
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, documents }),
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
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, query_image_paths: queryImagePaths, documents }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`多模态 Rerank 服务调用失败：${response.status} ${message}`);
  }

  return (await response.json()) as { scores: number[] };
}

function normalizeLocalText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLocalTextIntoChunks(text: string, chunkSize = 900, overlap = 120) {
  const normalized = normalizeLocalText(text);
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).trim().length <= chunkSize) {
      current = (current + "\n\n" + paragraph).trim();
      continue;
    }

    if (current) chunks.push(current);

    if (paragraph.length <= chunkSize) {
      current = paragraph;
      continue;
    }

    for (let start = 0; start < paragraph.length; start += chunkSize - overlap) {
      chunks.push(paragraph.slice(start, start + chunkSize).trim());
    }

    current = "";
  }

  if (current) chunks.push(current);

  return chunks;
}

export async function parseDocument(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    const originalText = result.value ?? "";
    const normalizedText = normalizeLocalText(originalText);
    const chunkTexts = splitLocalTextIntoChunks(normalizedText);

    if (!chunkTexts.length) {
      return { items: [] };
    }

    const sourceFile = path.basename(filePath);
    const question = sourceFile.replace(/\.docx$/i, "");

    return {
      items: [
        {
          question,
          answer: normalizedText,
          tags: ["药店", "门店", "智能问答", "知识库"],
          docType: "docx",
          sourceFile,
          imagePath: null,
          imagePaths: [],
          originalText,
          normalizedText,
          chunkTexts,
        },
      ],
    };
  }

  const response = await fetch(`${env.ML_SERVICE_URL}/parse-document`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file_path: filePath }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`文档解析服务调用失败：${response.status} ${message}`);
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
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system_prompt: input.systemPrompt,
      user_text: input.userText,
      image_paths: input.imagePaths,
      messages: input.messages?.map((message) => ({
        role: message.role,
        text: message.content,
        image_paths: message.imagePaths ?? [],
      })),
      model: input.model,
    }),
  });

  if (!response.ok || !response.body) {
    const message = await response.text();
    throw new Error(`多模态聊天流式服务调用失败：${response.status} ${message}`);
  }

  return response;
}
