import * as XLSX from 'npm:xlsx@0.18.5';

/** Logical columns of a maintenance log. `problem` is the only required one. */
export const FIELDS = ['ref', 'date', 'machine', 'problem', 'action', 'parts', 'hours', 'technician'] as const;
export type Field = (typeof FIELDS)[number];
export type ColumnMap = Partial<Record<Field, number>>;
export type Mapping = { headerRow: number; columns: ColumnMap };

/** Reads the first sheet (xlsx, xls or csv) as a grid of trimmed strings. */
export function readGrid(bytes: Uint8Array): string[][] {
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: false, raw: false, codepage: 65001 });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
  return rows.map((r) => r.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim()));
}

const HINTS: Record<Field, RegExp> = {
  ref: /^(ref|wo|work ?order|no\.?|#|id|رقم)/i,
  date: /(date|day|تاريخ)/i,
  machine: /(machine|equipment|asset|unit|comp|الماكينة|المعدة|الآلة|الجهاز)/i,
  problem: /(problem|fault|symptom|issue|complaint|description|العطل|المشكلة|الوصف)/i,
  action: /(action|done|repair|fix|remedy|work done|الإجراء|الاصلاح|الإصلاح|العمل)/i,
  parts: /(part|spare|material|قطع)/i,
  hours: /^(hrs?|hours?|time|duration|المدة|ساعات)/i,
  technician: /(tech|by|name|الفني)/i,
};

/**
 * Header detection without AI: the first row (within the first 10) where the
 * "problem" column and at least one other column can be recognized.
 * Also used as the mock answer for the AI mapping step.
 */
export function guessMapping(grid: string[][]): Mapping | null {
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const columns: ColumnMap = {};
    grid[r].forEach((cell, c) => {
      for (const field of FIELDS) {
        if (columns[field] === undefined && HINTS[field].test(cell)) {
          columns[field] = c;
          break;
        }
      }
    });
    if (columns.problem !== undefined && Object.keys(columns).length >= 2) return { headerRow: r, columns };
  }
  return null;
}

export function validateMapping(value: unknown, grid: string[][]): Mapping {
  const v = value as { header_row?: unknown; columns?: Record<string, unknown> };
  const headerRow = Number(v?.header_row);
  if (!Number.isInteger(headerRow) || headerRow < 0 || headerRow >= Math.min(grid.length, 20)) {
    throw new Error('header_row out of range');
  }
  const width = Math.max(...grid.slice(0, 20).map((r) => r.length));
  const columns: ColumnMap = {};
  for (const field of FIELDS) {
    const raw = v.columns?.[field];
    if (raw === null || raw === undefined) continue;
    const idx = Number(raw);
    if (!Number.isInteger(idx) || idx < 0 || idx >= width) throw new Error(`column ${field} out of range`);
    columns[field] = idx;
  }
  if (columns.problem === undefined) throw new Error('no problem column');
  return { headerRow, columns };
}

/** Parses the date formats found in real logs, plus Excel serial numbers. Returns YYYY-MM-DD. */
export function parseDate(text: string): string | null {
  const s = text.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    // Day first, as written in Jordan and the Gulf.
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else if (/^\d{5}(\.\d+)?$/.test(s)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000);
    return date.toISOString().slice(0, 10);
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseHours(text: string): number | null {
  const n = Number(text.replace(',', '.').replace(/[^\d.]/g, ''));
  return text.trim() && Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 100) / 100 : null;
}

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9؀-ۿ]/g, '');

/**
 * Matches how people write machine names ("C03", "comp 3", "C-02 (RS-55)")
 * to registered machine tags. Returns null when unsure rather than guessing.
 */
export function matchMachine(label: string, machines: { id: string; tag: string }[]): string | null {
  if (!label.trim()) return null;
  const target = alnum(label);
  const byTag = machines.map((m) => ({ id: m.id, key: alnum(m.tag) }));

  const exact = byTag.find((m) => m.key === target);
  if (exact) return exact.id;
  const prefix = byTag.filter((m) => m.key.length >= 2 && target.startsWith(m.key));
  if (prefix.length === 1) return prefix[0].id;

  // Only a number was written ("comp 3"): match the unique tag ending in that number.
  const num = label.match(/(\d+)\s*$/)?.[1] ?? label.match(/\b(\d{1,3})\b/)?.[1];
  if (num) {
    const n = Number(num);
    const hits = machines.filter((m) => Number(m.tag.match(/(\d+)\D*$/)?.[1]) === n);
    if (hits.length === 1) return hits[0].id;
  }
  return null;
}

export type ParsedCase = {
  sourceRef: string;
  occurredOn: string | null;
  machineLabel: string;
  problem: string;
  action: string;
  parts: string;
  hours: number | null;
  technician: string;
  raw: Record<string, string>;
};

export function extractCases(grid: string[][], mapping: Mapping, limit: number): ParsedCase[] {
  const header = grid[mapping.headerRow] ?? [];
  const get = (row: string[], field: Field) => {
    const idx = mapping.columns[field];
    return idx === undefined ? '' : (row[idx] ?? '').trim();
  };
  const cases: ParsedCase[] = [];
  for (let r = mapping.headerRow + 1; r < grid.length && cases.length < limit; r++) {
    const row = grid[r];
    const problem = get(row, 'problem');
    if (!problem) continue;
    const raw: Record<string, string> = {};
    row.forEach((cell, i) => {
      if (cell) raw[header[i] || `col${i + 1}`] = cell;
    });
    cases.push({
      sourceRef: get(row, 'ref') || `row ${r + 1}`,
      occurredOn: parseDate(get(row, 'date')),
      machineLabel: get(row, 'machine'),
      problem,
      action: get(row, 'action'),
      parts: get(row, 'parts'),
      hours: parseHours(get(row, 'hours')),
      technician: get(row, 'technician'),
      raw,
    });
  }
  return cases;
}
