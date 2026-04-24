import { QdrantClient } from "@qdrant/js-client-rest";

import { env } from "@/lib/env";

export const COLLECTION_NAME = "pharmacy_kb";

export const qdrant = new QdrantClient({
  url: env.QDRANT_URL
});

export async function ensureCollection(vectorSize: number) {
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((item) => item.name === COLLECTION_NAME);

  if (!exists) {
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: {
        size: vectorSize,
        distance: "Cosine"
      }
    });
  }
}

