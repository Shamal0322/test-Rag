import type { RagMode } from "@/lib/rag/ambiguity";
import type { RagRuntimeConfig } from "@/lib/rag/config";
import type { RankedDocument } from "@/lib/rag/documentRanking";
import { dedupeSources, type DedupeSource } from "@/lib/rag/dedupeSources";

export type ContextSelectionStats = {
  retrievedCount: number;
  afterMinScoreCount: number;
  afterDedupeCount: number;
  finalContextCount: number;
  documentsUsed: number;
  droppedBecauseLowScore: number;
  droppedBecauseDuplicate: number;
  droppedBecauseDocumentLimit: number;
};

export type ContextSelectionResult<T extends DedupeSource> = {
  selectedSources: T[];
  stats: ContextSelectionStats;
};

export function selectContextSources<T extends DedupeSource>(params: {
  candidates: T[];
  rankedDocuments: RankedDocument[];
  config: RagRuntimeConfig;
  mode?: RagMode;
}): ContextSelectionResult<T> {
  const { candidates, rankedDocuments, config, mode = "auto" } = params;
  const aboveMinScore = candidates.filter((source) => source.score >= config.minScore);
  const droppedBecauseLowScore = candidates.length - aboveMinScore.length;
  const deduped = dedupeSources(aboveMinScore);
  const selected: T[] = [];
  const perDocumentCount = new Map<string, number>();
  let droppedBecauseDocumentLimit = 0;

  const orderedDocumentIds = rankedDocuments.map((document) => document.documentId);
  const rankedDocumentSet = new Set(orderedDocumentIds);
  const candidatesByDocument = groupByDocument(deduped.sources);

  for (const documentId of orderedDocumentIds) {
    const documentCandidates = candidatesByDocument.get(documentId) ?? [];

    for (const candidate of documentCandidates) {
      const currentCount = perDocumentCount.get(candidate.documentId) ?? 0;
      const maxPerDocument = config.maxChunksPerDocument;

      if (currentCount >= maxPerDocument) {
        droppedBecauseDocumentLimit += 1;
        continue;
      }

      selected.push(candidate);
      perDocumentCount.set(candidate.documentId, currentCount + 1);

      if (selected.length >= config.contextLimit) {
        return buildResult({
          candidates,
          aboveMinScore,
          dedupedSources: deduped.sources,
          selected,
          droppedBecauseLowScore,
          droppedBecauseDuplicate: deduped.droppedBecauseDuplicate,
          droppedBecauseDocumentLimit,
        });
      }
    }

    if (mode !== "compare" && selected.length >= config.maxChunksPerDocument) {
      break;
    }
  }

  for (const candidate of deduped.sources) {
    if (rankedDocumentSet.has(candidate.documentId)) continue;
    if (selected.some((source) => source.chunkId === candidate.chunkId)) continue;

    const currentCount = perDocumentCount.get(candidate.documentId) ?? 0;
    if (currentCount >= config.maxChunksPerDocument) {
      droppedBecauseDocumentLimit += 1;
      continue;
    }

    selected.push(candidate);
    perDocumentCount.set(candidate.documentId, currentCount + 1);

    if (selected.length >= config.contextLimit) break;
  }

  return buildResult({
    candidates,
    aboveMinScore,
    dedupedSources: deduped.sources,
    selected,
    droppedBecauseLowScore,
    droppedBecauseDuplicate: deduped.droppedBecauseDuplicate,
    droppedBecauseDocumentLimit,
  });
}

function groupByDocument<T extends DedupeSource>(sources: T[]) {
  const groups = new Map<string, T[]>();

  for (const source of sources) {
    const group = groups.get(source.documentId) ?? [];
    group.push(source);
    groups.set(source.documentId, group);
  }

  return groups;
}

function buildResult<T extends DedupeSource>(params: {
  candidates: T[];
  aboveMinScore: T[];
  dedupedSources: T[];
  selected: T[];
  droppedBecauseLowScore: number;
  droppedBecauseDuplicate: number;
  droppedBecauseDocumentLimit: number;
}): ContextSelectionResult<T> {
  const selectedSources = resequenceSources(params.selected);

  return {
    selectedSources,
    stats: {
      retrievedCount: params.candidates.length,
      afterMinScoreCount: params.aboveMinScore.length,
      afterDedupeCount: params.dedupedSources.length,
      finalContextCount: selectedSources.length,
      documentsUsed: new Set(selectedSources.map((source) => source.documentId)).size,
      droppedBecauseLowScore: params.droppedBecauseLowScore,
      droppedBecauseDuplicate: params.droppedBecauseDuplicate,
      droppedBecauseDocumentLimit: params.droppedBecauseDocumentLimit,
    },
  };
}

function resequenceSources<T extends DedupeSource>(sources: T[]) {
  return sources.map((source, index) => ({
    ...source,
    sourceId: `S${index + 1}`,
  }));
}
