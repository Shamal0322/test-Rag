import { ragConfig } from "@/lib/rag/config";
import type { RankedDocument } from "@/lib/rag/documentRanking";

export type RagMode = "auto" | "selected" | "compare";

export type AmbiguityResult = {
  ambiguity: boolean;
  ambiguousDocuments: RankedDocument[];
  suggestedAction: string | null;
  reason: string | null;
};

const COMPARE_TERMS = [
  "vergleiche",
  "vergleich",
  "alle dokumente",
  "übergreifend",
  "zusammen",
  "gegenüberstellen",
  "compare",
  "all documents",
  "across documents",
];

export function isCompareQuestion(question: string) {
  const normalized = normalizeText(question);
  return COMPARE_TERMS.some((term) => normalized.includes(normalizeText(term)));
}

export function detectAmbiguity(params: {
  question: string;
  rankedDocuments: RankedDocument[];
  mode: RagMode;
  selectedDocumentIds?: string[];
}): AmbiguityResult {
  const { question, rankedDocuments, mode, selectedDocumentIds } = params;
  const topDocuments = rankedDocuments.slice(0, 3);
  const hasMultipleDocuments = topDocuments.length >= 2;
  const compare = mode === "compare" || isCompareQuestion(question);
  const filteredToOneDocument = selectedDocumentIds?.length === 1;

  if (!hasMultipleDocuments || compare || filteredToOneDocument) {
    return emptyResult();
  }

  const topScore = topDocuments[0].score;
  const similarDocuments = topDocuments.filter(
    (document) => topScore - document.score <= ragConfig.ambiguityScoreDelta,
  );
  const isGeneral = isGeneralQuestion(question);
  const mentionsDocument = topDocuments.some((document) =>
    normalizeText(question).includes(normalizeText(stripExtension(document.documentName))),
  );

  if (similarDocuments.length >= 2 && isGeneral && !mentionsDocument) {
    return {
      ambiguity: true,
      ambiguousDocuments: similarDocuments,
      suggestedAction:
        "Mehrere Dokumente enthalten ähnliche Treffer. Grenze die Frage ein oder wähle ein Dokument aus.",
      reason: "Mehrere Dokumente liegen beim Document Ranking nah beieinander.",
    };
  }

  return emptyResult();
}

function emptyResult(): AmbiguityResult {
  return {
    ambiguity: false,
    ambiguousDocuments: [],
    suggestedAction: null,
    reason: null,
  };
}

function isGeneralQuestion(question: string) {
  const normalized = normalizeText(question);

  if (/\b(in|aus|laut)\s+[\w.-]+\.(pdf|txt|md)\b/.test(normalized)) {
    return false;
  }

  const specificMarkers = [
    "vertrag",
    "contract",
    "policy",
    "handbuch",
    "manual",
    "richtlinie",
    "exposé",
    "lebenslauf",
    "rechnung",
  ];

  return !specificMarkers.some((marker) => normalized.includes(normalizeText(marker)));
}

function stripExtension(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

function normalizeText(input: string) {
  return input
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}
