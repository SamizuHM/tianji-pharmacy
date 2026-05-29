import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import {
  KnowledgeIndexTaskStatus,
  KnowledgeIndexTaskType,
  KnowledgeSourceType,
  KnowledgeStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { repoRoot } from "@/lib/env";
import { parseDocument } from "@/lib/retrieval/ml-service";
import {
  DEFAULT_DOCUMENT_CHUNKING_CONFIG,
  DEFAULT_QA_CHUNKING_CONFIG,
  chunkPlainText,
  chunkQaItems,
  sanitizeChunkingConfig,
  type ChunkPlan,
  type DocumentChunkingConfig,
} from "@/lib/services/document-chunking";
import {
  buildStablePointId,
  enqueueUpsertTasksForChunkIds,
  prepareKnowledgeChunkUpsertTasks,
  tryDrainKnowledgeIndexTasks,
  type KnowledgeChunkProjectionSource,
} from "@/lib/services/knowledge-index";

type UpsertKnowledgeInput = {
  categoryL1: string;
  categoryL2: string;
  question: string;
  answer: string;
  tags: string[];
  status?: KnowledgeStatus;
  sourceType: KnowledgeSourceType;
  sourceTicketId?: string;
  sourceFile?: string;
  docType?: string;
  documentId?: string | null;
  chunkSetId?: string | null;
  businessCategory?: string;
  answerPolicy?: "allow_llm_fallback" | "kb_only";
  scopeLevel?: "national" | "province" | "city" | "district" | "store";
  provinceCode?: string | null;
  provinceName?: string | null;
  cityCode?: string | null;
  cityName?: string | null;
  districtCode?: string | null;
  districtName?: string | null;
  storeId?: string | null;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  imagePath?: string | null;
  imagePaths?: string[];
  originalText: string;
  normalizedText: string;
  chunkTexts: string[];
  chunkPlans?: ChunkPlan[];
};

export type DocumentImportOptions = {
  sourceFileNameByPath?: Record<string, string>;
  uploadedByUserId?: string;
  businessCategory?: string;
  answerPolicy?: "allow_llm_fallback" | "kb_only";
  scopeLevel?: "national" | "province" | "city" | "district" | "store";
  provinceCode?: string | null;
  provinceName?: string | null;
  cityCode?: string | null;
  cityName?: string | null;
  districtCode?: string | null;
  districtName?: string | null;
  storeId?: string | null;
  chunkingConfig?: Partial<DocumentChunkingConfig>;
};

export type UpsertQaKnowledgeDocumentInput = Omit<
  UpsertKnowledgeInput,
  "sourceType" | "originalText" | "normalizedText" | "chunkTexts" | "chunkPlans"
> & {
  sourceType?: KnowledgeSourceType;
  originalText?: string;
  normalizedText?: string;
};

export type KnowledgeListParams = {
  q?: string;
  category?: string;
  status?: KnowledgeStatus | "all";
  page?: number;
  pageSize?: number;
};

type ExistingKnowledgeItem = Awaited<ReturnType<typeof findExistingKnowledgeItem>>;

function qaText(input: { question: string; answer: string }) {
  return `问题：${input.question}\n答案：${input.answer}`;
}

function qaDocumentTitle(input: { question: string; sourceTicketId?: string }) {
  if (input.sourceTicketId) return `工单知识：${input.question}`.slice(0, 120);
  return `QA：${input.question}`.slice(0, 120);
}

function buildTagsJson(tags: string[]) {
  return JSON.stringify(Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))));
}

function buildImagePaths(input: UpsertKnowledgeInput) {
  return input.imagePaths?.filter(Boolean) ?? [];
}

function inferBusinessCategory(input: { categoryL1?: string; categoryL2?: string; text?: string }) {
  const text = [input.categoryL1, input.categoryL2, input.text].filter(Boolean).join("\n");
  if (/医保|统筹|报销|结算|刷卡|医保卡/.test(text)) return "医保";
  if (/用药|药品|处方|剂量|不良反应|禁忌|过敏|孕妇|儿童|老人/.test(text)) return "用药";
  if (/小票|打印|收银|票据|打印机/.test(text)) return "收银打印";
  return input.categoryL1 || "通用";
}

function inferAnswerPolicy(businessCategory: string): "allow_llm_fallback" | "kb_only" {
  return ["医保", "用药"].includes(businessCategory) ? "kb_only" : "allow_llm_fallback";
}

function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function toNullableIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function clampPage(value: number | undefined) {
  return Math.max(1, Number.isFinite(value ?? 1) ? Number(value ?? 1) : 1);
}

function clampPageSize(value: number | undefined) {
  const size = Number.isFinite(value ?? 10) ? Number(value ?? 10) : 10;
  return Math.min(50, Math.max(5, size));
}

