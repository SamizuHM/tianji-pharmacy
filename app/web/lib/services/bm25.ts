export type Bm25Document<T> = {
  id: string;
  text: string;
  payload: T;
};

export type Bm25ScoredDocument<T> = Bm25Document<T> & {
  score: number;
};

const BM25_K1 = 1.5;
const BM25_B = 0.75;

export function tokenizeForBm25(text: string) {
  const normalized = text.toLowerCase();
  const terms = normalized.match(/[a-z0-9]+|[\u4e00-\u9fa5]{2,}|[\u4e00-\u9fa5]/g) ?? [];
  const grams: string[] = [];

  for (const term of terms) {
    grams.push(term);
    if (/^[\u4e00-\u9fa5]{3,}$/.test(term)) {
      for (let i = 0; i < term.length - 1; i += 1) {
        grams.push(term.slice(i, i + 2));
      }
    }
  }

  return grams.filter((term) => term.trim().length > 0);
}

export function scoreBm25Documents<T>(
  query: string,
  documents: Array<Bm25Document<T>>,
  options?: { limit?: number }
): Array<Bm25ScoredDocument<T>> {
  const queryTerms = Array.from(new Set(tokenizeForBm25(query)));
  if (!queryTerms.length || !documents.length) {
    return [];
  }

  const tokenizedDocs = documents.map((document) => {
    const tokens = tokenizeForBm25(document.text);
    const termFrequency = new Map<string, number>();
    for (const token of tokens) {
      termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    }
    return { document, tokens, termFrequency };
  });

  const averageDocLength =
    tokenizedDocs.reduce((sum, item) => sum + item.tokens.length, 0) / tokenizedDocs.length || 1;
  const docFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    docFrequency.set(
      term,
      tokenizedDocs.reduce((count, item) => count + (item.termFrequency.has(term) ? 1 : 0), 0)
    );
  }

  return tokenizedDocs
    .map(({ document, tokens, termFrequency }) => {
      const score = queryTerms.reduce((sum, term) => {
        const frequency = termFrequency.get(term) ?? 0;
        if (!frequency) {
          return sum;
        }
        const df = docFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
        const docLength = tokens.length || 1;
        const numerator = frequency * (BM25_K1 + 1);
        const denominator =
          frequency + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / averageDocLength));
        return sum + idf * (numerator / denominator);
      }, 0);
      return { ...document, score };
    })
    .filter((document) => document.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options?.limit ?? documents.length);
}
