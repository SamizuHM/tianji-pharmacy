import { QdrantClient } from "@qdrant/js-client-rest";

import { env } from "@/lib/env";

export const COLLECTION_NAME = "pharmacy_kb";

export const qdrant = new QdrantClient({
  url: env.QDRANT_URL,
  checkCompatibility: true,
});

let qdrantWriteReadyPromise: Promise<void> | null = null;

export async function ensureQdrantWriteReady() {
  if (!qdrantWriteReadyPromise) {
    qdrantWriteReadyPromise = qdrant.getCollections().then(
      () => undefined,
      (error) => {
        qdrantWriteReadyPromise = null;
        throw new Error(
          `Qdrant 写入能力校验失败，请检查服务版本与 SDK 兼容性：${error instanceof Error ? error.message : "未知错误"}`
        );
      }
    );
  }

  return qdrantWriteReadyPromise;
}

export async function ensureCollection(vectorSize: number) {
  await ensureQdrantWriteReady();
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((item) => item.name === COLLECTION_NAME);

  if (!exists) {
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });
  }
}
