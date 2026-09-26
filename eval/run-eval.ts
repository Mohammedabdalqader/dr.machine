// Runs the held-out test set through the deployed `diagnose` function as the
// sample technician and scores it (product brief, section 09).
//
//   npx deno run -A eval/run-eval.ts            all cases
//   npx deno run -A eval/run-eval.ts T01 T26    selected cases
//
// A suggested record counts as correct when most of its past cases belong to the
// expected fault in the ground truth (data/sample/reference/fault_catalog_clean.json).
// Results are written to eval/results/<timestamp>.json and .md.
import { createClient } from 'npm:@supabase/supabase-js@2';

const root = new URL('../', import.meta.url);
const env = Object.fromEntries(
  (await Deno.readTextFile(new URL('mobile/.env.local', root)))
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const users = JSON.parse(await Deno.readTextFile(new URL('supabase/.sample-users.local.json', root))).created_users;
const truth = JSON.parse(await Deno.readTextFile(new URL('data/sample/reference/fault_catalog_clean.json', root)));
const testSet = JSON.parse(await Deno.readTextFile(new URL('eval/test_set.json', root)));

type TestCase = { id: string; machine: string; text: string; error_code: string | null; expected: string | null };
type Cause = { record_id: string; title: string; record_title: string; confidence: string; model_confidence: string; evidence_level: string; past_cases: number };
type Diagnosis = { id: string; status: string; causes: Cause[]; safety_notes: string[]; latency_ms: number };

const client = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error } = await client.auth.signInWithPassword(users.technician);
if (error) throw error;

// record -> true fault, by majority of its linked past cases
const faultOfRef = new Map<string, string>();
for (const f of truth.faults) for (const ref of f.log_refs) faultOfRef.set(ref, f.id);
const { data: records } = await client.from('fault_records').select('id, fault_cases(source_ref)').eq('status', 'approved');
const faultOfRecord = new Map<string, string>();
for (const r of records ?? []) {
  const votes = new Map<string, number>();
  for (const c of r.fault_cases) {
    const f = faultOfRef.get(c.source_ref);
    if (f) votes.set(f, (votes.get(f) ?? 0) + 1);
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) faultOfRecord.set(r.id, best[0]);
}

const { data: machines } = await client.from('machines').select('id, tag');
const machineId = new Map((machines ?? []).map((m) => [m.tag, m.id]));

const only = new Set(Deno.args);
const cases: TestCase[] = testSet.cases.filter((c: TestCase) => !only.size || only.has(c.id));

async function run(c: TestCase) {
  const arabic = /[؀-ۿ]/.test(c.text);
  const { data, error: fnError } = await client.functions.invoke('diagnose', {
    body: { machine_id: machineId.get(c.machine), text: c.text, error_code: c.error_code ?? '', language: arabic ? 'ar' : 'en' },
  });
  if (fnError) return { case: c, error: (await fnError.context?.text?.()) ?? fnError.message };
  const d = data as Diagnosis;
  // Evidence similarities, for tuning the confidence gate.
  const { data: row } = await client.from('diagnoses').select('evidence').eq('id', d.id).single();
  const evidence = (row?.evidence?.candidates ?? []) as { id: string; similarity: number; code_match: boolean }[];
  const suggested = d.causes.map((x) => faultOfRecord.get(x.record_id) ?? '?');
  const expectedEvidence = evidence.find((e) => faultOfRecord.get(e.id) === c.expected);
  return {
    case: c,
    status: d.status,
    suggested,
    top1: c.expected !== null && suggested[0] === c.expected,
    top3: c.expected !== null && suggested.includes(c.expected),
    declined: d.status === 'not_enough_data',
    confidence: d.causes[0]?.confidence ?? null,
    titles: d.causes.map((x) => `${x.record_title} (${x.confidence}; model ${x.model_confidence}, evidence ${x.evidence_level})`),
    safety_ok: d.status !== 'answered' || d.safety_notes.length > 0,
    latency_ms: d.latency_ms,
    max_similarity: Math.max(0, ...evidence.map((e) => e.similarity)),
    expected_similarity: expectedEvidence?.similarity ?? null,
    expected_retrieved: expectedEvidence !== undefined,
  };
}

// A few at a time: fast, without hammering the AI provider.
const results: Awaited<ReturnType<typeof run>>[] = [];
for (let i = 0; i < cases.length; i += 3) {
  results.push(...(await Promise.all(cases.slice(i, i + 3).map(run))));
  console.log(`  ${Math.min(i + 3, cases.length)}/${cases.length}`);
}

const ok = results.filter((r): r is Exclude<typeof r, { error: string }> => !('error' in r));
const known = ok.filter((r) => r.case.expected !== null);
const unknown = ok.filter((r) => r.case.expected === null);
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '-');
const latencies = ok.map((r) => r.latency_ms).sort((a, b) => a - b);
const q = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))];

const summary = {
  cases: results.length,
  errors: results.length - ok.length,
  top1: pct(known.filter((r) => r.top1).length, known.length),
  top3: pct(known.filter((r) => r.top3).length, known.length),
  retrieval_recall: pct(known.filter((r) => r.expected_retrieved).length, known.length),
  correct_not_enough_data: pct(unknown.filter((r) => r.declined).length, unknown.length),
  wrongly_declined: known.filter((r) => r.declined).length,
  safety_coverage: pct(ok.filter((r) => r.safety_ok).length, ok.length),
  latency_p50_ms: q(0.5),
  latency_p95_ms: q(0.95),
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
await Deno.mkdir(new URL('eval/results/', root), { recursive: true });
await Deno.writeTextFile(new URL(`eval/results/${stamp}.json`, root), JSON.stringify({ summary, results }, null, 2));

const rows = results.map((r) =>
  'error' in r
    ? `| ${r.case.id} | ${r.case.expected ?? 'none'} | ERROR | ${String(r.error).slice(0, 80)} |`
    : `| ${r.case.id} | ${r.case.expected ?? 'none'} | ${r.declined ? 'not enough data' : r.suggested.join(', ')} | ${
        r.case.expected === null ? (r.declined ? 'correct' : 'WRONG: should decline') : r.top1 ? 'top 1' : r.top3 ? 'top 3' : 'MISS'
      } (sim ${r.expected_similarity?.toFixed(2) ?? '-'} / max ${r.max_similarity.toFixed(2)}, ${(r.latency_ms / 1000).toFixed(1)}s) |`,
);
const md = `# Evaluation ${stamp}\n\n${Object.entries(summary)
  .map(([k, v]) => `- **${k}**: ${v}`)
  .join('\n')}\n\n| Case | Expected | Suggested | Result |\n|---|---|---|---|\n${rows.join('\n')}\n`;
await Deno.writeTextFile(new URL(`eval/results/${stamp}.md`, root), md);
console.log(md);
