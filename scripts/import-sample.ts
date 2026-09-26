// End-to-end import of the sample files as the sample engineer, through the
// same path the app uses (storage upload -> documents row -> ingest-step loop).
// Also checks that row-level security hides drafts from the technician.
//
//   npx deno run -A scripts/import-sample.ts
//
// Reads mobile/.env.local and supabase/.sample-users.local.json.
import { createClient } from 'npm:@supabase/supabase-js@2';

const root = new URL('../', import.meta.url);
const env = Object.fromEntries(
  (await Deno.readTextFile(new URL('mobile/.env.local', root)))
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const users = JSON.parse(await Deno.readTextFile(new URL('supabase/.sample-users.local.json', root))).created_users;
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function signIn(who: 'technician' | 'engineer' | 'manager') {
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword(users[who]);
  if (error) throw error;
  return client;
}

const engineer = await signIn('engineer');
const { data: { user: engineerUser } } = await engineer.auth.getUser();
const { data: me } = await engineer.from('profiles').select('company_id, role').eq('id', engineerUser!.id).single();
console.log('signed in as', me);

const FILES = [
  { kind: 'manual', file: 'aircore_rs_service_manual_SAMPLE.pdf', mime: 'application/pdf', title: 'AirCore RS service manual (SAMPLE)' },
  {
    kind: 'fault_log',
    file: 'sample_plant_fault_log.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    title: 'Plant breakdown log 2024-2025 (SAMPLE)',
  },
];

// Manual first, so structuring can cite its pages.
for (const f of FILES) {
  // Resume an unfinished import of the same file instead of uploading it again.
  const { data: existing } = await engineer
    .from('documents')
    .select('id, status')
    .eq('file_name', f.file)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.status === 'ready') {
    console.log(`  ${f.kind}: already imported`);
    continue;
  }
  let doc = existing?.status === 'processing' || existing?.status === 'uploaded' ? existing : null;
  if (!doc) {
    const bytes = await Deno.readFile(new URL(`data/sample/${f.file}`, root));
    const path = `${me!.company_id}/${crypto.randomUUID()}-${f.file}`;
    const up = await engineer.storage.from('documents').upload(path, bytes, { contentType: f.mime });
    if (up.error) throw up.error;
    const inserted = await engineer
      .from('documents')
      .insert({ company_id: me!.company_id, kind: f.kind, title: f.title, file_name: f.file, storage_path: path, mime_type: f.mime, uploaded_by: engineerUser!.id })
      .select('id, status')
      .single();
    if (inserted.error) throw inserted.error;
    doc = inserted.data;
  }

  const t0 = Date.now();
  for (let i = 0; i < 100; i++) {
    const { data, error: fnError } = await engineer.functions.invoke('ingest-step', { body: { document_id: doc.id } });
    if (fnError) {
      const body = await fnError.context?.text?.();
      throw new Error(`ingest-step failed: ${fnError.message} ${body ?? ''}`);
    }
    console.log(`  ${f.kind}: ${data.stage} ${JSON.stringify(data.progress)}`);
    if (data.done) {
      console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(data.stats));
      break;
    }
  }
}

const { count: drafts } = await engineer.from('fault_records').select('id', { count: 'exact', head: true }).eq('status', 'draft');
console.log('engineer sees drafts:', drafts);

const technician = await signIn('technician');
const { count: techDrafts } = await technician.from('fault_records').select('id', { count: 'exact', head: true }).eq('status', 'draft');
console.log('technician sees drafts (must be 0):', techDrafts);
const { error: techUpload } = await technician.from('documents').insert({ company_id: me!.company_id, kind: 'manual', title: 'x', file_name: 'x', storage_path: 'x' });
console.log('technician blocked from uploading:', Boolean(techUpload));