function buildKnowledgeWhere(params: KnowledgeListParams): Prisma.KnowledgeItemWhereInput {
  const and: Prisma.KnowledgeItemWhereInput[] = [];
  const q = params.q?.trim();

  if (params.status && params.status !== "all") {
    and.push({ status: params.status });
  }

  if (params.category && params.category !== "all") {
    and.push({
      OR: [{ categoryL1: params.category }, { categoryL2: params.category }],
    });
  }

  if (q) {
    and.push({
      OR: [
        { question: { contains: q } },
        { answer: { contains: q } },
        { categoryL1: { contains: q } },
        { categoryL2: { contains: q } },
        { sourceFile: { contains: q } },
      ],
    });
  }

  return and.length ? { AND: and } : {};
}

function buildChunkMetadata(
  itemId: string,
  chunkId: string,
  chunkIndex: number,
  chunkText: string,
  input: UpsertKnowledgeInput
) {
  return {
    knowledgeItemId: itemId,
    documentId: input.documentId ?? null,
    chunkSetId: input.chunkSetId ?? null,
    chunkId,
    chunkIndex,
    chunkText,
    question: input.question,
    answer: input.answer,
    sourceFile: input.sourceFile ?? null,
    docType: input.docType ?? null,
    categoryL1: input.categoryL1,
    categoryL2: input.categoryL2,
    businessCategory: input.businessCategory ?? inferBusinessCategory(input),
    answerPolicy:
      input.answerPolicy ?? inferAnswerPolicy(input.businessCategory ?? input.categoryL1),
    scopeLevel: input.scopeLevel ?? "national",
    provinceCode: input.provinceCode ?? null,
    provinceName: input.provinceName ?? null,
    cityCode: input.cityCode ?? null,
    cityName: input.cityName ?? null,
    districtCode: input.districtCode ?? null,
    districtName: input.districtName ?? null,
    storeId: input.storeId ?? null,
    effectiveFrom: toNullableIso(input.effectiveFrom),
    effectiveTo: toNullableIso(input.effectiveTo),
    imagePath: input.imagePath ?? null,
    imagePaths: buildImagePaths(input),
  };
}

async function findExistingKnowledgeItem(input: {
  question: string;
  sourceFile?: string;
  sourceTicketId?: string;
  sourceType: KnowledgeSourceType;
}) {
  return prisma.knowledgeItem.findFirst({
    where: {
      question: input.question,
      sourceFile: input.sourceFile ?? null,
      sourceTicketId: input.sourceTicketId ?? null,
      sourceType: input.sourceType,
    },
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" },
      },
    },
  });
}

