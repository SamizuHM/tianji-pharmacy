import { prisma } from "@/lib/db";
import type { ProgressStepKey } from "@/lib/chat-progress";
import {
  buildMultimodalQueryText,
  rewriteRetrievalQueriesWithModel,
  type RetrievalQueryRewrite,
} from "@/lib/openai";
import { embedMultimodal, rerankMultimodal } from "@/lib/retrieval/ml-service";
import { COLLECTION_NAME, qdrant } from "@/lib/retrieval/qdrant";
import { scoreBm25FromTermRows, tokenizeForBm25 } from "@/lib/services/bm25";
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
  keywordScore?: number;
  rrfScore?: number;
  finalScore?: number;
  scopeLevel?: string | null;
  cityName?: string | null;
  sources?: string[];
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

function inferBusinessCategory(text: string) {
  if (/医保|统筹|报销|结算|刷卡|医保卡/.test(text)) return "医保";
  if (/用药|药品|处方|剂量|不良反应|禁忌|过敏|孕妇|儿童|老人/.test(text)) return "用药";
  if (/小票|打印|收银|票据|打印机/.test(text)) return "收银打印";
  return "通用";
}

function resolveFallbackPolicy(plan: QueryPlan): "allow_llm_fallback" | "kb_only" {
  return ["医保", "用药"].includes(plan.businessCategory) ? "kb_only" : "allow_llm_fallback";
}

function expandProfessionalTerms(query: string) {
  const expansionMap: Array<[RegExp, string[]]> = [
    [/安定|地西泮/, ["地西泮", "安定", "苯二氮䓬类", "第二类精神药品", "处方药"]],
    [/处方|方子/, ["处方药", "处方审核", "执业药师", "凭处方销售"]],
    [/医保|刷卡|统筹/, ["医保结算", "医保刷卡", "统筹支付", "报销政策"]],
    [/小票|票据|打印/, ["收银小票", "票据打印", "热敏打印机", "打印异常"]],
    [/编号|文号|文件号|政策号/, ["政策编号", "文件编号", "通知文号"]],
  ];

  return expansionMap.flatMap(([pattern, terms]) => (pattern.test(query) ? terms : []));
}

