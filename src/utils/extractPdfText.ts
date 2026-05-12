/**
 * extractPdfText.ts
 *
 * Client-side PDF text extraction using pdfjs-dist.
 * Handles selectable-text PDFs (e.g. UG Pro exports). Scanned/image PDFs
 * will return empty or garbled text — callers should surface an error in
 * that case and fall back to the OMR backend if available.
 *
 * Worker setup: pdfjs-dist requires its own web worker. We import the minified
 * worker as a Vite asset URL (?url) so it is served as a separate file and
 * not bundled into the main chunk.
 */

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set once at module init — idempotent, safe to call multiple times.
GlobalWorkerOptions.workerSrc = workerSrc;

/**
 * Extract plain text from all pages of a PDF ArrayBuffer.
 *
 * Text items are grouped by their rounded Y coordinate (PDF units, bottom-up),
 * then each group is joined left-to-right and the groups are sorted top-to-bottom.
 * This reconstructs human-readable lines from the flat item list pdfjs returns.
 *
 * Returns a multi-line string ready for sniffFormatFromBytes / parseChordChart.
 */
export async function extractPdfText(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Group text items by Y position (rounded to nearest 2px to tolerate
    // sub-pixel baseline differences within the same typographic line).
    const lineMap = new Map<number, Array<{ x: number; str: string }>>();

    for (const item of content.items) {
      if (!('str' in item)) continue;
      const ti = item as TextItem;
      if (!ti.str.trim()) continue;

      const x = ti.transform[4];
      const y = Math.round(ti.transform[5] / 2) * 2;  // snap to 2-unit grid

      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y)!.push({ x, str: ti.str });
    }

    // Sort lines top-to-bottom (PDF Y axis is bottom-up → descending Y = top-down)
    const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);

    const lines = sortedYs.map((y) => {
      const items = lineMap.get(y)!.sort((a, b) => a.x - b.x);
      return items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
    }).filter(Boolean);

    if (lines.length > 0) pageTexts.push(lines.join('\n'));
  }

  return pageTexts.join('\n\n');
}
