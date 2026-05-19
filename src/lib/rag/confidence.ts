export type ConfidenceLevel = "high" | "medium" | "low";

export type ConfidenceInput = {
  sources: Array<{
    score: number;
    documentId: string;
    text: string;
  }>;
};

export type ConfidenceResult = {
  confidence: ConfidenceLevel;
  confidenceReason: string;
};

export function evaluateConfidence(input: ConfidenceInput): ConfidenceResult {
  const scores = input.sources.map((source) => source.score).sort((a, b) => b - a);
  const bestScore = scores[0] ?? 0;
  const usableSources = input.sources.filter((source) => source.score >= 0.3);
  const distinctDocuments = new Set(usableSources.map((source) => source.documentId)).size;
  const topGap = bestScore - (scores[1] ?? 0);
  const topicalSupport = countTopicalSupport(input.sources);

  if (!usableSources.length || bestScore < 0.3) {
    return {
      confidence: "low",
      confidenceReason:
        "Der beste Retrieval Treffer liegt unter dem Mindestwert oder es gibt keine brauchbaren Quellen.",
    };
  }

  if (bestScore >= 0.55 && usableSources.length >= 2 && topicalSupport >= 2) {
    return {
      confidence: "high",
      confidenceReason:
        `Starker Top Treffer (${bestScore.toFixed(3)}) und mehrere Quellen stützen dasselbe Thema.`,
    };
  }

  if (bestScore >= 0.4 || usableSources.length >= 2 || distinctDocuments >= 2) {
    return {
      confidence: "medium",
      confidenceReason:
        `Brauchbare Quellen gefunden; bester Score ${bestScore.toFixed(3)}, Abstand zum nächsten Treffer ${topGap.toFixed(3)}.`,
    };
  }

  return {
    confidence: "low",
    confidenceReason:
      `Nur schwache Quellen gefunden; bester Score ${bestScore.toFixed(3)}.`,
  };
}

function countTopicalSupport(sources: ConfidenceInput["sources"]) {
  const termCounts = new Map<string, number>();

  for (const source of sources.slice(0, 5)) {
    const terms = new Set(
      source.text
        .toLowerCase()
        .replace(/ä/g, "ae")
        .replace(/ö/g, "oe")
        .replace(/ü/g, "ue")
        .replace(/ß/g, "ss")
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 5),
    );

    for (const term of terms) {
      termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
    }
  }

  return Array.from(termCounts.values()).filter((count) => count >= 2).length;
}
