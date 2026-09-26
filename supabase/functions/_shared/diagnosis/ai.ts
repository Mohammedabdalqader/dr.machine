import type { AIProvider, Usage } from '../ai/index.ts';
import { extractCodes, parseConfidence, type Confidence } from './gate.ts';

// ------------------------------------------------------------------ photos

export type VisionFindings = { error_codes: string[]; display_text: string; visible_symptoms: string };

/** Reads error displays and describes visible damage (leaks, burnt parts, broken belts). */
export async function readPhotos(ai: AIProvider, images: string[]): Promise<{ data: VisionFindings; usage: Usage }> {
  const { data, usage } = await ai.chatJSON({
    purpose: 'vision',
    temperature: 0,
    maxTokens: 400,
    messages: [
      {
        role: 'system',
        content:
          'You look at photos taken by a maintenance technician at an industrial machine. ' +
          'Report only what is visible; do not guess causes. ' +
          'Return JSON: {"error_codes": ["codes shown on any display, e.g. E101"], ' +
          '"display_text": "text shown on displays or labels", "visible_symptoms": "leaks, damage, burn marks, dirt, etc."}',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What do you see?' },
          ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
        ],
      },
    ],
    validate: (v) => {
      const o = v as Record<string, unknown>;
      return {
        error_codes: Array.isArray(o.error_codes) ? o.error_codes.map(String).flatMap(extractCodes) : [],
        display_text: String(o.display_text ?? '').slice(0, 500),
        visible_symptoms: String(o.visible_symptoms ?? '').slice(0, 800),
      };
    },
    mock: () => ({ error_codes: [], display_text: '', visible_symptoms: '' }),
  });
  return { data, usage };
}

// ------------------------------------------------------------------ understanding

export type Understanding = { summary_en: string; error_codes: string[]; keywords: string[] };

/**
 * Turns the report (often Arabic, informal) into a short English technical
 * summary for search: the knowledge base is written in English.
 */
export async function understand(
  ai: AIProvider,
  input: { text: string; errorCode: string; vision: VisionFindings | null; model: string | null },
): Promise<{ data: Understanding; usage: Usage }> {
  const typedCodes = extractCodes(`${input.errorCode} ${input.text}`);
  const { data, usage } = await ai.chatJSON({
    purpose: 'reasoning',
    temperature: 0,
    maxTokens: 300,
    messages: [
      {
        role: 'system',
        content:
          'You rewrite a technician\'s fault report about an industrial machine into a short, precise English ' +
          'technical description for searching a maintenance knowledge base. Keep every observed fact ' +
          '(alarms, timing, noises, temperatures, leaks). Do not add causes or guesses. ' +
          'Return JSON: {"summary_en": "one or two sentences", "error_codes": ["E101"], "keywords": ["component or symptom words"]}',
      },
      {
        role: 'user',
        content:
          `Machine model: ${input.model ?? 'unknown'}\n` +
          `Report: ${input.text || '(none)'}\n` +
          `Error code entered: ${input.errorCode || '(none)'}\n` +
          (input.vision
            ? `From photos - display: ${input.vision.display_text || '-'}; visible: ${input.vision.visible_symptoms || '-'}; codes: ${input.vision.error_codes.join(', ') || '-'}`
            : ''),
      },
    ],
    validate: (v) => {
      const o = v as Record<string, unknown>;
      const summary = String(o.summary_en ?? '').trim();
      if (!summary) throw new Error('summary_en missing');
      return {
        summary_en: summary.slice(0, 600),
        error_codes: [
          ...new Set([
            ...typedCodes,
            ...(input.vision?.error_codes ?? []),
            ...(Array.isArray(o.error_codes) ? o.error_codes.map(String).flatMap(extractCodes) : []),
          ]),
        ],
        keywords: Array.isArray(o.keywords) ? o.keywords.map(String).slice(0, 12) : [],
      };
    },
    mock: () => ({ summary_en: input.text || input.vision?.visible_symptoms || input.errorCode, error_codes: typedCodes, keywords: [] }),
  });
  return { data, usage };
}

// ------------------------------------------------------------------ ranking

export type RankInput = {
  language: 'ar' | 'en';
  report: string;
  understanding: Understanding;
  model: string | null;
  machineHistory: string[];
  candidates: {
    ref: string;
    title: string;
    component: string;
    symptoms: string;
    error_codes: string[];
    root_cause: string;
    applies_to: string;
    past_cases: number;
    past_cases_total: number;
  }[];
  manual: { ref: string; page: number; content: string }[];
};

export type RankedCause = {
  ref: string;
  confidence: Confidence;
  title: string;
  reason: string;
  manual_refs: string[];
};

