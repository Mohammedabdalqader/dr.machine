// Scores how well the import grouped the sample log, against the ground truth
// in data/sample/reference/fault_catalog_clean.json.
//   npx deno run -A scripts/eval-ingestion.ts
//
// purity:  share of drafts whose cases all belong to one true fault (no mixing)
// splits:  true faults whose cases were spread over more than one draft
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

const faultOfRef = new Map<string, string>();
for (const f of truth.faults) for (const ref of f.log_refs) faultOfRef.set(ref, f.id);

const client = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error } = await client.auth.signInWithPassword(users.engineer);
if (error) throw error;

const { data: records } = await client
  .from('fault_records')
  .select('id, title, root_cause, safety_notes, fix_steps, fault_cases(source_ref)')
  .in('status', ['draft', 'approved']);

let pure = 0;
const draftsPerFault = new Map<string, Set<string>>();
const mixed: string[] = [];
for (const r of records ?? []) {
  const faults = new Set(r.fault_cases.map((c: { source_ref: string }) => faultOfRef.get(c.source_ref) ?? '?'));
  faults.forEach((f) => draftsPerFault.set(f, (draftsPerFault.get(f) ?? new Set()).add(r.id)));
  if (faults.size === 1) pure++;
  else mixed.push(`${r.title} <- ${[...faults].join(', ')}`);
}
const splits = [...draftsPerFault.entries()].filter(([, d]) => d.size > 1);

console.log(`drafts: ${records?.length}   true faults in log: ${truth.faults.length}`);
console.log(`purity: ${pure}/${records?.length} drafts contain a single true fault`);
console.log(`split faults: ${splits.length} (${splits.map(([f, d]) => `${f}x${d.size}`).join(', ')})`);
if (mixed.length) console.log('mixed drafts:\n  ' + mixed.join('\n  '));
console.log(`drafts without safety notes: ${records?.filter((r) => !r.safety_notes.length).length}`);
console.log(`drafts without fix steps: ${records?.filter((r) => !r.fix_steps.length).length}`);
