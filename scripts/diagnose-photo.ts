// Photo-only diagnosis through the deployed function, as the sample technician.
//   npx deno run -A scripts/diagnose-photo.ts [image] [machine tag]
import { createClient } from 'npm:@supabase/supabase-js@2';

const root = new URL('../', import.meta.url);
const env = Object.fromEntries(
  (await Deno.readTextFile(new URL('mobile/.env.local', root)))
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const users = JSON.parse(await Deno.readTextFile(new URL('supabase/.sample-users.local.json', root))).created_users;
const image = Deno.args[0] ?? 'data/sample/photos/display_E101_SAMPLE.jpg';
const tag = Deno.args[1] ?? 'C-02';

const client = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { data: auth, error } = await client.auth.signInWithPassword(users.technician);
if (error) throw error;
const { data: me } = await client.from('profiles').select('company_id').eq('id', auth.user.id).single();
const { data: machine } = await client.from('machines').select('id').eq('tag', tag).single();

const path = `${me!.company_id}/diagnoses/${crypto.randomUUID()}.jpg`;
const up = await client.storage.from('photos').upload(path, await Deno.readFile(new URL(image, root)), { contentType: 'image/jpeg' });
if (up.error) throw up.error;

const { data, error: fnError } = await client.functions.invoke('diagnose', {
  body: { machine_id: machine!.id, photo_paths: [path], language: 'en' },
});
if (fnError) throw new Error(await fnError.context?.text?.());
const { data: row } = await client.from('diagnoses').select('understanding').eq('id', data.id).single();
console.log('vision saw:', JSON.stringify(row?.understanding?.vision));
console.log('summary:', row?.understanding?.summary_en);
console.log('status:', data.status, '| causes:', data.causes.map((c: { record_title: string; confidence: string }) => `${c.record_title} (${c.confidence})`));
console.log('follow-up:', data.follow_up_question, '| latency', data.latency_ms, 'ms');
