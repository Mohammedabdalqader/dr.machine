// Advances the import of one uploaded document. The app calls it repeatedly
// until `done`; each call does a bounded amount of work so it always finishes
// well inside the Edge Function time limit, and an interrupted import can resume.
//
//   { document_id } -> { stage, status, progress, stats, done, error? }
//
// Fault log:  queued -> mapping -> grouping -> structuring -> done
// Manual:     queued -> extracting -> embedding -> done
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { AIError, getAI, type AIProvider } from '../_shared/ai/index.ts';
import { audit, REVIEWERS, type Caller } from '../_shared/auth.ts';
import { userHandler } from '../_shared/handler.ts';
import { HttpError, json, readJSON, requireString } from '../_shared/http.ts';
import {
  groupCases,
  mapColumns,
  structureRecord,
  type Candidate,
  type CaseForGrouping,
} from '../_shared/ingest/ai-steps.ts';
import { chunkPages, readPdfPages } from '../_shared/ingest/manual.ts';
import { extractCases, matchMachine, readGrid } from '../_shared/ingest/spreadsheet.ts';
import { toVector } from '../_shared/records.ts';

const TIME_BUDGET_MS = 55_000; // stop starting new work after this
const LOCK_SECONDS = 120;
const MAX_ROWS = 1000;
const GROUPING_BATCH = 100; // cases per grouping call
const STRUCTURE_PARALLEL = 4; // records written per structuring round
const EMBED_BATCH = 32;

type Doc = {
  id: string;
  company_id: string;
  kind: 'fault_log' | 'manual';
  storage_path: string;
  status: string;
  stage: string;
  progress: Record<string, unknown>;
  stats: Record<string, unknown>;
  uploaded_by: string | null;
};

type Ctx = { admin: SupabaseClient; ai: AIProvider; caller: Caller; doc: Doc };

export default userHandler(REVIEWERS, async (req, { caller, admin }) => {
  const documentId = requireString((await readJSON(req)).document_id, 'document_id');

  const { data: doc, error } = await admin
    .from('documents')
    .select('id, company_id, kind, storage_path, status, stage, progress, stats, uploaded_by')
    .eq('id', documentId)
    .eq('company_id', caller.companyId)
    .maybeSingle();
  if (error) throw error;
  if (!doc) throw new HttpError(404, 'Document not found');
  if (doc.stage === 'done' || doc.status === 'failed') return json(report(doc));

  // Atomic claim: only one call works on a document at a time.
  const now = new Date();
  const { data: claimed } = await admin
    .from('documents')
    .update({ locked_until: new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString() })
    .eq('id', documentId)
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
    .select('id');
  if (!claimed?.length) return json({ ...report(doc), busy: true });

  const ctx: Ctx = { admin, ai: getAI().provider, caller, doc };
  const started = Date.now();
  try {
    if (doc.stage === 'queued') {
      await save(ctx, { status: 'processing', stage: doc.kind === 'manual' ? 'extracting' : 'mapping' });
    }
    while (ctx.doc.stage !== 'done' && Date.now() - started < TIME_BUDGET_MS) {
      const step = STEPS[ctx.doc.stage];
      if (!step) throw new Error(`Unknown stage ${ctx.doc.stage}`);
      await step(ctx);
    }
    if (ctx.doc.stage === 'done') {
      await save(ctx, { status: 'ready' });
      await audit(admin, caller, 'document.processed', 'document', doc.id, ctx.doc.stats);
    }
    await admin.from('documents').update({ locked_until: null }).eq('id', doc.id);
    return json(report(ctx.doc));
  } catch (err) {
    const retryable = err instanceof AIError && err.retryable;
    const message = err instanceof Error ? err.message : String(err);
    console.error('ingest failed', doc.id, ctx.doc.stage, message);
    await admin
      .from('documents')
      .update({ locked_until: null, ...(retryable ? {} : { status: 'failed', error: message.slice(0, 500) }) })
      .eq('id', doc.id);
    return json({ ...report(ctx.doc), status: retryable ? ctx.doc.status : 'failed', error: message, retryable }, retryable ? 503 : 422);
  }
});

