export type Bm25Document<T> = {
  id: string;
  text: string;
  payload: T;
};

export type Bm25ScoredDocument<T> = Bm25Document<T> & {
  score: number;
};

export type Bm25IndexTermRow = {
  chunkId: string;
  term: string;
  termFrequency: number;
  docLength: number;
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

export function buildBm25TermRows(input: {
  chunkId: string;
  text: string;
  scopeLevel: "common" | "city";
  cityName?: string | null;
}) {
  const tokens = tokenizeForBm25(input.text);
  const termFrequency = new Map<string, number>();
  for (const token of tokens) {
    termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
  }

  const docLength = tokens.length;
  return {
    docLength,
    rows: Array.from(termFrequency.entries()).map(([term, frequency]) => ({
      chunkId: input.chunkId,
      term,
      termFrequency: frequency,
      docLength,
      scopeLevel: input.scopeLevel,
      cityName: input.scopeLevel === "city" ? (input.cityName ?? null) : null,
    })),
  };
}

export function scoreBm25FromTermRows<T>(
  query: string,
  documents: Array<{
    id: string;
    docLength: number;
    payload: T;
  }>,
  termRows: Bm25IndexTermRow[],
  corpus: { documentCount: number; averageDocLength: number },
  options?: { limit?: number }
): Array<{ id: string; payload: T; score: number }> {
  const queryTerms = Array.from(new Set(tokenizeForBm25(query)));
  if (!queryTerms.length || !documents.length || !termRows.length || corpus.documentCount <= 0) {
    return [];
  }

  const rowsByChunk = new Map<string, Map<string, number>>();
  const docFrequency = new Map<string, Set<string>>();
  for (const row of termRows) {
    if (!queryTerms.includes(row.term)) {
      continue;
    }
    if (!rowsByChunk.has(row.chunkId)) {
      rowsByChunk.set(row.chunkId, new Map());
    }
    rowsByChunk.get(row.chunkId)!.set(row.term, row.termFrequency);

    if (!docFrequency.has(row.term)) {
      docFrequency.set(row.term, new Set());
    }
    docFrequency.get(row.term)!.add(row.chunkId);
  }

  const averageDocLength = corpus.averageDocLength || 1;
  return documents
    .map((document) => {
      const termFrequency = rowsByChunk.get(document.id);
      if (!termFrequency) {
        return { ...document, score: 0 };
      }

      const score = queryTerms.reduce((sum, term) => {
        const frequency = termFrequency.get(term) ?? 0;
        if (!frequency) {
          return sum;
        }
        const df = docFrequency.get(term)?.size ?? 0;
        const idf = Math.log(1 + (corpus.documentCount - df + 0.5) / (df + 0.5));
        const docLength = document.docLength || 1;
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
