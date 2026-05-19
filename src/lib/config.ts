export const DOCUMENT_STATUSES = [
  "uploaded",
  "parsing",
  "chunking",
  "embedding",
  "indexed",
  "failed",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".md"] as const;

export const env = {
  databaseUrl: process.env.DATABASE_URL,
  nvidiaApiKey: process.env.NVIDIA_API_KEY,
  nvidiaEmbeddingBaseUrl:
    process.env.NVIDIA_EMBEDDING_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
  nvidiaEmbeddingModel:
    process.env.NVIDIA_EMBEDDING_MODEL ?? "nvidia/nv-embedcode-7b-v1",
  nvidiaEmbeddingTruncate: process.env.NVIDIA_EMBEDDING_TRUNCATE ?? "NONE",
  nvidiaLlmBaseUrl:
    process.env.NVIDIA_LLM_BASE_URL ??
    process.env.NVIDIA_EMBEDDING_BASE_URL ??
    "https://integrate.api.nvidia.com/v1",
  nvidiaLlmModel: process.env.NVIDIA_LLM_MODEL,
  qdrantUrl: process.env.QDRANT_URL ?? "http://localhost:6333",
  qdrantCollectionName:
    process.env.QDRANT_COLLECTION_NAME ?? "nim_document_chunks",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? "20"),
};
