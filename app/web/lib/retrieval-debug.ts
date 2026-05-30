export type KnowledgeSourceDebugItem = {
  question: string;
  sourceFile?: string | null;
  rerankScore: number;
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
