import type { AIConfig } from './config.ts';
import { parseModelJSON } from './json.ts';
import { AIError, type AIProvider, type ChatJSONOptions, type ChatJSONResult, type Usage } from './types.ts';

/**
 * DeepInfra through its OpenAI-compatible API. Any other OpenAI-compatible
 * server (for example vLLM inside a customer plant) works by changing AI_BASE_URL.
 */
export class DeepInfraProvider implements AIProvider {
  readonly name = 'deepinfra';

  constructor(private readonly config: AIConfig) {}

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.config.apiKey}`, ...init.headers },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new AIError(
          `AI provider error ${res.status}: ${body.slice(0, 300)}`,
          res.status,
          res.status === 429 || res.status >= 500,
        );
      }
      return res;
    } catch (err) {
      if (err instanceof AIError) throw err;
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      throw new AIError(aborted ? 'AI provider timed out' : `AI provider unreachable: ${err}`, undefined, true);
    } finally {
      clearTimeout(timer);
    }
  }

  async chatJSON<T>(options: ChatJSONOptions<T>): Promise<ChatJSONResult<T>> {
    const model = this.config.models[options.purpose];
    const started = Date.now();
    // Strict JSON mode first. Some models degrade under constrained decoding
    // (e.g. returning {"": ""}), so a failed attempt is retried once in plain mode.
    let lastError = '';
    for (const jsonMode of [true, false]) {
      const res = await this.request('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: jsonMode
            ? options.messages
            : [...options.messages, { role: 'user', content: 'Answer with the JSON object only, no other text.' }],
          temperature: options.temperature ?? 0.1,
          max_tokens: options.maxTokens ?? 2048,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      const body = await res.json();
      const choice = body.choices?.[0];
      const content: string = choice?.message?.content ?? '';
      try {
        const data = options.validate(parseModelJSON(content));
        return { data, usage: usage(model, body.usage, started) };
      } catch (err) {
        // Keep a short excerpt so failures can be diagnosed from the logs.
        const excerpt = content.replace(/\s+/g, ' ').slice(0, 300);
        lastError = `${(err as Error).message} (finish=${choice?.finish_reason}, json_mode=${jsonMode}). Got: ${excerpt}`;
        console.warn(`invalid JSON from ${model} for ${options.purpose}: ${lastError}`);
      }
    }
    throw new AIError(`AI returned invalid JSON for ${options.purpose} (${model}): ${lastError}`, undefined, true);
  }

  async embed(texts: string[]): Promise<{ vectors: number[][]; usage: Usage }> {
    const model = this.config.models.embedding;
    const started = Date.now();
    const res = await this.request('/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts, encoding_format: 'float' }),
    });
    const body = await res.json();
    const vectors: number[][] = (body.data ?? [])
      .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
      .map((d: { embedding: number[] }) => d.embedding);
    if (vectors.length !== texts.length || vectors.some((v) => v.length !== this.config.embeddingDim)) {
      throw new AIError(
        `Embedding shape mismatch: expected ${texts.length} x ${this.config.embeddingDim}, got ${vectors.length} x ${vectors[0]?.length}`,
      );
    }
    return { vectors, usage: usage(model, body.usage, started) };
  }

  async transcribe(audio: Blob, language?: 'ar' | 'en'): Promise<{ text: string; usage: Usage }> {
    const model = this.config.models.speech;
    const started = Date.now();
    const form = new FormData();
    form.append('file', audio, 'audio.m4a');
    form.append('model', model);
    if (language) form.append('language', language);
    const res = await this.request('/audio/transcriptions', { method: 'POST', body: form });
    const body = await res.json();
    return { text: String(body.text ?? '').trim(), usage: usage(model, body.usage, started) };
  }
}

function usage(model: string, raw: { prompt_tokens?: number; completion_tokens?: number } | undefined, started: number): Usage {
  return {
    model,
    promptTokens: raw?.prompt_tokens ?? 0,
    completionTokens: raw?.completion_tokens ?? 0,
    latencyMs: Date.now() - started,
  };
}
