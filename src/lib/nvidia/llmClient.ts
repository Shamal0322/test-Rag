import { env } from "@/lib/config";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

export class NvidiaLlmClient {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options?: { model?: string }) {
    if (!env.nvidiaApiKey) {
      throw new Error("NVIDIA_API_KEY ist nicht gesetzt.");
    }

    const model = options?.model?.trim() || env.nvidiaLlmModel;

    if (!model) {
      throw new Error("NVIDIA_LLM_MODEL ist nicht gesetzt.");
    }

    this.apiKey = env.nvidiaApiKey;
    this.baseUrl = env.nvidiaLlmBaseUrl.replace(/\/$/, "");
    this.model = model;
  }

  async complete(options: {
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  }) {
    const controller = new AbortController();
    const timeout = options.timeoutMs
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : null;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 700,
      }),
      signal: controller.signal,
    }).finally(() => {
      if (timeout) clearTimeout(timeout);
    });

    const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;

    if (!response.ok) {
      throw new Error(
        payload.error?.message ??
          `NVIDIA Chat Completion Request fehlgeschlagen (${response.status}).`,
      );
    }

    const content = payload.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error("NVIDIA Chat Completion Antwort enthält keinen Text.");
    }

    return content;
  }
}
