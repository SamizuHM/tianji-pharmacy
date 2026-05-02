import fs from "node:fs/promises";
import path from "node:path";

import { KnowledgeIndexTaskStatus, KnowledgeIndexTaskType, KnowledgeSourceType, KnowledgeStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { repoRoot } from "@/lib/env";
import { parseDocument } from "@/lib/retrieval/ml-service";
import {
  buildStablePointId,
  prepareKnowledgeChunkUpsertTasks,
  tryDrainKnowledgeIndexTasks,
  type KnowledgeChunkProjectionSource
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
  imagePath?: string | null;
  imagePaths?: string[];
  originalText: string;
  normalizedText: string;
  chunkTexts: string[];
};

export type KnowledgeListParams = {
  q?: string;
  category?: string;
  status?: KnowledgeStatus | "all";
  page?: number;
  pageSize?: number;
};

type ExistingKnowledgeItem = Awaited<ReturnType<typeof findExistingKnowledgeItem>>;

function buildTagsJson(tags: string[]) {
  return JSON.stringify(Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))));
}

function buildImagePaths(input: UpsertKnowledgeInput) {
  return input.imagePaths?.filter(Boolean) ?? [];
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
      OR: [{ categoryL1: params.category }, { categoryL2: params.category }]
    });
  }

  if (q) {
    and.push({
      OR: [
        { question: { contains: q } },
        { answer: { contains: q } },
        { categoryL1: { contains: q } },
        { categoryL2: { contains: q } },
        { sourceFile: { contains: q } }
      ]
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
    chunkId,
    chunkIndex,
    chunkText,
    question: input.question,
    answer: input.answer,
    sourceFile: input.sourceFile ?? null,
    docType: input.docType ?? null,
    categoryL1: input.categoryL1,
    categoryL2: input.categoryL2,
    imagePath: input.imagePath ?? null,
    imagePaths: buildImagePaths(input)
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
      sourceType: input.sourceType
    },
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" }
      }
    }
  });
}

async function persistKnowledgeItem(input: UpsertKnowledgeInput, existing: ExistingKnowledgeItem) {
  const itemId = existing?.id ?? crypto.randomUUID();
  const existingChunks = existing?.chunks ?? [];
  const imagePaths = buildImagePaths(input);

  const chunkPlans = input.chunkTexts.map((chunkText, chunkIndex) => {
    const existingChunk = existingChunks[chunkIndex];
    const chunkId = existingChunk?.id ?? crypto.randomUUID();
    return {
      id: chunkId,
      knowledgeItemId: itemId,
      chunkIndex,
      chunkText,
      originalText: input.originalText,
      sourceFile: input.sourceFile,
      docType: input.docType,
      qdrantPointId: buildStablePointId(chunkId),
      metadataJson: JSON.stringify(buildChunkMetadata(itemId, chunkId, chunkIndex, chunkText, input))
    };
  });
  const staleChunks = existingChunks.filter((chunk) => !chunkPlans.some((plan) => plan.id === chunk.id));
  const taskSources: KnowledgeChunkProjectionSource[] = chunkPlans.map((chunk) => ({
    knowledgeItemId: itemId,
    chunkId: chunk.id,
    chunkIndex: chunk.chunkIndex,
    chunkText: chunk.chunkText,
    sourceFile: chunk.sourceFile ?? null,
    docType: chunk.docType ?? null,
    knowledgeItem: {
      question: input.question,
      answer: input.answer,
      sourceFile: input.sourceFile ?? null,
      docType: input.docType ?? null,
      categoryL1: input.categoryL1,
      categoryL2: input.categoryL2,
      imagePath: input.imagePath ?? null,
      imagePaths
    }
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
      imagePath: input.imagePath ?? null,
      imagePathsJson: imagePaths.length ? JSON.stringify(imagePaths) : null
    };

    if (existing) {
      await tx.knowledgeItem.update({
        where: { id: existing.id },
        data: itemData
      });
    } else {
      await tx.knowledgeItem.create({
        data: {
          id: itemId,
          ...itemData
        }
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
          sourceFile: chunk.sourceFile ?? null,
          docType: chunk.docType ?? null,
          qdrantPointId: chunk.qdrantPointId,
          metadataJson: chunk.metadataJson
        },
        create: chunk
      });
    }

    if (staleChunks.length) {
      await tx.knowledgeChunk.deleteMany({
        where: {
          id: { in: staleChunks.map((chunk) => chunk.id) }
        }
      });
    }

    const taskData = [
      ...upsertTasks.map((task) => ({
        taskType: KnowledgeIndexTaskType.upsert,
        status: KnowledgeIndexTaskStatus.pending,
        knowledgeItemId: task.knowledgeItemId,
        chunkId: task.chunkId,
        pointId: task.pointId,
        payloadJson: task.payloadJson
      })),
      ...staleChunks.map((chunk) => ({
        taskType: KnowledgeIndexTaskType.delete,
        status: KnowledgeIndexTaskStatus.pending,
        knowledgeItemId: existing?.id ?? itemId,
        chunkId: chunk.id,
        pointId: chunk.qdrantPointId,
        payloadJson: JSON.stringify({ reason: "stale_chunk_delete" })
      }))
    ];

    if (taskData.length) {
      await tx.knowledgeIndexTask.createMany({
        data: taskData
      });
    }

    return tx.knowledgeItem.findUniqueOrThrow({
      where: { id: itemId }
    });
  });

  await tryDrainKnowledgeIndexTasks({
    limit: Math.max(20, upsertTasks.length + staleChunks.length)
  });

  return item;
}

