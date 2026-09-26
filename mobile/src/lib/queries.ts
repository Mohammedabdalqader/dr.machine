import { unwrap } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { DocumentRow, FaultCase, FaultRecord, Line, Machine, MachineModel } from '@/lib/types';

// All queries run as the signed-in user: row-level security limits them to the user's company.

const MACHINE = 'id, tag, serial_number, installed_on, notes, model_id, line_id, model:machine_models(id, code, name), line:lines(id, name, site:sites(name))';

export async function listMachines(): Promise<Machine[]> {
  return unwrap(await supabase!.from('machines').select(MACHINE).order('tag')) as unknown as Machine[];
}

export async function getMachine(id: string): Promise<Machine | null> {
  return unwrap(await supabase!.from('machines').select(MACHINE).eq('id', id).maybeSingle()) as unknown as Machine | null;
}

export async function listModels(): Promise<MachineModel[]> {
  return unwrap(await supabase!.from('machine_models').select('id, code, name').order('code'));
}

export async function listLines(): Promise<Line[]> {
  return unwrap(await supabase!.from('lines').select('id, name, site:sites(name)').order('name')) as unknown as Line[];
}

const CASE = 'id, source_ref, occurred_on, machine_label, problem, action_taken, hours, technician_name, fault_record_id';

export async function machineHistory(machineId: string): Promise<FaultCase[]> {
  return unwrap(
    await supabase!
      .from('fault_cases')
      .select(CASE)
      .eq('machine_id', machineId)
      .order('occurred_on', { ascending: false, nullsFirst: false })
      .limit(50),
  );
}

export async function recordCases(recordId: string): Promise<FaultCase[]> {
  return unwrap(
    await supabase!
      .from('fault_cases')
      .select(CASE)
      .eq('fault_record_id', recordId)
      .order('occurred_on', { ascending: false, nullsFirst: false }),
  );
}

const RECORD =
  'id, model_id, title, component, symptoms, error_codes, root_cause, fix_steps, parts, tools, estimated_minutes, safety_notes, requires_qualified, status, version, manual_refs, approved_at, updated_at';

export type RecordListItem = FaultRecord & { case_count: number };

export async function listRecords(status: string): Promise<RecordListItem[]> {
  const rows = unwrap(
    await supabase!
      .from('fault_records')
      .select(`${RECORD}, fault_cases(count)`)
      .eq('status', status)
      .order('updated_at', { ascending: false })
      .limit(300),
  ) as unknown as (FaultRecord & { fault_cases: { count: number }[] })[];
  return rows.map(({ fault_cases, ...r }) => ({ ...r, case_count: fault_cases[0]?.count ?? 0 }));
}

export async function getRecord(id: string): Promise<FaultRecord | null> {
  return unwrap(await supabase!.from('fault_records').select(RECORD).eq('id', id).maybeSingle()) as FaultRecord | null;
}

export async function documentTitles(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const rows = unwrap(await supabase!.from('documents').select('id, title').in('id', ids));
  return Object.fromEntries(rows.map((d: { id: string; title: string }) => [d.id, d.title]));
}

export async function listDocuments(): Promise<DocumentRow[]> {
  return unwrap(
    await supabase!
      .from('documents')
      .select('id, kind, title, file_name, status, stage, progress, stats, error, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  );
}