async function persistKnowledgeItem(input: UpsertKnowledgeInput, existing: ExistingKnowledgeItem) {
  const itemId = existing?.id ?? crypto.randomUUID();
  const existingChunks = existing?.chunks ?? [];
  const imagePaths = buildImagePaths(input);

  const inputChunkPlans: ChunkPlan[] = input.chunkPlans?.length
    ? input.chunkPlans
    : input.chunkTexts.map((text) => ({ text }));

  const chunkPlans = inputChunkPlans.map((plan, chunkIndex) => {
    const existingChunk = existingChunks[chunkIndex];
    const chunkId = existingChunk?.id ?? crypto.randomUUID();
    const businessCategory = input.businessCategory ?? inferBusinessCategory(input);
    const chunkText = plan.text;
    return {
      id: chunkId,
      knowledgeItemId: itemId,
      documentId: input.documentId ?? null,
      chunkSetId: input.chunkSetId ?? null,
      chunkIndex,
      chunkText,
      originalText: input.originalText,
      sourceFile: input.sourceFile,
      docType: input.docType,
      sectionPath: plan.sectionPath ?? `${input.categoryL1} / ${input.categoryL2}`,
      tokenCount: chunkText.length,
      enabled: true,
      qdrantPointId: buildStablePointId(chunkId),
      metadataJson: JSON.stringify({
        ...buildChunkMetadata(itemId, chunkId, chunkIndex, chunkText, {
          ...input,
          businessCategory,
          answerPolicy: input.answerPolicy ?? inferAnswerPolicy(businessCategory),
        }),
        ...(plan.metadata ?? {}),
      }),
    };
  });
  const staleChunks = existingChunks.filter(
    (chunk) => !chunkPlans.some((plan) => plan.id === chunk.id)
  );
  const taskSources: KnowledgeChunkProjectionSource[] = chunkPlans.map((chunk) => ({
    documentId: chunk.documentId,
    chunkSetId: chunk.chunkSetId,
    knowledgeItemId: itemId,
    chunkId: chunk.id,
    chunkIndex: chunk.chunkIndex,
    chunkText: chunk.chunkText,
    sourceFile: chunk.sourceFile ?? null,
    docType: chunk.docType ?? null,
    businessCategory: input.businessCategory ?? inferBusinessCategory(input),
    answerPolicy:
      input.answerPolicy ??
      inferAnswerPolicy(input.businessCategory ?? inferBusinessCategory(input)),
    scopeLevel: input.scopeLevel ?? "national",
    provinceCode: input.provinceCode ?? null,
    cityCode: input.cityCode ?? null,
    districtCode: input.districtCode ?? null,
    storeId: input.storeId ?? null,
    effectiveFrom: toNullableIso(input.effectiveFrom),
    effectiveTo: toNullableIso(input.effectiveTo),
    knowledgeItem: {
      question: input.question,
      answer: input.answer,
      sourceFile: input.sourceFile ?? null,
      docType: input.docType ?? null,
      categoryL1: input.categoryL1,
      categoryL2: input.categoryL2,
      imagePath: input.imagePath ?? null,
      imagePaths,
    },
  }));
  const upsertTasks = await prepareKnowledgeChunkUpsertTasks(taskSources);

  const item = await prisma.$transaction(async (tx) => {
    const itemData = {
      categoryL1: input.categoryL1,
      categoryL2: input.categoryL2,
      question: input.question,
      answer: input.answer,
      tagsJson: buildTagsJson(input.tags),
      status: input.status ?? existing?.status ?? "published",
      sourceType: input.sourceType,
      sourceTicketId: input.sourceTicketId ?? null,
      sourceFile: input.sourceFile ?? null,
      docType: input.docType ?? null,
      documentId: input.documentId ?? null,
      imagePath: input.imagePath ?? null,
      imagePathsJson: imagePaths.length ? JSON.stringify(imagePaths) : null,
    };

    if (existing) {
      await tx.knowledgeItem.update({
        where: { id: existing.id },
        data: itemData,
      });
    } else {
      await tx.knowledgeItem.create({
        data: {
          id: itemId,
          ...itemData,
        },
      });
    }

    for (const chunk of chunkPlans) {
      await tx.knowledgeChunk.upsert({
        where: { id: chunk.id },
        update: {
          knowledgeItemId: chunk.knowledgeItemId,
          chunkIndex: chunk.chunkIndex,
          chunkText: chunk.chunkText,
          originalText: chunk.originalText,
          documentId: chunk.documentId,
          chunkSetId: chunk.chunkSetId,
          sourceFile: chunk.sourceFile ?? null,
          docType: chunk.docType ?? null,
          sectionPath: chunk.sectionPath,
          tokenCount: chunk.tokenCount,
          enabled: chunk.enabled,
          qdrantPointId: chunk.qdrantPointId,
          metadataJson: chunk.metadataJson,
        },
        create: chunk,
      });
    }

    if (staleChunks.length) {
      await tx.knowledgeChunk.deleteMany({
        where: {
          id: { in: staleChunks.map((chunk) => chunk.id) },
        },
      });
    }

    const taskData = [
      ...upsertTasks.map((task) => ({
        taskType: KnowledgeIndexTaskType.upsert,
        status: KnowledgeIndexTaskStatus.pending,
        knowledgeItemId: task.knowledgeItemId,
        chunkId: task.chunkId,
        pointId: task.pointId,
        payloadJson: task.payloadJson,
      })),
      ...staleChunks.map((chunk) => ({
        taskType: KnowledgeIndexTaskType.delete,
        status: KnowledgeIndexTaskStatus.pending,
        knowledgeItemId: existing?.id ?? itemId,
        chunkId: chunk.id,
        pointId: chunk.qdrantPointId,
        payloadJson: JSON.stringify({ reason: "stale_chunk_delete" }),
      })),
    ];

    if (taskData.length) {
      await tx.knowledgeIndexTask.createMany({
        data: taskData,
      });
    }

    return tx.knowledgeItem.findUniqueOrThrow({
      where: { id: itemId },
    });
  });

  await tryDrainKnowledgeIndexTasks({
    limit: Math.max(20, upsertTasks.length + staleChunks.length),
  });

  return item;
}

export async function upsertKnowledgeItem(input: UpsertKnowledgeInput) {
  const existing = await findExistingKnowledgeItem({
    question: input.question,
    sourceFile: input.sourceFile,
    sourceTicketId: input.sourceTicketId,
    sourceType: input.sourceType,
  });

  return persistKnowledgeItem(input, existing);
}

