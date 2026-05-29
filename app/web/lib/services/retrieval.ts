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
  finalScore?: number;
  scopeLevel?: string | null;
  cityCode?: string | null;
  sources?: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

type QueryPlan = {
  normalizedQuery: string;
  businessCategory: string;
  answerPolicy: "allow_llm_fallback" | "kb_only";
  mustTerms: string[];
  queryVariants: string[];
  bm25Queries: string[];
};

type RegionContext = {
  storeId?: string | null;
  provinceCode?: string | null;
  cityCode?: string | null;
  districtCode?: string | null;
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

function buildQueryPlan(queryText: string, historyText = ""): QueryPlan {
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
    answerPolicy: ["医保", "用药"].includes(businessCategory) ? "kb_only" : "allow_llm_fallback",
    mustTerms: terms,
    queryVariants: variants,
    bm25Queries,
  };
}

function scopeWeight(
  candidate: RetrievalCandidate,
  currentCityCode?: string | null,
  cityWeight = 1.3
) {
  const scopeLevel = String(candidate.payload.scopeLevel ?? "");
  const cityCode = candidate.payload.cityCode ? String(candidate.payload.cityCode) : null;
  if (scopeLevel === "city" && cityCode && cityCode === currentCityCode) {
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
          existing.rrfScore * scopeWeight(existing, region?.cityCode, cityWeight);
        candidate.sources.forEach((source) => existing.sources.add(source));
        return;
      }
      merged.set(candidate.chunkId, {
        ...candidate,
        rrfScore,
        finalScore: rrfScore * scopeWeight(candidate, region?.cityCode, cityWeight),
        sources: new Set(candidate.sources),
      });
    });
  }

  return Array.from(merged.values()).sort((a, b) => b.finalScore - a.finalScore);
}

function tokenizeForBm25(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[，。；、\s,.!?！？:：()（）【】[\]<>《》"'“”‘’]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
    )
  );
}

function scoreBm25Like(text: string, queryTerms: string[]) {
  if (!queryTerms.length) return 0;
  const normalizedText = text.toLowerCase();
  return queryTerms.reduce((score, term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tf = normalizedText.match(new RegExp(escaped, "g"))?.length ?? 0;
    if (!tf) return score;
    return score + ((tf * 2.2) / (tf + 1.2)) * Math.log(1 + 1000 / (1 + term.length));
  }, 0);
}

