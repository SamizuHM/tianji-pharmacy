import fs from "node:fs/promises";
import path from "node:path";

import { KnowledgeIndexTaskStatus, KnowledgeIndexTaskType, KnowledgeSourceType } from "@prisma/client";

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

type ExistingKnowledgeItem = Awaited<ReturnType<typeof findExistingKnowledgeItem>>;

function buildTagsJson(tags: string[]) {
  return JSON.stringify(Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))));
}

function buildImagePaths(input: UpsertKnowledgeInput) {
  return input.imagePaths?.filter(Boolean) ?? [];
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
  const legacyPointDeletes = existingChunks
    .filter((chunk) => chunkPlans.some((plan) => plan.id === chunk.id) && chunk.qdrantPointId !== chunk.id)
    .map((chunk) => ({
      knowledgeItemId: existing?.id ?? itemId,
      chunkId: chunk.id,
      pointId: chunk.qdrantPointId,
      payloadJson: JSON.stringify({ reason: "legacy_point_id_cleanup" })
    }));
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
      })),
      ...legacyPointDeletes.map((task) => ({
        taskType: KnowledgeIndexTaskType.delete,
        status: KnowledgeIndexTaskStatus.pending,
        knowledgeItemId: task.knowledgeItemId,
        chunkId: task.chunkId,
        pointId: task.pointId,
        payloadJson: task.payloadJson
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
    limit: Math.max(20, upsertTasks.length + staleChunks.length + legacyPointDeletes.length)
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

export async function importKnowledgeFromFiles(filePaths: string[]) {
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
        await upsertKnowledgeItem({
          categoryL1: item.categoryL1,
          categoryL2: item.categoryL2,
          question: item.question,
          answer: item.answer,
          tags: item.tags,
          sourceType: item.docType.startsWith("image") ? "image_doc" : "seed_doc",
          sourceFile: item.sourceFile,
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

export async function writeTicketResolutionToKnowledge(input: {
  question: string;
  contextSummary: string;
  resolution: string;
  ticketId: string;
  imagePaths?: string[];
}) {
  const standardAnswer = input.resolution.trim();
  const question = input.question.trim() || `工单 ${input.ticketId} 闭环问题`;

  return upsertKnowledgeItem({
    categoryL1: "人工经验沉淀",
    categoryL2: "工单闭环新增",
    question,
    answer: standardAnswer,
    tags: ["人工闭环", "工单回写", ...Array.from(new Set(question.split(/[，。；、\s]+/).filter(Boolean))).slice(0, 5)],
    sourceType: "manual_ticket",
    sourceTicketId: input.ticketId,
    docType: "manual_ticket",
    imagePath: input.imagePaths?.[0] ?? null,
    imagePaths: input.imagePaths ?? [],
    originalText: `${question}\n${input.contextSummary}\n${standardAnswer}`,
    normalizedText: `${question}\n${input.contextSummary}\n${standardAnswer}`,
    chunkTexts: [`问题：${question}\n背景：${input.contextSummary}\n标准答案：${standardAnswer}`]
  });
}
