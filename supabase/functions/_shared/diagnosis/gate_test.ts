import { assert, assertEquals } from 'jsr:@std/assert@1';

import { acceptCause, capConfidence, evidenceLevel, extractCodes, finalConfidence, hasUsableEvidence, mergeSafety } from './gate.ts';

const t = { strong: 0.72, medium: 0.62, minimum: 0.5 };
const c = (code_match: boolean, similarity: number) => ({ id: 'x', code_match, text_rank: 0, similarity });

Deno.test('evidence level combines code match and similarity', () => {
  assertEquals(evidenceLevel(c(true, 0.65), t), 'high');
  assertEquals(evidenceLevel(c(false, 0.8), t), 'high');
  assertEquals(evidenceLevel(c(true, 0.4), t), 'medium');
  assertEquals(evidenceLevel(c(false, 0.65), t), 'medium');
  assertEquals(evidenceLevel(c(false, 0.55), t), 'low');
});

Deno.test('no usable evidence means not enough data', () => {
  assert(!hasUsableEvidence([], t));
  assert(!hasUsableEvidence([c(false, 0.45), c(false, 0.3)], t));
  assert(hasUsableEvidence([c(false, 0.45), c(true, 0.2)], t));
  assert(hasUsableEvidence([c(false, 0.51)], t));
});

Deno.test('the model can never be more confident than the evidence', () => {
  assertEquals(capConfidence('high', 'medium'), 'medium');
  assertEquals(capConfidence('low', 'high'), 'low');
  assertEquals(capConfidence('medium', 'medium'), 'medium');
});

Deno.test('gate accepts sure answers and declines weak ones', () => {
  assert(acceptCause('high', 'low'));
  assert(acceptCause('medium', 'medium'));
  assert(!acceptCause('medium', 'low'));
  assert(!acceptCause('low', 'high'));
  assertEquals(finalConfidence('high', 'low'), 'medium');
  assertEquals(finalConfidence('high', 'medium'), 'high');
  assertEquals(finalConfidence('medium', 'low'), 'low');
});

Deno.test('safety notes are merged in order, without duplicates, never empty', () => {
  assertEquals(mergeSafety([['Lockout/tagout.', 'Hot surfaces'], ['lockout / tagout', 'Wear PPE']]), [
    'Lockout/tagout.',
    'Hot surfaces',
    'Wear PPE',
  ]);
  assertEquals(mergeSafety([[], []]).length, 1);
});

Deno.test('error codes are found in typed text', () => {
  assertEquals(extractCodes('انذار e101 والضغط'), ['E101']);
  assertEquals(extractCodes('E-305 then E101, E101'), ['E305', 'E101']);
  assertEquals(extractCodes('pressure 8 bar'), []);
});
