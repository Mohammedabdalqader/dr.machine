import type { AIConfig } from './config.ts';
import type { AIProvider, ChatJSONOptions, ChatJSONResult, Usage } from './types.ts';

/**
 * Deterministic stand-in used until a real API key is configured.
 * - chatJSON returns the caller's own `mock()` answer (still run through `validate`).
 * - embed uses feature hashing of words and character trigrams, so texts that
 *   share words still land near each other and search can be tested end to end.
 */
export class MockProvider implements AIProvider {
  readonly name = 'mock';

  constructor(private readonly config: AIConfig) {}

  chatJSON<T>(options: ChatJSONOptions<T>): Promise<ChatJSONResult<T>> {
    return Promise.resolve({ data: options.validate(options.mock()), usage: mockUsage('mock-chat') });
  }

  embed(texts: string[]): Promise<{ vectors: number[][]; usage: Usage }> {
    return Promise.resolve({
      vectors: texts.map((t) => hashEmbedding(t, this.config.embeddingDim)),
      usage: mockUsage('mock-embedding'),
    });
  }

  transcribe(): Promise<{ text: string; usage: Usage }> {
    return Promise.resolve({ text: '', usage: mockUsage('mock-speech') });
  }
}

function mockUsage(model: string): Usage {
  return { model, promptTokens: 0, completionTokens: 0, latencyMs: 0 };
}

export function hashEmbedding(text: string, dim: number): number[] {
  const vector = new Array<number>(dim).fill(0);
  const normalized = text.toLowerCase().normalize('NFKC');
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  const features = [...words];
  for (const w of words) {
    const padded = ` ${w} `;
    for (let i = 0; i + 3 <= padded.length; i++) features.push(padded.slice(i, i + 3));
  }
  for (const f of features) {
    const h = fnv1a(f);
    vector[h % dim] += (h & 0x80000000) === 0 ? 1 : -1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((v) => v / norm);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