function report(doc: Pick<Doc, 'stage' | 'status' | 'progress' | 'stats'>) {
  return { stage: doc.stage, status: doc.status, progress: doc.progress, stats: doc.stats, done: doc.stage === 'done' };
}

async function save(ctx: Ctx, patch: Partial<Doc>): Promise<void> {
  const { error } = await ctx.admin
    .from('documents')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', ctx.doc.id);
  if (error) throw error;
  ctx.doc = { ...ctx.doc, ...patch };
}

async function download(ctx: Ctx): Promise<Uint8Array> {
  // Defense in depth (the database also enforces this): never read outside the company folder.
  if (!ctx.doc.storage_path.startsWith(`${ctx.doc.company_id}/`) || ctx.doc.storage_path.includes('..')) {
    throw new Error('Invalid file location');
  }
  const { data, error } = await ctx.admin.storage.from('documents').download(ctx.doc.storage_path);
  if (error || !data) throw new Error(`Cannot read uploaded file: ${error?.message ?? 'missing'}`);
  return new Uint8Array(await data.arrayBuffer());
}

const STEPS: Record<string, (ctx: Ctx) => Promise<void>> = {
  mapping: stepMapping,
  grouping: stepGrouping,
  structuring: stepStructuring,
  extracting: stepExtracting,
  embedding: stepEmbedding,
};

// ------------------------------------------------------------------ fault log

