import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { HttpError } from './http.ts';

/** Fields a reviewer may set on a fault record. Everything else is system-managed. */
export type RecordFields = {
  title?: string;
  component?: string;
  symptoms?: string;
  error_codes?: string[];
  root_cause?: string;
  fix_steps?: string[];
  parts?: string[];
  tools?: string[];
  estimated_minutes?: number | null;
  safety_notes?: string[];
  requires_qualified?: boolean;
  model_id?: string | null;
};

const TEXT = ['title', 'component', 'symptoms', 'root_cause'] as const;
const LISTS = ['error_codes', 'fix_steps', 'parts', 'tools', 'safety_notes'] as const;

function cleanList(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, `${name} must be a list`);
  return value.map((v) => String(v ?? '').trim()).filter((v) => v !== '');
}

/** Whitelists and normalizes reviewer input. */
export function sanitizeFields(input: unknown): RecordFields {
  if (!input || typeof input !== 'object') return {};
  const src = input as Record<string, unknown>;
  const out: RecordFields = {};
  for (const key of TEXT) {
    if (key in src) out[key] = String(src[key] ?? '').trim();
  }
  for (const key of LISTS) {
    if (key in src) out[key] = cleanList(src[key], key);
  }
  if (out.error_codes) out.error_codes = [...new Set(out.error_codes.map((c) => c.toUpperCase()))];
  if ('estimated_minutes' in src) {
    const n = src.estimated_minutes === null || src.estimated_minutes === '' ? null : Number(src.estimated_minutes);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 10_000)) throw new HttpError(400, 'estimated_minutes is invalid');
    out.estimated_minutes = n === null ? null : Math.round(n);
  }
  if ('requires_qualified' in src) out.requires_qualified = Boolean(src.requires_qualified);
  if ('model_id' in src) out.model_id = src.model_id ? String(src.model_id) : null;
  return out;
}

/** Rules a record must meet before it can be used in answers. */
export function approvalProblems(r: {
  root_cause: string;
  symptoms: string;
  fix_steps: string[];
  safety_notes: string[];
}): string[] {
  const problems: string[] = [];
  if (!r.symptoms.trim()) problems.push('symptoms are empty');
  if (!r.root_cause.trim()) problems.push('root cause is empty');
  if (r.fix_steps.length === 0) problems.push('no fix steps');
  if (r.safety_notes.length === 0) problems.push('no safety notes (safety first: add at least one)');
  return problems;
}

/** Text that represents a record in semantic search. */
export function embeddingText(r: {
  title: string;
  component: string;
  symptoms: string;
  error_codes: string[];
  root_cause: string;
}): string {
  return [r.title, r.component, r.symptoms, r.error_codes.join(' '), r.root_cause].filter(Boolean).join('\n');
}

export async function snapshotVersion(
  admin: SupabaseClient,
  record: Record<string, unknown>,
  changedBy: string | null,
  note: string,
): Promise<void> {
  const { embedding: _e, fts: _f, search_text: _s, ...snapshot } = record as Record<string, unknown>;
  const { error } = await admin.from('fault_record_versions').insert({
    company_id: record.company_id,
    fault_record_id: record.id,
    version: record.version,
    status: record.status,
    snapshot,
    changed_by: changedBy,
    note,
  });
  if (error) throw error;
}

/** pgvector accepts the JSON array text form. */
export function toVector(values: number[]): string {
  return JSON.stringify(values);
}

/** Record columns returned to clients (never the embedding vector). */
export const RECORD_COLUMNS =
  'id, company_id, model_id, title, component, symptoms, error_codes, root_cause, fix_steps, parts, tools, estimated_minutes, safety_notes, requires_qualified, status, version, source_document_id, manual_refs, created_by, approved_by, approved_at, created_at, updated_at';
