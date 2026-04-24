import fs from "node:fs/promises";
import path from "node:path";

import { KnowledgeSourceType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { repoRoot } from "@/lib/env";
import { embedMultimodal, parseDocument } from "@/lib/retrieval/ml-service";
import { COLLECTION_NAME, ensureCollection, qdrant } from "@/lib/retrieval/qdrant";

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

export async function upsertKnowledgeItem(input: UpsertKnowledgeInput) {
  const existing = await prisma.knowledgeItem.findFirst({
    where: {
      question: input.question,
      sourceFile: input.sourceFile ?? null,
      sourceTicketId: input.sourceTicketId ?? null,
      sourceType: input.sourceType
    },
    include: {
      chunks: true
    }
  });

  if (existing) {
    const pointIds = existing.chunks.map((chunk) => chunk.qdrantPointId);
    if (pointIds.length) {
      await qdrant.delete(COLLECTION_NAME, {
        wait: true,
        points: pointIds
      });
    }

    await prisma.knowledgeItem.delete({
      where: { id: existing.id }
    });
  }

  const item = await prisma.knowledgeItem.create({
    data: {
      categoryL1: input.categoryL1,
      categoryL2: input.categoryL2,
      question: input.question,
      answer: input.answer,
      tagsJson: JSON.stringify(input.tags),
      sourceType: input.sourceType,
      sourceTicketId: input.sourceTicketId,
      sourceFile: input.sourceFile,
      docType: input.docType,
      imagePath: input.imagePath,
      imagePathsJson: input.imagePaths?.length ? JSON.stringify(input.imagePaths) : null
    }
  });

  // 使用多模态 embedding（文本+图片融合向量）
  const embedInputs = input.chunkTexts.map((text) => ({
    text,
    image_path: input.imagePaths?.[0] ?? undefined,
    image_paths: input.imagePaths ?? []
  }));
  const vectors = await embedMultimodal(embedInputs);
  await ensureCollection(vectors.vectors[0]?.length ?? 1024);

  const chunksData: Prisma.KnowledgeChunkCreateManyInput[] = [];

  for (let index = 0; index < input.chunkTexts.length; index += 1) {
    const pointId = crypto.randomUUID();
    const chunkText = input.chunkTexts[index];
    const payload = {
      knowledgeItemId: item.id,
      question: input.question,
      answer: input.answer,
      sourceFile: input.sourceFile ?? null,
      docType: input.docType ?? null,
      categoryL1: input.categoryL1,
      categoryL2: input.categoryL2,
      imagePath: input.imagePath ?? null,
      imagePaths: input.imagePaths ?? []
    };

    await qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points: [
        {
          id: pointId,
          vector: vectors.vectors[index],
          payload: {
            ...payload,
            chunkText
          }
        }
      ]
    });

    chunksData.push({
      knowledgeItemId: item.id,
      chunkIndex: index,
      chunkText,
      originalText: input.originalText,
      sourceFile: input.sourceFile,
      docType: input.docType,
      qdrantPointId: pointId,
      metadataJson: JSON.stringify(payload)
    });
  }

  if (chunksData.length > 0) {
    await prisma.knowledgeChunk.createMany({ data: chunksData });
  }

  return item;
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
    include: { chunks: true }
  });
  if (!existing) throw new Error("知识条目不存在");

  const pointIds = existing.chunks.map((chunk) => chunk.qdrantPointId);
  if (pointIds.length) {
    await qdrant.delete(COLLECTION_NAME, { wait: true, points: pointIds });
  }
  await prisma.knowledgeItem.delete({ where: { id } });

  const tags = Array.from(new Set(input.question.split(/[，。；、\s]+/).filter(Boolean))).slice(0, 5);

  return upsertKnowledgeItem({
    categoryL1: input.categoryL1,
    categoryL2: input.categoryL2,
    question: input.question,
    answer: input.answer,
    tags,
    sourceType: existing.sourceType,
    sourceTicketId: existing.sourceTicketId ?? undefined,
    sourceFile: existing.sourceFile ?? undefined,
    docType: existing.docType ?? undefined,
    imagePath: existing.imagePath,
    imagePaths: input.imagePaths ?? [],
    originalText: `${input.question}\n${input.answer}`,
    normalizedText: `${input.question}\n${input.answer}`,
    chunkTexts: [`问题：${input.question}\n答案：${input.answer}`]
  });
}

export async function writeTicketResolutionToKnowledge(input: {
  question: string;
  contextSummary: string;
  resolution: string;
  ticketId: string;
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
    originalText: `${question}\n${input.contextSummary}\n${standardAnswer}`,
    normalizedText: `${question}\n${input.contextSummary}\n${standardAnswer}`,
    chunkTexts: [`问题：${question}\n背景：${input.contextSummary}\n标准答案：${standardAnswer}`]
  });
}
