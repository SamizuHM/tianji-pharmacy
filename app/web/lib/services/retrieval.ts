import { prisma } from "@/lib/db";
import { buildMultimodalQueryText, generateConservativeAnswer } from "@/lib/openai";
import { embedMultimodal, rerankMultimodal } from "@/lib/retrieval/ml-service";
import { COLLECTION_NAME, qdrant } from "@/lib/retrieval/qdrant";
import { getRuntimeSettings } from "@/lib/services/settings";
import { safeJsonParse } from "@/lib/utils";

export async function summarizeContext(conversationId: string, maxTurns: number) {
  const messages = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: maxTurns * 2
  });

  return messages
    .reverse()
    .map((message) => `${message.role === "user" ? "用户" : "系统/助手"}：${message.contentText.slice(0, 200)}`)
    .join("\n");
}

export async function retrieveAnswer(input: { conversationId: string; question: string; imagePaths: string[] }) {
  const settings = await getRuntimeSettings();
  const contextSummary = await summarizeContext(input.conversationId, settings.maxContextTurns);
  const queryText = await buildMultimodalQueryText({
    question: input.question,
    contextSummary,
    imagePaths: input.imagePaths
  });

  // 使用多模态 embedding（支持用户上传图片）
  const queryImagePath = input.imagePaths?.[0] ?? null;
  const embedResults = await embedMultimodal([
    { text: queryText, image_path: queryImagePath ?? undefined }
  ]);
  const searchResult = await qdrant.search(COLLECTION_NAME, {
    vector: embedResults.vectors[0],
    with_payload: true,
    limit: settings.retrievalTopK
  });

  // 多模态 rerank：候选文档带上图片路径
  const rerankDocs = searchResult.map((item) => {
    const imagePaths = Array.isArray(item.payload?.imagePaths) ? item.payload.imagePaths as string[] : [];
    return {
      text: String(item.payload?.chunkText ?? ""),
      image_path: imagePaths[0] ?? undefined
    };
  });
  const rerankResult = rerankDocs.length
    ? await rerankMultimodal(queryText, queryImagePath, rerankDocs)
    : { scores: [] };

  const ranked = searchResult
    .map((item, index) => ({
      pointId: String(item.id),
      payload: item.payload as Record<string, unknown>,
      vectorScore: item.score ?? 0,
      rerankScore: rerankResult.scores[index] ?? 0
    }))
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, settings.rerankTopN);

  const top = ranked[0];

  if (top && top.rerankScore >= settings.kbHitThreshold) {
    const knowledgeItem = await prisma.knowledgeItem.findUnique({
      where: { id: String(top.payload.knowledgeItemId) },
      include: { chunks: true }
    });

    if (knowledgeItem) {
      const retrievalDebug = ranked.map((item) => ({
        knowledgeItemId: String(item.payload.knowledgeItemId),
        chunkId: item.pointId,
        question: String(item.payload.question ?? ""),
        answer: String(item.payload.answer ?? ""),
        sourceFile: item.payload.sourceFile ? String(item.payload.sourceFile) : null,
        rerankScore: item.rerankScore,
        vectorScore: item.vectorScore
      }));

      // 解析知识条目的图片路径
      const imagePaths: string[] = knowledgeItem.imagePathsJson
        ? JSON.parse(knowledgeItem.imagePathsJson)
        : knowledgeItem.imagePath
          ? [knowledgeItem.imagePath]
          : [];

      return {
        sourceType: "kb" as const,
        answer:
          `根据知识库：\n${knowledgeItem.answer}\n\n参考问题：${knowledgeItem.question}`,
        retrievalDebug,
        imagePaths
      };
    }
  }

  const llmAnswer = await generateConservativeAnswer({
    question: input.question || "用户上传了图片，请结合上下文提供保守建议。",
    contextSummary,
    retrievalHints: ranked.slice(0, 3).map((item) => String(item.payload.chunkText ?? ""))
  });

  return {
    sourceType: "llm" as const,
    answer: llmAnswer,
    retrievalDebug: ranked.map((item) => ({
      knowledgeItemId: String(item.payload.knowledgeItemId ?? ""),
      chunkId: item.pointId,
      question: String(item.payload.question ?? ""),
      answer: String(item.payload.answer ?? ""),
      sourceFile: item.payload.sourceFile ? String(item.payload.sourceFile) : null,
      rerankScore: item.rerankScore,
      vectorScore: item.vectorScore
    }))
  };
}

export function parseAttachmentsJson(value: string | null) {
  return safeJsonParse(value, []);
}

