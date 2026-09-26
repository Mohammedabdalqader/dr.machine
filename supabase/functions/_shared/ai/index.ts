import { loadAIConfig, type AIConfig } from './config.ts';
import { DeepInfraProvider } from './deepinfra.ts';
import { MockProvider } from './mock.ts';
import type { AIProvider } from './types.ts';

export * from './types.ts';
export type { AIConfig } from './config.ts';

let cached: { provider: AIProvider; config: AIConfig } | null = null;

export function getAI(): { provider: AIProvider; config: AIConfig } {
  if (!cached) {
    const config = loadAIConfig();
    const provider = config.provider === 'deepinfra' ? new DeepInfraProvider(config) : new MockProvider(config);
    cached = { provider, config };
  }
  return cached;
}
