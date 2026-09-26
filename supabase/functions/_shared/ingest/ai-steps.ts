import type { AIProvider } from '../ai/index.ts';
import { FIELDS, guessMapping, validateMapping, type Mapping } from './spreadsheet.ts';

// ------------------------------------------------------------------ 1. column mapping

export async function mapColumns(ai: AIProvider, grid: string[][]): Promise<Mapping> {
  const preview = grid
    .slice(0, 12)
    .map((row, i) => `${i}: ${JSON.stringify(row.map((c) => c.slice(0, 60)))}`)
    .join('\n');
  const guess = guessMapping(grid);

  const { data } = await ai.chatJSON({
    purpose: 'extraction',
    temperature: 0,
    maxTokens: 300,
    messages: [
      {
        role: 'system',
        content:
          'You map the columns of a maintenance / breakdown log exported from a factory. ' +
          'Rows are shown as "<row index>: [cells]". Some files have title rows before the header. ' +
          'Headers may be English or Arabic, abbreviated, or missing.\n' +
          `Return JSON: {"header_row": <index of the header row>, "columns": {${FIELDS.map((f) => `"${f}": <column index or null>`).join(', ')}}}\n` +
          'problem = description of the fault/symptom (required). action = what was done / repair. ' +
          'machine = machine name or tag. hours = time spent. technician = who did it. ref = work order or reference number.',
      },
      { role: 'user', content: preview },
    ],
    validate: (v) => validateMapping(v, grid),
    mock: () => {
      if (!guess) throw new Error('Could not find a header row with a problem/description column');
      return {
        header_row: guess.headerRow,
        columns: Object.fromEntries(FIELDS.map((f) => [f, guess.columns[f] ?? null])),
      };
    },
  });
  return data;
}

// ------------------------------------------------------------------ 2. grouping cases

export type CaseForGrouping = { ref: string; model: string | null; problem: string; action: string };
export type Candidate = { ref: string; summary: string };
export type Grouping = { label: string; cases: string[]; target: string | null }[];

/**
 * Groups repair cases that describe the same underlying fault (same root cause).
 * Candidates are existing knowledge records ("r1"...) and groups already created
 * earlier in this import ("g1"...); a group may be attached to one of them.
 */
export async function groupCases(ai: AIProvider, cases: CaseForGrouping[], candidates: Candidate[]): Promise<Grouping> {
  const caseRefs = new Set(cases.map((c) => c.ref));
  const candidateRefs = new Set(candidates.map((c) => c.ref));

  const { data } = await ai.chatJSON({
    purpose: 'extraction',
    temperature: 0,
    maxTokens: 4000,
    messages: [
      {
        role: 'system',
        content:
          'You are a senior maintenance engineer cleaning up a breakdown log for industrial machines. ' +
          'Group the cases that describe the SAME underlying fault, meaning the same root cause and the same fix ' +
          '(for example several "high temperature, cooler dirty, cleaned cooler" entries). ' +
          'Entries may be in English or Arabic, abbreviated, or have typos. ' +
          'Different root causes must be different groups even when the symptom or alarm code is the same ' +
          '(a high-temperature alarm caused by low oil is not the same fault as one caused by a dirty cooler). ' +
          'If a group matches one of the existing candidates, set "target" to that candidate ref, otherwise null.\n' +
          'Return JSON: {"groups": [{"label": "<short English name of the fault>", "cases": ["c1", ...], "target": "r1" | "g1" | null}]}\n' +
          'Every case ref must appear in exactly one group.',
      },
      {
        role: 'user',
        content:
          `Existing candidates:\n${candidates.map((c) => `${c.ref}: ${c.summary}`).join('\n') || '(none)'}\n\n` +
          `Cases:\n${cases
            .map((c) => `${c.ref} [${c.model ?? 'unknown model'}] problem: ${c.problem} | action: ${c.action || '-'}`)
            .join('\n')}`,
      },
    ],
    validate: (v) => normalizeGrouping(v, caseRefs, candidateRefs),
    mock: () => ({ groups: mockGrouping(cases) }),
  });
  return data;
}

function normalizeGrouping(value: unknown, caseRefs: Set<string>, candidateRefs: Set<string>): Grouping {
  const groups = (value as { groups?: unknown[] })?.groups;
  if (!Array.isArray(groups)) throw new Error('groups missing');
  const seen = new Set<string>();
  const out: Grouping = [];
  for (const g of groups as { label?: unknown; cases?: unknown; target?: unknown }[]) {
    const refs = (Array.isArray(g.cases) ? g.cases : []).map(String).filter((r) => caseRefs.has(r) && !seen.has(r));
    refs.forEach((r) => seen.add(r));
    if (!refs.length) continue;
    const target = typeof g.target === 'string' && candidateRefs.has(g.target) ? g.target : null;
    out.push({ label: String(g.label ?? '').slice(0, 120) || 'Unnamed fault', cases: refs, target });
  }
  // Never lose a case: anything the model forgot becomes its own group.
  for (const ref of caseRefs) {
    if (!seen.has(ref)) out.push({ label: 'Ungrouped case', cases: [ref], target: null });
  }
  return out;
}

