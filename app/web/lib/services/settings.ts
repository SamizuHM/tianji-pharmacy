import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export async function getRuntimeSettings() {
  const list = await prisma.appSetting.findMany();
  const map = new Map(list.map((item) => [item.key, item.value]));

  return {
    retrievalTopK: Number(map.get("RETRIEVAL_TOP_K") ?? env.RETRIEVAL_TOP_K),
    rerankTopN: Number(map.get("RERANK_TOP_N") ?? env.RERANK_TOP_N),
    kbHitThreshold: Number(map.get("KB_HIT_THRESHOLD") ?? env.KB_HIT_THRESHOLD),
    maxContextTurns: Number(map.get("MAX_CONTEXT_TURNS") ?? env.MAX_CONTEXT_TURNS),
    cityScopeWeight: Number(map.get("CITY_SCOPE_WEIGHT") ?? 1.3),
    rerankAlpha: Number(map.get("RERANK_ALPHA") ?? 0.7),
  };
}

export type RuntimeSettingsInput = {
  retrievalTopK: number;
  rerankTopN: number;
  kbHitThreshold: number;
  maxContextTurns: number;
  cityScopeWeight?: number;
  rerankAlpha?: number;
};

export async function updateRuntimeSettings(input: RuntimeSettingsInput) {
  const settings = {
    RETRIEVAL_TOP_K: String(input.retrievalTopK),
    RERANK_TOP_N: String(input.rerankTopN),
    KB_HIT_THRESHOLD: String(input.kbHitThreshold),
    MAX_CONTEXT_TURNS: String(input.maxContextTurns),
    CITY_SCOPE_WEIGHT: String(input.cityScopeWeight ?? 1.3),
    RERANK_ALPHA: String(input.rerankAlpha ?? 0.7),
  };

  for (const [key, value] of Object.entries(settings)) {
    await prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  return getRuntimeSettings();
}
