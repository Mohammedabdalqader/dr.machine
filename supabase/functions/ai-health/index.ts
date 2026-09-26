// Reports which AI provider and models are active, and optionally runs a tiny
// live check of chat + embeddings. Used to verify the DeepInfra key after setup.
// Signed-in users only (a live check costs AI credits).
//   GET  /functions/v1/ai-health           -> configuration only (no AI cost)
//   GET  /functions/v1/ai-health?live=1    -> also calls the provider once
import { withSupabase } from 'npm:@supabase/server@^1';

import { getAI } from '../_shared/ai/index.ts';

export default {
  fetch: withSupabase({ auth: 'user' }, async (req) => {
    const { provider, config } = getAI();
    const live = new URL(req.url).searchParams.get('live') === '1';

    const report: Record<string, unknown> = {
      provider: provider.name,
      models: config.models,
      embeddingDim: config.embeddingDim,
    };

    if (live) {
      try {
        const chat = await provider.chatJSON({
          purpose: 'reasoning',
          messages: [
            { role: 'system', content: 'Reply only with JSON.' },
            { role: 'user', content: 'Return {"ok": true, "arabic": "<the Arabic word for compressor>"}' },
          ],
          maxTokens: 50,
          validate: (v) => v as { ok: boolean; arabic?: string },
          mock: () => ({ ok: true, arabic: 'ضاغط' }),
        });
        const emb = await provider.embed(['high discharge temperature', 'حرارة عالية']);
        report.chat = { ...chat.data, latencyMs: chat.usage.latencyMs };
        report.embedding = { count: emb.vectors.length, dim: emb.vectors[0]?.length, latencyMs: emb.usage.latencyMs };
      } catch (err) {
        report.error = (err as Error).message;
      }
    }

    return Response.json(report, { status: report.error ? 502 : 200 });
  }),
};