/** Without AI: group by the first alarm code, else by the first words of the problem. */
function mockGrouping(cases: CaseForGrouping[]): Grouping {
  const groups = new Map<string, string[]>();
  for (const c of cases) {
    const code = c.problem.toUpperCase().match(/\b[A-Z]{1,3}-?\d{2,4}\b/)?.[0];
    const key = code ?? c.problem.toLowerCase().split(/\s+/).slice(0, 3).join(' ');
    groups.set(key, [...(groups.get(key) ?? []), c.ref]);
  }
  return [...groups.entries()].map(([key, refs]) => ({ label: key, cases: refs, target: null }));
}

// ------------------------------------------------------------------ 3. structuring a record

export type ManualExcerpt = { ref: string; page: number; content: string };
export type StructuredRecord = {
  title: string;
  component: string;
  symptoms: string;
  error_codes: string[];
  root_cause: string;
  fix_steps: string[];
  parts: string[];
  tools: string[];
  safety_notes: string[];
  requires_qualified: boolean;
  manual_refs_used: string[];
};

export async function structureRecord(
  ai: AIProvider,
  input: { label: string; model: string | null; cases: CaseForGrouping[]; manual: ManualExcerpt[] },
): Promise<StructuredRecord> {
  const manualRefs = new Set(input.manual.map((m) => m.ref));
  const { data } = await ai.chatJSON({
    purpose: 'extraction',
    temperature: 0.1,
    maxTokens: 1500,
    messages: [
      {
        role: 'system',
        content:
          'You turn messy repair log entries into ONE clean, structured fault record for a maintenance knowledge base. ' +
          'Technicians will follow it on the shop floor, so be precise, practical and safe.\n' +
          'Rules:\n' +
          '- Base the record on the repair cases. Use the manual excerpts only to complete or correct the procedure, parts and safety steps.\n' +
          '- Do not invent part numbers, values or codes that are not in the cases or manual excerpts.\n' +
          '- Write in clear English, even if the cases are in Arabic.\n' +
          '- fix_steps: ordered, imperative, one action per step; start with isolating/stopping the machine when relevant.\n' +
          '- safety_notes: always at least one (lockout/tagout, stored pressure, hot surfaces, electrical, PPE as relevant).\n' +
          '- requires_qualified: true when any step needs an electrician or other certified person.\n' +
          '- manual_refs_used: the refs ("m1"...) of manual excerpts you actually used.\n' +
          'Return exactly one JSON object with this shape (fill in every field):\n' +
          JSON.stringify({
            title: 'short name of the fault',
            component: 'affected component',
            symptoms: 'what the technician observes',
            error_codes: ['E101'],
            root_cause: 'the underlying cause',
            fix_steps: ['step 1', 'step 2'],
            parts: ['part name'],
            tools: ['tool name'],
            safety_notes: ['safety step'],
            requires_qualified: false,
            manual_refs_used: ['m1'],
          }),
      },
      {
        role: 'user',
        content:
          `Fault group: ${input.label}\nMachine model: ${input.model ?? 'various'}\n\nRepair cases:\n` +
          input.cases.map((c) => `- problem: ${c.problem} | action: ${c.action || '-'}`).join('\n') +
          `\n\nManual excerpts:\n` +
          (input.manual.map((m) => `${m.ref} (page ${m.page}): ${m.content.slice(0, 1200)}`).join('\n\n') || '(none)'),
      },
    ],
    validate: (v) => validateStructured(v, manualRefs),
    mock: () => mockStructured(input),
  });
  return data;
}

const list = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : typeof v === 'string' && v ? [v] : [];

function validateStructured(value: unknown, manualRefs: Set<string>): StructuredRecord {
  const v = value as Record<string, unknown>;
  const out: StructuredRecord = {
    title: String(v.title ?? '').trim(),
    component: String(v.component ?? '').trim(),
    symptoms: String(v.symptoms ?? '').trim(),
    error_codes: list(v.error_codes).map((c) => c.toUpperCase()),
    root_cause: String(v.root_cause ?? '').trim(),
    fix_steps: list(v.fix_steps),
    parts: list(v.parts),
    tools: list(v.tools),
    safety_notes: list(v.safety_notes),
    requires_qualified: Boolean(v.requires_qualified),
    manual_refs_used: list(v.manual_refs_used).filter((r) => manualRefs.has(r)),
  };
  if (!out.symptoms || !out.root_cause) throw new Error('symptoms and root_cause are required');
  return out;
}

function mockStructured(input: { label: string; cases: CaseForGrouping[] }): StructuredRecord {
  const unique = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  const codes = unique(input.cases.flatMap((c) => c.problem.toUpperCase().match(/\b[A-Z]{1,3}-?\d{2,4}\b/g) ?? []));
  return {
    title: input.label,
    component: '',
    symptoms: unique(input.cases.map((c) => c.problem)).join('; '),
    error_codes: codes,
    root_cause: unique(input.cases.map((c) => c.action)).join('; ') || 'Unknown - to be completed by the engineer',
    fix_steps: unique(input.cases.map((c) => c.action)),
    parts: [],
    tools: [],
    safety_notes: ['Stop the machine and apply lockout/tagout before any work.'],
    requires_qualified: false,
    manual_refs_used: [],
  };
}
