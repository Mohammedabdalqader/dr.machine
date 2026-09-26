/**
 * Provider-neutral AI interface used by every Edge Function.
 * Business logic (diagnosis, ingestion) depends only on this file, so the
 * provider can be swapped (DeepInfra today, a self-hosted vLLM on-premise later).
 */

/** What a call is for. Each purpose maps to a model in config.ts. */
export type Purpose = 'reasoning' | 'extraction' | 'vision';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }; // https URL or data: URI

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
};

export type Usage = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
};

export type ChatJSONOptions<T> = {
  purpose: Purpose;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Validates and narrows the parsed JSON; throw to reject it. */
  validate: (value: unknown) => T;
  /** Raw (model-shaped) answer used by the mock provider; it also goes through `validate`. */
  mock: () => unknown;
};

export type ChatJSONResult<T> = { data: T; usage: Usage };

export interface AIProvider {
  readonly name: string;
  chatJSON<T>(options: ChatJSONOptions<T>): Promise<ChatJSONResult<T>>;
  /** One vector per input text, all of length config.embeddingDim. */
  embed(texts: string[]): Promise<{ vectors: number[][]; usage: Usage }>;
  transcribe(audio: Blob, language?: 'ar' | 'en'): Promise<{ text: string; usage: Usage }>;
}

export class AIError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = 'AIError';
  }
}
