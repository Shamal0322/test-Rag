import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { chunkText } from "@/lib/chunking/chunker";
import { env } from "@/lib/config";
import { NvidiaEmbeddingClient } from "@/lib/nvidia/embeddingClient";
import { prisma } from "@/lib/prisma/client";
import {
  deleteDocumentVectors,
  ensureQdrantCollection,
  upsertChunkVectors,
} from "@/lib/qdrant/client";
import { uploadDir } from "@/lib/storage/uploads";
import { extractTextFromFile } from "./extractText";

export async function processDocument(documentId: string) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) return;

  try {
    await prisma.document.update({
      where: { id: documentId },
      data: {
        processingStartedAt: new Date(),
        processingFinishedAt: null,
        indexedAt: null,
        extractedChars: null,
        chunkCount: null,
        embeddingModel: env.nvidiaEmbeddingModel,
      },
    });

    await deleteDocumentVectors(documentId).catch(() => undefined);
    await prisma.chunk.deleteMany({ where: { documentId } });

    await setStatus(documentId, "parsing");
    const filePath = path.join(uploadDir, document.filename);
    const extracted = await extractTextFromFile(filePath);

    if (extracted.text.length < 40) {
      throw new Error(
        extracted.warnings[0] ??
          "Aus dem Dokument konnte nicht genug Text extrahiert werden.",
      );
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { extractedChars: extracted.text.length },
    });

    await setStatus(documentId, "chunking");
    const chunks = chunkText(extracted.text);

    if (!chunks.length) {
      throw new Error("Es konnten keine Chunks aus dem Dokument erzeugt werden.");
    }

    const createdChunks = await Promise.all(
      chunks.map((chunk) =>
        prisma.chunk.create({
          data: {
            documentId,
            text: chunk.text,
            pageNumber: chunk.pageNumber,
            chunkIndex: chunk.chunkIndex,
            tokenCount: chunk.tokenCount,
          },
        }),
      ),
    );

    await prisma.document.update({
      where: { id: documentId },
      data: { chunkCount: createdChunks.length },
    });

    await setStatus(documentId, "embedding");
    const embeddingClient = new NvidiaEmbeddingClient({ batchSize: 1 });
    const vectors: number[][] = [];

    for (const [index, chunk] of createdChunks.entries()) {
      try {
        const [vector] = await embeddingClient.embed(chunk.text, "passage");
        vectors.push(vector);
      } catch (error) {
        throw new Error(
          [
            `Embedding fehlgeschlagen bei Chunk ${index + 1} von ${createdChunks.length}.`,
            `Chunk Länge: ${chunk.text.length} Zeichen.`,
            error instanceof Error ? error.message : "Unbekannter NVIDIA Fehler.",
          ].join(" "),
        );
      }
    }

    await ensureQdrantCollection(vectors[0].length);

    const pointIds = createdChunks.map(() => uuidv4());
    await upsertChunkVectors(
      createdChunks.map((chunk, index) => ({
        id: pointIds[index],
        vector: vectors[index],
        payload: {
          chunkId: chunk.id,
          documentId,
          originalName: document.originalName,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          preview: chunk.text.slice(0, 500),
        },
      })),
    );

    await Promise.all(
      createdChunks.map((chunk, index) =>
        prisma.chunk.update({
          where: { id: chunk.id },
          data: { qdrantPointId: pointIds[index] },
        }),
      ),
    );

    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: "indexed",
        errorMessage: extracted.warnings.length ? extracted.warnings.join(" ") : null,
        embeddingModel: env.nvidiaEmbeddingModel,
        indexedAt: new Date(),
        processingFinishedAt: new Date(),
      },
    });
  } catch (error) {
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: "failed",
        processingFinishedAt: new Date(),
        errorMessage:
          error instanceof Error ? error.message : "Unbekannter Fehler bei der Verarbeitung.",
      },
    });
  }
}

async function setStatus(documentId: string, status: string) {
  await prisma.document.update({
    where: { id: documentId },
    data: { status, errorMessage: null },
  });
}
