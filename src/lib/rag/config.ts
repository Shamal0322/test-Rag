export type RagRuntimeConfig = {
  chunkSizeChars: number;
  chunkOverlapChars: number;
  minChunkChars: number;
  maxChunkChars: number;
  retrievalLimit: number;
  contextLimit: number;
  maxChunksPerDocument: number;
  minScore: number;
  ambiguityScoreDelta: number;
};

const defaults: RagRuntimeConfig = {
  chunkSizeChars: 1800,
  chunkOverlapChars: 300,
  minChunkChars: 450,
  maxChunkChars: 2400,
  retrievalLimit: 25,
  contextLimit: 5,
  maxChunksPerDocument: 2,
  minScore: 0.45,
  ambiguityScoreDelta: 0.08,
};

export const ragConfig = getRagConfig();

export function getRagConfig(): RagRuntimeConfig {
  const config: RagRuntimeConfig = {
    chunkSizeChars: readNumber("RAG_CHUNK_SIZE_CHARS", defaults.chunkSizeChars),
    chunkOverlapChars: readNumber("RAG_CHUNK_OVERLAP_CHARS", defaults.chunkOverlapChars),
    minChunkChars: readNumber("RAG_MIN_CHUNK_CHARS", defaults.minChunkChars),
    maxChunkChars: readNumber("RAG_MAX_CHUNK_CHARS", defaults.maxChunkChars),
    retrievalLimit: readNumber("RAG_RETRIEVAL_LIMIT", defaults.retrievalLimit),
    contextLimit: readNumber("RAG_CONTEXT_LIMIT", defaults.contextLimit),
    maxChunksPerDocument: readNumber(
      "RAG_MAX_CHUNKS_PER_DOCUMENT",
      defaults.maxChunksPerDocument,
    ),
    minScore: readNumber("RAG_MIN_SCORE", defaults.minScore),
    ambiguityScoreDelta: readNumber(
      "RAG_AMBIGUITY_SCORE_DELTA",
      defaults.ambiguityScoreDelta,
    ),
  };

  const warnings: string[] = [];

  if (config.chunkOverlapChars >= config.chunkSizeChars) {
    warnings.push("RAG_CHUNK_OVERLAP_CHARS muss kleiner als RAG_CHUNK_SIZE_CHARS sein.");
    config.chunkOverlapChars = defaults.chunkOverlapChars;
  }

  if (config.maxChunkChars <= config.chunkSizeChars) {
    warnings.push("RAG_MAX_CHUNK_CHARS muss größer als RAG_CHUNK_SIZE_CHARS sein.");
    config.maxChunkChars = defaults.maxChunkChars;
  }

  if (config.minChunkChars >= config.chunkSizeChars) {
    warnings.push("RAG_MIN_CHUNK_CHARS muss kleiner als RAG_CHUNK_SIZE_CHARS sein.");
    config.minChunkChars = defaults.minChunkChars;
  }

  if (config.contextLimit > config.retrievalLimit) {
    warnings.push("RAG_CONTEXT_LIMIT darf nicht größer als RAG_RETRIEVAL_LIMIT sein.");
    config.contextLimit = defaults.contextLimit;
  }

  if (config.minScore < 0 || config.minScore > 1) {
    warnings.push("RAG_MIN_SCORE muss zwischen 0 und 1 liegen.");
    config.minScore = defaults.minScore;
  }

  if (warnings.length && process.env.NODE_ENV !== "production") {
    console.warn(`RAG Konfiguration korrigiert: ${warnings.join(" ")}`);
  }

  return config;
}

function readNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
