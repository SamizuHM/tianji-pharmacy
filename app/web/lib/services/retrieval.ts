import { prisma } from "@/lib/db";
import { buildMultimodalQueryText } from "@/lib/openai";
import { embedMultimodal, rerankMultimodal } from "@/lib/retrieval/ml-service";
import { COLLECTION_NAME, qdrant } from "@/lib/retrieval/qdrant";
import { getRuntimeSettings } from "@/lib/services/settings";

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

type RetrievalDebugRecord = {
  knowledgeItemId: string;
  chunkId: string;
  question: string;
  answer: string;
  sourceFile: string | null;
  rerankScore: number;
  vectorScore: number;
};

export type RetrievalDecision =
  | {
      sourceType: "kb";
      contextSummary: string;
      queryText: string;
      retrievalDebug: RetrievalDebugRecord[];
      knowledgeItem: {
        id: string;
        question: string;
        answer: string;
        imagePaths: string[];
      };
      referenceSnippets: string[];
    }
  | {
      sourceType: "llm";
      contextSummary: string;
      queryText: string;
      retrievalDebug: RetrievalDebugRecord[];
      retrievalHints: string[];
    };

export async function retrieveAnswer(input: { conversationId: string; question: string; imagePaths: string[] }): Promise<RetrievalDecision> {
  const settings = await getRuntimeSettings();
  const contextSummary = await summarizeContext(input.conversationId, settings.maxContextTurns);
  const queryText = await buildMultimodalQueryText({
    question: input.question,
    contextSummary,
    imagePaths: input.imagePaths
  });

  const embedResults = await embedMultimodal([
    {
      text: queryText,
      image_path: input.imagePaths[0] ?? undefined,
      image_paths: input.imagePaths
    }
  ]);
  const searchResult = await qdrant.search(COLLECTION_NAME, {
    vector: embedResults.vectors[0],
    with_payload: true,
    limit: settings.retrievalTopK
  });

  const rerankDocs = searchResult.map((item) => {
    const imagePaths = Array.isArray(item.payload?.imagePaths) ? (item.payload.imagePaths as string[]) : [];
    return {
      text: String(item.payload?.chunkText ?? ""),
      image_path: imagePaths[0] ?? undefined,
      image_paths: imagePaths
    };
  });

  const rerankResult = rerankDocs.length
    ? await rerankMultimodal(queryText, input.imagePaths, rerankDocs)
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

  const retrievalDebug = ranked.map((item) => ({
    knowledgeItemId: String(item.payload.knowledgeItemId ?? ""),
    chunkId: item.pointId,
    question: String(item.payload.question ?? ""),
    answer: String(item.payload.answer ?? ""),
    sourceFile: item.payload.sourceFile ? String(item.payload.sourceFile) : null,
    rerankScore: item.rerankScore,
    vectorScore: item.vectorScore
  }));

  const top = ranked[0];
  if (top && top.rerankScore >= settings.kbHitThreshold) {
    const knowledgeItem = await prisma.knowledgeItem.findUnique({
      where: { id: String(top.payload.knowledgeItemId) },
      include: { chunks: { orderBy: { chunkIndex: "asc" } } }
    });

    if (knowledgeItem) {
      const imagePaths: string[] = knowledgeItem.imagePathsJson
        ? JSON.parse(knowledgeItem.imagePathsJson)
        : knowledgeItem.imagePath
          ? [knowledgeItem.imagePath]
          : [];

      return {
        sourceType: "kb",
        contextSummary,
        queryText,
        retrievalDebug,
        knowledgeItem: {
          id: knowledgeItem.id,
          question: knowledgeItem.question,
          answer: knowledgeItem.answer,
          imagePaths
        },
        referenceSnippets: knowledgeItem.chunks.map((item) => item.chunkText).slice(0, 3)
      };
    }
  }

  return {
    sourceType: "llm",
    contextSummary,
    queryText,
    retrievalDebug,
    retrievalHints: ranked.slice(0, 3).map((item) => String(item.payload.chunkText ?? ""))
  };
}
