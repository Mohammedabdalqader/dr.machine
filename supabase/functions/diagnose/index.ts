// Fault diagnosis, following the seven steps of the product brief:
//   1 context      machine, model and recent repairs (from the QR scan)
//   2 understand   photos -> vision; report -> short English technical summary
//   3 search       exact error code + keywords + meaning, filtered by model
//   4 rank         the model picks causes ONLY from retrieved approved records
//   5 gate         weak evidence -> "not enough data" + escalation, never a guess
//   6 safety       safety steps of every suggested cause, shown first
//   7 log          inputs, evidence, answer, timings and AI usage
//
// { machine_id?, text?, error_code?, photo_paths?, language } -> Diagnosis
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

import { getAI, type Usage } from '../_shared/ai/index.ts';
import { userHandler } from '../_shared/handler.ts';
import { HttpError, json, readJSON } from '../_shared/http.ts';
import { rankCauses, readPhotos, understand, type VisionFindings } from '../_shared/diagnosis/ai.ts';
import {
  acceptCause,
  evidenceLevel,
  finalConfidence,
  hasUsableEvidence,
  mergeSafety,
  type Candidate,
  type Confidence,
} from '../_shared/diagnosis/gate.ts';
import { toVector } from '../_shared/records.ts';

const MAX_PHOTOS = 3;
const MAX_CANDIDATES = 8;

type MachineContext = {
  id: string;
  tag: string;
  model_id: string | null;
  model: { code: string; name: string; description: string } | null;
  line: { name: string } | null;
};

type Body = {
  machine_id?: string;
  text?: string;
  error_code?: string;
  photo_paths?: string[];
  language?: 'ar' | 'en';
};

