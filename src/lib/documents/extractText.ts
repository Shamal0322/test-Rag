import { readFile } from "node:fs/promises";
import path from "node:path";

export type ExtractedText = {
  text: string;
  warnings: string[];
};

type PdfTextItem = {
  str: string;
  transform: number[];
  width?: number;
};

type PositionedText = {
  text: string;
  x: number;
  y: number;
};

export async function extractTextFromFile(filePath: string): Promise<ExtractedText> {
  const extension = path.extname(filePath).toLowerCase();
  const buffer = await readFile(filePath);

  if (extension === ".pdf") {
    return extractPdfText(buffer);
  }

  if (extension === ".txt" || extension === ".md") {
    return { text: buffer.toString("utf8").trim(), warnings: [] };
  }

  throw new Error("Nicht unterstützter Dateityp.");
}

async function extractPdfText(buffer: Buffer): Promise<ExtractedText> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
  });
  const document = await loadingTask.promise;
  const rawPageTexts: string[] = [];
  let multiColumnPages = 0;

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .map((item) => toPositionedText(item as PdfTextItem))
      .filter((item): item is PositionedText => Boolean(item));

    const { text, isMultiColumn } = formatPageText(items, viewport.width);
    if (isMultiColumn) {
      multiColumnPages += 1;
    }

    rawPageTexts.push(text);
  }

  const pageTexts = cleanPdfPages(rawPageTexts);
  const text = pageTexts
    .map((pageText, index) => (pageText ? `--- Seite ${index + 1} ---\n${pageText}` : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const warnings: string[] = [];

  if (text.length < 80) {
    warnings.push(
      "Aus dem PDF wurde kaum Text extrahiert. Vermutlich handelt es sich um einen Scan ohne OCR.",
    );
  }

  if (multiColumnPages > 0) {
    warnings.push(
      `Mehrspaltenlayout erkannt: ${multiColumnPages} Seite(n) wurden spaltenweise extrahiert.`,
    );
  }

  return { text, warnings };
}

function cleanPdfPages(pages: string[]) {
  const lineCounts = new Map<string, number>();
  const normalizedPages = pages.map((page) =>
    page
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );

  for (const page of normalizedPages) {
    const seenOnPage = new Set<string>();

    for (const line of page.split("\n")) {
      const normalizedLine = normalizeLine(line);
      if (!normalizedLine || normalizedLine.length > 80) continue;
      seenOnPage.add(normalizedLine);
    }

    for (const line of seenOnPage) {
      lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
    }
  }

  const repeatedThreshold = Math.max(2, Math.ceil(normalizedPages.length * 0.6));

  return normalizedPages.map((page) =>
    page
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        const normalizedLine = normalizeLine(trimmed);

        if (!trimmed) return true;
        if (/^(seite\s*)?\d{1,4}(\s*\/\s*\d{1,4})?$/i.test(trimmed)) return false;
        if (
          normalizedLine.length <= 80 &&
          (lineCounts.get(normalizedLine) ?? 0) >= repeatedThreshold &&
          !hasInformationValue(normalizedLine)
        ) {
          return false;
        }

        return true;
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function normalizeLine(line: string) {
  return line.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasInformationValue(line: string) {
  if (line.length >= 35 && /[.!?:;]/.test(line)) return true;
  if (/\d{2,}/.test(line) && /[a-zäöüß]{4,}/i.test(line)) return true;
  return false;
}

function toPositionedText(item: PdfTextItem): PositionedText | null {
  const text = item.str.replace(/\s+/g, " ").trim();
  if (!text) return null;

  return {
    text,
    x: item.transform[4] ?? 0,
    y: item.transform[5] ?? 0,
  };
}

function formatPageText(items: PositionedText[], pageWidth: number) {
  if (!items.length) {
    return { text: "", isMultiColumn: false };
  }

  const leftItems = items.filter((item) => item.x < pageWidth * 0.48);
  const rightItems = items.filter((item) => item.x >= pageWidth * 0.48);
  const isMultiColumn = leftItems.length >= 8 && rightItems.length >= 8;
  const columns = isMultiColumn ? [leftItems, rightItems] : [items];

  return {
    text: columns
      .map((column) => formatColumnText(column))
      .filter(Boolean)
      .join("\n\n"),
    isMultiColumn,
  };
}

function formatColumnText(items: PositionedText[]) {
  const sorted = [...items].sort((a, b) => {
    const yDiff = b.y - a.y;
    if (Math.abs(yDiff) > 3) return yDiff;
    return a.x - b.x;
  });

  const lines: PositionedText[][] = [];

  for (const item of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) <= 3);

    if (line) {
      line.push(item);
    } else {
      lines.push([item]);
    }
  }

  return lines
    .map((line) =>
      line
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(" "),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
