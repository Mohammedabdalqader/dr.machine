// SAMPLE COMPANY ONLY: approves every draft that passes the approval rules, as the
// sample engineer, through the normal `records` function (versions, embeddings,
// audit log). Real companies review each draft in the app instead.
//   npx deno run -A scripts/approve-sample-drafts.ts
import { createClient } from 'npm:@supabase/supabase-js@2';

const root = new URL('../', import.meta.url);
const env = Object.fromEntries(
  (await Deno.readTextFile(new URL('mobile/.env.local', root)))
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const users = JSON.parse(await Deno.readTextFile(new URL('supabase/.sample-users.local.json', root))).created_users;
const client = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error } = await client.auth.signInWithPassword(users.engineer);
if (error) throw error;

const { data: company } = await client.from('companies').select('is_sample').single();
if (!company?.is_sample) throw new Error('Refusing: this script only runs against the SAMPLE company');

const { data: drafts } = await client.from('fault_records').select('id, title').eq('status', 'draft');
let ok = 0;
for (const d of drafts ?? []) {
  const res = await client.functions.invoke('records', {
    body: { action: 'approve', id: d.id, note: 'bulk-approved by script for sample evaluation' },
  });
  if (res.error) console.log('  not approved:', d.title, await res.error.context?.text?.());
  else ok++;
}
console.log(`approved ${ok}/${drafts?.length ?? 0}`);