async function keywordRecall(
  plan: QueryPlan,
  limit: number,
  region: RegionContext | undefined
): Promise<RetrievalCandidate[]> {
  const terms = Array.from(
    new Set([
      ...plan.mustTerms,
      ...plan.bm25Queries.flatMap(tokenizeForBm25),
      plan.businessCategory,
    ])
  ).filter(Boolean);
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
          { bm25SearchText: { contains: term } },
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
    .map((chunk) => {
      const searchText = [
        chunk.bm25SearchText,
        chunk.chunkText,
        chunk.knowledgeItem.question,
        chunk.knowledgeItem.answer,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        pointId: chunk.qdrantPointId,
        chunkId: chunk.id,
        payload: {
          knowledgeItemId: chunk.knowledgeItemId,
          chunkId: chunk.id,
          chunkText: chunk.chunkText,
          question: chunk.knowledgeItem.question,
          answer: chunk.knowledgeItem.answer,
          sourceFile: chunk.sourceFile ?? chunk.knowledgeItem.sourceFile,
          scopeLevel: chunk.scopeLevel,
          cityCode: chunk.cityCode,
          cityName: chunk.cityName,
          overrideScope: chunk.overrideScope,
          imagePaths: chunk.knowledgeItem.imagePathsJson
            ? JSON.parse(chunk.knowledgeItem.imagePathsJson)
            : chunk.knowledgeItem.imagePath
              ? [chunk.knowledgeItem.imagePath]
              : [],
        },
        vectorScore: 0,
        keywordScore: scoreBm25Like(searchText, terms),
        rrfScore: 0,
        finalScore: 0,
        sources: new Set<"vector" | "keyword">(["keyword"]),
      };
    })
    .sort((a, b) => b.keywordScore - a.keywordScore)
    .slice(0, limit);
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

function payloadScopeVisible(payload: Record<string, unknown>, region: RegionContext | undefined) {
  const scopeLevel = String(payload.scopeLevel ?? "national");
  if (scopeLevel === "national" || scopeLevel === "common") {
    return true;
  }
  if (!region) {
    return false;
  }
  if (scopeLevel === "province") return String(payload.provinceCode ?? "") === region.provinceCode;
  if (scopeLevel === "city") return String(payload.cityCode ?? "") === region.cityCode;
  if (scopeLevel === "district") return String(payload.districtCode ?? "") === region.districtCode;
  if (scopeLevel === "store") return String(payload.storeId ?? "") === region.storeId;
  return false;
}

function qdrantScopeFilter(region: RegionContext | undefined) {
  const should: Array<Record<string, unknown>> = [
    { key: "scopeLevel", match: { value: "national" } },
    { key: "scopeLevel", match: { value: "common" } },
  ];

  if (region?.provinceCode) {
    should.push({
      must: [
        { key: "scopeLevel", match: { value: "province" } },
        { key: "provinceCode", match: { value: region.provinceCode } },
      ],
    });
  }
  if (region?.cityCode) {
    should.push({
      must: [
        { key: "scopeLevel", match: { value: "city" } },
        { key: "cityCode", match: { value: region.cityCode } },
      ],
    });
  }
  if (region?.districtCode) {
    should.push({
      must: [
        { key: "scopeLevel", match: { value: "district" } },
        { key: "districtCode", match: { value: region.districtCode } },
      ],
    });
  }
  if (region?.storeId) {
    should.push({
      must: [
        { key: "scopeLevel", match: { value: "store" } },
        { key: "storeId", match: { value: region.storeId } },
      ],
    });
  }

  return { should };
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
  const queryPlan = buildQueryPlan(queryText, historyText);
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
          filter: qdrantScopeFilter(input.region),
          limit: Math.max(settings.retrievalTopK, settings.rerankTopN * 2),
        });
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
    question: String(item.payload.question ?? ""),
    answer: String(item.payload.answer ?? ""),
    sourceFile: item.payload.sourceFile ? String(item.payload.sourceFile) : null,
    rerankScore: item.rerankScore,
    vectorScore: item.vectorScore,
    keywordScore: item.keywordScore,
    rrfScore: item.rrfScore,
    finalScore: item.finalScore,
    scopeLevel: item.payload.scopeLevel ? String(item.payload.scopeLevel) : null,
    cityCode: item.payload.cityCode ? String(item.payload.cityCode) : null,
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
          createdAt: Date;
          updatedAt: Date;
        };
        sourceFile?: string | null;
        scopeLevel?: string | null;
        cityCode?: string | null;
        cityName?: string | null;
        document?: {
          scopeLevel: string;
          provinceCode?: string | null;
          cityCode?: string | null;
          districtCode?: string | null;
          storeId?: string | null;
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
        if (!isDocumentVisible(chunk.document, input.region)) {
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
            question: knowledgeItem.question,
            answer: knowledgeItem.answer,
            imagePaths,
            createdAt: knowledgeItem.createdAt?.toISOString?.() ?? new Date().toISOString(),
            updatedAt: knowledgeItem.updatedAt?.toISOString?.() ?? new Date().toISOString(),
          },
          referenceSnippets: evidenceChunks.slice(0, 5).map((chunk, index) => {
            const scopeLabel =
              chunk.scopeLevel === "city" || chunk.document?.scopeLevel === "city"
                ? `仅限${chunk.cityName || chunk.cityCode || chunk.document?.cityCode || "本市"}`
                : "通用";
            const sourceFile = chunk.sourceFile || `证据 ${index + 1}`;
            return `[来源：${sourceFile}][适用范围：${scopeLabel}]\n${chunk.chunkText ?? ""}`;
          }),
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
