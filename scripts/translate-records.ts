// Generates Arabic versions for approved records that don't have one yet
// (records approved before translations existed), through the `records` function.
//   npx deno run -A scripts/translate-records.ts
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

const { data: records } = await client.from('fault_records').select('id, title, translations').eq('status', 'approved');
const todo = (records ?? []).filter((r) => !r.translations?.ar);
let ok = 0;
for (let i = 0; i < todo.length; i += 4) {
  await Promise.all(
    todo.slice(i, i + 4).map(async (r) => {
      const res = await client.functions.invoke('records', { body: { action: 'translate', id: r.id } });
      if (res.error) console.log('  failed:', r.title, await res.error.context?.text?.());
      else ok++;
    }),
  );
}
console.log(`translated ${ok}/${todo.length}`);
