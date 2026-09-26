import qrcodeGenerator from 'qrcode-generator';

import type { Machine } from '@/lib/types';

/** What a machine's QR sticker encodes: a deep link that opens the machine in the app. */
export function machineLink(machineId: string): string {
  return `muallim://machine/${machineId}`;
}

export function qrSvg(text: string, cellSize = 6): string {
  const qr = qrcodeGenerator(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize, margin: 2, scalable: true });
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Printable A4 sheet of stickers (3 per row), opened with expo-print. */
export function stickerSheetHtml(machines: Machine[], scanWith: string): string {
  const stickers = machines
    .map(
      (m) => `
      <div class="sticker">
        <div class="qr">${qrSvg(machineLink(m.id))}</div>
        <div class="tag">${escape(m.tag)}</div>
        <div class="meta">${escape([m.model?.code, m.line?.name].filter(Boolean).join(' · '))}</div>
        <div class="brand">${escape(scanWith)}</div>
      </div>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    @page { size: A4; margin: 10mm; }
    body { font-family: -apple-system, Roboto, 'Segoe UI', sans-serif; margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; }
    .sticker { border: 1.5px dashed #999; border-radius: 4mm; padding: 4mm; text-align: center; break-inside: avoid; }
    .qr svg { width: 42mm; height: 42mm; }
    .tag { font-size: 20pt; font-weight: 800; color: #1E2632; }
    .meta { font-size: 10pt; color: #5B6573; }
    .brand { margin-top: 2mm; font-size: 9pt; color: #E0851F; font-weight: 700; }
  </style></head><body><div class="grid">${stickers}</div></body></html>`;
}
