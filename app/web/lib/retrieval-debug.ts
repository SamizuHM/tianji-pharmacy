export type KnowledgeSourceDebugItem = {
  chunkId?: string;
  question: string;
  answer?: string;
  sourceFile?: string | null;
  rerankScore: number;
  vectorScore?: number;
  keywordScore?: number;
  rrfScore?: number;
  finalScore?: number;
  scopeLevel?: string | null;
  cityName?: string | null;
  sources?: string[];
  usedAsReference?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export function sortKnowledgeSourcesBySimilarity<T extends KnowledgeSourceDebugItem>(
  items: readonly T[]
) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const scoreDiff = right.item.rerankScore - left.item.rerankScore;
      return scoreDiff || left.index - right.index;
    })
    .map(({ item }) => item);
}

export function prepareKnowledgeSourcesForDisplay<T extends KnowledgeSourceDebugItem>(
  items: readonly T[],
  options: { isKbMessage: boolean }
) {
  const sortedSources = sortKnowledgeSourcesBySimilarity(items);
  const hasExplicitReferenceFlag = sortedSources.some(
    (item) => typeof item.usedAsReference === "boolean"
  );

  return sortedSources.map((item, index) => ({
    ...item,
    usedAsReference:
      item.usedAsReference || (options.isKbMessage && !hasExplicitReferenceFlag && index === 0),
  }));
}