export async function upsertKnowledgeItem(input: UpsertKnowledgeInput) {
  const existing = await findExistingKnowledgeItem({
    question: input.question,
    sourceFile: input.sourceFile,
    sourceTicketId: input.sourceTicketId,
    sourceType: input.sourceType
  });

  return persistKnowledgeItem(input, existing);
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
      take: pageSize
    }),
    prisma.knowledgeItem.count({ where }),
    getKnowledgeSummary(),
    prisma.knowledgeItem.findMany({
      select: {
        categoryL1: true,
        categoryL2: true
      },
      distinct: ["categoryL1", "categoryL2"],
      orderBy: [{ categoryL1: "asc" }, { categoryL2: "asc" }]
    })
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
    categoryOptions
  };
}

export async function getKnowledgeSummary() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [total, imageCount, todayCreated, published, draft, archived, hitSum, recentHits] = await Promise.all([
    prisma.knowledgeItem.count(),
    prisma.knowledgeItem.count({
      where: {
        OR: [{ imagePath: { not: null } }, { imagePathsJson: { not: null } }]
      }
    }),
    prisma.knowledgeItem.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.knowledgeItem.count({ where: { status: "published" } }),
    prisma.knowledgeItem.count({ where: { status: "draft" } }),
    prisma.knowledgeItem.count({ where: { status: "archived" } }),
    prisma.knowledgeItem.aggregate({ _sum: { hitCount: true } }),
    prisma.knowledgeItem.aggregate({
      where: { lastHitAt: { gte: sevenDaysAgo } },
      _sum: { hitCount: true }
    })
  ]);

  return {
    total,
    imageCount,
    todayCreated,
    published,
    draft,
    archived,
    totalHits: hitSum._sum.hitCount ?? 0,
    recentHits: recentHits._sum.hitCount ?? 0
  };
}

export async function getKnowledgeItemDetail(id: string) {
  return prisma.knowledgeItem.findUnique({
    where: { id },
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" }
      }
    }
  });
}

export async function recordKnowledgeHit(id: string) {
  return prisma.knowledgeItem.update({
    where: { id },
    data: {
      hitCount: { increment: 1 },
      lastHitAt: new Date()
    }
  });
}

export async function deleteKnowledgeItem(id: string) {
  const existing = await prisma.knowledgeItem.findUnique({
    where: { id },
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" }
      }
    }
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
          payloadJson: JSON.stringify({ reason: "knowledge_item_delete" })
        }))
      });
    }

    await tx.knowledgeItem.delete({
      where: { id: existing.id }
    });
  });

  await tryDrainKnowledgeIndexTasks({
    limit: Math.max(20, existing.chunks.length)
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
    path.resolve(repoRoot, "信息部常见问题详解/full.md")
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

export async function importKnowledgeFromFiles(
  filePaths: string[],
  options?: {
    sourceFileNameByPath?: Record<string, string>;
  }
) {
  let importedFiles = 0;
  let importedChunks = 0;
  let skippedFiles = 0;
  const errors: Array<{ file: string; reason: string }> = [];

  const job = await prisma.importJob.create({
    data: {
      source: filePaths.join("\n"),
      status: "running"
    }
  });

  for (const filePath of filePaths) {
    try {
      const parsed = await parseDocument(filePath);

      if (!parsed.items.length) {
        skippedFiles += 1;
        continue;
      }

      for (const item of parsed.items) {
        const sourceFile = options?.sourceFileNameByPath?.[filePath] ?? item.sourceFile;
        await upsertKnowledgeItem({
          categoryL1: item.categoryL1,
          categoryL2: item.categoryL2,
          question: item.question,
          answer: item.answer,
          tags: item.tags,
          sourceType: item.docType.startsWith("image") ? "image_doc" : "seed_doc",
          sourceFile,
          docType: item.docType,
          imagePath: item.imagePath,
          imagePaths: item.imagePaths,
          originalText: item.originalText,
          normalizedText: item.normalizedText,
          chunkTexts: item.chunkTexts
        });
        importedChunks += item.chunkTexts.length;
      }

      importedFiles += 1;
    } catch (error) {
      skippedFiles += 1;
      errors.push({
        file: filePath,
        reason: error instanceof Error ? error.message : "未知错误"
      });
    }
  }

  await prisma.importJob.update({
    where: { id: job.id },
    data: {
      status: errors.length ? "failed" : "success",
      summary: JSON.stringify({ importedFiles, importedChunks, skippedFiles, errors })
    }
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
        orderBy: { chunkIndex: "asc" }
      }
    }
  });
  if (!existing) throw new Error("知识条目不存在");

  const tags = Array.from(new Set(input.question.split(/[，。；、\s]+/).filter(Boolean))).slice(0, 5);

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
      chunkTexts: [`问题：${input.question}\n答案：${input.answer}`]
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
    data: { status }
  });

  return { affected: result.count };
}
