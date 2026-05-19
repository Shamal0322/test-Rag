import { env } from "@/lib/config";

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[]; index?: number }>;
  error?: { message?: string; type?: string; code?: string };
  detail?: unknown;
  message?: string;
};

export type EmbeddingInputType = "query" | "passage";

const MAX_RETRIES = 3;

export class NvidiaEmbeddingClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly batchSize: number;

  constructor(options?: { batchSize?: number }) {
    if (!env.nvidiaApiKey) {
      throw new Error("NVIDIA_API_KEY ist nicht gesetzt.");
    }

    this.apiKey = env.nvidiaApiKey;
    this.baseUrl = env.nvidiaEmbeddingBaseUrl.replace(/\/$/, "");
    this.model = env.nvidiaEmbeddingModel;
    this.batchSize = options?.batchSize ?? 1;
  }

  async embed(input: string | string[], inputType: EmbeddingInputType = "passage") {
    const values = (Array.isArray(input) ? input : [input]).map(sanitizeEmbeddingInput);
    const vectors: number[][] = [];

    for (let index = 0; index < values.length; index += this.batchSize) {
      const batch = values.slice(index, index + this.batchSize);
      vectors.push(...(await this.embedBatch(batch, inputType)));
    }

    return vectors;
  }

  private async embedBatch(input: string[], inputType: EmbeddingInputType) {
    const totalChars = input.reduce((sum, value) => sum + value.length, 0);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            input,
            encoding_format: "float",
            input_type: inputType,
            truncate: env.nvidiaEmbeddingTruncate,
          }),
        });

        const rawText = await response.text();
        const payload = parseEmbeddingPayload(rawText);

        if (!response.ok) {
          throw new Error(
            buildEmbeddingErrorMessage({
              status: response.status,
              payload,
              rawText,
              batchSize: input.length,
              totalChars,
              inputType,
              model: this.model,
            }),
          );
        }

        const vectors = payload.data
          ?.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
          .map((item) => item.embedding)
          .filter((embedding): embedding is number[] => Array.isArray(embedding));

        if (!vectors?.length || vectors.length !== input.length) {
          throw new Error("NVIDIA Embedding Antwort enthält keine gültigen Vektoren.");
        }

        return vectors;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Embedding Request fehlgeschlagen.");

        if (attempt === MAX_RETRIES || !isRetryableError(lastError)) {
          break;
        }

        await wait(900 * (attempt + 1));
      }
    }

    throw lastError ?? new Error("NVIDIA Embedding Request fehlgeschlagen.");
  }
}

function sanitizeEmbeddingInput(input: string) {
  return input
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEmbeddingPayload(rawText: string): EmbeddingResponse {
  if (!rawText) return {};

  try {
    return JSON.parse(rawText) as EmbeddingResponse;
  } catch {
    return { message: rawText.slice(0, 500) };
  }
}

function buildEmbeddingErrorMessage(options: {
  status: number;
  payload: EmbeddingResponse;
  rawText: string;
  batchSize: number;
  totalChars: number;
  inputType: EmbeddingInputType;
  model: string;
}) {
  const details =
    options.payload.error?.message ??
    options.payload.message ??
    summarizeDetail(options.payload.detail) ??
    options.rawText.slice(0, 500) ??
    "Keine Detailmeldung von NVIDIA erhalten.";

  return [
    `NVIDIA Embedding Request fehlgeschlagen (${options.status}).`,
    `Modell: ${options.model}.`,
    `Input-Type: ${options.inputType}.`,
    `Batch: ${options.batchSize} Text(e), ca. ${options.totalChars} Zeichen.`,
    `Details: ${details}`,
    options.status >= 500
      ? "Hinweis: NVIDIA hat einen Serverfehler zurückgegeben; die App versucht kleinere Einzelrequests, aber das Modell oder der Dienst kann temporär instabil sein."
      : "",
  ].join(" ");
}

function summarizeDetail(detail: unknown) {
  if (!detail) return null;
  if (typeof detail === "string") return detail.slice(0, 500);

  try {
    return JSON.stringify(detail).slice(0, 500);
  } catch {
    return null;
  }
}

function isRetryableError(error: Error) {
  return /\((408|429|500|502|503|504)\)/.test(error.message);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
