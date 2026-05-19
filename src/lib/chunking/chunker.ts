import { ragConfig } from "@/lib/rag/config";

export type TextChunk = {
  text: string;
  chunkIndex: number;
  tokenCount: number;
  pageNumber?: number;
};

type TextUnit = {
  text: string;
  pageNumber?: number;
};

type DraftChunk = {
  text: string;
  pageNumber?: number;
};

export function estimateTokenCount(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function chunkText(text: string): TextChunk[] {
  const normalized = normalizeForChunking(text);
  if (!normalized) return [];

  const units = splitIntoUnits(normalized);
  const drafts = mergeSmallChunks(buildDraftChunks(units));

  return drafts
    .map((chunk) => ({
      ...chunk,
      text: chunk.text.trim(),
    }))
    .filter((chunk) => chunk.text.length > 0)
    .map((chunk, index) => ({
      text: chunk.text,
      pageNumber: chunk.pageNumber,
      chunkIndex: index,
      tokenCount: estimateTokenCount(chunk.text),
    }));
}

function normalizeForChunking(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function splitIntoUnits(text: string): TextUnit[] {
  const units: TextUnit[] = [];
  const pageSections = splitByPageMarkers(text);

  for (const section of pageSections) {
    const paragraphs = section.text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    for (const paragraph of paragraphs) {
      for (const part of splitLongParagraph(paragraph)) {
        units.push({ text: part, pageNumber: section.pageNumber });
      }
    }
  }

  return units;
}

function splitByPageMarkers(text: string): TextUnit[] {
  const matches = Array.from(text.matchAll(/^--- Seite (\d+) ---$/gm));
  if (!matches.length) return [{ text }];

  return matches
    .map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[index + 1]?.index ?? text.length;
      return {
        pageNumber: Number(match[1]),
        text: text.slice(start, end).trim(),
      };
    })
    .filter((section) => section.text.length > 0);
}

function splitLongParagraph(paragraph: string) {
  if (paragraph.length <= ragConfig.maxChunkChars) {
    return [paragraph];
  }

  const sentences = paragraph
    .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/)
    .flatMap((sentence) => splitLongSentence(sentence.trim()))
    .filter(Boolean);

  const units: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;

    if (current && next.length > ragConfig.chunkSizeChars) {
      units.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }

  if (current) {
    units.push(current);
  }

  return units;
}

function splitLongSentence(sentence: string) {
  if (sentence.length <= ragConfig.maxChunkChars) {
    return [sentence];
  }

  const parts: string[] = [];
  let remaining = sentence;

  while (remaining.length > ragConfig.maxChunkChars) {
    const splitAt = findBoundary(remaining, ragConfig.chunkSizeChars);
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

function buildDraftChunks(units: TextUnit[]): DraftChunk[] {
  const chunks: DraftChunk[] = [];
  let current: TextUnit[] = [];

  for (const unit of units) {
    const nextText = joinUnits([...current, unit]);

    if (
      current.length &&
      nextText.length > ragConfig.chunkSizeChars &&
      joinUnits(current).length >= ragConfig.minChunkChars
    ) {
      pushChunk(chunks, current);
      current = buildOverlapUnits(current);
    }

    current.push(unit);

    const currentText = joinUnits(current);
    if (currentText.length > ragConfig.maxChunkChars) {
      const { head, tail } = splitAtCleanBoundary(currentText, ragConfig.maxChunkChars);
      chunks.push({ text: head, pageNumber: firstPageNumber(current) });
      current = tail
        ? [{ text: `${buildOverlapText(head)} ${tail}`.trim(), pageNumber: firstPageNumber(current) }]
        : [];
    }
  }

  if (current.length) {
    pushChunk(chunks, current);
  }

  return chunks;
}

function pushChunk(chunks: DraftChunk[], units: TextUnit[]) {
  const text = joinUnits(units);
  if (!text) return;

  const previous = chunks[chunks.length - 1];
  if (previous?.text === text) return;

  chunks.push({
    text,
    pageNumber: firstPageNumber(units),
  });
}

function mergeSmallChunks(chunks: DraftChunk[]) {
  const merged: DraftChunk[] = [];

  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (
      chunk.text.length < ragConfig.minChunkChars &&
      previous &&
      previous.text.length + chunk.text.length + 2 <= ragConfig.maxChunkChars
    ) {
      previous.text = `${previous.text}\n\n${chunk.text}`.trim();
      continue;
    }

    merged.push({ ...chunk });
  }

  for (let index = 0; index < merged.length - 1; index += 1) {
    const chunk = merged[index];
    const next = merged[index + 1];

    if (
      chunk.text.length < ragConfig.minChunkChars &&
      chunk.text.length + next.text.length + 2 <= ragConfig.maxChunkChars
    ) {
      next.text = `${chunk.text}\n\n${next.text}`.trim();
      next.pageNumber = chunk.pageNumber ?? next.pageNumber;
      merged.splice(index, 1);
      index -= 1;
    }
  }

  return merged;
}

function buildOverlapUnits(units: TextUnit[]) {
  const text = buildOverlapText(joinUnits(units));
  if (!text) return [];
  return [{ text, pageNumber: units[units.length - 1]?.pageNumber }];
}

function buildOverlapText(text: string) {
  if (ragConfig.chunkOverlapChars <= 0 || text.length <= ragConfig.chunkOverlapChars) {
    return "";
  }

  const start = Math.max(0, text.length - ragConfig.chunkOverlapChars);
  const candidate = text.slice(start);
  const paragraphStart = candidate.search(/\n\n\S/);

  if (paragraphStart >= 0 && paragraphStart < candidate.length * 0.5) {
    return candidate.slice(paragraphStart).trim();
  }

  const sentenceStart = candidate.search(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/);
  if (sentenceStart >= 0 && sentenceStart < candidate.length * 0.55) {
    return candidate.slice(sentenceStart).trim();
  }

  const wordBoundary = candidate.search(/\b[\wÄÖÜäöüß]/);
  return wordBoundary >= 0 ? candidate.slice(wordBoundary).trim() : candidate.trim();
}

function splitAtCleanBoundary(text: string, maxLength: number) {
  const splitAt = findBoundary(text, maxLength);
  return {
    head: text.slice(0, splitAt).trim(),
    tail: text.slice(splitAt).trim(),
  };
}

function findBoundary(text: string, target: number) {
  const lowerBound = Math.floor(target * 0.65);
  const sentenceBoundary = findLastMatchIndex(text.slice(0, target), /[.!?]\s+/g);

  if (sentenceBoundary >= lowerBound) {
    return sentenceBoundary + 1;
  }

  const paragraphBoundary = text.lastIndexOf("\n\n", target);
  if (paragraphBoundary >= lowerBound) {
    return paragraphBoundary;
  }

  const whitespaceBoundary = text.lastIndexOf(" ", target);
  if (whitespaceBoundary >= lowerBound) {
    return whitespaceBoundary;
  }

  const nextWhitespace = text.indexOf(" ", target);
  return nextWhitespace > 0 ? nextWhitespace : target;
}

function findLastMatchIndex(text: string, pattern: RegExp) {
  let last = -1;
  for (const match of text.matchAll(pattern)) {
    last = match.index ?? last;
  }
  return last;
}

function joinUnits(units: TextUnit[]) {
  return units.map((unit) => unit.text.trim()).filter(Boolean).join("\n\n").trim();
}

function firstPageNumber(units: TextUnit[]) {
  return units.find((unit) => typeof unit.pageNumber === "number")?.pageNumber;
}
