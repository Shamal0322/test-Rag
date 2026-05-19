import { NextResponse } from "next/server";
import { processDocument } from "@/lib/documents/processor";
import { prisma } from "@/lib/prisma/client";

export const runtime = "nodejs";

export async function POST(
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

  if (["parsing", "chunking", "embedding"].includes(document.status)) {
    return NextResponse.json(
      { error: "Dokument wird bereits verarbeitet." },
      { status: 409 },
    );
  }

  await prisma.document.update({
    where: { id },
    data: {
      status: "uploaded",
      errorMessage: null,
    },
  });

  void processDocument(id);

  return NextResponse.json({ ok: true });
}
