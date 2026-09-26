// Checks the AI provider through the deployed ai-health function as the sample engineer.
//   npx deno run -A scripts/ai-health.ts         configuration only
//   npx deno run -A scripts/ai-health.ts live    also makes one small paid call
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
const { data, error } = await client.auth.signInWithPassword(users.engineer);
if (error) throw error;

const live = Deno.args[0] === 'live' ? '?live=1' : '';
const res = await fetch(`${env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/ai-health${live}`, {
  headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
});
console.log(res.status, JSON.stringify(await res.json(), null, 2));
