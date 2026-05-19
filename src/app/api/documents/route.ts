import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export const runtime = "nodejs";

export async function GET() {
  const documents = await prisma.document.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { chunks: true },
      },
    },
  });

  return NextResponse.json({
    documents: documents.map((document) => ({
      id: document.id,
      filename: document.filename,
      originalName: document.originalName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      status: document.status,
      errorMessage: document.errorMessage,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      chunkCount: document._count.chunks,
    })),
  });
}
