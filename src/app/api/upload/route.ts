import { NextResponse } from "next/server";
import { processDocument } from "@/lib/documents/processor";
import { prisma } from "@/lib/prisma/client";
import { saveUpload, validateUpload } from "@/lib/storage/uploads";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Keine Datei gefunden." }, { status: 400 });
    }

    validateUpload(file);
    const saved = await saveUpload(file);

    const document = await prisma.document.create({
      data: {
        filename: saved.filename,
        originalName: saved.originalName,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
        status: "uploaded",
      },
    });

    void processDocument(document.id);

    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload fehlgeschlagen." },
      { status: 400 },
    );
  }
}
