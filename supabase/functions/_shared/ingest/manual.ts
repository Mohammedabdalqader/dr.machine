import { extractText, getDocumentProxy } from 'npm:unpdf@1';

export type PageText = { page: number; text: string };
export type Chunk = { page: number; chunkIndex: number; content: string };

export async function readPdfPages(bytes: Uint8Array): Promise<PageText[]> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map((t, i) => ({ page: i + 1, text: t.replace(/[ \t]+/g, ' ').trim() }));
}

/**
 * One chunk per page when it fits (so citations stay "manual p. N"), otherwise
 * split on paragraph/sentence boundaries into pieces of about `max` characters.
 */
export function chunkPages(pages: PageText[], max = 1500): Chunk[] {
  const chunks: Chunk[] = [];
  for (const { page, text } of pages) {
    if (text.length < 20) continue; // blank or image-only page
    if (text.length <= max) {
      chunks.push({ page, chunkIndex: 0, content: text });
      continue;
    }
    const parts = text.split(/(?<=[.!?؟])\s+|\n{2,}/);
    let current = '';
    let index = 0;
    for (const part of parts) {
      if (current && current.length + part.length + 1 > max) {
        chunks.push({ page, chunkIndex: index++, content: current.trim() });
        current = '';
      }
      current += (current ? ' ' : '') + part;
      while (current.length > max) {
        chunks.push({ page, chunkIndex: index++, content: current.slice(0, max) });
        current = current.slice(max);
      }
    }
    if (current.trim()) chunks.push({ page, chunkIndex: index, content: current.trim() });
  }
  return chunks;
}
