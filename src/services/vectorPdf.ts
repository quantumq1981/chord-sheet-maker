// vectorPdf.ts
//
// Opt-in *vector* PDF export (beta). Unlike the default raster pipeline
// (SVG → canvas → JPEG → jsPDF), this feeds the OSMD SVG straight into pdfkit
// via svg-to-pdfkit, producing resolution-independent pages: crisp at any zoom,
// no JPEG artefacts, smaller files, and selectable chord/lyric text.
//
// This module statically imports the heavy pdfkit standalone build (~2.4 MB),
// so it MUST only be reached through a dynamic import() — App loads it lazily on
// button click, keeping it out of the main bundle.
//
// Fidelity caveat (why this is beta): OSMD's SVG text uses fonts that pdfkit
// substitutes with its built-in standard fonts, and some SVG features
// (clip-paths, filters) may render imperfectly. Music glyphs are emitted by
// OSMD's VexFlow as <path> elements, which convert cleanly. The raster export
// remains the reliable default/fallback.

import PDFDocument from 'pdfkit/js/pdfkit.standalone.js';
import SVGtoPDF from 'svg-to-pdfkit';
import { serializeSvg } from '../utils/svgRaster';
import { fitContain } from './exportService';

export interface VectorPdfOptions {
  pageSize: 'letter' | 'a4';
  /** Page margin in PostScript points (72 pt = 1 in). Default 36 (½"). */
  marginPt?: number;
}

// Page dimensions in PostScript points (72 pt = 1 inch).
const PAGE_PT: Record<'letter' | 'a4', [number, number]> = {
  letter: [612, 792],       // 8.5 × 11 in
  a4: [595.28, 841.89],     // 210 × 297 mm
};

function pdfkitSize(pageSize: 'letter' | 'a4'): 'letter' | 'A4' {
  return pageSize === 'letter' ? 'letter' : 'A4';
}

function svgIntrinsicSize(svg: SVGSVGElement, fallbackW: number, fallbackH: number): { w: number; h: number } {
  const vb = svg.viewBox?.baseVal;
  const w = (vb && vb.width > 0 ? vb.width : 0) || svg.clientWidth || fallbackW;
  const h = (vb && vb.height > 0 ? vb.height : 0) || svg.clientHeight || fallbackH;
  return { w, h };
}

/**
 * Compose a vector PDF from the rendered OSMD SVG pages: one SVG per page, fit
 * inside the printable area (page minus margins) preserving aspect ratio and
 * centred. Returns the PDF as a Blob.
 */
export async function svgsToVectorPdfBlob(
  svgs: SVGSVGElement[],
  { pageSize, marginPt = 36 }: VectorPdfOptions,
): Promise<Blob> {
  if (svgs.length === 0) throw new Error('No rendered score found for vector export.');

  const [pageW, pageH] = PAGE_PT[pageSize];
  const availW = pageW - marginPt * 2;
  const availH = pageH - marginPt * 2;
  const size = pdfkitSize(pageSize);

  const doc = new PDFDocument({ size, margin: 0, autoFirstPage: true });

  // Collect the document's output chunks directly. pdfkit's standalone build
  // bundles its own readable-stream implementation, so we avoid blob-stream
  // (which pulls in Node's `stream`/`util`, unavailable in the browser).
  const chunks: Uint8Array[] = [];
  const done = new Promise<Blob>((resolve, reject) => {
    doc.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    doc.on('end', () => resolve(new Blob(chunks as unknown as BlobPart[], { type: 'application/pdf' })));
    doc.on('error', (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
  });

  svgs.forEach((svg, i) => {
    if (i > 0) doc.addPage({ size, margin: 0 });
    const { w: srcW, h: srcH } = svgIntrinsicSize(svg, availW, availH);
    const { w, h } = fitContain(srcW, srcH, availW, availH);
    const x = (pageW - w) / 2;
    const y = (pageH - h) / 2;
    SVGtoPDF(doc, serializeSvg(svg), x, y, {
      width: w,
      height: h,
      assumePt: true,
      preserveAspectRatio: 'xMidYMid meet',
    });
  });

  doc.end();
  return done;
}
