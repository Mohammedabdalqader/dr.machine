// Creates the SAMPLE company used for development and demos: fictional
// compressor models, one site with lines, four machines and three users
// (technician, engineer, manager). Safe to call twice: it reuses what exists.
//
// Protected by the BOOTSTRAP_TOKEN secret (header x-bootstrap-token), because
// it runs before any user exists. Remove the secret to disable it.
import { withSupabase } from 'npm:@supabase/server@^1';

import { errorResponse, HttpError, json, readJSON } from '../_shared/http.ts';

const COMPANY = 'Sample Plastics Co. (SAMPLE)';
const MODELS = [
  { code: 'RS-37', name: 'AirCore RS-37', description: '37 kW rotary screw, belt driven' },
  { code: 'RS-55', name: 'AirCore RS-55', description: '55 kW rotary screw, direct drive, integrated dryer' },
];
const SITE = 'Sahab Plant (SAMPLE)';
const LINES = ['Line 1', 'Line 2', 'Utilities'];
const MACHINES = [
  { tag: 'C-01', model: 'RS-37', line: 'Line 1', serial: 'SA37-2019-0412', installed: '2019-05-14' },
  { tag: 'C-02', model: 'RS-55', line: 'Line 2', serial: 'SA55-2021-0077', installed: '2021-02-03' },
  { tag: 'C-03', model: 'RS-37', line: 'Utilities', serial: 'SA37-2017-0156', installed: '2017-09-21' },
  { tag: 'C-04', model: 'RS-55', line: 'Utilities', serial: 'SA55-2022-0301', installed: '2022-06-30' },
];
const USERS = [
  { key: 'technician', full_name: 'Sample Technician', role: 'technician' },
  { key: 'engineer', full_name: 'Sample Engineer', role: 'engineer' },
  { key: 'manager', full_name: 'Sample Manager', role: 'manager' },
] as const;

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return 'Mu-' + btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 14);
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    try {
      const expected = Deno.env.get('BOOTSTRAP_TOKEN');
      if (!expected || req.headers.get('x-bootstrap-token') !== expected) {
        throw new HttpError(403, 'Bootstrap is disabled or the token is wrong');
      }
      const { email_domain } = await readJSON<{ email_domain?: string }>(req);
      const domain = email_domain ?? 'muallim-sample.test';
      const admin = ctx.supabaseAdmin;

      // Company
      let { data: company } = await admin.from('companies').select('id').eq('name', COMPANY).maybeSingle();
      if (!company) {
        const res = await admin.from('companies').insert({ name: COMPANY, is_sample: true }).select('id').single();
        if (res.error) throw res.error;
        company = res.data;
      }
      const companyId = company.id as string;

      // Models, site, lines, machines (upserts keep this idempotent)
      const models = await admin
        .from('machine_models')
        .upsert(MODELS.map((m) => ({ ...m, company_id: companyId, manufacturer: 'SampleAir (fictional)' })), {
          onConflict: 'company_id,code',
        })
        .select('id, code');
      if (models.error) throw models.error;
      const modelId = Object.fromEntries(models.data.map((m) => [m.code, m.id]));

      const site = await admin
        .from('sites')
        .upsert({ company_id: companyId, name: SITE }, { onConflict: 'company_id,name' })
        .select('id')
        .single();
      if (site.error) throw site.error;

      const lines = await admin
        .from('lines')
        .upsert(LINES.map((name) => ({ company_id: companyId, site_id: site.data.id, name })), {
          onConflict: 'site_id,name',
        })
        .select('id, name');
      if (lines.error) throw lines.error;
      const lineId = Object.fromEntries(lines.data.map((l) => [l.name, l.id]));

      const machines = await admin.from('machines').upsert(
        MACHINES.map((m) => ({
          company_id: companyId,
          tag: m.tag,
          model_id: modelId[m.model],
          line_id: lineId[m.line],
          serial_number: m.serial,
          installed_on: m.installed,
        })),
        { onConflict: 'company_id,tag' },
      );
      if (machines.error) throw machines.error;

      // Users: created once; passwords are only returned when a user is new.
      const created: Record<string, { email: string; password: string }> = {};
      for (const u of USERS) {
        const email = `${u.key}@${domain}`;
        const { data: existing } = await admin.from('profiles').select('id').eq('company_id', companyId).eq('role', u.role).eq('full_name', u.full_name).maybeSingle();
        if (existing) continue;
        const password = randomPassword();
        const res = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (res.error) throw res.error;
        const prof = await admin.from('profiles').insert({
          id: res.data.user.id,
          company_id: companyId,
          full_name: u.full_name,
          role: u.role,
          language: 'en',
        });
        if (prof.error) throw prof.error;
        created[u.key] = { email, password };
      }

      return json({ company_id: companyId, created_users: created });
    } catch (err) {
      return errorResponse(err);
    }
  }),
};
