import { prisma } from "@/lib/db";
import type { ProgressStepKey } from "@/lib/chat-progress";
import { buildMultimodalQueryText } from "@/lib/openai";
import { embedMultimodal, rerankMultimodal } from "@/lib/retrieval/ml-service";
import { COLLECTION_NAME, qdrant } from "@/lib/retrieval/qdrant";
import {
  enqueueDeletePointTask,
  tryDrainKnowledgeIndexTasks,
} from "@/lib/services/knowledge-index";
import { getRuntimeSettings } from "@/lib/services/settings";

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
      queryText: string;
      retrievalDebug: RetrievalDebugRecord[];
    };

type RetrievalProgressHooks = {
  startStep?: (stepKey: ProgressStepKey, detail?: string) => void;
  completeStep?: (stepKey: ProgressStepKey, detail?: string) => void;
};

async function runProgressStep<T>(
  hooks: RetrievalProgressHooks | undefined,
  stepKey: ProgressStepKey,
  action: () => Promise<T>,
  detail?: string | ((result: T) => string | undefined)
) {
  hooks?.startStep?.(stepKey);
  const result = await action();
  const resolvedDetail = typeof detail === "function" ? detail(result) : detail;
  hooks?.completeStep?.(stepKey, resolvedDetail);
  return result;
}

export async function retrieveAnswer(
  input: { question: string; imagePaths: string[] },
  hooks?: RetrievalProgressHooks
): Promise<RetrievalDecision> {
  const settings = await getRuntimeSettings();
  const queryText = await runProgressStep(hooks, "rewrite_query", () =>
    buildMultimodalQueryText({
      question: input.question,
      imagePaths: input.imagePaths,
    })
  );

  const embedResults = await runProgressStep(hooks, "embed_query", () =>
    embedMultimodal([
      {
        text: queryText,
        image_path: input.imagePaths[0] ?? undefined,
        image_paths: input.imagePaths,
      },
    ])
  );
  const searchResult = await runProgressStep(hooks, "search_qdrant", () =>
    qdrant.search(COLLECTION_NAME, {
      vector: embedResults.vectors[0],
      with_payload: true,
      limit: settings.retrievalTopK,
    })
  );

  const rerankDocs = searchResult.map((item) => {
    const imagePaths = Array.isArray(item.payload?.imagePaths)
      ? (item.payload.imagePaths as string[])
      : [];
    return {
      text: String(item.payload?.chunkText ?? ""),
      image_path: imagePaths[0] ?? undefined,
      image_paths: imagePaths,
    };
  });

  const rerankResult = await runProgressStep(hooks, "rerank", async () =>
    rerankDocs.length ? rerankMultimodal(queryText, input.imagePaths, rerankDocs) : { scores: [] }
  );

  const ranked = searchResult
    .map((item, index) => ({
      pointId: String(item.id),
      payload: item.payload as Record<string, unknown>,
      vectorScore: item.score ?? 0,
      rerankScore: rerankResult.scores[index] ?? 0,
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
    vectorScore: item.vectorScore,
  }));

  return runProgressStep(
    hooks,
    "decide_source",
    async () => {
      const candidates = ranked.filter((item) => item.rerankScore >= settings.kbHitThreshold);

      for (const top of candidates) {
        const chunk =
          (await prisma.knowledgeChunk.findUnique({
            where: { id: top.pointId },
            include: {
              knowledgeItem: true,
            },
          })) ??
          (await prisma.knowledgeChunk.findUnique({
            where: { qdrantPointId: top.pointId },
            include: {
              knowledgeItem: true,
            },
          }));

        if (!chunk) {
          await enqueueDeletePointTask({
            pointId: top.pointId,
            reason: "retrieval_stale_point",
          });
          await tryDrainKnowledgeIndexTasks({ limit: 10 });
          continue;
        }

        const knowledgeItem = chunk.knowledgeItem;
        if (knowledgeItem.status !== "published") {
          continue;
        }

        await prisma.knowledgeItem.update({
          where: { id: knowledgeItem.id },
          data: {
            hitCount: { increment: 1 },
            lastHitAt: new Date(),
          },
        });

        const imagePaths: string[] = knowledgeItem.imagePathsJson
          ? JSON.parse(knowledgeItem.imagePathsJson)
          : knowledgeItem.imagePath
            ? [knowledgeItem.imagePath]
            : [];

        const siblingChunks = await prisma.knowledgeChunk.findMany({
          where: { knowledgeItemId: knowledgeItem.id },
          orderBy: { chunkIndex: "asc" },
          select: { chunkText: true },
        });

        return {
          sourceType: "kb",
          queryText,
          retrievalDebug,
          knowledgeItem: {
            id: knowledgeItem.id,
            question: knowledgeItem.question,
            answer: knowledgeItem.answer,
            imagePaths,
          },
          referenceSnippets: siblingChunks.map((item) => item.chunkText).slice(0, 3),
        } satisfies RetrievalDecision;
      }

      return {
        sourceType: "llm",
        queryText,
        retrievalDebug,
      } satisfies RetrievalDecision;
    },
    (result) =>
      result.sourceType === "kb" ? "知识库命中，进入答案整理" : "未命中知识库，转入通用药店问答"
  );
}
