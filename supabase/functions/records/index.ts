// Knowledge base writes (engineers, managers, admins). Every change bumps the
// version, stores a snapshot and writes the audit log. Approval also computes
// the embedding used by semantic search.
//   { action: 'create', fields }
//   { action: 'save',    id, fields }             edit without changing status
//   { action: 'approve', id, fields?, note? }
//   { action: 'reject',  id, note? }
//   { action: 'translate', id }                  refresh the Arabic version of an approved record
import { getAI } from '../_shared/ai/index.ts';
import { audit, REVIEWERS } from '../_shared/auth.ts';
import { userHandler } from '../_shared/handler.ts';
import { HttpError, json, readJSON, requireString } from '../_shared/http.ts';
import {
  approvalProblems,
  embeddingText,
  RECORD_COLUMNS,
  sanitizeFields,
  snapshotVersion,
  toVector,
  translateRecord,
} from '../_shared/records.ts';

export default userHandler(REVIEWERS, async (req, { caller, admin }) => {
  const body = await readJSON(req);
  const action = body.action;
  const fields = sanitizeFields(body.fields);
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : '';

  if (fields.model_id) {
    const { data } = await admin
      .from('machine_models')
      .select('id')
      .eq('id', fields.model_id)
      .eq('company_id', caller.companyId)
      .maybeSingle();
    if (!data) throw new HttpError(400, 'Unknown machine model');
  }

  if (action === 'create') {
    const { data, error } = await admin
      .from('fault_records')
      .insert({ ...fields, company_id: caller.companyId, status: 'draft', created_by: caller.userId })
      .select(RECORD_COLUMNS)
      .single();
    if (error) throw error;
    await snapshotVersion(admin, data, caller.userId, 'created manually');
    await audit(admin, caller, 'record.create', 'fault_record', data.id);
    return json({ record: data });
  }

  const id = requireString(body.id, 'id');

  if (action === 'translate') {
    const { data: rec } = await admin
      .from('fault_records')
      .select(RECORD_COLUMNS)
      .eq('id', id)
      .eq('company_id', caller.companyId)
      .eq('status', 'approved')
      .maybeSingle();
    if (!rec) throw new HttpError(404, 'Approved record not found');
    const ar = await translateRecord(getAI().provider, rec, rec.version);
    if (!ar) throw new HttpError(502, 'Translation failed, try again');
    const { error } = await admin.from('fault_records').update({ translations: { ar } }).eq('id', id).eq('version', rec.version);
    if (error) throw error;
    await audit(admin, caller, 'record.translate', 'fault_record', id, { version: rec.version });
    return json({ ok: true });
  }
  const { data: current, error: loadError } = await admin
    .from('fault_records')
    .select(RECORD_COLUMNS)
    .eq('id', id)
    .eq('company_id', caller.companyId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!current) throw new HttpError(404, 'Record not found');

  const next = { ...current, ...fields };
  const update: Record<string, unknown> = { ...fields, version: current.version + 1 };

  if (action === 'save') {
    // Editing an approved record changes what technicians see: refresh its embedding.
    if (current.status === 'approved') {
      const problems = approvalProblems(next);
      if (problems.length) throw new HttpError(422, 'Record is incomplete', { problems });
      Object.assign(update, await searchFields(next));
    }
  } else if (action === 'approve') {
    const problems = approvalProblems(next);
    if (problems.length) throw new HttpError(422, 'Record is incomplete', { problems });
    update.status = 'approved';
    update.approved_by = caller.userId;
    update.approved_at = new Date().toISOString();
    Object.assign(update, await searchFields(next));
  } else if (action === 'reject') {
    update.status = 'rejected';
    update.embedding = null;
  } else {
    throw new HttpError(400, 'Unknown action');
  }

  const { data: saved, error } = await admin
    .from('fault_records')
    .update(update)
    .eq('id', id)
    .eq('company_id', caller.companyId)
    .eq('version', current.version) // optimistic lock: two reviewers editing at once
    .select(RECORD_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!saved) throw new HttpError(409, 'Someone else changed this record. Reload and try again.');

  await snapshotVersion(admin, saved, caller.userId, note || action);
  await audit(admin, caller, `record.${action}`, 'fault_record', id, { version: saved.version });
  if (saved.status === 'approved') {
    // Translating takes up to a minute: don't make the engineer wait for it.
    runInBackground(refreshTranslation(admin, saved));
  }
  return json({ record: saved });
});

/** What technicians see changed: new search embedding; the old translation is stale until refreshed. */
async function searchFields(record: Parameters<typeof embeddingText>[0]): Promise<{ embedding: string; translations: Record<string, never> }> {
  const { vectors } = await getAI().provider.embed([embeddingText(record)]);
  return { embedding: toVector(vectors[0]), translations: {} };
}

/** Stores the Arabic version, unless the record changed again in the meantime. */
async function refreshTranslation(
  admin: import('npm:@supabase/supabase-js@2').SupabaseClient,
  record: Parameters<typeof translateRecord>[1] & { id: string; version: number },
): Promise<void> {
  const ar = await translateRecord(getAI().provider, record, record.version);
  if (!ar) return;
  await admin.from('fault_records').update({ translations: { ar } }).eq('id', record.id).eq('version', record.version);
}

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

function runInBackground(task: Promise<unknown>): void {
  const guarded = task.catch((err) => console.error('background task failed', err));
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(guarded);
}