async function stepMapping(ctx: Ctx): Promise<void> {
  const grid = readGrid(await download(ctx));
  if (grid.length < 2) throw new Error('The file has no rows');
  const mapping = await mapColumns(ctx.ai, grid);
  const parsed = extractCases(grid, mapping, MAX_ROWS);
  if (!parsed.length) throw new Error('No fault descriptions found in the file');

  const { data: machines, error } = await ctx.admin
    .from('machines')
    .select('id, tag')
    .eq('company_id', ctx.doc.company_id);
  if (error) throw error;

  // Re-running after a crash must not duplicate cases.
  await ctx.admin.from('fault_cases').delete().eq('source_document_id', ctx.doc.id);
  const rows = parsed.map((c) => ({
    company_id: ctx.doc.company_id,
    source_document_id: ctx.doc.id,
    source_ref: c.sourceRef,
    occurred_on: c.occurredOn,
    machine_label: c.machineLabel,
    machine_id: matchMachine(c.machineLabel, machines),
    problem: c.problem,
    action_taken: c.action,
    parts: c.parts,
    hours: c.hours,
    technician_name: c.technician,
    raw: c.raw,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insertError } = await ctx.admin.from('fault_cases').insert(rows.slice(i, i + 500));
    if (insertError) throw insertError;
  }
  await save(ctx, {
    stage: 'grouping',
    progress: { grouped: 0, total: rows.length },
    stats: {
      rows: rows.length,
      machines_matched: rows.filter((r) => r.machine_id).length,
      columns: mapping.columns,
      header_row: mapping.headerRow + 1,
    },
  });
}

async function stepGrouping(ctx: Ctx): Promise<void> {
  const { admin, doc } = ctx;
  const grouped = Number(doc.progress.grouped ?? 0);

  const { data: cases, error } = await admin
    .from('fault_cases')
    .select('id, problem, action_taken, machine:machines(model:machine_models(code))')
    .eq('source_document_id', doc.id)
    .order('created_at')
    .order('id')
    .range(grouped, grouped + GROUPING_BATCH - 1);
  if (error) throw error;
  if (!cases.length) {
    const { count } = await admin
      .from('ingestion_groups')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', doc.id)
      .eq('status', 'pending');
    await save(ctx, {
      stage: 'structuring',
      progress: { structured: 0, total: count ?? 0 },
    });
    return;
  }

  // Candidates: knowledge that already exists (approved or draft) + groups from earlier batches.
  const { data: records } = await admin
    .from('fault_records')
    .select('id, title, component, root_cause, error_codes')
    .eq('company_id', doc.company_id)
    .in('status', ['approved', 'draft'])
    .limit(300);
  const { data: groups } = await admin
    .from('ingestion_groups')
    .select('id, label, case_ids')
    .eq('document_id', doc.id);

  const candidates: Candidate[] = [];
  const candidateTarget = new Map<string, { recordId?: string; groupId?: string }>();
  (records ?? []).forEach((r, i) => {
    const ref = `r${i + 1}`;
    candidates.push({ ref, summary: `${r.title} | ${r.component} | cause: ${r.root_cause} | codes: ${r.error_codes.join(',')}` });
    candidateTarget.set(ref, { recordId: r.id });
  });
  (groups ?? []).forEach((g, i) => {
    const ref = `g${i + 1}`;
    candidates.push({ ref, summary: g.label });
    candidateTarget.set(ref, { groupId: g.id });
  });

  const caseByRef = new Map<string, string>();
  const forModel: CaseForGrouping[] = cases.map((c, i) => {
    const ref = `c${i + 1}`;
    caseByRef.set(ref, c.id);
    // deno-lint-ignore no-explicit-any
    const model = (c as any).machine?.model?.code ?? null;
    return { ref, model, problem: c.problem, action: c.action_taken };
  });

  const grouping = await groupCases(ctx.ai, forModel, candidates);

  for (const group of grouping) {
    const caseIds = group.cases.map((r) => caseByRef.get(r)!);
    const target = group.target ? candidateTarget.get(group.target) : undefined;
    if (target?.recordId) {
      // Same fault as existing knowledge: attach the cases as more evidence.
      await admin.from('fault_cases').update({ fault_record_id: target.recordId }).in('id', caseIds);
      await admin.from('ingestion_groups').insert({
        company_id: doc.company_id,
        document_id: doc.id,
        label: group.label,
        case_ids: caseIds,
        existing_record_id: target.recordId,
        status: 'done',
      });
    } else if (target?.groupId) {
      const existing = groups!.find((g) => g.id === target.groupId)!;
      await admin
        .from('ingestion_groups')
        .update({ case_ids: [...existing.case_ids, ...caseIds] })
        .eq('id', target.groupId);
    } else {
      await admin.from('ingestion_groups').insert({
        company_id: doc.company_id,
        document_id: doc.id,
        label: group.label,
        case_ids: caseIds,
      });
    }
  }
  await save(ctx, { progress: { ...doc.progress, grouped: grouped + cases.length } });
}

async function stepStructuring(ctx: Ctx): Promise<void> {
  const { admin, doc } = ctx;
  const { data: pending, error } = await admin
    .from('ingestion_groups')
    .select('id, label, case_ids')
    .eq('document_id', doc.id)
    .eq('status', 'pending')
    .order('created_at')
    .limit(STRUCTURE_PARALLEL);
  if (error) throw error;

  if (!pending.length) {
    const { data: all } = await admin
      .from('ingestion_groups')
      .select('existing_record_id, fault_record_id, status')
      .eq('document_id', doc.id);
    await save(ctx, {
      stage: 'done',
      stats: {
        ...doc.stats,
        groups: all?.length ?? 0,
        new_drafts: all?.filter((g) => g.fault_record_id).length ?? 0,
        linked_to_existing: all?.filter((g) => g.existing_record_id).length ?? 0,
        failed_groups: all?.filter((g) => g.status === 'failed').length ?? 0,
      },
    });
    return;
  }

  const results = await Promise.allSettled(pending.map((g) => structureGroup(ctx, g)));
  // Retryable AI errors (rate limit, timeout) stop this round; the next call retries.
  const retry = results.find((r) => r.status === 'rejected' && r.reason instanceof AIError && r.reason.retryable);
  if (retry) throw (retry as PromiseRejectedResult).reason;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      await admin
        .from('ingestion_groups')
        .update({ status: 'failed', error: String(r.reason?.message ?? r.reason).slice(0, 300) })
        .eq('id', pending[i].id);
    }
  }
  await save(ctx, {
    progress: { ...doc.progress, structured: Number(doc.progress.structured ?? 0) + pending.length },
  });
}

