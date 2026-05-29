export type KnowledgeChunkingMode = "general" | "parent_child" | "qa";

export type PreprocessingRule = {
  removeExtraSpaces: boolean;
  removeUrlsEmails: boolean;
};

export type GeneralChunkingRule = {
  mode: "general";
  separator: string;
  maxLength: number;
  overlap: number;
};

export type ParentChildChunkingRule = {
  mode: "parent_child";
  parentMode: "paragraph" | "full_doc";
  parentSeparator: string;
  parentMaxLength: number;
  childSeparator: string;
  childMaxLength: number;
  childOverlap: number;
};

export type QaChunkingRule = {
  mode: "qa";
};

export type DocumentChunkingRule = GeneralChunkingRule | ParentChildChunkingRule | QaChunkingRule;

export type DocumentChunkingConfig = {
  preprocessing: PreprocessingRule;
  rule: DocumentChunkingRule;
};

export type ChunkPlan = {
  text: string;
  sectionPath?: string;
  parentIndex?: number;
  metadata?: Record<string, unknown>;
};

export type QaInput = {
  question: string;
  answer: string;
  categoryL1?: string;
  categoryL2?: string | null;
  tags?: string[];
};

const RECURSIVE_SEPARATORS = ["\n\n", "\n", "。", ". ", " ", ""];

export const DEFAULT_DOCUMENT_CHUNKING_CONFIG: DocumentChunkingConfig = {
  preprocessing: {
    removeExtraSpaces: true,
    removeUrlsEmails: false,
  },
  rule: {
    mode: "general",
    separator: "\n\n",
    maxLength: 1024,
    overlap: 50,
  },
};

export const DEFAULT_PARENT_CHILD_CHUNKING_CONFIG: DocumentChunkingConfig = {
  preprocessing: {
    removeExtraSpaces: true,
    removeUrlsEmails: false,
  },
  rule: {
    mode: "parent_child",
    parentMode: "paragraph",
    parentSeparator: "\n\n",
    parentMaxLength: 1024,
    childSeparator: "\n",
    childMaxLength: 512,
    childOverlap: 50,
  },
};

export const DEFAULT_QA_CHUNKING_CONFIG: DocumentChunkingConfig = {
  preprocessing: {
    removeExtraSpaces: true,
    removeUrlsEmails: false,
  },
  rule: {
    mode: "qa",
  },
};

export function normalizeEscapedSeparator(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
}

export function normalizeTextForChunking(text: string, preprocessing: PreprocessingRule) {
  let normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (preprocessing.removeUrlsEmails) {
    normalized = normalized
      .replace(/https?:\/\/[^\s]+/gi, " ")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ");
  }

  if (preprocessing.removeExtraSpaces) {
    normalized = normalized
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  return normalized.trim();
}

function clampPositiveInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
) {
  const next = Number.isFinite(value) ? Math.trunc(value ?? fallback) : fallback;
  return Math.min(max, Math.max(min, next));
}

export function sanitizeChunkingConfig(
  input?: Partial<DocumentChunkingConfig>
): DocumentChunkingConfig {
  const mode = input?.rule?.mode ?? DEFAULT_DOCUMENT_CHUNKING_CONFIG.rule.mode;
  const preprocessing = {
    removeExtraSpaces: input?.preprocessing?.removeExtraSpaces ?? true,
    removeUrlsEmails: input?.preprocessing?.removeUrlsEmails ?? false,
  };

  if (mode === "qa") {
    return { preprocessing, rule: { mode: "qa" } };
  }

  if (mode === "parent_child") {
    const defaultRule = DEFAULT_PARENT_CHILD_CHUNKING_CONFIG.rule as ParentChildChunkingRule;
    const rule: ParentChildChunkingRule =
      input?.rule?.mode === "parent_child" ? input.rule : defaultRule;
    const childMaxLength = clampPositiveInteger(rule.childMaxLength, 512, 64, 4000);
    return {
      preprocessing,
      rule: {
        mode: "parent_child",
        parentMode: rule.parentMode === "full_doc" ? "full_doc" : "paragraph",
        parentSeparator: normalizeEscapedSeparator(rule.parentSeparator, "\n\n"),
        parentMaxLength: clampPositiveInteger(rule.parentMaxLength, 1024, 128, 8000),
        childSeparator: normalizeEscapedSeparator(rule.childSeparator, "\n"),
        childMaxLength,
        childOverlap: Math.min(
          clampPositiveInteger(rule.childOverlap, 50, 0, 1000),
          childMaxLength - 1
        ),
      },
    };
  }

  const defaultRule = DEFAULT_DOCUMENT_CHUNKING_CONFIG.rule as GeneralChunkingRule;
  const rule: GeneralChunkingRule = input?.rule?.mode === "general" ? input.rule : defaultRule;
  const maxLength = clampPositiveInteger(rule.maxLength, 1024, 64, 12000);
  return {
    preprocessing,
    rule: {
      mode: "general",
      separator: normalizeEscapedSeparator(rule.separator, "\n\n"),
      maxLength,
      overlap: Math.min(clampPositiveInteger(rule.overlap, 50, 0, 4000), maxLength - 1),
    },
  };
}

function splitBySeparator(text: string, separator: string, keepSeparator = true) {
  if (!separator) return Array.from(text);
  const parts = text.split(separator);
  if (!keepSeparator) return parts.filter((part) => part && part !== "\n");
  return parts
    .map((part, index) => (index < parts.length - 1 ? `${part}${separator}` : part))
    .filter((part) => part && part !== "\n");
}