async function ensureQaDocumentShell(input: {
  existing?: ExistingKnowledgeItem;
  sourceType: KnowledgeSourceType;
  sourceTicketId?: string;
  sourceFile?: string;
  uploadedByUserId?: string;
  categoryL1: string;
  categoryL2: string;
  question: string;
  answer: string;
  businessCategory?: string;
  answerPolicy?: "allow_llm_fallback" | "kb_only";
  scopeLevel?: "national" | "province" | "city" | "district" | "store";
  provinceCode?: string | null;
  provinceName?: string | null;
  cityCode?: string | null;
  cityName?: string | null;
  districtCode?: string | null;
  districtName?: string | null;
  storeId?: string | null;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  imagePaths?: string[];
}) {
  const activeChunkSet = input.existing?.documentId
    ? await prisma.knowledgeChunkSet.findFirst({
        where: { documentId: input.existing.documentId, isActive: true },
        orderBy: { createdAt: "desc" },
      })
    : null;

  if (input.existing?.documentId && activeChunkSet) {
    const businessCategory =
      input.businessCategory ??
      inferBusinessCategory({
        categoryL1: input.categoryL1,
        categoryL2: input.categoryL2,
        text: qaText(input),
      });
    await prisma.knowledgeDocument.update({
      where: { id: input.existing.documentId },
      data: {
        title: qaDocumentTitle(input),
        businessCategory,
        answerPolicy: input.answerPolicy ?? inferAnswerPolicy(businessCategory),
        scopeLevel: input.scopeLevel ?? "national",
        provinceCode: input.provinceCode ?? null,
        provinceName: input.provinceName ?? null,
        cityCode: input.cityCode ?? null,
        cityName: input.cityName ?? null,
        districtCode: input.districtCode ?? null,
        districtName: input.districtName ?? null,
        storeId: input.storeId ?? null,
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveTo: input.effectiveTo ?? null,
        status: "published",
      },
    });
    return { documentId: input.existing.documentId, chunkSetId: activeChunkSet.id };
  }

  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const parseRunId = crypto.randomUUID();
  const chunkSetId = crypto.randomUUID();
  const text = qaText(input);
  const businessCategory =
    input.businessCategory ??
    inferBusinessCategory({
      categoryL1: input.categoryL1,
      categoryL2: input.categoryL2,
      text,
    });

  await prisma.$transaction(async (tx) => {
    await tx.knowledgeDocument.create({
      data: {
        id: documentId,
        title: qaDocumentTitle(input),
        sourceType: input.sourceType,
        sourceFile: input.sourceFile ?? null,
        mimeType: "qa",
        businessCategory,
        answerPolicy: input.answerPolicy ?? inferAnswerPolicy(businessCategory),
        scopeLevel: input.scopeLevel ?? "national",
        provinceCode: input.provinceCode ?? null,
        provinceName: input.provinceName ?? null,
        cityCode: input.cityCode ?? null,
        cityName: input.cityName ?? null,
        districtCode: input.districtCode ?? null,
        districtName: input.districtName ?? null,
        storeId: input.storeId ?? null,
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveTo: input.effectiveTo ?? null,
        status: "published",
      },
    });
    await tx.knowledgeDocumentVersion.create({
      data: {
        id: versionId,
        documentId,
        originalFilePath: null,
        sourceFileName: input.sourceFile ?? qaDocumentTitle(input),
        contentHash: hashText(text),
        uploadedByUserId: input.uploadedByUserId ?? null,
      },
    });
    await tx.knowledgeParseRun.create({
      data: {
        id: parseRunId,
        documentId,
        documentVersionId: versionId,
        parserType: "legacy_qa",
        status: "success",
        extractedText: text,
        structuredJson: JSON.stringify({
          question: input.question,
          answer: input.answer,
          imagePaths: input.imagePaths ?? [],
        }),
      },
    });
    await tx.knowledgeChunkSet.create({
      data: {
        id: chunkSetId,
        documentId,
        parseRunId,
        chunkStrategy: "qa",
        configJson: JSON.stringify(DEFAULT_QA_CHUNKING_CONFIG),
        isActive: true,
      },
    });
  });

  return { documentId, chunkSetId };
}

export async function upsertQaKnowledgeDocument(input: UpsertQaKnowledgeDocumentInput) {
  const sourceType = input.sourceType ?? "manual_qa";
  const originalText = input.originalText ?? qaText(input);
  const normalizedText = input.normalizedText ?? originalText;
  const existing = await findExistingKnowledgeItem({
    question: input.question,
    sourceFile: input.sourceFile,
    sourceTicketId: input.sourceTicketId,
    sourceType,
  });
  const shell = await ensureQaDocumentShell({
    existing,
    sourceType,
    ...input,
  });

  return persistKnowledgeItem(
    {
      ...input,
      sourceType,
      docType: input.docType ?? "qa",
      documentId: shell.documentId,
      chunkSetId: shell.chunkSetId,
      originalText,
      normalizedText,
      chunkTexts: [qaText(input)],
      chunkPlans: chunkQaItems(
        [
          {
            question: input.question,
            answer: input.answer,
            categoryL1: input.categoryL1,
            categoryL2: input.categoryL2,
            tags: input.tags,
          },
        ],
        DEFAULT_QA_CHUNKING_CONFIG
      ),
    },
    existing
  );
}