async function structureGroup(ctx: Ctx, group: { id: string; label: string; case_ids: string[] }): Promise<void> {
  const { admin, doc } = ctx;
  const { data: cases, error } = await admin
    .from('fault_cases')
    .select('id, problem, action_taken, hours, machine:machines(model_id, model:machine_models(code))')
    .in('id', group.case_ids);
  if (error) throw error;

  // deno-lint-ignore no-explicit-any
  const models = [...new Set(cases.map((c: any) => c.machine?.model_id).filter(Boolean))] as string[];
  const modelId = models.length === 1 ? models[0] : null;
  // deno-lint-ignore no-explicit-any
  const modelCode = modelId ? ((cases.find((c: any) => c.machine?.model_id === modelId) as any)?.machine?.model?.code ?? null) : null;

  const query = [group.label, ...cases.map((c) => `${c.problem} ${c.action_taken}`)].join(' ').slice(0, 1000);
  const { data: chunks } = await admin.rpc('search_manual_chunks', {
    p_company_id: doc.company_id,
    p_query: query,
    p_model_id: modelId,
    p_limit: 3,
  });
  const manual = ((chunks ?? []) as { id: number; document_id: string; page: number; content: string }[]).map((c, i) => ({
    ref: `m${i + 1}`,
    page: c.page,
    content: c.content,
    documentId: c.document_id,
  }));

  const structured = await structureRecord(ctx.ai, {
    label: group.label,
    model: modelCode,
    cases: cases.map((c) => ({ ref: c.id, model: modelCode, problem: c.problem, action: c.action_taken })),
    manual,
  });

  // Estimated time comes from the real repairs, not from the model.
  const hours = cases.map((c) => Number(c.hours)).filter((h) => h > 0).sort((a, b) => a - b);
  const estimatedMinutes = hours.length ? Math.round(hours[Math.floor(hours.length / 2)] * 60) : null;

  // Several chunks can come from the same page: cite each page once.
  const manualRefs = [
    ...new Map(
      manual
        .filter((m) => structured.manual_refs_used.includes(m.ref))
        .map((m) => [`${m.documentId}:${m.page}`, { document_id: m.documentId, page: m.page }]),
    ).values(),
  ];

  const { manual_refs_used: _used, ...fields } = structured;
  const { data: record, error: insertError } = await admin
    .from('fault_records')
    .insert({
      ...fields,
      company_id: doc.company_id,
      model_id: modelId,
      estimated_minutes: estimatedMinutes,
      status: 'draft',
      source_document_id: doc.id,
      manual_refs: manualRefs,
      created_by: doc.uploaded_by,
    })
    .select('id')
    .single();
  if (insertError) throw insertError;

  await admin.from('fault_cases').update({ fault_record_id: record.id }).in('id', group.case_ids);
  await admin.from('ingestion_groups').update({ status: 'done', fault_record_id: record.id }).eq('id', group.id);
}

// ------------------------------------------------------------------ manual

async function stepExtracting(ctx: Ctx): Promise<void> {
  const pages = await readPdfPages(await download(ctx));
  const chunks = chunkPages(pages);
  if (!chunks.length) {
    throw new Error('No text found in the PDF. Scanned manuals need OCR, which is not supported yet.');
  }
  await ctx.admin.from('document_chunks').delete().eq('document_id', ctx.doc.id);
  const { error } = await ctx.admin.from('document_chunks').insert(
    chunks.map((c) => ({
      company_id: ctx.doc.company_id,
      document_id: ctx.doc.id,
      page: c.page,
      chunk_index: c.chunkIndex,
      content: c.content,
    })),
  );
  if (error) throw error;
  await save(ctx, {
    stage: 'embedding',
    progress: { embedded: 0, total: chunks.length },
    stats: { pages: pages.length, chunks: chunks.length },
  });
}

async function stepEmbedding(ctx: Ctx): Promise<void> {
  const { admin, doc } = ctx;
  const { data: chunks, error } = await admin
    .from('document_chunks')
    .select('id, content')
    .eq('document_id', doc.id)
    .is('embedding', null)
    .order('id')
    .limit(EMBED_BATCH);
  if (error) throw error;
  if (!chunks.length) {
    await save(ctx, { stage: 'done' });
    return;
  }
  const { vectors } = await ctx.ai.embed(chunks.map((c) => c.content));
  await Promise.all(
    chunks.map((c, i) => admin.from('document_chunks').update({ embedding: toVector(vectors[i]) }).eq('id', c.id)),
  );
  await save(ctx, {
    progress: { ...doc.progress, embedded: Number(doc.progress.embedded ?? 0) + chunks.length },
  });
}
