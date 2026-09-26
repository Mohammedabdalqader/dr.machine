/**
 * Models sometimes wrap JSON in ```json fences or add a sentence around it.
 * Extract the first top-level JSON object or array.
 */
export function parseModelJSON(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // fall through
    }
  }
  const start = trimmed.search(/[{[]/);
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new SyntaxError('Model response did not contain JSON');
}
