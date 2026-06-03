// exportService.ts
//
// Pure PDF page-assembly helpers extracted from App.tsx. The OSMD / AlphaTab /
// tab PDF export paths all shared the same "rasterize → fit each canvas inside
// the printable area → place it → addPage" loop, duplicated three times with
// only the vertical alignment differing. That logic now lives here as pure
// functions (no React, no DOM lookups beyond the canvases handed in), so it can
// be unit-tested and reused. The OSMD render orchestration and React feedback
// stay in App.tsx.

import { jsPDF } from 'jspdf';

/**
 * Aspect-ratio-preserving "contain" fit: scale (srcW × srcH) to fill availW,
 * but never exceed availH (which would clip content at the page bottom).
 * Returns the rendered width/height in the PDF's units.
 */
export function fitContain(
  srcW: number,
  srcH: number,
  availW: number,
  availH: number,
): { w: number; h: number } {
  const aspect = srcW / srcH;
  let w = availW;
  let h = w / aspect;
  if (h > availH) { h = availH; w = h * aspect; }
  return { w, h };
}

export interface PdfComposeOptions {
  /** jsPDF unit — 'in' for Letter, 'mm' for A4. */
  unit: 'in' | 'mm';
  /** Page format tuple in `unit` (e.g. [8.5, 11] or [210, 297]). */
  format: [number, number];
  /** Page orientation; defaults to portrait. */
  orientation?: 'portrait' | 'landscape';
  /** Uniform page margin in `unit`. */
  margin: number;
  /** Vertical placement of each canvas: centred (default) or top-aligned. */
  valign?: 'center' | 'top';
  /** JPEG quality for rasterized pages (default 0.92). */
  jpegQuality?: number;
}

/**
 * Compose a multi-page PDF by placing each canvas, one per page, fit inside the
 * printable area (page minus margins) and horizontally centred. Returns the PDF
 * as a Blob. Behaviour matches the previous inline loops in App.tsx exactly.
 */
export function canvasesToPdfBlob(
  canvases: HTMLCanvasElement[],
  options: PdfComposeOptions,
): Blob {
  const {
    unit,
    format,
    orientation = 'portrait',
    margin,
    valign = 'center',
    jpegQuality = 0.92,
  } = options;

  const pdf = new jsPDF({ orientation, unit, format });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;

  canvases.forEach((canvas, i) => {
    if (i > 0) pdf.addPage(format, orientation);
    const jpegData = canvas.toDataURL('image/jpeg', jpegQuality);
    const { w, h } = fitContain(canvas.width, canvas.height, availW, availH);
    const x = (pageW - w) / 2;
    const y = valign === 'top' ? margin : (pageH - h) / 2;
    pdf.addImage(jpegData, 'JPEG', x, y, w, h, undefined, 'FAST');
  });

  return pdf.output('blob');
}
