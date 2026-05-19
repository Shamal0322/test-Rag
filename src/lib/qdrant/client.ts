import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "@/lib/config";

export const qdrant = new QdrantClient({
  url: env.qdrantUrl,
  checkCompatibility: false,
});

export type ChunkPayload = {
  chunkId: string;
  documentId: string;
  originalName: string;
  pageNumber: number | null;
  chunkIndex: number;
  preview: string;
};

export async function ensureQdrantCollection(vectorSize: number) {
  let collection: unknown;

  try {
    collection = await qdrant.getCollection(env.qdrantCollectionName);
  } catch {
    await qdrant.createCollection(env.qdrantCollectionName, {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });
    return;
  }

  const existingSize = getCollectionVectorSize(collection);

  if (existingSize && existingSize !== vectorSize) {
    throw new Error(
      `Qdrant Collection ${env.qdrantCollectionName} hat Vector Size ${existingSize}, das aktuelle Embedding Modell liefert aber ${vectorSize}. Lege eine neue QDRANT_COLLECTION_NAME fest oder lösche die alte Collection.`,
    );
  }
}

export async function upsertChunkVectors(
  points: Array<{ id: string; vector: number[]; payload: ChunkPayload }>,
) {
  await qdrant.upsert(env.qdrantCollectionName, {
    wait: true,
    points,
  });
}

function getCollectionVectorSize(collection: unknown) {
  const config = collection as {
    config?: {
      params?: {
        vectors?: { size?: number } | Record<string, { size?: number }>;
      };
    };
  };
  const vectors = config.config?.params?.vectors;

  if (!vectors) return null;
  if ("size" in vectors && typeof vectors.size === "number") return vectors.size;

  const firstVector = Object.values(vectors)[0];
  return firstVector?.size ?? null;
}

export async function deleteDocumentVectors(documentId: string) {
  await qdrant.delete(env.qdrantCollectionName, {
    wait: true,
    filter: {
      must: [{ key: "documentId", match: { value: documentId } }],
    },
  });
}

export async function searchVectors(
  vector: number[],
  limit: number,
  options: { documentIds?: string[] } = {},
) {
  return qdrant.search(env.qdrantCollectionName, {
    vector,
    limit,
    with_payload: true,
    filter: options.documentIds?.length
      ? {
          must: [
            {
              key: "documentId",
              match: { any: options.documentIds },
            },
          ],
        }
      : undefined,
  });
}
