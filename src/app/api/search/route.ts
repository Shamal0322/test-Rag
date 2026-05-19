import { NextResponse } from "next/server";
import { NvidiaEmbeddingClient } from "@/lib/nvidia/embeddingClient";
import { searchVectors } from "@/lib/qdrant/client";
import { ragConfig } from "@/lib/rag/config";
import { rankDocuments } from "@/lib/rag/documentRanking";

export const runtime = "nodejs";

type SearchPayload = {
  question?: string;
  query?: string;
  limit?: number;
  documentIds?: string[];
  mode?: "auto" | "selected" | "compare";
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SearchPayload;
    const query = (body.question ?? body.query)?.trim();
    const documentIds = normalizeDocumentIds(body.documentIds);
    const limit = Math.min(
      Math.max(Number(body.limit ?? ragConfig.retrievalLimit), 1),
      ragConfig.retrievalLimit,
    );

    if (!query) {
      return NextResponse.json({ error: "Suchanfrage fehlt." }, { status: 400 });
    }

    const embeddingClient = new NvidiaEmbeddingClient({ batchSize: 1 });
    const [vector] = await embeddingClient.embed(query, "query");
    const results = await searchVectors(vector, limit, { documentIds });
    const publicResults = results.map((result) => ({
      score: result.score,
      source: result.payload,
    }));

    return NextResponse.json({
      results: publicResults,
      rankedDocuments: rankDocuments(
        query,
        publicResults
          .map((result) => {
            const payload = result.source as Record<string, unknown> | null | undefined;
            const documentId = typeof payload?.documentId === "string" ? payload.documentId : null;
            const chunkId = typeof payload?.chunkId === "string" ? payload.chunkId : undefined;
            const documentName =
              typeof payload?.originalName === "string" ? payload.originalName : "Unbekanntes Dokument";
            const preview = typeof payload?.preview === "string" ? payload.preview : "";

            if (!documentId) return null;

            return {
              chunkId,
              documentId,
              documentName,
              score: result.score,
              text: preview,
              preview,
            };
          })
          .filter((result): result is NonNullable<typeof result> => Boolean(result)),
      ),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Suche fehlgeschlagen." },
      { status: 500 },
    );
  }
}

function normalizeDocumentIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)),
  );
}
