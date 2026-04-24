import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export async function getRuntimeSettings() {
  const list = await prisma.appSetting.findMany();
  const map = new Map(list.map((item) => [item.key, item.value]));

  return {
    retrievalTopK: Number(map.get("RETRIEVAL_TOP_K") ?? env.RETRIEVAL_TOP_K),
    rerankTopN: Number(map.get("RERANK_TOP_N") ?? env.RERANK_TOP_N),
    kbHitThreshold: Number(map.get("KB_HIT_THRESHOLD") ?? env.KB_HIT_THRESHOLD),
    maxContextTurns: Number(map.get("MAX_CONTEXT_TURNS") ?? env.MAX_CONTEXT_TURNS)
  };
}

