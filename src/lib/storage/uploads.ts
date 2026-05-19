import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { ALLOWED_EXTENSIONS, env } from "@/lib/config";

export const uploadDir = path.join(process.cwd(), "storage", "uploads");

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/octet-stream",
]);

export function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function getExtension(filename: string) {
  return path.extname(filename).toLowerCase();
}

export function validateUpload(file: File) {
  const extension = getExtension(file.name);
  const maxBytes = env.maxUploadMb * 1024 * 1024;

  if (!ALLOWED_EXTENSIONS.includes(extension as (typeof ALLOWED_EXTENSIONS)[number])) {
    throw new Error("Nur PDF, TXT und Markdown Dateien sind erlaubt.");
  }

  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error(`MIME Type ${file.type} ist nicht erlaubt.`);
  }

  if (file.size > maxBytes) {
    throw new Error(`Die Datei ist größer als ${env.maxUploadMb} MB.`);
  }
}

export async function saveUpload(file: File) {
  await mkdir(uploadDir, { recursive: true });

  const extension = getExtension(file.name);
  const filename = `${uuidv4()}${extension}`;
  const targetPath = path.join(uploadDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());

  await writeFile(targetPath, buffer);

  return {
    filename,
    path: targetPath,
    sizeBytes: buffer.byteLength,
    originalName: sanitizeFilename(file.name),
    mimeType: file.type || mimeTypeFromExtension(extension),
  };
}

export async function removeUpload(filename: string) {
  try {
    await unlink(path.join(uploadDir, filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function mimeTypeFromExtension(extension: string) {
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".md") return "text/markdown";
  return "text/plain";
}