export type Ranking = { causes: RankedCause[]; not_enough_data: boolean; follow_up_question: string };

export async function rankCauses(ai: AIProvider, input: RankInput): Promise<{ data: Ranking; usage: Usage }> {
  const refs = new Set(input.candidates.map((c) => c.ref));
  const manualRefs = new Set(input.manual.map((m) => m.ref));
  const lang = input.language === 'ar' ? 'Arabic' : 'English';

  const { data, usage } = await ai.chatJSON({
    purpose: 'reasoning',
    temperature: 0,
    maxTokens: 900,
    messages: [
      {
        role: 'system',
        content:
          'You are the most experienced maintenance technician of this company. A colleague reports a fault. ' +
          'Choose the most likely causes ONLY from the candidate fault records, which come from this company\'s ' +
          'own approved repair history. Never invent a cause that is not a candidate.\n' +
          'Rules:\n' +
          '- Return at most 3 causes, most likely first. A cause must fit the reported symptoms and error codes; ' +
          'a matching alarm code alone is not enough if the described symptoms contradict the record.\n' +
          '- The cause must be physically possible on this machine model (see its description): for example no ' +
          'belt faults on a direct-drive machine. "applies to" is the model a record is limited to, or "all models".\n' +
          '- confidence: "high" only when symptoms and codes clearly match and there are past cases; "medium" when it fits but ' +
          'other causes are possible; "low" when it is only a possibility.\n' +
          '- If no candidate plausibly explains the report, return no causes and set not_enough_data to true. ' +
          'Saying "not enough data" is better than guessing.\n' +
          `- title and reason must be written in ${lang}. reason: one sentence, what in the report matches this record.\n` +
          '- follow_up_question: if one question to the technician would clearly separate the top causes, ask it ' +
          `in ${lang}; otherwise "".\n` +
          '- manual_refs: the refs ("m1"...) of manual excerpts that support a cause.\n' +
          'Return JSON: {"causes": [{"ref": "k1", "confidence": "high|medium|low", "title": "...", "reason": "...", ' +
          '"manual_refs": ["m1"]}], "not_enough_data": false, "follow_up_question": ""}',
      },
      {
        role: 'user',
        content:
          `Machine model: ${input.model ?? 'unknown'}\n` +
          `Technician report: ${input.report || '(none)'}\n` +
          `Technical summary: ${input.understanding.summary_en}\n` +
          `Error codes: ${input.understanding.error_codes.join(', ') || 'none'}\n` +
          (input.machineHistory.length ? `Recent repairs on this machine:\n${input.machineHistory.map((h) => `- ${h}`).join('\n')}\n` : '') +
          `\nCandidate fault records:\n` +
          input.candidates
            .map(
              (c) =>
                `${c.ref}: ${c.title} | component: ${c.component} | symptoms: ${c.symptoms} | codes: ${c.error_codes.join(', ') || '-'} | ` +
                `root cause: ${c.root_cause} | applies to: ${c.applies_to} | ` +
                `past cases: ${c.past_cases} on this model, ${c.past_cases_total} in total`,
            )
            .join('\n') +
          `\n\nManual excerpts:\n` +
          (input.manual.map((m) => `${m.ref} (page ${m.page}): ${m.content.slice(0, 700)}`).join('\n') || '(none)'),
      },
    ],
    validate: (v) => {
      const o = v as Record<string, unknown>;
      const causes = (Array.isArray(o.causes) ? o.causes : [])
        .map((c) => c as Record<string, unknown>)
        .filter((c) => refs.has(String(c.ref)))
        .filter((c, i, all) => all.findIndex((x) => x.ref === c.ref) === i)
        .slice(0, 3)
        .map((c) => ({
          ref: String(c.ref),
          confidence: parseConfidence(c.confidence),
          title: String(c.title ?? '').slice(0, 200),
          reason: String(c.reason ?? '').slice(0, 600),
          manual_refs: (Array.isArray(c.manual_refs) ? c.manual_refs.map(String) : []).filter((r) => manualRefs.has(r)),
        }));
      return {
        causes,
        // No valid cause means not enough data, whatever the flag says.
        not_enough_data: causes.length === 0,
        follow_up_question: String(o.follow_up_question ?? '').slice(0, 300),
      };
    },
    // Without AI: trust retrieval order.
    mock: () => ({
      causes: input.candidates.slice(0, 3).map((c) => ({ ref: c.ref, confidence: 'medium', title: c.title, reason: '', manual_refs: [] })),
      not_enough_data: input.candidates.length === 0,
      follow_up_question: '',
    }),
  });
  return { data, usage };
}
