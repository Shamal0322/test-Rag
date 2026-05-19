import { NextResponse } from "next/server";
import { NvidiaEmbeddingClient } from "@/lib/nvidia/embeddingClient";
import { NvidiaLlmClient } from "@/lib/nvidia/llmClient";
import { prisma } from "@/lib/prisma/client";
import { searchVectors } from "@/lib/qdrant/client";
import {
  buildStrictRetryInstruction,
  validateGroundedAnswer,
} from "@/lib/rag/answerValidator";
import {
  detectAmbiguity,
  isCompareQuestion,
  type RagMode,
} from "@/lib/rag/ambiguity";
import { evaluateConfidence, type ConfidenceLevel } from "@/lib/rag/confidence";
import { ragConfig } from "@/lib/rag/config";
import { rankDocuments, type RankedDocument } from "@/lib/rag/documentRanking";
import { buildRagMessages, type RagSource } from "@/lib/rag/promptBuilder";
import { selectContextSources } from "@/lib/rag/selectContextSources";

export const runtime = "nodejs";

type AnswerPayload = {
  question?: string;
  limit?: number;
  documentIds?: string[];
  mode?: RagMode;
};

type SourceResponse = {
  sourceId: string;
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  documentName: string;
  pageNumber: number | null;
  score: number;
  preview: string;
};

type SourceGroupResponse = {
  documentId: string;
  documentName: string;
  sources: SourceResponse[];
};

type AnswerSource = SourceResponse & {
  text: string;
};

type RetrievalHit = {
  chunkId: string;
  score: number;
};

