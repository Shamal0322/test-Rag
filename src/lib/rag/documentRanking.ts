export type RankingChunk = {
  sourceId?: string;
  chunkId?: string;
  documentId: string;
  documentName: string;
  score: number;
  text: string;
  preview?: string;
};

export type RankedDocument = {
  documentId: string;
  documentName: string;
  score: number;
  topChunks: RankingChunk[];
  reason: string;
};

const MIN_RELEVANT_SCORE = 0.35;

export function rankDocuments(question: string, chunks: RankingChunk[]): RankedDocument[] {
  const grouped = new Map<string, RankingChunk[]>();

  for (const chunk of chunks) {
    const current = grouped.get(chunk.documentId) ?? [];
    current.push(chunk);
    grouped.set(chunk.documentId, current);
  }

  return Array.from(grouped.entries())
    .map(([documentId, documentChunks]) => {
      const sortedChunks = [...documentChunks].sort((a, b) => b.score - a.score);
      const topChunks = sortedChunks.slice(0, 3);
      const bestScore = topChunks[0]?.score ?? 0;
      const averageTopScore =
        topChunks.reduce((sum, chunk) => sum + chunk.score, 0) / Math.max(topChunks.length, 1);
      const relevantCount = sortedChunks.filter((chunk) => chunk.score >= MIN_RELEVANT_SCORE).length;
      const overlap = getKeywordOverlap(question, sortedChunks);
      const countScore = Math.min(relevantCount, 5) * 0.025;
      const overlapScore = Math.min(overlap, 6) * 0.012;
      const score = bestScore * 0.55 + averageTopScore * 0.3 + countScore + overlapScore;

      return {
        documentId,
        documentName: sortedChunks[0]?.documentName ?? "Unbekanntes Dokument",
        score: Number(score.toFixed(4)),
        topChunks,
        reason: buildReason(bestScore, averageTopScore, relevantCount, overlap),
      };
    })
    .sort((a, b) => b.score - a.score);
}

function buildReason(
  bestScore: number,
  averageTopScore: number,
  relevantCount: number,
  overlap: number,
) {
  const parts = [
    `bester Treffer ${bestScore.toFixed(2)}`,
    `Top-3-Durchschnitt ${averageTopScore.toFixed(2)}`,
    `${relevantCount} relevante Treffer`,
  ];

  if (overlap > 0) {
    parts.push(`${overlap} Begriffsüberschneidungen`);
  }

  return parts.join(", ");
}

function getKeywordOverlap(question: string, chunks: RankingChunk[]) {
  const queryTerms = tokenize(question);
  if (!queryTerms.length) return 0;

  const documentText = normalizeText(
    chunks.map((chunk) => `${chunk.documentName} ${chunk.text}`).join(" "),
  );

  return queryTerms.filter((term) => documentText.includes(term)).length;
}

function tokenize(input: string) {
  const stopwords = new Set([
    "aber",
    "alle",
    "auch",
    "der",
    "die",
    "das",
    "den",
    "dem",
    "des",
    "ein",
    "eine",
    "einer",
    "eines",
    "hat",
    "haben",
    "ist",
    "mit",
    "und",
    "oder",
    "viel",
    "was",
    "welche",
    "welcher",
    "welches",
    "wie",
    "zu",
  ]);

  return Array.from(
    new Set(
      normalizeText(input)
        .split(/[^a-z0-9äöüß]+/i)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3 && !stopwords.has(term)),
    ),
  );
}

function normalizeText(input: string) {
  return input
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}
