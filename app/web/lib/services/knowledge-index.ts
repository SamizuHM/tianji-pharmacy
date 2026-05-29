import {
  KnowledgeIndexTaskStatus,
  KnowledgeIndexTaskType,
  type KnowledgeChunk,
  type KnowledgeItem,
  type Prisma,
} from "@prisma/client";
import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";
import { generateHypotheticalQuestionsWithModel } from "@/lib/openai";
import { embedMultimodal } from "@/lib/retrieval/ml-service";
import {
  COLLECTION_NAME,
  ensureCollection,
  ensureQdrantWriteReady,
  qdrant,
} from "@/lib/retrieval/qdrant";
import { buildBm25TermRows } from "@/lib/services/bm25";

const INDEX_RETRY_BASE_MS = 5_000;
const INDEX_RETRY_MAX_MS = 5 * 60_000;
const EMBED_BATCH_SIZE = 16;

export function buildStablePointId(chunkId: string) {
  const hex = createHash("sha256").update(chunkId).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
}

type ChunkRecord = KnowledgeChunk & {
  knowledgeItem: KnowledgeItem;
};

type Bm25RefreshChunk = Pick<
  KnowledgeChunk,
  "id" | "chunkText" | "bm25SearchText" | "scopeLevel" | "cityName"
>;

export type KnowledgeChunkProjectionSource = {
  documentId?: string | null;
  chunkSetId?: string | null;
  knowledgeItemId: string;
  chunkId: string;
  chunkIndex: number;
  chunkText: string;
  sourceFile?: string | null;
  docType?: string | null;
  businessCategory?: string | null;
  scopeLevel?: string | null;
  cityName?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  knowledgeItem: {
    question: string;
    answer: string;
    sourceFile?: string | null;
    docType?: string | null;
    categoryL1: string;
    categoryL2: string;
    imagePath?: string | null;
    imagePaths?: string[];
  };
};

type ChunkMetadata = {
  documentId?: string | null;
  chunkSetId?: string | null;
  businessCategory?: string | null;
  scopeLevel?: string | null;
  cityName?: string | null;
  overrideScope?: boolean | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
};

type QdrantUpsertPayload = {
  knowledgeItemId: string;
  documentId: string | null;
  chunkId: string;
  chunkSetId: string | null;
  chunkIndex: number;
  chunkText: string;
  question: string;
  answer: string;
  sourceFile: string | null;
  docType: string | null;
  categoryL1: string;
  categoryL2: string;
  businessCategory: string;
  scopeLevel: string;
  cityName: string | null;
  overrideScope: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  imagePath: string | null;
  imagePaths: string[];
  retrievalBasis: string;
  retrievalBasisType: "question" | "chunk" | "hq";
};

type KnowledgeIndexTaskPayload =
  | {
      vector: number[];
      payload: QdrantUpsertPayload;
    }
  | {
      reason?: string;
      chunkId?: string | null;
    };

function getRetryDelayMs(retryCount: number) {
  return Math.min(INDEX_RETRY_BASE_MS * 2 ** Math.max(0, retryCount - 1), INDEX_RETRY_MAX_MS);
}

function asDateAfterRetry(retryCount: number) {
  return new Date(Date.now() + getRetryDelayMs(retryCount));
}

function parseImagePaths(item: KnowledgeItem) {
  if (item.imagePathsJson) {
    try {
      const parsed = JSON.parse(item.imagePathsJson);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value));
      }
    } catch {
      // 忽略损坏数据，回退到单图字段。
    }
  }

  return item.imagePath ? [item.imagePath] : [];
}

function parseImagePathsFromSource(source: KnowledgeChunkProjectionSource) {
  if (source.knowledgeItem.imagePaths?.length) {
    return source.knowledgeItem.imagePaths.map((value) => String(value));
  }

  return source.knowledgeItem.imagePath ? [source.knowledgeItem.imagePath] : [];
}