const NO_MATCH_ANSWER =
  "Ich habe in den hochgeladenen Dokumenten keine passenden Informationen gefunden.";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnswerPayload;
    const question = body.question?.trim();
    const documentIds = normalizeDocumentIds(body.documentIds);
    const requestedMode = normalizeMode(body.mode);
    const mode: RagMode = requestedMode === "auto" && isCompareQuestion(question ?? "")
      ? "compare"
      : requestedMode;
    const retrievalLimit = Math.min(
      Math.max(Number(body.limit ?? ragConfig.retrievalLimit), 1),
      ragConfig.retrievalLimit,
    );

    if (!question) {
      return NextResponse.json({ error: "Frage fehlt." }, { status: 400 });
    }

    const indexedDocuments = await prisma.document.count({
      where: {
        status: "indexed",
        ...(documentIds.length ? { id: { in: documentIds } } : {}),
      },
    });

    if (!indexedDocuments) {
      return NextResponse.json({
        answer: "Lade zuerst ein Dokument hoch und warte, bis es indexiert ist.",
        sources: [],
        sourceGroups: [],
        rankedDocuments: [],
        ambiguity: false,
        ambiguousDocuments: [],
        suggestedAction: null,
        confidence: "low" satisfies ConfidenceLevel,
        confidenceReason: "Es existieren keine indexierten Dokumente.",
        usedModel: "not-called",
      });
    }

    const retrievalStartedAt = Date.now();
    const hits = await retrieveCandidateHits(question, retrievalLimit, documentIds);

    if (!hits.length) {
      return NextResponse.json({
        answer: NO_MATCH_ANSWER,
        sources: [],
        sourceGroups: [],
        rankedDocuments: [],
        ambiguity: false,
        ambiguousDocuments: [],
        suggestedAction: null,
        confidence: "low" satisfies ConfidenceLevel,
        confidenceReason: "Retrieval hat keine passenden Chunks gefunden.",
        debug: emptyDebug(Date.now() - retrievalStartedAt),
        usedModel: "not-called",
      });
    }

    const retrievedSources = await buildSources(hits);

    if (!retrievedSources.length) {
      return NextResponse.json({
        answer: NO_MATCH_ANSWER,
        sources: [],
        sourceGroups: [],
        rankedDocuments: [],
        ambiguity: false,
        ambiguousDocuments: [],
        suggestedAction: null,
        confidence: "low" satisfies ConfidenceLevel,
        confidenceReason: "Retrieval Treffer konnten keinen gespeicherten Chunks zugeordnet werden.",
        debug: emptyDebug(Date.now() - retrievalStartedAt),
        usedModel: "not-called",
      });
    }

    const rankedDocuments = rankDocuments(question, retrievedSources);
    const ambiguityResult = detectAmbiguity({
      question,
      rankedDocuments,
      mode,
      selectedDocumentIds: documentIds,
    });

    if (ambiguityResult.ambiguity) {
      const ambiguousSources = sourcesForRankedDocuments(
        retrievedSources,
        ambiguityResult.ambiguousDocuments,
      );

      return NextResponse.json({
        answer: buildAmbiguityAnswer(ambiguityResult.ambiguousDocuments),
        sources: toPublicSources(ambiguousSources),
        sourceGroups: groupPublicSourcesByDocument(toPublicSources(ambiguousSources)),
        rankedDocuments,
        ambiguity: true,
        ambiguousDocuments: ambiguityResult.ambiguousDocuments,
        suggestedAction: ambiguityResult.suggestedAction,
        debug: {
          retrievedCount: retrievedSources.length,
          afterMinScoreCount: retrievedSources.filter((source) => source.score >= ragConfig.minScore).length,
          afterDedupeCount: retrievedSources.length,
          finalContextCount: ambiguousSources.length,
          documentsUsed: new Set(ambiguousSources.map((source) => source.documentId)).size,
          droppedBecauseLowScore: retrievedSources.filter((source) => source.score < ragConfig.minScore).length,
          droppedBecauseDuplicate: 0,
          droppedBecauseDocumentLimit: 0,
          retrievalDurationMs: Date.now() - retrievalStartedAt,
          llmDurationMs: 0,
        },
        confidence: "medium" satisfies ConfidenceLevel,
        confidenceReason: ambiguityResult.reason,
        usedModel: "not-called",
      });
    }

    const selection = selectContextSources({
      candidates: retrievedSources,
      rankedDocuments,
      config: ragConfig,
      mode,
    });
    const sources = selection.selectedSources;
    const retrievalDurationMs = Date.now() - retrievalStartedAt;

    if (!sources.length) {
      return NextResponse.json({
        answer:
          "Die hochgeladenen Dokumente enthalten dazu keine ausreichende Information. Die gefundenen Quellen liegen unter dem Mindestscore.",
        sources: [],
        sourceGroups: [],
        rankedDocuments,
        ambiguity: false,
        ambiguousDocuments: [],
        suggestedAction: null,
        confidence: "low" satisfies ConfidenceLevel,
        confidenceReason: `Keine Quelle erreicht den Mindestscore ${ragConfig.minScore.toFixed(2)}.`,
        debug: {
          ...selection.stats,
          retrievalDurationMs,
          llmDurationMs: 0,
        },
        usedModel: "not-called",
      });
    }

    const { confidence, confidenceReason } = evaluateConfidence({
      sources: sources.map((source) => ({
        score: source.score,
        documentId: source.documentId,
        text: source.text,
      })),
    });

    if (confidence === "low") {
      return NextResponse.json({
        answer:
          "Die hochgeladenen Dokumente enthalten dazu keine ausreichende Information. Die gefundenen Quellen sind zu schwach für eine sichere Antwort.",
        sources: toPublicSources(sources),
        sourceGroups: groupPublicSourcesByDocument(toPublicSources(sources)),
        rankedDocuments,
        debug: {
          ...selection.stats,
          retrievalDurationMs,
          llmDurationMs: 0,
        },
        confidence,
        confidenceReason,
        usedModel: "not-called",
      });
    }

    const promptSources: RagSource[] = sources.map((source) => ({
      sourceId: source.sourceId,
      documentId: source.documentId,
      documentName: source.documentName,
      pageNumber: source.pageNumber,
      score: source.score,
      text: source.text,
    }));

    const llmClient = new NvidiaLlmClient();
    const messages = buildRagMessages(question, promptSources, { mode });
    const llmStartedAt = Date.now();
    let answer = await llmClient.complete({
      messages,
      temperature: 0.2,
      maxTokens: 800,
    });
    let validation = validateGroundedAnswer({
      answer,
      sourceIds: sources.map((source) => source.sourceId),
      confidence,
    });

    if (!validation.ok) {
      answer = await llmClient.complete({
        messages: [
          ...messages,
          { role: "assistant", content: answer },
          { role: "user", content: buildStrictRetryInstruction(validation.reason) },
        ],
        temperature: 0,
        maxTokens: 500,
      });
      validation = validateGroundedAnswer({
        answer,
        sourceIds: sources.map((source) => source.sourceId),
        confidence,
      });
    }

    if (!validation.ok) {
      answer = validation.safeAnswer;
    }

    return NextResponse.json({
      answer,
      sources: toPublicSources(sources),
      sourceGroups: groupPublicSourcesByDocument(toPublicSources(sources)),
      rankedDocuments,
      ambiguity: false,
      ambiguousDocuments: [],
      suggestedAction: null,
      debug: {
        ...selection.stats,
        retrievalDurationMs,
        llmDurationMs: Date.now() - llmStartedAt,
      },
      confidence,
      confidenceReason: validation.ok
        ? confidenceReason
        : `${confidenceReason} Antwortvalidierung: ${validation.reason}`,
      usedModel: llmClient.model,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Antwortgenerierung fehlgeschlagen.",
      },
      { status: 500 },
    );
  }
}

