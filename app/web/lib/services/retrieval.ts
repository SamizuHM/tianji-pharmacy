import type { Prisma } from "@prisma/client";

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
  keywordScore?: number;
  rrfScore?: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type QueryPlan = {
  normalizedQuery: string;
  businessCategory: string;
  answerPolicy: "allow_llm_fallback" | "kb_only";
  mustTerms: string[];
  queryVariants: string[];
};

type RegionContext = {
  storeId?: string | null;
  provinceCode?: string | null;
  cityCode?: string | null;
  districtCode?: string | null;
};

type RetrievalCandidate = {
  pointId: string;
  payload: Record<string, unknown>;
  vectorScore: number;
  keywordScore: number;
  rrfScore: number;
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

function buildQueryPlan(queryText: string): QueryPlan {
  const normalizedQuery = queryText.trim() || "用户未输入明确问题";
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
  const terms = Array.from(
    new Set(
      normalizedQuery
        .split(/[，。；、\s,.!?！？]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
    )
  ).slice(0, 8);
  const variants = Array.from(
    new Set([
      normalizedQuery,
      [normalizedQuery, ...synonyms].filter(Boolean).join(" "),
      [businessCategory, normalizedQuery].filter(Boolean).join(" "),
    ])
  ).slice(0, 3);

  return {
    normalizedQuery,
    businessCategory,
    answerPolicy: ["医保", "用药"].includes(businessCategory) ? "kb_only" : "allow_llm_fallback",
    mustTerms: terms,
    queryVariants: variants,
  };
}

function mergeCandidates(groups: RetrievalCandidate[][]) {
  const merged = new Map<string, RetrievalCandidate>();
  const rrfK = 60;

  for (const group of groups) {
    group.forEach((candidate, index) => {
      const existing = merged.get(candidate.pointId);
      const rrfScore = 1 / (rrfK + index + 1);
      if (existing) {
        existing.vectorScore = Math.max(existing.vectorScore, candidate.vectorScore);
        existing.keywordScore = Math.max(existing.keywordScore, candidate.keywordScore);
        existing.rrfScore += rrfScore;
        candidate.sources.forEach((source) => existing.sources.add(source));
        return;
      }
      merged.set(candidate.pointId, {
        ...candidate,
        rrfScore,
        sources: new Set(candidate.sources),
      });
    });
  }

  return Array.from(merged.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

async function keywordRecall(
  plan: QueryPlan,
  limit: number,
  region: RegionContext | undefined
): Promise<RetrievalCandidate[]> {
  const terms = Array.from(new Set([...plan.mustTerms, plan.businessCategory])).filter(Boolean);
  if (!terms.length) {
    return [];
  }

  const chunks =
    (await prisma.knowledgeChunk.findMany({
      where: {
        enabled: true,
        knowledgeItem: { status: "published" },
        AND: [
          {
            OR: [{ documentId: null }, { document: { is: documentVisibilityWhere(region) } }],
          },
        ],
        OR: terms.flatMap((term) => [
          { chunkText: { contains: term } },
          { knowledgeItem: { question: { contains: term } } },
          { knowledgeItem: { answer: { contains: term } } },
        ]),
      },
      include: { knowledgeItem: true },
      orderBy: [{ createdAt: "desc" }],
      take: limit,
    })) ?? [];

  return chunks
    .filter((chunk) => chunk.knowledgeItem)
    .map((chunk, index) => ({
      pointId: chunk.qdrantPointId,
      payload: {
        knowledgeItemId: chunk.knowledgeItemId,
        chunkText: chunk.chunkText,
        question: chunk.knowledgeItem.question,
        answer: chunk.knowledgeItem.answer,
        sourceFile: chunk.sourceFile ?? chunk.knowledgeItem.sourceFile,
        imagePaths: chunk.knowledgeItem.imagePathsJson
          ? JSON.parse(chunk.knowledgeItem.imagePathsJson)
          : chunk.knowledgeItem.imagePath
            ? [chunk.knowledgeItem.imagePath]
            : [],
      },
      vectorScore: 0,
      keywordScore: 1 / (index + 1),
      rrfScore: 0,
      sources: new Set<"vector" | "keyword">(["keyword"]),
    }));
}

function documentVisibilityWhere(
  region: RegionContext | undefined
): Prisma.KnowledgeDocumentWhereInput {
  if (!region) {
    return { scopeLevel: "national" };
  }

  return {
    OR: [
      { scopeLevel: "national" },
      { scopeLevel: "province", provinceCode: region.provinceCode ?? "__none__" },
      { scopeLevel: "city", cityCode: region.cityCode ?? "__none__" },
      { scopeLevel: "district", districtCode: region.districtCode ?? "__none__" },
      { scopeLevel: "store", storeId: region.storeId ?? "__none__" },
    ],
  };
}

function isDocumentVisible(
  document:
    | {
        scopeLevel: string;
        provinceCode?: string | null;
        cityCode?: string | null;
        districtCode?: string | null;
        storeId?: string | null;
      }
    | null
    | undefined,
  region: RegionContext | undefined
) {
  if (!document || document.scopeLevel === "national") {
    return true;
  }
  if (!region) {
    return false;
  }
  if (document.scopeLevel === "province") return document.provinceCode === region.provinceCode;
  if (document.scopeLevel === "city") return document.cityCode === region.cityCode;
  if (document.scopeLevel === "district") return document.districtCode === region.districtCode;
  if (document.scopeLevel === "store") return document.storeId === region.storeId;
  return false;
}

async function resolveAnswerPolicy(plan: QueryPlan) {
  const rules =
    (await prisma.answerPolicyRule.findMany({
      where: {
        enabled: true,
        businessCategory: plan.businessCategory,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 5,
    })) ?? [];

  const matched = rules.find((rule) => {
    if (!rule.matchTermsJson) {
      return true;
    }
    try {
      const terms = JSON.parse(rule.matchTermsJson) as string[];
      return terms.some((term) => plan.normalizedQuery.includes(term));
    } catch {
      return false;
    }
  });

  return matched?.answerPolicy ?? plan.answerPolicy;
}

export async function retrieveAnswer(
  input: { question: string; imagePaths: string[]; region?: RegionContext },
  hooks?: RetrievalProgressHooks
): Promise<RetrievalDecision> {
  const settings = await getRuntimeSettings();
  const queryText = await runProgressStep(hooks, "rewrite_query", () =>
    buildMultimodalQueryText({
      question: input.question,
      imagePaths: input.imagePaths,
    })
  );

  const queryPlan = buildQueryPlan(queryText);
  const answerPolicy = await resolveAnswerPolicy(queryPlan);
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
        const searchResult = await qdrant.search(COLLECTION_NAME, {
          vector,
          with_payload: true,
          limit: Math.max(settings.retrievalTopK, settings.rerankTopN * 2),
        });
        return searchResult.map((item) => ({
          pointId: String(item.id),
          payload: item.payload as Record<string, unknown>,
          vectorScore: item.score ?? 0,
          keywordScore: 0,
          rrfScore: 0,
          sources: new Set<"vector" | "keyword">(["vector"]),
        }));
      })
    )
  );
  const keywordCandidates = await keywordRecall(
    queryPlan,
    Math.max(settings.retrievalTopK, settings.rerankTopN * 2),
    input.region
  );
  const searchResult = mergeCandidates([...vectorGroups, keywordCandidates]).slice(
    0,
    Math.max(settings.retrievalTopK * 3, settings.rerankTopN * 4)
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
      pointId: item.pointId,
      payload: item.payload as Record<string, unknown>,
      vectorScore: item.vectorScore,
      keywordScore: item.keywordScore,
      rrfScore: item.rrfScore,
      rerankScore: rerankResult.scores[index] ?? 0,
    }))
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, settings.rerankTopN);

  const retrievalDebug: RetrievalDebugRecord[] = ranked.map((item) => ({
    knowledgeItemId: String(item.payload.knowledgeItemId ?? ""),
    chunkId: item.pointId,
    question: String(item.payload.question ?? ""),
    answer: String(item.payload.answer ?? ""),
    sourceFile: item.payload.sourceFile ? String(item.payload.sourceFile) : null,
    rerankScore: item.rerankScore,
    vectorScore: item.vectorScore,
    keywordScore: item.keywordScore,
    rrfScore: item.rrfScore,
    createdAt: null,
    updatedAt: null,
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
        if (!isDocumentVisible(chunk.document, input.region)) {
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

        // Fill createdAt/updatedAt into retrievalDebug for matching items
        for (const debug of retrievalDebug) {
          if (debug.knowledgeItemId === knowledgeItem.id) {
            debug.createdAt = knowledgeItem.createdAt?.toISOString?.() ?? null;
            debug.updatedAt = knowledgeItem.updatedAt?.toISOString?.() ?? null;
          }
        }

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
            createdAt: knowledgeItem.createdAt?.toISOString?.() ?? new Date().toISOString(),
            updatedAt: knowledgeItem.updatedAt?.toISOString?.() ?? new Date().toISOString(),
          },
          referenceSnippets: siblingChunks.map((item) => item.chunkText).slice(0, 3),
        } satisfies RetrievalDecision;
      }

      return {
        sourceType: answerPolicy === "kb_only" ? "refusal" : "llm",
        queryText,
        retrievalDebug,
        refusalReason:
          answerPolicy === "kb_only"
            ? `当前问题属于${queryPlan.businessCategory}类问题，但知识库中没有检索到足够匹配的依据。`
            : "",
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
