import { prisma } from "@/lib/db";
import type { ProgressStepKey } from "@/lib/chat-progress";
import { buildMultimodalQueryText, rewriteRetrievalQueriesWithModel } from "@/lib/openai";
import { embedMultimodal, rerankMultimodal } from "@/lib/retrieval/ml-service";
import { COLLECTION_NAME, qdrant } from "@/lib/retrieval/qdrant";
import { scoreBm25FromTermRows, tokenizeForBm25 } from "@/lib/services/bm25";
import {
  enqueueDeletePointTask,
  tryDrainKnowledgeIndexTasks,
} from "@/lib/services/knowledge-index";
import { isSensitiveQuery, matchSensitiveTerms } from "@/lib/services/sensitive-words";
import { getRuntimeSettings } from "@/lib/services/settings";

type RetrievalDebugRecord = {
  knowledgeItemId: string;
  chunkId: string;
  chunkText: string;
  question: string;
  answer: string;
  sourceFile: string | null;
  rerankScore: number;
  vectorScore: number;
  keywordScore?: number;
  rrfScore?: number;
  finalScore?: number;
  scopeLevel?: string | null;
  cityName?: string | null;
  sources?: string[];
  usedAsReference: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

type QueryPlan = {
  normalizedQuery: string;
  businessCategory: string;
  mustTerms: string[];
  queryVariants: string[];
  bm25Queries: string[];
};

const KNOWLEDGE_ONLY_REFUSAL_TEXT = "当前知识库中未找到相关政策，建议咨询上级主管部门。";

type RegionContext = {
  cityName?: string | null;
};

type RetrievalCandidate = {
  pointId: string;
  chunkId: string;
  payload: Record<string, unknown>;
  vectorScore: number;
  keywordScore: number;
  rrfScore: number;
  finalScore: number;
  scopeWeight: number;
  sources: Set<"vector" | "keyword">;
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
        createdAt: string;
        updatedAt: string;
      };
      referenceSnippets: string[];
    }
  | {
      sourceType: "llm";
      queryText: string;
      retrievalDebug: RetrievalDebugRecord[];
    }
  | {
      sourceType: "refusal";
      queryText: string;
      retrievalDebug: RetrievalDebugRecord[];
      refusalReason: string;
    }
  | {
      sourceType: "sensitive";
      queryText: string;
      retrievalDebug: RetrievalDebugRecord[];
      matchedTerms: string[];
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

function resolveFallbackPolicy(businessCategory: string): "allow_llm_fallback" | "kb_only" {
  return ["医保", "用药"].includes(businessCategory) ? "kb_only" : "allow_llm_fallback";
}

async function buildQueryPlan(queryText: string, historyText = ""): Promise<QueryPlan> {
  const rewritten = await rewriteRetrievalQueriesWithModel({ queryText, historyText });
  const normalizedQuery = rewritten.normalizedQuery.trim() || queryText.trim();
  return {
    normalizedQuery,
    businessCategory: rewritten.businessCategory,
    mustTerms: rewritten.mustTerms.slice(0, 8),
    queryVariants: Array.from(new Set([normalizedQuery, ...rewritten.vectorQueries])).slice(0, 8),
    bm25Queries: Array.from(new Set([normalizedQuery, ...rewritten.keywordQueries])).slice(0, 8),
  };
}

function scopeWeight(
  candidate: RetrievalCandidate,
  currentCityName?: string | null,
  cityWeight = 1.3
) {
  const scopeLevel = String(candidate.payload.scopeLevel ?? "");
  const cityName = candidate.payload.cityName ? String(candidate.payload.cityName) : null;
  if (scopeLevel === "city" && cityName && cityName === currentCityName) {
    return cityWeight;
  }
  return 1;
}

function mergeCandidates(
  groups: RetrievalCandidate[][],
  region: RegionContext | undefined,
  cityWeight: number
) {
  const merged = new Map<string, RetrievalCandidate>();
  const rrfK = 60;

  for (const group of groups) {
    group.forEach((candidate, index) => {
      const existing = merged.get(candidate.chunkId);
      const rrfScore = 1 / (rrfK + index + 1);
      const weight = scopeWeight(candidate, region?.cityName, cityWeight);
      if (existing) {
        existing.vectorScore = Math.max(existing.vectorScore, candidate.vectorScore);
        existing.keywordScore = Math.max(existing.keywordScore, candidate.keywordScore);
        existing.rrfScore += rrfScore;
        existing.scopeWeight = Math.max(existing.scopeWeight, weight);
        candidate.sources.forEach((source) => existing.sources.add(source));
        return;
      }
      merged.set(candidate.chunkId, {
        ...candidate,
        rrfScore,
        finalScore: 0,
        scopeWeight: weight,
        sources: new Set(candidate.sources),
      });
    });
  }

  const candidates = Array.from(merged.values());
  for (const c of candidates) {
    c.finalScore = c.rrfScore * c.scopeWeight;
  }
  return candidates.sort((a, b) => b.finalScore - a.finalScore);
}

function buildFullTextQuery(plan: QueryPlan) {
  return Array.from(new Set([...plan.bm25Queries, ...plan.mustTerms]))
    .filter(Boolean)
    .join(" ");
}

function candidateFromPayload(input: {
  pointId: string;
  payload: Record<string, unknown>;
  rank: number;
  keywordScore?: number;
}): RetrievalCandidate {
  return {
    pointId: input.pointId,
    chunkId: String(input.payload.chunkId ?? input.pointId),
    payload: input.payload,
    vectorScore: 0,
    keywordScore: input.keywordScore ?? 1 / (input.rank + 1),
    rrfScore: 0,
    finalScore: 0,
    scopeWeight: 1,
    sources: new Set<"vector" | "keyword">(["keyword"]),
  };
}

async function keywordRecall(
  plan: QueryPlan,
  limit: number,
  region: RegionContext | undefined
): Promise<RetrievalCandidate[]> {
  const query = buildFullTextQuery(plan);
  const queryTerms = Array.from(new Set(tokenizeForBm25(query)));
  if (!queryTerms.length) {
    return [];
  }

  const visibleScopeWhere = {
    OR: [
      { scopeLevel: "common" as const },
      { scopeLevel: "city" as const, cityName: region?.cityName ?? "__none__" },
    ],
  };
  const visibleChunkWhere = {
    enabled: true,
    knowledgeItem: { status: "published" as const },
    ...visibleScopeWhere,
  };

  const termRows =
    (await prisma.knowledgeBm25Term.findMany({
      where: {
        term: { in: queryTerms },
        ...visibleScopeWhere,
        chunk: {
          enabled: true,
          knowledgeItem: { status: "published" },
        },
      },
      select: {
        chunkId: true,
        term: true,
        termFrequency: true,
        docLength: true,
      },
    })) ?? [];
  const chunkIds = Array.from(new Set(termRows.map((row) => row.chunkId)));
  if (!chunkIds.length) {
    return [];
  }

  const [corpusStats, chunks] = await Promise.all([
    prisma.knowledgeChunk.aggregate({
      where: visibleChunkWhere,
      _count: { _all: true },
      _avg: { bm25DocLength: true },
    }),
    prisma.knowledgeChunk.findMany({
      where: {
        ...visibleChunkWhere,
        id: { in: chunkIds },
      },
      include: { knowledgeItem: true },
    }),
  ]);

  return scoreBm25FromTermRows(
    query,
    chunks.map((chunk) => ({
      id: chunk.id,
      docLength: chunk.bm25DocLength,
      payload: chunk,
    })),
    termRows,
    {
      documentCount: corpusStats._count._all,
      averageDocLength: corpusStats._avg.bm25DocLength ?? 1,
    },
    { limit }
  ).map((scored, rank) => {
    const chunk = scored.payload;
    return candidateFromPayload({
      pointId: chunk.qdrantPointId,
      rank,
      keywordScore: scored.score,
      payload: {
        knowledgeItemId: chunk.knowledgeItemId,
        chunkId: chunk.id,
        chunkText: chunk.chunkText,
        question: chunk.knowledgeItem.question,
        answer: chunk.knowledgeItem.answer,
        sourceFile: chunk.sourceFile ?? chunk.knowledgeItem.sourceFile,
        scopeLevel: chunk.scopeLevel,
        cityName: chunk.cityName,
        overrideScope: chunk.overrideScope,
        imagePaths: chunk.knowledgeItem.imagePathsJson
          ? JSON.parse(chunk.knowledgeItem.imagePathsJson)
          : chunk.knowledgeItem.imagePath
            ? [chunk.knowledgeItem.imagePath]
            : [],
      },
    });
  });
}

function isChunkVisible(
  chunk:
    | {
        scopeLevel?: string | null;
        cityName?: string | null;
        document?: { scopeLevel: string; cityName?: string | null } | null;
      }
    | null
    | undefined,
  region: RegionContext | undefined
) {
  const scopeLevel = chunk?.scopeLevel ?? chunk?.document?.scopeLevel ?? "common";
  if (scopeLevel === "common") {
    return true;
  }
  if (!region?.cityName) {
    return false;
  }
  return (
    scopeLevel === "city" && (chunk?.cityName ?? chunk?.document?.cityName) === region.cityName
  );
}

function payloadScopeVisible(payload: Record<string, unknown>, region: RegionContext | undefined) {
  const scopeLevel = String(payload.scopeLevel ?? "common");
  if (scopeLevel === "common") {
    return true;
  }
  if (!region?.cityName) {
    return false;
  }
  return scopeLevel === "city" && String(payload.cityName ?? "") === region.cityName;
}

function qdrantScopeFilter(region: RegionContext | undefined) {
  const should: Array<Record<string, unknown>> = [
    { key: "scopeLevel", match: { value: "common" } },
  ];

  if (region?.cityName) {
    should.push({
      must: [
        { key: "scopeLevel", match: { value: "city" } },
        { key: "cityName", match: { value: region.cityName } },
      ],
    });
  }

  return { should };
}

function isQdrantCollectionMissingError(error: unknown) {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  const message = error instanceof Error ? error.message : String(error);
  return (
    status === 404 ||
    message.includes("Not Found") ||
    message.includes("not found") ||
    message.includes("doesn't exist") ||
    message.includes("does not exist")
  );
}

export async function retrieveAnswer(
  input: {
    question: string;
    imagePaths: string[];
    region?: RegionContext;
    historyMessages?: Array<{ role: "user" | "assistant"; content: string }>;
  },
  hooks?: RetrievalProgressHooks
): Promise<RetrievalDecision> {
  const settings = await getRuntimeSettings();
  const queryText = await runProgressStep(hooks, "rewrite_query", () =>
    buildMultimodalQueryText({
      question: input.question,
      imagePaths: input.imagePaths,
    })
  );

  const historyText =
    input.historyMessages
      ?.slice(-4)
      .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`)
      .join("\n") ?? "";
  const queryPlan = await buildQueryPlan(queryText, historyText);
  const fallbackPolicy = resolveFallbackPolicy(queryPlan.businessCategory);
  const embedResults = await runProgressStep(hooks, "embed_query", () =>
    embedMultimodal(
      queryPlan.queryVariants.map((text) => ({
        text,
        image_path: input.imagePaths[0] ?? undefined,
        image_paths: input.imagePaths,
      }))
    )
  );
  const vectorGroups = await runProgressStep(hooks, "search_qdrant", async () =>
    Promise.all(
      embedResults.vectors.map(async (vector) => {
        let searchResult;
        try {
          searchResult = await qdrant.search(COLLECTION_NAME, {
            vector,
            with_payload: true,
            filter: qdrantScopeFilter(input.region),
            limit: Math.max(settings.retrievalTopK, settings.rerankTopN * 2),
          });
        } catch (error) {
          if (isQdrantCollectionMissingError(error)) {
            return [];
          }
          throw error;
        }
        return searchResult
          .map((item) => {
            const payload = item.payload as Record<string, unknown>;
            return {
              pointId: String(item.id),
              chunkId: String(payload.chunkId ?? item.id),
              payload,
              vectorScore: item.score ?? 0,
              keywordScore: 0,
              rrfScore: 0,
              finalScore: 0,
              scopeWeight: 1,
              sources: new Set<"vector" | "keyword">(["vector"]),
            };
          })
          .filter((item) => payloadScopeVisible(item.payload, input.region));
      })
    )
  );
  const keywordCandidates = await keywordRecall(
    queryPlan,
    Math.max(settings.retrievalTopK, settings.rerankTopN * 2),
    input.region
  );
  const searchResult = mergeCandidates(
    [...vectorGroups, keywordCandidates],
    input.region,
    settings.cityScopeWeight
  ).slice(0, Math.max(settings.retrievalTopK * 3, settings.rerankTopN * 4));

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

  const ranked = searchResult.map((item, index) => ({
    pointId: item.pointId,
    payload: item.payload as Record<string, unknown>,
    vectorScore: item.vectorScore,
    keywordScore: item.keywordScore,
    rrfScore: item.rrfScore,
    finalScore: item.finalScore,
    scopeWeight: item.scopeWeight,
    rerankScore: rerankResult.scores[index] ?? 0,
    sources: Array.from(item.sources),
  }));

  // min-max 归一化 RRF 分数后与 rerank 加权融合
  const finalScores = ranked.map((item) => item.finalScore);
  const minFinal = Math.min(...finalScores);
  const maxFinal = Math.max(...finalScores);
  const range = maxFinal - minFinal || 1;
  const alpha = settings.rerankAlpha;

  ranked.forEach((item) => {
    const normalizedFinal = (item.finalScore - minFinal) / range;
    item.finalScore = normalizedFinal;
  });
  ranked.sort((a, b) => {
    const scoreA = alpha * a.rerankScore + (1 - alpha) * a.finalScore;
    const scoreB = alpha * b.rerankScore + (1 - alpha) * b.finalScore;
    return scoreB - scoreA;
  });
  ranked.splice(settings.rerankTopN);

  const retrievalDebug: RetrievalDebugRecord[] = ranked.map((item) => ({
    knowledgeItemId: String(item.payload.knowledgeItemId ?? ""),
    chunkId: String(item.payload.chunkId ?? item.pointId),
    chunkText: String(item.payload.chunkText ?? ""),
    question: String(item.payload.sourceFile ?? item.payload.question ?? ""),
    answer: String(item.payload.answer ?? ""),
    sourceFile: item.payload.sourceFile ? String(item.payload.sourceFile) : null,
    rerankScore: item.rerankScore,
    vectorScore: item.vectorScore,
    keywordScore: item.keywordScore,
    rrfScore: item.rrfScore,
    finalScore: item.finalScore,
    scopeLevel: item.payload.scopeLevel ? String(item.payload.scopeLevel) : null,
    cityName: item.payload.cityName ? String(item.payload.cityName) : null,
    sources: item.sources,
    usedAsReference: false,
    createdAt: null,
    updatedAt: null,
  }));

  return runProgressStep(
    hooks,
    "decide_source",
    async () => {
      const candidates = ranked.filter((item) => item.rerankScore >= settings.kbHitThreshold);

      // 批量查询 evidence chunks
      const candidateChunkIds = candidates.map((top) => String(top.payload.chunkId ?? top.pointId));
      const foundChunks = await prisma.knowledgeChunk.findMany({
        where: { id: { in: candidateChunkIds } },
        include: { knowledgeItem: true, document: true },
      });
      const chunksById = new Map(foundChunks.map((chunk) => [chunk.id, chunk]));

      const missingCandidates = candidates.filter(
        (top) => !chunksById.has(String(top.payload.chunkId ?? top.pointId))
      );
      const missingPointIds = missingCandidates.map((top) => top.pointId);

      let chunksByPointId = new Map<string, (typeof foundChunks)[number]>();
      if (missingPointIds.length) {
        const foundByPointId = await prisma.knowledgeChunk.findMany({
          where: { qdrantPointId: { in: missingPointIds } },
          include: { knowledgeItem: true, document: true },
        });
        chunksByPointId = new Map(foundByPointId.map((chunk) => [chunk.qdrantPointId, chunk]));
      }

      const stalePointIds = missingCandidates
        .filter((top) => !chunksByPointId.has(top.pointId))
        .map((top) => top.pointId);
      if (stalePointIds.length) {
        for (const pointId of stalePointIds) {
          await enqueueDeletePointTask({ pointId, reason: "retrieval_stale_point" });
        }
        await tryDrainKnowledgeIndexTasks({ limit: 10 });
      }

      const evidenceChunks: Array<{
        id: string;
        chunkText: string;
        knowledgeItem: {
          id: string;
          question: string;
          answer: string;
          imagePath?: string | null;
          imagePathsJson?: string | null;
          sourceFile?: string | null;
          createdAt: Date;
          updatedAt: Date;
        };
        sourceFile?: string | null;
        scopeLevel?: string | null;
        cityName?: string | null;
        document?: {
          title?: string | null;
          scopeLevel: string;
          cityName?: string | null;
        } | null;
      }> = [];

      for (const top of candidates) {
        const chunkId = String(top.payload.chunkId ?? top.pointId);
        const chunk = chunksById.get(chunkId) ?? chunksByPointId.get(top.pointId);
        if (!chunk) continue;

        const knowledgeItem = chunk.knowledgeItem;
        if (knowledgeItem.status !== "published") continue;
        if (!isChunkVisible(chunk, input.region)) continue;

        evidenceChunks.push(chunk);
        if (evidenceChunks.length >= settings.retrievalTopK) break;
      }

      const primary = evidenceChunks[0];
      if (primary) {
        const knowledgeItem = primary.knowledgeItem;
        const referenceChunkIds = new Set(evidenceChunks.map((chunk) => chunk.id));
        const sourceTitle =
          primary.sourceFile?.trim() ||
          String(primary.document?.title ?? "").trim() ||
          knowledgeItem.sourceFile?.trim() ||
          knowledgeItem.question;

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

        for (const debug of retrievalDebug) {
          if (referenceChunkIds.has(debug.chunkId)) {
            debug.usedAsReference = true;
          }
          if (debug.knowledgeItemId === knowledgeItem.id) {
            debug.createdAt = knowledgeItem.createdAt?.toISOString?.() ?? null;
            debug.updatedAt = knowledgeItem.updatedAt?.toISOString?.() ?? null;
          }
        }

        return {
          sourceType: "kb",
          queryText,
          retrievalDebug,
          knowledgeItem: {
            id: knowledgeItem.id,
            question: sourceTitle,
            answer: knowledgeItem.answer,
            imagePaths,
            createdAt: knowledgeItem.createdAt?.toISOString?.() ?? new Date().toISOString(),
            updatedAt: knowledgeItem.updatedAt?.toISOString?.() ?? new Date().toISOString(),
          },
          referenceSnippets: evidenceChunks.slice(0, 5).map((chunk, index) => {
            const scopeLabel =
              chunk.scopeLevel === "city" || chunk.document?.scopeLevel === "city"
                ? `仅限${chunk.cityName || chunk.document?.cityName || "本市"}`
                : "通用";
            const sourceFile = chunk.sourceFile || `证据 ${index + 1}`;
            return `[来源：${sourceFile}][适用范围：${scopeLabel}]\n${chunk.chunkText ?? ""}`;
          }),
        } satisfies RetrievalDecision;
      }

      const questionText = input.question || queryText;
      if (isSensitiveQuery(questionText)) {
        return {
          sourceType: "sensitive",
          queryText,
          retrievalDebug,
          matchedTerms: matchSensitiveTerms(questionText),
        } satisfies RetrievalDecision;
      }

      return {
        sourceType: fallbackPolicy === "kb_only" ? "refusal" : "llm",
        queryText,
        retrievalDebug,
        refusalReason: fallbackPolicy === "kb_only" ? KNOWLEDGE_ONLY_REFUSAL_TEXT : "",
      } satisfies RetrievalDecision;
    },
    (result) =>
      result.sourceType === "kb"
        ? "知识库命中，进入答案整理"
        : result.sourceType === "refusal"
          ? "强制知识库类问题未命中，拒绝兜底"
          : result.sourceType === "sensitive"
            ? "敏感词命中，仅限知识库回答"
            : "未命中知识库，转入通用药店问答"
  );
}
