import type { ConfidenceLevel } from "@/lib/rag/confidence";

export type AnswerValidationResult =
  | { ok: true }
  | { ok: false; reason: string; safeAnswer: string };

const SAFE_FALLBACK =
  "Die hochgeladenen Dokumente enthalten dazu keine ausreichende Information.";

export function validateGroundedAnswer(options: {
  answer: string;
  sourceIds: string[];
  confidence: ConfidenceLevel;
}): AnswerValidationResult {
  const answer = options.answer.trim();
  const knownSourceIds = new Set(options.sourceIds);
  const citedSourceIds = Array.from(answer.matchAll(/\[(S\d+)\]/g)).map(
    (match) => match[1],
  );

  if (!answer) {
    return {
      ok: false,
      reason: "Antwort ist leer.",
      safeAnswer: SAFE_FALLBACK,
    };
  }

  if (!options.sourceIds.length && !isInsufficientAnswer(answer)) {
    return {
      ok: false,
      reason: "Antwort ohne vorhandene Quellen.",
      safeAnswer: SAFE_FALLBACK,
    };
  }

  if (options.sourceIds.length && citedSourceIds.length === 0) {
    return {
      ok: false,
      reason: "Antwort enthält keine Quellenreferenzen.",
      safeAnswer: SAFE_FALLBACK,
    };
  }

  const inventedSource = citedSourceIds.find((sourceId) => !knownSourceIds.has(sourceId));
  if (inventedSource) {
    return {
      ok: false,
      reason: `Antwort verwendet unbekannte Quelle ${inventedSource}.`,
      safeAnswer: SAFE_FALLBACK,
    };
  }

  if (options.confidence === "low" && !isInsufficientAnswer(answer)) {
    return {
      ok: false,
      reason: "Low Confidence Antwort war nicht vorsichtig genug.",
      safeAnswer:
        "Die Quellenlage ist schwach. Die hochgeladenen Dokumente enthalten dazu keine ausreichende Information.",
    };
  }

  return { ok: true };
}

export function buildStrictRetryInstruction(validationReason: string) {
  return [
    "Die vorherige Antwort wurde verworfen.",
    `Grund: ${validationReason}`,
    "Antworte erneut und halte dich strikt an diese Regeln:",
    "Jede inhaltliche Aussage braucht eine Quellenreferenz wie [S1].",
    "Verwende nur Quellen IDs, die im Kontext vorkommen.",
    'Wenn das nicht möglich ist, antworte exakt: "Die hochgeladenen Dokumente enthalten dazu keine ausreichende Information."',
  ].join("\n");
}

function isInsufficientAnswer(answer: string) {
  return /keine ausreichende information|quellenlage ist schwach|nicht ausreichend|nicht in den quellen/i.test(
    answer,
  );
}
