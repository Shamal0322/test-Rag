export type DedupeSource = {
  sourceId: string;
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  pageNumber: number | null;
  score: number;
  preview: string;
  text: string;
};

export type DedupeResult<T extends DedupeSource> = {
  sources: T[];
  droppedBecauseDuplicate: number;
};

export function dedupeSources<T extends DedupeSource>(sources: T[]): DedupeResult<T> {
  const selected: T[] = [];
  let droppedBecauseDuplicate = 0;

  for (const source of [...sources].sort((a, b) => b.score - a.score)) {
    const duplicateIndex = selected.findIndex((candidate) => isDuplicate(candidate, source));

    if (duplicateIndex >= 0) {
      droppedBecauseDuplicate += 1;
      if (source.score > selected[duplicateIndex].score) {
        selected[duplicateIndex] = source;
      }
      continue;
    }

    selected.push(source);
  }

  return {
    sources: selected.sort((a, b) => b.score - a.score),
    droppedBecauseDuplicate,
  };
}

function isDuplicate(a: DedupeSource, b: DedupeSource) {
  if (a.chunkId === b.chunkId) return true;
  if (a.documentId === b.documentId && a.chunkIndex === b.chunkIndex) return true;

  if (
    a.documentId === b.documentId &&
    a.pageNumber &&
    b.pageNumber &&
    a.pageNumber === b.pageNumber &&
    areSimilarTextStarts(a.text, b.text)
  ) {
    return true;
  }

  return areSimilarTextStarts(a.preview || a.text, b.preview || b.text);
}

function areSimilarTextStarts(a: string, b: string) {
  const left = normalizeText(a).slice(0, 240);
  const right = normalizeText(b).slice(0, 240);

  if (!left || !right) return false;
  if (left === right) return true;

  const shortest = Math.min(left.length, right.length);
  if (shortest < 80) return false;

  const sharedPrefix = countSharedPrefix(left, right);
  if (sharedPrefix / shortest >= 0.82) return true;

  const leftTokens = new Set(left.split(" ").filter((token) => token.length >= 4));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length >= 4));
  const intersection = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;

  return union > 0 && intersection / union >= 0.86;
}

function countSharedPrefix(a: string, b: string) {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) {
    count += 1;
  }
  return count;
}

function normalizeText(input: string) {
  return input
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
