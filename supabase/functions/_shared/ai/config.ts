import type { Purpose } from './types.ts';

/**
 * All model choices are configuration, not code. Defaults are starting points;
 * the evaluation test set (eval/) decides the final models.
 *
 * Set with: npx supabase secrets set AI_PROVIDER=deepinfra DEEPINFRA_API_KEY=...
 */
export type AIConfig = {
  provider: 'deepinfra' | 'mock';
  baseUrl: string;
  apiKey: string | undefined;
  models: Record<Purpose, string> & { embedding: string; speech: string };
  embeddingDim: number;
  timeoutMs: number;
};

function env(name: string): string | undefined {
  const value = Deno.env.get(name);
  return value && value.trim() !== '' ? value.trim() : undefined;
}

export function loadAIConfig(): AIConfig {
  const apiKey = env('DEEPINFRA_API_KEY');
  // Without a key we fall back to the mock provider, so development never blocks.
  const requested = env('AI_PROVIDER') ?? (apiKey ? 'deepinfra' : 'mock');
  const provider = requested === 'deepinfra' && apiKey ? 'deepinfra' : 'mock';

  return {
    provider,
    baseUrl: env('AI_BASE_URL') ?? 'https://api.deepinfra.com/v1/openai',
    apiKey,
    models: {
      reasoning: env('AI_MODEL_REASONING') ?? 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      extraction: env('AI_MODEL_EXTRACTION') ?? 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      vision: env('AI_MODEL_VISION') ?? 'Qwen/Qwen2.5-VL-32B-Instruct',
      embedding: env('AI_MODEL_EMBEDDING') ?? 'BAAI/bge-m3',
      speech: env('AI_MODEL_SPEECH') ?? 'openai/whisper-large-v3-turbo',
    },
    // bge-m3 produces 1024-dim vectors; the database column must match.
    embeddingDim: Number(env('AI_EMBEDDING_DIM') ?? 1024),
    timeoutMs: Number(env('AI_TIMEOUT_MS') ?? 45_000),
  };
}