function splitSubQueries(query: string) {
  return query
    .split(/[？?。；;\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function buildRuleBasedQueryPlan(queryText: string, historyText = ""): QueryPlan {
  const normalizedQuery = queryText.trim() || "用户未输入明确问题";
  const contextAwareQuery = [historyText.trim(), normalizedQuery]
    .filter(Boolean)
    .join("\n当前问题：");
  const businessCategory = inferBusinessCategory(normalizedQuery);
  const synonymMap: Record<string, string[]> = {
    小票: ["收银小票", "打印凭证", "票据", "热敏打印机"],
    打印: ["打印机", "出纸", "票据打印"],
    医保: ["医保结算", "医保刷卡", "统筹支付", "报销"],
    用药: ["药品", "剂量", "禁忌", "不良反应", "处方"],
  };
  const synonyms = Object.entries(synonymMap)
    .filter(([term]) => normalizedQuery.includes(term))
    .flatMap(([, values]) => values);
  const professionalTerms = expandProfessionalTerms(normalizedQuery);
  const terms = Array.from(
    new Set(
      [normalizedQuery, ...professionalTerms]
        .join(" ")
        .split(/[，。；、\s,.!?！？]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
    )
  ).slice(0, 8);
  const variants = Array.from(
    new Set([
      normalizedQuery,
      ...splitSubQueries(normalizedQuery),
      [normalizedQuery, ...synonyms, ...professionalTerms].filter(Boolean).join(" "),
      [businessCategory, normalizedQuery].filter(Boolean).join(" "),
      contextAwareQuery,
    ])
  ).slice(0, 6);

  const bm25Queries = Array.from(
    new Set([
      [normalizedQuery, ...professionalTerms].filter(Boolean).join(" "),
      ...splitSubQueries(normalizedQuery),
      ...professionalTerms,
    ])
  )
    .filter(Boolean)
    .slice(0, 6);

  return {
    normalizedQuery,
    businessCategory,
    mustTerms: terms,
    queryVariants: variants,
    bm25Queries,
  };
}

async function buildQueryPlan(queryText: string, historyText = ""): Promise<QueryPlan> {
  const fallback = buildRuleBasedQueryPlan(queryText, historyText);
  try {
    const rewritten = await rewriteRetrievalQueriesWithModel({ queryText, historyText });
    return queryPlanFromRewrite(rewritten, fallback);
  } catch (error) {
    console.warn("[retrieval] llm query rewrite failed, fallback to rules", error);
    return fallback;
  }
}

function queryPlanFromRewrite(rewritten: RetrievalQueryRewrite, fallback: QueryPlan): QueryPlan {
  const normalizedQuery = rewritten.normalizedQuery.trim() || fallback.normalizedQuery;
  const rewrittenCategory = rewritten.businessCategory.trim() || fallback.businessCategory;
  const businessCategory =
    ["医保", "用药"].includes(rewrittenCategory) ||
    ["医保", "用药"].includes(fallback.businessCategory)
      ? ["医保", "用药"].includes(fallback.businessCategory)
        ? fallback.businessCategory
        : rewrittenCategory
      : rewrittenCategory;
  const mustTerms = Array.from(new Set([...rewritten.mustTerms, ...fallback.mustTerms]))
    .filter(Boolean)
    .slice(0, 8);
  const queryVariants = Array.from(
    new Set([normalizedQuery, ...rewritten.vectorQueries, ...fallback.queryVariants])
  )
    .filter(Boolean)
    .slice(0, 8);
  const bm25Queries = Array.from(
    new Set([normalizedQuery, ...rewritten.keywordQueries, ...fallback.bm25Queries])
  )
    .filter(Boolean)
    .slice(0, 8);

  return {
    normalizedQuery,
    businessCategory,
    mustTerms,
    queryVariants,
    bm25Queries,
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
      if (existing) {
        existing.vectorScore = Math.max(existing.vectorScore, candidate.vectorScore);
        existing.keywordScore = Math.max(existing.keywordScore, candidate.keywordScore);
        existing.rrfScore += rrfScore;
        existing.finalScore =
          existing.rrfScore * scopeWeight(existing, region?.cityName, cityWeight);
        candidate.sources.forEach((source) => existing.sources.add(source));
        return;
      }
      merged.set(candidate.chunkId, {
        ...candidate,
        rrfScore,
        finalScore: rrfScore * scopeWeight(candidate, region?.cityName, cityWeight),
        sources: new Set(candidate.sources),
      });
    });
  }

  return Array.from(merged.values()).sort((a, b) => b.finalScore - a.finalScore);
}

function buildFullTextQuery(plan: QueryPlan) {
  return Array.from(new Set([...plan.bm25Queries, ...plan.mustTerms, plan.businessCategory]))
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
  const fallbackPolicy = resolveFallbackPolicy(queryPlan);
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

  const ranked = searchResult
    .map((item, index) => ({
      pointId: item.pointId,
      payload: item.payload as Record<string, unknown>,
      vectorScore: item.vectorScore,
      keywordScore: item.keywordScore,
      rrfScore: item.rrfScore,
      finalScore: item.finalScore,
      rerankScore: rerankResult.scores[index] ?? 0,
      sources: Array.from(item.sources),
    }))
    .sort((a, b) => b.rerankScore + b.finalScore - (a.rerankScore + a.finalScore))
    .slice(0, settings.rerankTopN);

  const retrievalDebug: RetrievalDebugRecord[] = ranked.map((item) => ({
    knowledgeItemId: String(item.payload.knowledgeItemId ?? ""),
    chunkId: String(item.payload.chunkId ?? item.pointId),
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
    createdAt: null,
    updatedAt: null,
  }));

  return runProgressStep(
    hooks,
    "decide_source",
    async () => {
      const candidates = ranked.filter((item) => item.rerankScore >= settings.kbHitThreshold);

      const evidenceChunks: Array<{
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
        const chunk =
          (await prisma.knowledgeChunk.findUnique({
            where: { id: String(top.payload.chunkId ?? top.pointId) },
            include: {
              knowledgeItem: true,
              document: true,
            },
          })) ??
          (await prisma.knowledgeChunk.findUnique({
            where: { qdrantPointId: top.pointId },
            include: {
              knowledgeItem: true,
              document: true,
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
        if (!isChunkVisible(chunk, input.region)) {
          continue;
        }

        evidenceChunks.push(chunk);
        if (evidenceChunks.length < settings.retrievalTopK) {
          continue;
        }
        break;
      }

      const primary = evidenceChunks[0];
      if (primary) {
        const knowledgeItem = primary.knowledgeItem;
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

        // Fill createdAt/updatedAt into retrievalDebug for matching items
        for (const debug of retrievalDebug) {
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
          : "未命中知识库，转入通用药店问答"
  );
}