function mergeSplits(splits: string[], separator: string, chunkSize: number, overlap: number) {
  const docs: string[] = [];
  const current: string[] = [];
  let total = 0;
  const separatorLength = separator.length;

  for (const split of splits) {
    const splitLength = split.length;
    const projected = total + splitLength + (current.length > 0 ? separatorLength : 0);
    if (projected > chunkSize && current.length > 0) {
      const doc = current.join(separator).trim();
      if (doc) docs.push(doc);

      while (
        current.length > 0 &&
        (total > overlap ||
          total + splitLength + (current.length > 0 ? separatorLength : 0) > chunkSize)
      ) {
        const removed = current.shift() ?? "";
        total -= removed.length + (current.length > 0 ? separatorLength : 0);
      }
    }

    current.push(split);
    total += splitLength + (current.length > 1 ? separatorLength : 0);
  }

  const tail = current.join(separator).trim();
  if (tail) docs.push(tail);
  return docs;
}

export function recursiveCharacterSplit(
  text: string,
  chunkSize: number,
  overlap: number,
  separators = RECURSIVE_SEPARATORS
): string[] {
  if (!text.trim()) return [];

  let separator = separators[separators.length - 1] ?? "";
  let rest: string[] = [];
  for (const candidate of separators) {
    if (!candidate || text.includes(candidate)) {
      separator = candidate;
      rest = separators.slice(separators.indexOf(candidate) + 1);
      break;
    }
  }

  const splits = splitBySeparator(text, separator, true);
  const goodSplits: string[] = [];
  const finalChunks: string[] = [];
  const joinSeparator = separator ? "" : "";

  for (const split of splits) {
    if (split.length < chunkSize) {
      goodSplits.push(split);
      continue;
    }

    if (goodSplits.length) {
      finalChunks.push(...mergeSplits(goodSplits.splice(0), joinSeparator, chunkSize, overlap));
    }

    if (!rest.length) {
      finalChunks.push(split.trim());
    } else {
      finalChunks.push(...recursiveCharacterSplit(split, chunkSize, overlap, rest));
    }
  }

  if (goodSplits.length) {
    finalChunks.push(...mergeSplits(goodSplits, joinSeparator, chunkSize, overlap));
  }

  return finalChunks.map((chunk) => chunk.trim()).filter(Boolean);
}

export function fixedRecursiveSplit(input: {
  text: string;
  separator: string;
  chunkSize: number;
  overlap: number;
}) {
  const fixedParts = input.separator ? input.text.split(input.separator) : [input.text];
  return fixedParts.flatMap((part) => {
    const trimmed = part.trim();
    if (!trimmed) return [];
    if (trimmed.length <= input.chunkSize) return [trimmed];
    return recursiveCharacterSplit(trimmed, input.chunkSize, input.overlap);
  });
}

export function chunkPlainText(text: string, config: DocumentChunkingConfig): ChunkPlan[] {
  const sanitized = sanitizeChunkingConfig(config);
  const normalized = normalizeTextForChunking(text, sanitized.preprocessing);
  if (!normalized) return [];

  if (sanitized.rule.mode === "qa") {
    return [{ text: normalized, sectionPath: "全文" }];
  }

  if (sanitized.rule.mode === "parent_child") {
    const rule = sanitized.rule as ParentChildChunkingRule;
    const parents =
      rule.parentMode === "full_doc"
        ? [normalized]
        : fixedRecursiveSplit({
            text: normalized,
            separator: rule.parentSeparator,
            chunkSize: rule.parentMaxLength,
            overlap: 0,
          });

    return parents.flatMap((parent, parentIndex) => {
      const children = fixedRecursiveSplit({
        text: parent,
        separator: rule.childSeparator,
        chunkSize: rule.childMaxLength,
        overlap: rule.childOverlap,
      });
      return children.map((child, childIndex) => ({
        text: child,
        parentIndex,
        sectionPath: `父片段 ${parentIndex + 1} / 子片段 ${childIndex + 1}`,
        metadata: {
          parentText: parent,
          parentMode: sanitized.rule.mode,
        },
      }));
    });
  }

  return fixedRecursiveSplit({
    text: normalized,
    separator: (sanitized.rule as GeneralChunkingRule).separator,
    chunkSize: (sanitized.rule as GeneralChunkingRule).maxLength,
    overlap: (sanitized.rule as GeneralChunkingRule).overlap,
  }).map((chunk, index) => ({
    text: chunk,
    sectionPath: `片段 ${index + 1}`,
  }));
}

export function chunkQaItems(items: QaInput[], config: DocumentChunkingConfig): ChunkPlan[] {
  const preprocessing = sanitizeChunkingConfig(config).preprocessing;
  const chunks: ChunkPlan[] = [];
  items.forEach((item, index) => {
    const question = normalizeTextForChunking(item.question, preprocessing);
    const answer = normalizeTextForChunking(item.answer, preprocessing);
    if (!question || !answer) return;
    chunks.push({
      text: `问题：${question}\n答案：${answer}`,
      sectionPath:
        [item.categoryL1, item.categoryL2].filter(Boolean).join(" / ") || `QA ${index + 1}`,
      metadata: {
        question,
        answer,
        tags: item.tags ?? [],
      },
    });
  });
  return chunks;
}