export async function ensureKnowledgeItemsHaveDocuments(limit = 500) {
  const items = await prisma.knowledgeItem.findMany({
    where: { documentId: null },
    include: { chunks: { orderBy: { chunkIndex: "asc" } } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const touchedChunkIds: string[] = [];
  for (const item of items) {
    const shell = await ensureQaDocumentShell({
      existing: item,
      sourceType: item.sourceType === "manual" ? "manual_qa" : item.sourceType,
      sourceTicketId: item.sourceTicketId ?? undefined,
      sourceFile: item.sourceFile ?? undefined,
      categoryL1: item.categoryL1,
      categoryL2: item.categoryL2,
      question: item.question,
      answer: item.answer,
      imagePaths: item.imagePathsJson
        ? JSON.parse(item.imagePathsJson)
        : item.imagePath
          ? [item.imagePath]
          : [],
    });

    await prisma.$transaction(async (tx) => {
      await tx.knowledgeItem.update({
        where: { id: item.id },
        data: {
          documentId: shell.documentId,
          sourceType: item.sourceType === "manual" ? "manual_qa" : item.sourceType,
        },
      });
      await tx.knowledgeChunk.updateMany({
        where: { knowledgeItemId: item.id },
        data: {
          documentId: shell.documentId,
          chunkSetId: shell.chunkSetId,
          sectionPath: [item.categoryL1, item.categoryL2].filter(Boolean).join(" / ") || "QA",
        },
      });
    });
    touchedChunkIds.push(...item.chunks.map((chunk) => chunk.id));
  }

  if (touchedChunkIds.length) {
    await enqueueUpsertTasksForChunkIds(touchedChunkIds);
  }

  return { documentsCreated: items.length, chunksTouched: touchedChunkIds.length };
}

export async function listKnowledgeItems(params: KnowledgeListParams = {}) {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const where = buildKnowledgeWhere(params);

  const [items, total, summary, categories] = await Promise.all([
    prisma.knowledgeItem.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.knowledgeItem.count({ where }),
    getKnowledgeSummary(),
    prisma.knowledgeItem.findMany({
      select: {
        categoryL1: true,
        categoryL2: true,
      },
      distinct: ["categoryL1", "categoryL2"],
      orderBy: [{ categoryL1: "asc" }, { categoryL2: "asc" }],
    }),
  ]);

  const categoryOptions = Array.from(
    new Set(categories.flatMap((item) => [item.categoryL1, item.categoryL2]).filter(Boolean))
  );

  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    summary,
    categoryOptions,
  };
}

export async function listKnowledgeDocuments(params: KnowledgeListParams = {}) {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const q = params.q?.trim();
  const and: Prisma.KnowledgeDocumentWhereInput[] = [];

  if (params.status && params.status !== "all") {
    const mappedStatus = params.status;
    and.push({ status: mappedStatus });
  }

  if (params.category && params.category !== "all") {
    and.push({ businessCategory: params.category });
  }

  if (q) {
    and.push({
      OR: [
        { title: { contains: q } },
        { sourceFile: { contains: q } },
        { businessCategory: { contains: q } },
        { chunks: { some: { chunkText: { contains: q } } } },
      ],
    });
  }

  const where: Prisma.KnowledgeDocumentWhereInput = and.length ? { AND: and } : {};

  const [items, total, categories] = await Promise.all([
    prisma.knowledgeDocument.findMany({
      where,
      include: {
        _count: { select: { chunks: true, chunkSets: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.knowledgeDocument.count({ where }),
    prisma.knowledgeDocument.findMany({
      select: { businessCategory: true },
      distinct: ["businessCategory"],
      orderBy: [{ businessCategory: "asc" }],
    }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    categoryOptions: categories.map((item) => item.businessCategory).filter(Boolean),
  };
}

export async function getKnowledgeDocumentDetail(id: string) {
  return prisma.knowledgeDocument.findUnique({
    where: { id },
    include: {
      versions: { orderBy: { createdAt: "desc" } },
      parseRuns: { orderBy: { createdAt: "desc" } },
      chunkSets: {
        orderBy: { createdAt: "desc" },
        include: {
          chunks: {
            orderBy: { chunkIndex: "asc" },
            take: 300,
          },
        },
      },
      chunks: {
        orderBy: { chunkIndex: "asc" },
        take: 300,
      },
    },
  });
}

export async function getKnowledgeSummary() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [total, imageCount, todayCreated, published, draft, archived, hitSum, recentHits] =
    await Promise.all([
      prisma.knowledgeItem.count(),
      prisma.knowledgeItem.count({
        where: {
          OR: [{ imagePath: { not: null } }, { imagePathsJson: { not: null } }],
        },
      }),
      prisma.knowledgeItem.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.knowledgeItem.count({ where: { status: "published" } }),
      prisma.knowledgeItem.count({ where: { status: "draft" } }),
      prisma.knowledgeItem.count({ where: { status: "archived" } }),
      prisma.knowledgeItem.aggregate({ _sum: { hitCount: true } }),
      prisma.knowledgeItem.aggregate({
        where: { lastHitAt: { gte: sevenDaysAgo } },
        _sum: { hitCount: true },
      }),
    ]);

  return {
    total,
    imageCount,
    todayCreated,
    published,
    draft,
    archived,
    totalHits: hitSum._sum.hitCount ?? 0,
    recentHits: recentHits._sum.hitCount ?? 0,
  };
}

export async function getKnowledgeItemDetail(id: string) {
  return prisma.knowledgeItem.findUnique({
    where: { id },
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" },
      },
    },
  });
}

export async function recordKnowledgeHit(id: string) {
  return prisma.knowledgeItem.update({
    where: { id },
    data: {
      hitCount: { increment: 1 },
      lastHitAt: new Date(),
    },
  });
}

export async function deleteKnowledgeItem(id: string) {
  const existing = await prisma.knowledgeItem.findUnique({
    where: { id },
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" },
      },
    },
  });

  if (!existing) {
    throw new Error("知识条目不存在");
  }

  await prisma.$transaction(async (tx) => {
    if (existing.chunks.length) {
      await tx.knowledgeIndexTask.createMany({
        data: existing.chunks.map((chunk) => ({
          taskType: KnowledgeIndexTaskType.delete,
          status: KnowledgeIndexTaskStatus.pending,
          knowledgeItemId: existing.id,
          chunkId: chunk.id,
          pointId: chunk.qdrantPointId,
          payloadJson: JSON.stringify({ reason: "knowledge_item_delete" }),
        })),
      });
    }

    await tx.knowledgeItem.delete({
      where: { id: existing.id },
    });
  });

  await tryDrainKnowledgeIndexTasks({
    limit: Math.max(20, existing.chunks.length),
  });
}

export async function collectKnowledgeSourceFiles() {
  const files = new Set<string>();
  const seedDir = path.resolve(repoRoot, "seed_knowledge");

  try {
    const entries = await fs.readdir(seedDir);
    for (const entry of entries) {
      files.add(path.join(seedDir, entry));
    }
  } catch {
    // 忽略不存在的目录，避免首次初始化中断。
  }

  const rootExtras = [
    path.resolve(repoRoot, "药店门店智能问答轻量级知识库.docx"),
    path.resolve(repoRoot, "信息部常见问题详解/full.md"),
  ];

  for (const file of rootExtras) {
    try {
      await fs.access(file);
      files.add(file);
    } catch {
      // 跳过不存在的可选文档。
    }
  }

  return Array.from(files);
}

async function createDocumentIngestion(input: {
  filePath: string;
  sourceFile: string;
  extractedText: string;
  chunkStrategy?: "fixed_overlap" | "recursive" | "qa" | "parent_child";
  chunkingConfig: DocumentChunkingConfig;
  options?: DocumentImportOptions;
}) {
  const businessCategory =
    input.options?.businessCategory ?? inferBusinessCategory({ text: input.extractedText });
  const answerPolicy = input.options?.answerPolicy ?? inferAnswerPolicy(businessCategory);
  const title = input.sourceFile.replace(/\.[^.]+$/, "");
  const contentHash = hashText(input.extractedText || `${input.sourceFile}:${Date.now()}`);
  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const parseRunId = crypto.randomUUID();
  const chunkSetId = crypto.randomUUID();

  await prisma.$transaction(async (tx) => {
    const existingDocuments =
      (await tx.knowledgeDocument.findMany({
        where: {
          sourceType: "uploaded_doc",
          sourceFile: input.sourceFile,
        },
        include: {
          chunks: true,
        },
      })) ?? [];
    const staleChunks = existingDocuments.flatMap((document) => document.chunks);

    if (staleChunks.length) {
      await tx.knowledgeIndexTask.createMany({
        data: staleChunks.map((chunk) => ({
          taskType: KnowledgeIndexTaskType.delete,
          status: KnowledgeIndexTaskStatus.pending,
          knowledgeItemId: chunk.knowledgeItemId,
          chunkId: chunk.id,
          pointId: chunk.qdrantPointId,
          payloadJson: JSON.stringify({ reason: "document_replace" }),
        })),
      });
    }

    if (existingDocuments.length) {
      await tx.knowledgeDocument.deleteMany({
        where: { id: { in: existingDocuments.map((document) => document.id) } },
      });
    }

    await tx.knowledgeDocument.create({
      data: {
        id: documentId,
        title,
        sourceType: "uploaded_doc",
        sourceFile: input.sourceFile,
        mimeType: path.extname(input.sourceFile).toLowerCase().replace(".", "") || null,
        businessCategory,
        answerPolicy,
        scopeLevel: input.options?.scopeLevel ?? "national",
        provinceCode: input.options?.provinceCode ?? null,
        provinceName: input.options?.provinceName ?? null,
        cityCode: input.options?.cityCode ?? null,
        cityName: input.options?.cityName ?? null,
        districtCode: input.options?.districtCode ?? null,
        districtName: input.options?.districtName ?? null,
        storeId: input.options?.storeId ?? null,
        status: "published",
      },
    });
    await tx.knowledgeDocumentVersion.create({
      data: {
        id: versionId,
        documentId,
        originalFilePath: input.filePath,
        sourceFileName: input.sourceFile,
        contentHash,
        uploadedByUserId: input.options?.uploadedByUserId ?? null,
      },
    });
    await tx.knowledgeParseRun.create({
      data: {
        id: parseRunId,
        documentId,
        documentVersionId: versionId,
        parserType: input.sourceFile.match(/\.(png|jpg|jpeg|webp)$/i)
          ? "image_vlm"
          : input.sourceFile.match(/\.pdf$/i)
            ? "pdf_text"
            : input.sourceFile.match(/\.docx?$/i)
              ? "docx_layout"
              : "basic_text",
        status: "success",
        extractedText: input.extractedText,
      },
    });
    await tx.knowledgeChunkSet.create({
      data: {
        id: chunkSetId,
        documentId,
        parseRunId,
        chunkStrategy: input.chunkStrategy ?? "qa",
        configJson: JSON.stringify(input.chunkingConfig),
        isActive: true,
      },
    });
  });

  return { documentId, chunkSetId, businessCategory, answerPolicy };
}

function resolveChunkStrategy(config: DocumentChunkingConfig) {
  if (config.rule.mode === "qa") return "qa";
  if (config.rule.mode === "parent_child") return "parent_child";
  return "recursive";
}

function buildImportItemsFromParsed(input: {
  parsedItems: Awaited<ReturnType<typeof parseDocument>>["items"];
  sourceFile: string;
  extractedText: string;
  config: DocumentChunkingConfig;
}) {
  if (input.config.rule.mode === "qa" && input.parsedItems.length > 1) {
    const qaChunks = chunkQaItems(input.parsedItems, input.config);
    return input.parsedItems.map((item, index) => ({
      ...item,
      sourceFile: input.sourceFile,
      chunkTexts: qaChunks[index] ? [qaChunks[index].text] : item.chunkTexts,
      chunkPlans: qaChunks[index] ? [qaChunks[index]] : undefined,
    }));
  }

  const representative = input.parsedItems[0];
  const chunkPlans =
    input.config.rule.mode === "qa" && input.parsedItems.length === 1
      ? chunkQaItems(
          [
            {
              question: representative.question,
              answer: representative.answer || representative.normalizedText,
              categoryL1: representative.categoryL1,
              categoryL2: representative.categoryL2,
              tags: representative.tags,
            },
          ],
          input.config
        )
      : chunkPlainText(input.extractedText, input.config);

  return [
    {
      categoryL1: representative.categoryL1 || "门店知识库",
      categoryL2: representative.categoryL2 || "智能问答",
      question: representative.question || input.sourceFile.replace(/\.[^.]+$/, ""),
      answer: input.extractedText,
      tags: representative.tags ?? [],
      sourceFile: input.sourceFile,
      docType: representative.docType,
      imagePath: representative.imagePath,
      imagePaths: representative.imagePaths ?? [],
      originalText: representative.originalText || input.extractedText,
      normalizedText: input.extractedText,
      chunkTexts: chunkPlans.map((chunk) => chunk.text),
      chunkPlans,
    },
  ];
}

export async function importKnowledgeFromFiles(
  filePaths: string[],
  options?: DocumentImportOptions
) {
  let importedFiles = 0;
  let importedChunks = 0;
  let skippedFiles = 0;
  const errors: Array<{ file: string; reason: string }> = [];

  const job = await prisma.importJob.create({
    data: {
      source: filePaths.join("\n"),
      status: "running",
    },
  });

  for (const filePath of filePaths) {
    try {
      const parsed = await parseDocument(filePath);

      if (!parsed.items.length) {
        skippedFiles += 1;
        continue;
      }

      const sourceFile =
        options?.sourceFileNameByPath?.[filePath] ??
        parsed.items[0]?.sourceFile ??
        path.basename(filePath);
      const extractedText = parsed.items
        .map((item) => item.normalizedText || item.originalText || item.chunkTexts.join("\n"))
        .join("\n\n");
      const chunkingConfig = sanitizeChunkingConfig(
        options?.chunkingConfig ?? DEFAULT_DOCUMENT_CHUNKING_CONFIG
      );
      const importItems = buildImportItemsFromParsed({
        parsedItems: parsed.items,
        sourceFile,
        extractedText,
        config: chunkingConfig,
      });
      const ingestion = await createDocumentIngestion({
        filePath,
        sourceFile,
        extractedText,
        chunkStrategy: resolveChunkStrategy(chunkingConfig),
        chunkingConfig,
        options,
      });

      for (const item of importItems) {
        await upsertKnowledgeItem({
          categoryL1: item.categoryL1,
          categoryL2: item.categoryL2,
          question: item.question,
          answer: item.answer,
          tags: item.tags,
          sourceType: item.docType.startsWith("image") ? "image_doc" : "uploaded_doc",
          sourceFile,
          docType: item.docType,
          documentId: ingestion.documentId,
          chunkSetId: ingestion.chunkSetId,
          businessCategory: ingestion.businessCategory,
          answerPolicy: ingestion.answerPolicy,
          scopeLevel: options?.scopeLevel ?? "national",
          provinceCode: options?.provinceCode ?? null,
          provinceName: options?.provinceName ?? null,
          cityCode: options?.cityCode ?? null,
          cityName: options?.cityName ?? null,
          districtCode: options?.districtCode ?? null,
          districtName: options?.districtName ?? null,
          storeId: options?.storeId ?? null,
          imagePath: item.imagePath,
          imagePaths: item.imagePaths,
          originalText: item.originalText,
          normalizedText: item.normalizedText,
          chunkTexts: item.chunkTexts,
          chunkPlans: item.chunkPlans,
        });
        importedChunks += item.chunkTexts.length;
      }

      importedFiles += 1;
    } catch (error) {
      skippedFiles += 1;
      errors.push({
        file: filePath,
        reason: error instanceof Error ? error.message : "未知错误",
      });
    }
  }

  await prisma.importJob.update({
    where: { id: job.id },
    data: {
      status: errors.length ? "failed" : "success",
      summary: JSON.stringify({ importedFiles, importedChunks, skippedFiles, errors }),
    },
  });

  await tryDrainKnowledgeIndexTasks({ limit: 100 });

  return { importedFiles, importedChunks, skippedFiles, errors };
}

export async function updateKnowledgeItem(
  id: string,
  input: {
    categoryL1: string;
    categoryL2: string;
    question: string;
    answer: string;
    imagePaths?: string[];
    status?: KnowledgeStatus;
  }
) {
  const existing = await prisma.knowledgeItem.findUnique({
    where: { id },
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" },
      },
    },
  });
  if (!existing) throw new Error("知识条目不存在");

  const tags = Array.from(new Set(input.question.split(/[，。；、\s]+/).filter(Boolean))).slice(
    0,
    5
  );

  return persistKnowledgeItem(
    {
      categoryL1: input.categoryL1,
      categoryL2: input.categoryL2,
      question: input.question,
      answer: input.answer,
      tags,
      status: input.status ?? existing.status,
      sourceType: existing.sourceType,
      sourceTicketId: existing.sourceTicketId ?? undefined,
      sourceFile: existing.sourceFile ?? undefined,
      docType: existing.docType ?? undefined,
      imagePath: input.imagePaths?.[0] ?? existing.imagePath ?? null,
      imagePaths: input.imagePaths ?? [],
      originalText: `${input.question}\n${input.answer}`,
      normalizedText: `${input.question}\n${input.answer}`,
      chunkTexts: [`问题：${input.question}\n答案：${input.answer}`],
    },
    existing
  );
}

export async function bulkUpdateKnowledgeItems(input: {
  ids: string[];
  action: "publish" | "archive" | "delete";
}) {
  const ids = Array.from(new Set(input.ids.filter(Boolean)));
  if (!ids.length) {
    return { affected: 0 };
  }

  if (input.action === "delete") {
    for (const id of ids) {
      await deleteKnowledgeItem(id);
    }
    return { affected: ids.length };
  }

  const status: KnowledgeStatus = input.action === "publish" ? "published" : "archived";
  const result = await prisma.knowledgeItem.updateMany({
    where: { id: { in: ids } },
    data: { status },
  });

  return { affected: result.count };
}