export default userHandler(['technician', 'engineer', 'manager', 'admin'], async (req, { caller, admin }) => {
  const started = Date.now();
  const body = await readJSON<Body>(req);
  const language = body.language === 'en' ? 'en' : 'ar';
  const text = String(body.text ?? '').trim().slice(0, 2000);
  const errorCode = String(body.error_code ?? '').trim().slice(0, 40);
  const photoPaths = (Array.isArray(body.photo_paths) ? body.photo_paths : []).map(String).slice(0, MAX_PHOTOS);
  if (!text && !errorCode && !photoPaths.length) throw new HttpError(400, 'Describe the fault, enter a code or add a photo');
  for (const p of photoPaths) {
    if (!p.startsWith(`${caller.companyId}/`) || p.includes('..')) throw new HttpError(400, 'Invalid photo location');
  }

  const { provider: ai } = getAI();
  const usage: Usage[] = [];

  // 1 · Context
  let machine: MachineContext | null = null;
  if (body.machine_id) {
    const { data } = await admin
      .from('machines')
      .select('id, tag, model_id, model:machine_models(code, name, description), line:lines(name)')
      .eq('id', body.machine_id)
      .eq('company_id', caller.companyId)
      .maybeSingle();
    if (!data) throw new HttpError(404, 'Machine not found');
    machine = data as unknown as MachineContext;
  }
  const modelId = machine?.model_id ?? null;
  const modelCode = machine?.model?.code ?? null;
  // The ranking step needs to know what the machine physically is (e.g. belt driven or not).
  const modelDescription = machine?.model
    ? `${machine.model.code} · ${machine.model.name}${machine.model.description ? `: ${machine.model.description}` : ''}`
    : null;
  const { data: history } = machine
    ? await admin
        .from('fault_cases')
        .select('occurred_on, problem, action_taken')
        .eq('machine_id', machine.id)
        .order('occurred_on', { ascending: false, nullsFirst: false })
        .limit(5)
    : { data: [] };

  // 2 · Understand the input
  let vision: VisionFindings | null = null;
  if (photoPaths.length) {
    const images = await Promise.all(photoPaths.map((p) => photoDataUrl(admin, p)));
    const res = await readPhotos(ai, images);
    vision = res.data;
    usage.push(res.usage);
  }
  const understood = await understand(ai, { text, errorCode, vision, model: modelCode });
  usage.push(understood.usage);
  const u = understood.data;

  // 3 · Search three ways
  const embedded = await ai.embed([u.summary_en]);
  usage.push(embedded.usage);
  const embedding = toVector(embedded.vectors[0]);
  const searchText = [u.summary_en, ...u.keywords].join(' ');

  const [{ data: found, error: searchError }, { data: chunks }] = await Promise.all([
    admin.rpc('search_fault_records', {
      p_company_id: caller.companyId,
      p_model_id: modelId,
      p_codes: u.error_codes,
      p_query: searchText,
      p_embedding: embedding,
      p_limit: MAX_CANDIDATES,
    }),
    admin.rpc('match_manual_chunks', { p_company_id: caller.companyId, p_embedding: embedding, p_model_id: modelId, p_limit: 4 }),
  ]);
  if (searchError) throw searchError;
  const candidates = ((found ?? []) as (Candidate & { model_match: boolean })[]).slice(0, MAX_CANDIDATES);

  const recordIds = candidates.map((c) => c.id);
  const { data: records } = recordIds.length
    ? await admin
        .from('fault_records')
        .select('id, title, component, symptoms, error_codes, root_cause, fix_steps, parts, tools, estimated_minutes, safety_notes, requires_qualified, manual_refs, translations, model:machine_models(code)')
        .in('id', recordIds)
    : { data: [] };
  const recordById = new Map((records ?? []).map((r) => [r.id, r]));
  const pastCases = await countPastCases(admin, recordIds, modelId);

  const evidence = {
    codes: u.error_codes,
    candidates: candidates.map((c) => ({ ...c, level: evidenceLevel(c), title: recordById.get(c.id)?.title })),
    manual: (chunks ?? []).map((c: { document_id: string; page: number; similarity: number }) => ({
      document_id: c.document_id,
      page: c.page,
      similarity: c.similarity,
    })),
  };

  // 4 + 5 · Rank from evidence only, behind the confidence gate
  let causes: Record<string, unknown>[] = [];
  let weakLeads: Record<string, unknown>[] = [];
  let followUp = '';
  let status: 'answered' | 'not_enough_data' = 'not_enough_data';

  if (hasUsableEvidence(candidates)) {
    const refOf = new Map(candidates.map((c, i) => [`k${i + 1}`, c]));
    const manual = ((chunks ?? []) as { document_id: string; page: number; content: string }[]).map((c, i) => ({
      ref: `m${i + 1}`,
      page: c.page,
      content: c.content,
      document_id: c.document_id,
    }));
    const ranked = await rankCauses(ai, {
      language,
      report: [text, errorCode && `code: ${errorCode}`].filter(Boolean).join(' · '),
      understanding: u,
      model: modelDescription,
      machineHistory: (history ?? []).map((h) => `${h.occurred_on ?? ''} ${h.problem} -> ${h.action_taken || '?'}`),
      candidates: [...refOf.entries()].map(([ref, c]) => {
        const r = recordById.get(c.id)!;
        return {
          ref,
          title: r.title,
          component: r.component,
          symptoms: r.symptoms,
          error_codes: r.error_codes,
          root_cause: r.root_cause,
          // deno-lint-ignore no-explicit-any
          applies_to: (r as any).model?.code ?? 'all models',
          past_cases: pastCases.get(c.id)?.onModel ?? 0,
          past_cases_total: pastCases.get(c.id)?.total ?? 0,
        };
      }),
      manual,
    });
    usage.push(ranked.usage);
    followUp = ranked.data.follow_up_question;

    const titles = await documentTitles(admin, [...new Set([...manual.map((m) => m.document_id), ...(records ?? []).flatMap((r) => r.manual_refs.map((m: { document_id: string }) => m.document_id))])]);

    causes = ranked.data.causes.map((rc) => {
      const cand = refOf.get(rc.ref)!;
      const r = recordById.get(cand.id)!;
      const confidence: Confidence = finalConfidence(rc.confidence, evidenceLevel(cand));
      // Knowledge is stored in English; use the reviewed-with-approval Arabic version when available.
      const tr = language === 'ar' ? (r.translations?.ar as Record<string, unknown> | undefined) : undefined;
      const pick = <K extends 'root_cause' | 'fix_steps' | 'parts' | 'tools' | 'safety_notes'>(k: K) =>
        (tr?.[k] as (typeof r)[K] | undefined) ?? r[k];
      const pages = new Map<string, { document_id: string; page: number; title: string }>();
      for (const m of [...r.manual_refs, ...manual.filter((m) => rc.manual_refs.includes(m.ref))]) {
        pages.set(`${m.document_id}:${m.page}`, { document_id: m.document_id, page: m.page, title: titles[m.document_id] ?? '' });
      }
      return {
        record_id: r.id,
        title: rc.title || r.title,
        record_title: r.title,
        reason: rc.reason,
        confidence,
        model_confidence: rc.confidence,
        evidence_level: evidenceLevel(cand),
        past_cases: pastCases.get(r.id)?.onModel ?? 0,
        past_cases_total: pastCases.get(r.id)?.total ?? 0,
        manual_pages: [...pages.values()].sort((a, b) => a.page - b.page),
        component: r.component,
        root_cause: pick('root_cause'),
        fix_steps: pick('fix_steps'),
        parts: pick('parts'),
        tools: pick('tools'),
        estimated_minutes: r.estimated_minutes,
        requires_qualified: r.requires_qualified,
        safety_notes: pick('safety_notes'),
        translated: Boolean(tr),
      };
    });
    // 5 · Confidence gate: a weak best match is "not enough data", shown only as unconfirmed leads.
    const top = causes[0];
    if (top && !acceptCause(top.model_confidence as Confidence, top.evidence_level as Confidence)) {
      weakLeads = causes.map((c) => ({ ...c, confidence: 'low' }));
      causes = [];
    }
    status = causes.length ? 'answered' : 'not_enough_data';
  }

  // 6 · Safety first: the steps of the most likely cause (each cause also carries its own),
  //     and generic isolation steps when the answer is "not enough data".
  const safety = mergeSafety([(causes[0]?.safety_notes as string[] | undefined) ?? []]);
  const confidence = (causes[0]?.confidence as Confidence | undefined) ?? null;

  // 7 · Log everything
  const latency = Date.now() - started;
  const { data: saved, error: saveError } = await admin
    .from('diagnoses')
    .insert({
      company_id: caller.companyId,
      machine_id: machine?.id ?? null,
      model_id: modelId,
      user_id: caller.userId,
      language,
      input_text: text,
      input_error_code: errorCode,
      photo_paths: photoPaths,
      understanding: { ...u, vision, follow_up_question: followUp },
      evidence: { ...evidence, weak_leads: weakLeads },
      causes,
      safety_notes: safety,
      confidence,
      status,
      latency_ms: latency,
      usage,
    })
    .select('id, created_at')
    .single();
  if (saveError) throw saveError;

  return json({
    id: saved.id,
    created_at: saved.created_at,
    status,
    confidence,
    language,
    machine: machine ? { id: machine.id, tag: machine.tag, model_code: modelCode, line: machine.line?.name ?? null } : null,
    input_text: text,
    input_error_code: errorCode,
    safety_notes: safety,
    causes,
    weak_leads: weakLeads,
    follow_up_question: followUp,
    latency_ms: latency,
  });
});