function parseChunkMetadata(metadataJson: string | null | undefined): ChunkMetadata {
  if (!metadataJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(metadataJson) as ChunkMetadata;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function buildQdrantPayload(chunk: ChunkRecord): QdrantUpsertPayload {
  const metadata = parseChunkMetadata(chunk.metadataJson);
  return {
    knowledgeItemId: chunk.knowledgeItemId,
    documentId: chunk.documentId ?? metadata.documentId ?? null,
    chunkId: chunk.id,
    chunkSetId: chunk.chunkSetId ?? metadata.chunkSetId ?? null,
    chunkIndex: chunk.chunkIndex,
    chunkText: chunk.chunkText,
    question: chunk.knowledgeItem.question,
    answer: chunk.knowledgeItem.answer,
    sourceFile: chunk.sourceFile ?? chunk.knowledgeItem.sourceFile ?? null,
    docType: chunk.docType ?? chunk.knowledgeItem.docType ?? null,
    categoryL1: chunk.knowledgeItem.categoryL1,
    categoryL2: chunk.knowledgeItem.categoryL2,
    businessCategory: metadata.businessCategory ?? chunk.knowledgeItem.categoryL1,
    scopeLevel: metadata.scopeLevel ?? "common",
    cityName: chunk.cityName ?? metadata.cityName ?? null,
    overrideScope: chunk.overrideScope || Boolean(metadata.overrideScope),
    effectiveFrom: metadata.effectiveFrom ?? null,
    effectiveTo: metadata.effectiveTo ?? null,
    imagePath: chunk.knowledgeItem.imagePath ?? null,
    imagePaths: parseImagePaths(chunk.knowledgeItem),
    retrievalBasis: chunk.chunkText,
    retrievalBasisType: "chunk",
  };
}

function buildQdrantPayloadFromSource(source: KnowledgeChunkProjectionSource): QdrantUpsertPayload {
  return {
    knowledgeItemId: source.knowledgeItemId,
    documentId: source.documentId ?? null,
    chunkId: source.chunkId,
    chunkSetId: source.chunkSetId ?? null,
    chunkIndex: source.chunkIndex,
    chunkText: source.chunkText,
    question: source.knowledgeItem.question,
    answer: source.knowledgeItem.answer,
    sourceFile: source.sourceFile ?? source.knowledgeItem.sourceFile ?? null,
    docType: source.docType ?? source.knowledgeItem.docType ?? null,
    categoryL1: source.knowledgeItem.categoryL1,
    categoryL2: source.knowledgeItem.categoryL2,
    businessCategory: source.businessCategory ?? source.knowledgeItem.categoryL1,
    scopeLevel: source.scopeLevel ?? "common",
    cityName: source.cityName ?? null,
    overrideScope: false,
    effectiveFrom: source.effectiveFrom ?? null,
    effectiveTo: source.effectiveTo ?? null,
    imagePath: source.knowledgeItem.imagePath ?? null,
    imagePaths: parseImagePathsFromSource(source),
    retrievalBasis: source.chunkText,
    retrievalBasisType: "chunk",
  };
}

function uniqueTexts(values: string[], limit: number) {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

async function buildHypotheticalQuestions(input: {
  question: string;
  answer: string;
  chunkText: string;
  categoryL1: string;
  categoryL2: string;
  sourceFile?: string | null;
}) {
  const generated = await generateHypotheticalQuestionsWithModel(input);
  const questions = uniqueTexts([input.question, ...generated], 9);
  if (questions.length < 2) {
    throw new Error(`chunk HQ 生成不足：${input.question}`);
  }
  return questions;
}

function buildPointId(chunkId: string, basis: string, index: number) {
  if (index === 0) {
    return buildStablePointId(chunkId);
  }
  return buildStablePointId(
    `${chunkId}:hq:${index}:${createHash("sha256").update(basis).digest("hex")}`
  );
}

function buildProjectionPayload(payload: QdrantUpsertPayload, basis: string, index: number) {
  const basisType: QdrantUpsertPayload["retrievalBasisType"] = index === 0 ? "question" : "hq";
  return {
    ...payload,
    retrievalBasis: basis,
    retrievalBasisType: basisType,
  };
}

async function buildUpsertTaskInputs(
  chunks: ChunkRecord[]
): Promise<Array<{ chunk: ChunkRecord; pointId: string; payloadJson: string }>> {
  const results: Array<{ chunk: ChunkRecord; pointId: string; payloadJson: string }> = [];

  for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(start, start + EMBED_BATCH_SIZE);
    const expanded = (
      await Promise.all(
        batch.map(async (chunk) => ({
          chunk,
          bases: await buildHypotheticalQuestions({
            question: chunk.knowledgeItem.question,
            answer: chunk.knowledgeItem.answer,
            chunkText: chunk.chunkText,
            categoryL1: chunk.knowledgeItem.categoryL1,
            categoryL2: chunk.knowledgeItem.categoryL2,
            sourceFile: chunk.sourceFile ?? chunk.knowledgeItem.sourceFile,
          }),
        }))
      )
    ).flatMap(({ chunk, bases }) => bases.map((basis, index) => ({ chunk, basis, index })));
    const embedInputs = expanded.map(({ chunk, basis }) => {
      const imagePaths = parseImagePaths(chunk.knowledgeItem);
      return {
        text: basis,
        image_path: imagePaths[0] ?? undefined,
        image_paths: imagePaths,
      };
    });
    const embedResult = await embedMultimodal(embedInputs);

    expanded.forEach(({ chunk, basis, index }, vectorIndex) => {
      const vector = embedResult.vectors[vectorIndex] ?? embedResult.vectors[0];
      if (!vector?.length) {
        throw new Error(`chunk ${chunk.id} embedding 结果为空`);
      }

      const payload: KnowledgeIndexTaskPayload = {
        vector,
        payload: buildProjectionPayload(buildQdrantPayload(chunk), basis, index),
      };

      results.push({
        chunk,
        pointId: buildPointId(chunk.id, basis, index),
        payloadJson: JSON.stringify(payload),
      });
    });
  }

  return results;
}

export async function prepareKnowledgeChunkUpsertTasks(
  chunks: KnowledgeChunkProjectionSource[]
): Promise<
  Array<{ chunkId: string; knowledgeItemId: string; pointId: string; payloadJson: string }>
> {
  const results: Array<{
    chunkId: string;
    knowledgeItemId: string;
    pointId: string;
    payloadJson: string;
  }> = [];

  for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(start, start + EMBED_BATCH_SIZE);
    const expanded = (
      await Promise.all(
        batch.map(async (chunk) => ({
          chunk,
          bases: await buildHypotheticalQuestions({
            question: chunk.knowledgeItem.question,
            answer: chunk.knowledgeItem.answer,
            chunkText: chunk.chunkText,
            categoryL1: chunk.knowledgeItem.categoryL1,
            categoryL2: chunk.knowledgeItem.categoryL2,
            sourceFile: chunk.sourceFile ?? chunk.knowledgeItem.sourceFile,
          }),
        }))
      )
    ).flatMap(({ chunk, bases }) => bases.map((basis, index) => ({ chunk, basis, index })));
    const embedInputs = expanded.map(({ chunk, basis }) => {
      const imagePaths = parseImagePathsFromSource(chunk);
      return {
        text: basis,
        image_path: imagePaths[0] ?? undefined,
        image_paths: imagePaths,
      };
    });
    const embedResult = await embedMultimodal(embedInputs);

    expanded.forEach(({ chunk, basis, index }, vectorIndex) => {
      const vector = embedResult.vectors[vectorIndex] ?? embedResult.vectors[0];
      if (!vector?.length) {
        throw new Error(`chunk ${chunk.chunkId} embedding 结果为空`);
      }

      const payload: KnowledgeIndexTaskPayload = {
        vector,
        payload: buildProjectionPayload(buildQdrantPayloadFromSource(chunk), basis, index),
      };

      results.push({
        chunkId: chunk.chunkId,
        knowledgeItemId: chunk.knowledgeItemId,
        pointId: buildPointId(chunk.chunkId, basis, index),
        payloadJson: JSON.stringify(payload),
      });
    });
  }

  return results;
}

async function processTask(task: {
  id: string;
  taskType: KnowledgeIndexTaskType;
  pointId: string;
  payloadJson: string | null;
}) {
  await ensureQdrantWriteReady();

  const payload = task.payloadJson
    ? (JSON.parse(task.payloadJson) as KnowledgeIndexTaskPayload)
    : null;

  if (task.taskType === "delete") {
    if (payload && "chunkId" in payload && payload.chunkId) {
      await qdrant.delete(COLLECTION_NAME, {
        wait: true,
        filter: { must: [{ key: "chunkId", match: { value: payload.chunkId } }] },
      });
      return;
    }
    await qdrant.delete(COLLECTION_NAME, { wait: true, points: [task.pointId] });
    return;
  }

  if (!payload) {
    throw new Error(`索引任务 ${task.id} 缺少 payload`);
  }

  if (!("vector" in payload) || !payload.vector.length) {
    throw new Error(`索引任务 ${task.id} 的向量数据无效`);
  }

  await ensureCollection(payload.vector.length);
  await qdrant.upsert(COLLECTION_NAME, {
    wait: true,
    points: [
      {
        id: task.pointId,
        vector: payload.vector,
        payload: payload.payload,
      },
    ],
  });
}

async function claimPendingTask(taskId: string) {
  const result = await prisma.knowledgeIndexTask.updateMany({
    where: {
      id: taskId,
      status: KnowledgeIndexTaskStatus.pending,
      availableAt: { lte: new Date() },
    },
    data: {
      status: KnowledgeIndexTaskStatus.processing,
    },
  });

  return result.count > 0;
}

async function refreshBm25IndexForChunks(chunks: Bm25RefreshChunk[]) {
  if (!chunks.length) {
    return 0;
  }

  const rowsByChunk = chunks.map((chunk) => ({
    chunk,
    index: buildBm25TermRows({
      chunkId: chunk.id,
      text: chunk.bm25SearchText ?? chunk.chunkText,
      scopeLevel: chunk.scopeLevel,
      cityName: chunk.cityName,
    }),
  }));

  await prisma.$transaction(async (tx) => {
    await tx.knowledgeBm25Term.deleteMany({
      where: { chunkId: { in: chunks.map((chunk) => chunk.id) } },
    });

    for (const item of rowsByChunk) {
      await tx.knowledgeChunk.update({
        where: { id: item.chunk.id },
        data: { bm25DocLength: item.index.docLength },
      });
    }

    const rows = rowsByChunk.flatMap((item) => item.index.rows);
    if (rows.length) {
      await tx.knowledgeBm25Term.createMany({
        data: rows,
        skipDuplicates: true,
      });
    }
  });

  return chunks.length;
}

export async function drainKnowledgeIndexTasks(options?: { limit?: number }) {
  const limit = options?.limit ?? 20;
  const pendingTasks = await prisma.knowledgeIndexTask.findMany({
    where: {
      status: KnowledgeIndexTaskStatus.pending,
      availableAt: { lte: new Date() },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
  });

  let completed = 0;
  let failed = 0;

  for (const task of pendingTasks) {
    const claimed = await claimPendingTask(task.id);
    if (!claimed) {
      continue;
    }

    try {
      await processTask(task);
      await prisma.knowledgeIndexTask.update({
        where: { id: task.id },
        data: {
          status: KnowledgeIndexTaskStatus.completed,
          processedAt: new Date(),
          lastError: null,
        },
      });
      completed += 1;
    } catch (error) {
      const retryCount = task.retryCount + 1;
      await prisma.knowledgeIndexTask.update({
        where: { id: task.id },
        data: {
          status: KnowledgeIndexTaskStatus.pending,
          retryCount,
          lastError: error instanceof Error ? error.message : "未知错误",
          availableAt: asDateAfterRetry(retryCount),
        },
      });
      failed += 1;
    }
  }

  return {
    scanned: pendingTasks.length,
    completed,
    failed,
  };
}

export async function tryDrainKnowledgeIndexTasks(options?: { limit?: number }) {
  try {
    return await drainKnowledgeIndexTasks(options);
  } catch (error) {
    console.error("[knowledge-index] drain failed", error);
    return {
      scanned: 0,
      completed: 0,
      failed: 1,
    };
  }
}

export async function normalizeKnowledgeChunkPointIds() {
  const rows = await prisma.knowledgeChunk.findMany({
    select: {
      id: true,
      qdrantPointId: true,
    },
  });

  let normalizedCount = 0;

  for (const row of rows) {
    const stablePointId = buildStablePointId(row.id);
    if (row.qdrantPointId === stablePointId) {
      continue;
    }

    await prisma.knowledgeChunk.update({
      where: { id: row.id },
      data: {
        qdrantPointId: stablePointId,
      },
    });
    normalizedCount += 1;
  }

  return normalizedCount;
}

export async function enqueueDeletePointTask(input: {
  knowledgeItemId?: string | null;
  chunkId?: string | null;
  pointId: string;
  reason?: string;
  tx?: Prisma.TransactionClient;
}) {
  const db = input.tx ?? prisma;
  await db.knowledgeIndexTask.create({
    data: {
      taskType: KnowledgeIndexTaskType.delete,
      status: KnowledgeIndexTaskStatus.pending,
      knowledgeItemId: input.knowledgeItemId ?? null,
      chunkId: input.chunkId ?? null,
      pointId: input.pointId,
      payloadJson: JSON.stringify({
        reason: input.reason ?? "delete",
        chunkId: input.chunkId ?? null,
      } satisfies KnowledgeIndexTaskPayload),
    },
  });
}

export async function enqueueUpsertTasksForChunkIds(
  chunkIds: string[],
  options?: { tx?: Prisma.TransactionClient }
) {
  if (!chunkIds.length) {
    return 0;
  }

  const chunks = await prisma.knowledgeChunk.findMany({
    where: { id: { in: chunkIds } },
    include: { knowledgeItem: true },
    orderBy: { chunkIndex: "asc" },
  });

  if (!chunks.length) {
    return 0;
  }

  const taskInputs = await buildUpsertTaskInputs(chunks);
  const db = options?.tx ?? prisma;

  await db.knowledgeIndexTask.createMany({
    data: taskInputs.map(({ chunk, pointId, payloadJson }) => ({
      taskType: KnowledgeIndexTaskType.upsert,
      status: KnowledgeIndexTaskStatus.pending,
      knowledgeItemId: chunk.knowledgeItemId,
      chunkId: chunk.id,
      pointId,
      payloadJson,
    })),
  });

  return taskInputs.length;
}

async function scrollAllQdrantPoints() {
  const points: Array<{ id: string; payload: Record<string, unknown> | null }> = [];
  let offset: unknown = undefined;

  while (true) {
    let response;
    try {
      response = (await (
        qdrant as unknown as {
          scroll: (
            collectionName: string,
            params: Record<string, unknown>
          ) => Promise<{
            points?: Array<{ id: string | number; payload?: Record<string, unknown> | null }>;
            next_page_offset?: unknown;
          }>;
        }
      ).scroll(COLLECTION_NAME, {
        with_payload: true,
        with_vector: false,
        limit: 256,
        offset,
      })) as {
        points?: Array<{ id: string | number; payload?: Record<string, unknown> | null }>;
        next_page_offset?: unknown;
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Collection `pharmacy_kb` doesn't exist")
      ) {
        return points;
      }
      throw error;
    }

    const pagePoints = response.points ?? [];
    points.push(
      ...pagePoints.map((point) => ({
        id: String(point.id),
        payload: point.payload ?? null,
      }))
    );

    if (!response.next_page_offset) {
      break;
    }

    offset = response.next_page_offset;
  }

  return points;
}

export async function reconcileKnowledgeIndex() {
  await ensureQdrantWriteReady();
  const normalizedChunks = await normalizeKnowledgeChunkPointIds();

  const dbChunks = await prisma.knowledgeChunk.findMany({
    select: {
      id: true,
      qdrantPointId: true,
    },
  });
  const dbPointIds = new Set(dbChunks.map((chunk) => chunk.qdrantPointId));
  const dbChunkIds = new Set(dbChunks.map((chunk) => chunk.id));
  const qdrantPoints = await scrollAllQdrantPoints();
  const qdrantPointIds = new Set(qdrantPoints.map((point) => point.id));
  const bm25MissingChunks = await prisma.knowledgeChunk.findMany({
    where: {
      enabled: true,
      knowledgeItem: { status: "published" },
      OR: [{ bm25DocLength: 0 }, { bm25Terms: { none: {} } }],
    },
    select: {
      id: true,
      chunkText: true,
      bm25SearchText: true,
      scopeLevel: true,
      cityName: true,
    },
  });
  const refreshedBm25Chunks = await refreshBm25IndexForChunks(bm25MissingChunks);

  const orphanPointIds = qdrantPoints
    .filter((point) => {
      if (dbPointIds.has(point.id)) {
        return false;
      }
      const chunkId = point.payload?.chunkId ? String(point.payload.chunkId) : null;
      return !chunkId || !dbChunkIds.has(chunkId);
    })
    .map((point) => point.id);
  const missingPointIds = dbChunks
    .filter((chunk) => !qdrantPointIds.has(chunk.qdrantPointId))
    .map((chunk) => chunk.id);

  for (const pointId of orphanPointIds) {
    await qdrant.delete(COLLECTION_NAME, {
      wait: true,
      points: [pointId],
    });
  }

  if (missingPointIds.length) {
    await enqueueUpsertTasksForChunkIds(missingPointIds);
    while (true) {
      const result = await drainKnowledgeIndexTasks({
        limit: Math.max(20, missingPointIds.length),
      });
      if (result.scanned === 0) {
        break;
      }
      if (result.failed > 0) {
        throw new Error("对账回补过程中存在失败任务，请检查 knowledgeIndexTask.lastError");
      }
    }
  }

  return {
    normalizedChunks,
    refreshedBm25Chunks,
    dbChunkCount: dbChunks.length,
    qdrantPointCount: qdrantPoints.length,
    deletedOrphanPoints: orphanPointIds.length,
    reprojectedMissingPoints: missingPointIds.length,
  };
}

export async function rebuildKnowledgeIndex() {
  await ensureQdrantWriteReady();
  const normalizedChunks = await normalizeKnowledgeChunkPointIds();

  const chunks = await prisma.knowledgeChunk.findMany({
    where: { enabled: true, knowledgeItem: { status: "published" } },
    include: { knowledgeItem: true },
    orderBy: [{ knowledgeItemId: "asc" }, { chunkIndex: "asc" }],
  });
  const refreshedBm25Chunks = await refreshBm25IndexForChunks(chunks);

  const qdrantAdmin = qdrant as unknown as {
    deleteCollection?: (collectionName: string) => Promise<unknown>;
  };

  try {
    await qdrantAdmin.deleteCollection?.(COLLECTION_NAME);
  } catch {
    // 集合不存在时忽略。
  }

  await prisma.knowledgeIndexTask.deleteMany({
    where: {
      status: {
        in: [KnowledgeIndexTaskStatus.pending, KnowledgeIndexTaskStatus.processing],
      },
    },
  });

  if (!chunks.length) {
    return {
      rebuiltChunks: 0,
      refreshedBm25Chunks,
    };
  }

  const taskInputs = await buildUpsertTaskInputs(chunks);
  await prisma.knowledgeIndexTask.createMany({
    data: taskInputs.map(({ chunk, pointId, payloadJson }) => ({
      taskType: KnowledgeIndexTaskType.upsert,
      status: KnowledgeIndexTaskStatus.pending,
      knowledgeItemId: chunk.knowledgeItemId,
      chunkId: chunk.id,
      pointId,
      payloadJson,
    })),
  });

  while (true) {
    const result = await drainKnowledgeIndexTasks({ limit: 50 });
    if (result.scanned === 0) {
      break;
    }
    if (result.failed > 0) {
      throw new Error("全量重建过程中存在失败任务，请检查 knowledgeIndexTask.lastError");
    }
  }

  return {
    normalizedChunks,
    rebuiltChunks: chunks.length,
    refreshedBm25Chunks,
  };
}