function toPublicSources(sources: AnswerSource[]): SourceResponse[] {
  return sources.map((source) => ({
    sourceId: source.sourceId,
    documentId: source.documentId,
    chunkId: source.chunkId,
    chunkIndex: source.chunkIndex,
    documentName: source.documentName,
    pageNumber: source.pageNumber,
    score: source.score,
    preview: source.preview,
  }));
}

function groupPublicSourcesByDocument(sources: SourceResponse[]): SourceGroupResponse[] {
  const groups = new Map<string, SourceGroupResponse>();

  for (const source of sources) {
    const group = groups.get(source.documentId) ?? {
      documentId: source.documentId,
      documentName: source.documentName,
      sources: [],
    };
    group.sources.push(source);
    groups.set(source.documentId, group);
  }

  return Array.from(groups.values());
}

async function retrieveCandidateHits(
  question: string,
  limit: number,
  documentIds: string[],
): Promise<RetrievalHit[]> {
  const embeddingClient = new NvidiaEmbeddingClient({ batchSize: 1 });
  const subqueries = buildSubqueries(question);
  const merged = new Map<string, RetrievalHit>();

  for (const subquery of subqueries) {
    const [queryVector] = await embeddingClient.embed(subquery, "query");
    const vectorHits = await searchVectors(queryVector, Math.max(limit, 8), {
      documentIds,
    });

    for (const hit of vectorHits) {
      const payload = hit.payload as Record<string, unknown> | null | undefined;
      const chunkId = typeof payload?.chunkId === "string" ? payload.chunkId : null;

      if (!chunkId) continue;

      mergeHit(merged, {
        chunkId,
        score: hit.score,
      });
    }
  }

  for (const hit of await lexicalChunkSearch(question, limit, documentIds)) {
    mergeHit(merged, hit);
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function mergeHit(merged: Map<string, RetrievalHit>, hit: RetrievalHit) {
  const existing = merged.get(hit.chunkId);
  if (!existing || hit.score > existing.score) {
    merged.set(hit.chunkId, hit);
  }
}

function buildSubqueries(question: string) {
  const normalized = question.replace(/\?/g, " ? ");
  const parts = normalized
    .split(/\s+(?:und|oder|sowie|außerdem|ausserdem)\s+|\?/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8);

  return Array.from(new Set([question, ...parts])).slice(0, 5);
}

async function lexicalChunkSearch(
  question: string,
  limit: number,
  documentIds: string[],
): Promise<RetrievalHit[]> {
  const queryTerms = tokenize(question);
  if (!queryTerms.length) return [];

  const chunks = await prisma.chunk.findMany({
    where: documentIds.length
      ? {
          documentId: {
            in: documentIds,
          },
        }
      : undefined,
    include: {
      document: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 1200,
  });

  const queryText = normalizeText(question);
  const hits = chunks
    .map((chunk) => {
      const haystack = normalizeText(`${chunk.document.originalName} ${chunk.text}`);
      let matches = 0;

      for (const term of queryTerms) {
        if (haystack.includes(term)) {
          matches += 1;
        }
      }

      matches += getDomainHintBoost(queryText, haystack);

      if (matches <= 0) return null;

      const score = Math.min(0.58, 0.28 + matches * 0.07);

      return {
        chunkId: chunk.id,
        score,
      };
    })
    .filter((hit): hit is RetrievalHit => Boolean(hit))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return hits;
}

function getDomainHintBoost(queryText: string, haystack: string) {
  let boost = 0;

  if (
    /(bewerber|lebenslauf|zertifikat|zertifikate|abschluss|qualifikation)/.test(queryText) &&
    /(lebenslauf|cv|resume|bewerber|zertifikat|zertifikate|certificate|certification|abschluss|qualifikation)/.test(
      haystack,
    )
  ) {
    boost += 4;
  }

  if (
    /(haus|wohnflaeche|wohnfläche|expose|exposé|immobilie)/.test(queryText) &&
    /(haus|wohnflaeche|wohnfläche|expose|exposé|immobilie)/.test(haystack)
  ) {
    boost += 2;
  }

  return boost;
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

async function buildSources(hits: RetrievalHit[]): Promise<AnswerSource[]> {
  const hitData = hits;

  const chunks = await prisma.chunk.findMany({
    where: {
      id: {
        in: hitData.map((hit) => hit.chunkId),
      },
    },
    include: {
      document: true,
    },
  });

  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

  return hitData
    .map((hit, index) => {
      const chunk = chunkById.get(hit.chunkId);
      if (!chunk) return null;

      return {
        sourceId: `S${index + 1}`,
        documentId: chunk.documentId,
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        documentName: chunk.document.originalName,
        pageNumber: chunk.pageNumber,
        score: hit.score,
        preview: chunk.text.slice(0, 700),
        text: chunk.text,
      };
    })
    .filter((source): source is AnswerSource => Boolean(source));
}

function resequenceSources(sources: AnswerSource[]) {
  return sources.map((source, index) => ({
    ...source,
    sourceId: `S${index + 1}`,
  }));
}

function sourcesForRankedDocuments(
  sources: AnswerSource[],
  rankedDocuments: RankedDocument[],
) {
  const documentIds = new Set(rankedDocuments.map((document) => document.documentId));
  return resequenceSources(
    sources
      .filter((source) => documentIds.has(source.documentId))
      .sort((a, b) => b.score - a.score)
      .slice(0, ragConfig.contextLimit),
  );
}

function emptyDebug(retrievalDurationMs: number) {
  return {
    retrievedCount: 0,
    afterMinScoreCount: 0,
    afterDedupeCount: 0,
    finalContextCount: 0,
    documentsUsed: 0,
    droppedBecauseLowScore: 0,
    droppedBecauseDuplicate: 0,
    droppedBecauseDocumentLimit: 0,
    retrievalDurationMs,
    llmDurationMs: 0,
  };
}

function buildAmbiguityAnswer(rankedDocuments: RankedDocument[]) {
  return [
    "Ich habe relevante Stellen in mehreren Dokumenten gefunden. Bitte wähle aus, ob ich eines davon verwenden oder alle vergleichen soll.",
    "",
    ...rankedDocuments.map((document) => `- ${document.documentName}: ${document.reason}`),
  ].join("\n");
}

function normalizeDocumentIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)),
  );
}

function normalizeMode(value: unknown): RagMode {
  return value === "selected" || value === "compare" ? value : "auto";
}
