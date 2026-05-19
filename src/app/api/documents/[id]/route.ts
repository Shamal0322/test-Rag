import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { deleteDocumentVectors } from "@/lib/qdrant/client";
import { ragConfig } from "@/lib/rag/config";
import { removeUpload } from "@/lib/storage/uploads";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      chunks: {
        orderBy: {
          chunkIndex: "asc",
        },
        select: {
          id: true,
          text: true,
          pageNumber: true,
          chunkIndex: true,
          tokenCount: true,
          qdrantPointId: true,
          createdAt: true,
        },
      },
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Dokument nicht gefunden." }, { status: 404 });
  }

  return NextResponse.json({
    document: {
      id: document.id,
      filename: document.filename,
      originalName: document.originalName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      status: document.status,
      errorMessage: document.errorMessage,
      extractedChars: document.extractedChars,
      chunkCount: document.chunkCount ?? document.chunks.length,
      embeddingModel: document.embeddingModel,
      indexedAt: document.indexedAt,
      processingStartedAt: document.processingStartedAt,
      processingFinishedAt: document.processingFinishedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      parsingStats: {
        extractedChars: document.extractedChars,
      },
      indexingStats: {
        chunkCount: document.chunkCount ?? document.chunks.length,
        embeddingModel: document.embeddingModel,
        indexedAt: document.indexedAt,
        processingStartedAt: document.processingStartedAt,
        processingFinishedAt: document.processingFinishedAt,
      },
      chunkingConfig: {
        chunkSizeChars: ragConfig.chunkSizeChars,
        chunkOverlapChars: ragConfig.chunkOverlapChars,
        minChunkChars: ragConfig.minChunkChars,
        maxChunkChars: ragConfig.maxChunkChars,
      },
      chunks: document.chunks.slice(0, 20),
    },
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const document = await prisma.document.findUnique({
    where: { id },
  });

  if (!document) {
    return NextResponse.json({ error: "Dokument nicht gefunden." }, { status: 404 });
  }

  try {
    await deleteDocumentVectors(id);
  } catch {
    // Die SQLite-Daten bleiben die Quelle der Wahrheit. Qdrant kann lokal leer sein.
  }

  await prisma.document.delete({ where: { id } });
  await removeUpload(document.filename);

  return NextResponse.json({ ok: true });
}
