import { callFunction, unwrap } from '@/lib/api';
import { readPickedFile, type PickedFile } from '@/lib/files';
import { supabase } from '@/lib/supabase';
import type { DiagnosisRow } from '@/lib/types';

/** Machine id from a scanned sticker ("muallim://machine/<uuid>"), or null for any other QR code. */
export function machineIdFromQr(data: string): string | null {
  return data.match(/machine\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1] ?? null;
}

export async function uploadPhotos(companyId: string, photos: (PickedFile & { mimeType?: string | null })[]): Promise<string[]> {
  return Promise.all(
    photos.map(async (p) => {
      const type = p.mimeType ?? 'image/jpeg';
      const ext = type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
      const path = `${companyId}/diagnoses/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase!.storage.from('photos').upload(path, await readPickedFile(p), { contentType: type });
      if (error) throw error;
      return path;
    }),
  );
}

export async function runDiagnosis(input: {
  machineId: string | null;
  text: string;
  errorCode: string;
  photoPaths: string[];
  language: 'ar' | 'en';
}): Promise<{ id: string }> {
  return callFunction('diagnose', {
    machine_id: input.machineId ?? undefined,
    text: input.text,
    error_code: input.errorCode,
    photo_paths: input.photoPaths,
    language: input.language,
  });
}

const DIAGNOSIS =
  'id, status, confidence, language, input_text, input_error_code, photo_paths, safety_notes, causes, understanding, evidence, ' +
  'rejected_record_ids, selected_record_id, escalated_at, escalation_note, latency_ms, created_at, ' +
  'machine:machines(id, tag, model:machine_models(code), line:lines(name))';

export async function getDiagnosis(id: string): Promise<DiagnosisRow | null> {
  return unwrap(await supabase!.from('diagnoses').select(DIAGNOSIS).eq('id', id).maybeSingle()) as unknown as DiagnosisRow | null;
}

export async function listDiagnoses(filter: { escalated?: boolean; machineId?: string; limit?: number }): Promise<DiagnosisRow[]> {
  let q = supabase!.from('diagnoses').select(DIAGNOSIS).order('created_at', { ascending: false }).limit(filter.limit ?? 20);
  if (filter.escalated) q = q.eq('status', 'escalated');
  if (filter.machineId) q = q.eq('machine_id', filter.machineId);
  return unwrap(await q) as unknown as DiagnosisRow[];
}

export async function sendFeedback(
  id: string,
  action: 'start_fix' | 'not_this' | 'escalate',
  recordId?: string,
  note?: string,
): Promise<void> {
  const { error } = await supabase!.rpc('diagnosis_feedback', {
    p_diagnosis_id: id,
    p_action: action,
    p_record_id: recordId ?? null,
    p_note: note ?? '',
  });
  if (error) throw new Error(error.message);
}

/** Short-lived links so the result screen can show the attached photos. */
export async function photoUrls(paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  const { data } = await supabase!.storage.from('photos').createSignedUrls(paths, 600);
  return (data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[];
}
