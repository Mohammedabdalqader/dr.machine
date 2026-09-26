// Run: npx deno test supabase/functions/_shared --allow-env --allow-read
import { assert, assertEquals } from 'jsr:@std/assert@1';

import { loadAIConfig } from '../ai/config.ts';
import { MockProvider } from '../ai/mock.ts';
import { groupCases, mapColumns } from './ai-steps.ts';
import { chunkPages, readPdfPages } from './manual.ts';
import { extractCases, guessMapping, matchMachine, parseDate, parseHours, readGrid } from './spreadsheet.ts';

const SAMPLE = new URL('../../../../data/sample/', import.meta.url);

Deno.test('parseDate reads day-first, ISO and Excel serial dates', () => {
  assertEquals(parseDate('25/01/2024'), '2024-01-25');
  assertEquals(parseDate('21-02-24'), '2024-02-21');
  assertEquals(parseDate('2024-02-28'), '2024-02-28');
  assertEquals(parseDate('08.03.2024'), '2024-03-08');
  assertEquals(parseDate('45292'), '2024-01-01');
  assertEquals(parseDate('31/13/2024'), null);
  assertEquals(parseDate('yesterday'), null);
});

Deno.test('parseHours accepts decimals and rejects junk', () => {
  assertEquals(parseHours('1.5'), 1.5);
  assertEquals(parseHours('2,25'), 2.25);
  assertEquals(parseHours(''), null);
  assertEquals(parseHours('n/a'), null);
});

Deno.test('matchMachine understands how technicians write machine names', () => {
  const machines = [
    { id: 'm1', tag: 'C-01' },
    { id: 'm2', tag: 'C-02' },
    { id: 'm3', tag: 'C-03' },
  ];
  assertEquals(matchMachine('C-02', machines), 'm2');
  assertEquals(matchMachine('C03', machines), 'm3');
  assertEquals(matchMachine('comp 1', machines), 'm1');
  assertEquals(matchMachine('C-02 (RS-55)', machines), 'm2');
  assertEquals(matchMachine('boiler', machines), null);
  assertEquals(matchMachine('', machines), null);
});

Deno.test('sample fault log: header found below the title row and all cases extracted', async () => {
  const grid = readGrid(await Deno.readFile(new URL('sample_plant_fault_log.xlsx', SAMPLE)));
  const mapping = guessMapping(grid);
  assert(mapping, 'header not found');
  assertEquals(mapping.headerRow, 1); // row 0 is the "SAMPLE DATA" banner
  assertEquals(grid[mapping.headerRow][mapping.columns.problem!], 'Problem');
  assertEquals(grid[mapping.headerRow][mapping.columns.action!], 'Action taken');

  const cases = extractCases(grid, mapping, 1000);
  assertEquals(cases.length, 59);
  assert(cases.some((c) => /[؀-ۿ]/.test(c.problem)), 'Arabic problems preserved');
  assert(cases.filter((c) => c.occurredOn).length >= 55, 'most dates parsed');
});

Deno.test('CSV export parses the same as xlsx', async () => {
  const grid = readGrid(await Deno.readFile(new URL('sample_plant_fault_log.csv', SAMPLE)));
  const mapping = guessMapping(grid)!;
  assertEquals(extractCases(grid, mapping, 1000).length, 59);
});

Deno.test('mock AI steps produce valid mapping and complete grouping', async () => {
  const ai = new MockProvider(loadAIConfig());
  const grid = readGrid(await Deno.readFile(new URL('sample_plant_fault_log.xlsx', SAMPLE)));
  const mapping = await mapColumns(ai, grid);
  const cases = extractCases(grid, mapping, 1000).map((c, i) => ({
    ref: `c${i + 1}`,
    model: null,
    problem: c.problem,
    action: c.action,
  }));
  const groups = await groupCases(ai, cases, []);
  const assigned = groups.flatMap((g) => g.cases);
  assertEquals(assigned.length, cases.length);
  assertEquals(new Set(assigned).size, cases.length);
});

Deno.test('sample manual: 18 pages, page numbers kept for citations', async () => {
  const pages = await readPdfPages(await Deno.readFile(new URL('aircore_rs_service_manual_SAMPLE.pdf', SAMPLE)));
  assertEquals(pages.length, 18);
  const chunks = chunkPages(pages);
  const cooling = chunks.find((c) => c.content.includes('Oil cooler fins blocked'));
  assert(cooling, 'cooler troubleshooting found');
  assertEquals(cooling.page, 8);
  assert(chunks.every((c) => c.content.length <= 1500));
});
