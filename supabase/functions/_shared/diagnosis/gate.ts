/**
 * Deterministic rules around the AI: how strong the evidence is, when to say
 * "not enough data", and which safety steps to show. Kept free of I/O so they
 * can be unit-tested and tuned with the evaluation set.
 */

export type Confidence = 'high' | 'medium' | 'low';

export type Candidate = {
  id: string;
  code_match: boolean;
  text_rank: number;
  similarity: number;
};

/**
 * Similarity thresholds for bge-m3 cosine similarity between the (English)
 * problem summary and a record's search text. Calibrated on the sample test set;
 * override with DIAG_SIM_* secrets if a new embedding model is used.
 */
export type Thresholds = { strong: number; medium: number; minimum: number };

export const DEFAULT_THRESHOLDS: Thresholds = {
  strong: Number(Deno.env.get('DIAG_SIM_STRONG') ?? 0.72),
  medium: Number(Deno.env.get('DIAG_SIM_MEDIUM') ?? 0.62),
  minimum: Number(Deno.env.get('DIAG_SIM_MINIMUM') ?? 0.5),
};

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** How strongly the retrieved evidence supports one candidate on its own. */
export function evidenceLevel(c: Candidate, t: Thresholds = DEFAULT_THRESHOLDS): Confidence {
  if ((c.code_match && c.similarity >= t.medium) || c.similarity >= t.strong) return 'high';
  if (c.code_match || c.similarity >= t.medium) return 'medium';
  return 'low';
}

/** Is there anything worth asking the model about? If not: "not enough data", no guessing. */
export function hasUsableEvidence(candidates: Candidate[], t: Thresholds = DEFAULT_THRESHOLDS): boolean {
  return candidates.some((c) => c.code_match || c.similarity >= t.minimum);
}

/** The model may never be more confident than the evidence allows. */
export function capConfidence(model: Confidence, evidence: Confidence): Confidence {
  return RANK[model] <= RANK[evidence] ? model : evidence;
}

/**
 * Confidence gate, calibrated on the sample test set: the ranking model's own
 * confidence separates known faults ("high") from faults missing in the
 * knowledge base ("medium"/"low") far better than embedding similarity does.
 * A top cause is shown only when the model is sure, or fairly sure with at
 * least medium evidence; otherwise the answer is "not enough data".
 */
export function acceptCause(model: Confidence, evidence: Confidence): boolean {
  return model === 'high' || (model === 'medium' && evidence !== 'low');
}

/** Shown confidence: the model's, one level lower when the retrieval evidence is weak. */
export function finalConfidence(model: Confidence, evidence: Confidence): Confidence {
  if (evidence !== 'low') return model;
  return model === 'high' ? 'medium' : 'low';
}

export function parseConfidence(value: unknown): Confidence {
  return value === 'high' || value === 'medium' ? value : 'low';
}

const GENERIC_SAFETY = 'Stop the machine and apply lockout/tagout before any work.';

/** Safety notes of the suggested causes, in rank order, without duplicates. Never empty. */
export function mergeSafety(notesPerCause: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const notes of notesPerCause) {
    for (const note of notes) {
      const key = note.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(note.trim());
      }
    }
  }
  return out.length ? out : [GENERIC_SAFETY];
}

/** Error codes as technicians type them: "e101", "E-101", "كود E101". */
export function extractCodes(text: string): string[] {
  const matches = text.toUpperCase().match(/\b[A-Z]{1,3}-?\d{2,4}\b/g) ?? [];
  return [...new Set(matches.map((c) => c.replace('-', '')))];
}
