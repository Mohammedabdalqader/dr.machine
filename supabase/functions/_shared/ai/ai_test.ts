// Run: npx deno test supabase/functions/_shared --allow-env
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';

import { loadAIConfig } from './config.ts';
import { parseModelJSON } from './json.ts';
import { hashEmbedding, MockProvider } from './mock.ts';

function cosine(a: number[], b: number[]): number {
  return a.reduce((sum, v, i) => sum + v * b[i], 0);
}

Deno.test('parseModelJSON handles plain, fenced and wrapped JSON', () => {
  assertEquals(parseModelJSON('{"a":1}'), { a: 1 });
  assertEquals(parseModelJSON('```json\n{"a":2}\n```'), { a: 2 });
  assertEquals(parseModelJSON('Here you go: {"a":3} hope it helps'), { a: 3 });
  assertThrows(() => parseModelJSON('no json here'));
});

Deno.test('config falls back to mock without an API key', () => {
  Deno.env.delete('DEEPINFRA_API_KEY');
  Deno.env.set('AI_PROVIDER', 'deepinfra');
  assertEquals(loadAIConfig().provider, 'mock');
  Deno.env.set('DEEPINFRA_API_KEY', 'test-key');
  assertEquals(loadAIConfig().provider, 'deepinfra');
  Deno.env.delete('DEEPINFRA_API_KEY');
  Deno.env.delete('AI_PROVIDER');
});

Deno.test('mock embeddings are normalized and similar texts score higher', () => {
  const dim = 1024;
  const a = hashEmbedding('high discharge temperature alarm, trips after 30 minutes', dim);
  const b = hashEmbedding('temperature alarm, compressor trips after half an hour', dim);
  const c = hashEmbedding('oil leak on the floor under the canopy', dim);
  assertEquals(a.length, dim);
  assert(Math.abs(cosine(a, a) - 1) < 1e-9);
  assert(cosine(a, b) > cosine(a, c));
});

Deno.test('mock provider validates its mock answer', async () => {
  const provider = new MockProvider(loadAIConfig());
  const res = await provider.chatJSON({
    purpose: 'reasoning',
    messages: [],
    validate: (v) => {
      if (typeof (v as { ok?: unknown }).ok !== 'boolean') throw new Error('bad');
      return v as { ok: boolean };
    },
    mock: () => ({ ok: true }),
  });
  assertEquals(res.data.ok, true);
});