async function photoDataUrl(admin: import('npm:@supabase/supabase-js@2').SupabaseClient, path: string): Promise<string> {
  const { data, error } = await admin.storage.from('photos').download(path);
  if (error || !data) throw new HttpError(400, 'Photo not found');
  const bytes = new Uint8Array(await data.arrayBuffer());
  return `data:${data.type || 'image/jpeg'};base64,${encodeBase64(bytes)}`;
}

/** Past repairs linked to each record: on this machine model, and in total. */
async function countPastCases(
  admin: import('npm:@supabase/supabase-js@2').SupabaseClient,
  recordIds: string[],
  modelId: string | null,
): Promise<Map<string, { onModel: number; total: number }>> {
  const counts = new Map<string, { onModel: number; total: number }>();
  if (!recordIds.length) return counts;
  const { data } = await admin
    .from('fault_cases')
    .select('fault_record_id, machine:machines(model_id)')
    .in('fault_record_id', recordIds);
  for (const c of (data ?? []) as unknown as { fault_record_id: string; machine: { model_id: string } | null }[]) {
    const entry = counts.get(c.fault_record_id) ?? { onModel: 0, total: 0 };
    entry.total++;
    if (!modelId || c.machine?.model_id === modelId) entry.onModel++;
    counts.set(c.fault_record_id, entry);
  }
  return counts;
}

async function documentTitles(
  admin: import('npm:@supabase/supabase-js@2').SupabaseClient,
  ids: string[],
): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const { data } = await admin.from('documents').select('id, title').in('id', ids);
  return Object.fromEntries((data ?? []).map((d) => [d.id, d.title]));
}
