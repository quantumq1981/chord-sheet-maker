// svgRaster.ts
//
// Pure SVG → canvas → PDF rasterization helpers extracted from App.tsx.
// These are DOM/canvas utilities with no React or app-state dependencies, so
// they live in their own module and can be unit-tested and reused independently.

export const IOS_USER_AGENT = /iPad|iPhone|iPod/;

export function getRenderedSvgs(container: HTMLDivElement | null): SVGSVGElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll('svg'));
}

export function isIOSBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return IOS_USER_AGENT.test(navigator.userAgent);
}

export function triggerBlobDownload(blob: Blob, filename: string, iOSFallbackToTab = false): void {
  const url = URL.createObjectURL(blob);
  if (iOSFallbackToTab && isIOSBrowser()) {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) throw new Error('Popup blocked. Please allow popups and try export again.');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

export function serializeSvg(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svg);
}

export function stitchSvgsToSingle(svgs: SVGSVGElement[]): string {
  if (svgs.length === 1) return serializeSvg(svgs[0]);
  const serializer = new XMLSerializer();
  let maxWidth = 0;
  let totalHeight = 0;
  const pages = svgs.map(svg => {
    const vb = svg.viewBox.baseVal;
    const w = (vb && vb.width > 0) ? vb.width : (svg.getBoundingClientRect().width || 800);
    const h = (vb && vb.height > 0) ? vb.height : (svg.getBoundingClientRect().height || 1100);
    const serialized = serializer.serializeToString(svg);
    // Strip the root <svg> wrapper so we can embed the content in a <g> group
    const inner = serialized.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    maxWidth = Math.max(maxWidth, w);
    totalHeight += h;
    return { w, h, inner };
  });
  let y = 0;
  const groups = pages.map(({ h, inner }) => {
    const g = `<g transform="translate(0,${y})">${inner}</g>`;
    y += h;
    return g;
  });
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${maxWidth}" height="${totalHeight}" viewBox="0 0 ${maxWidth} ${totalHeight}">\n` +
    groups.join('\n') +
    `\n</svg>`
  );
}

export async function stitchCanvases(svgs: SVGSVGElement[], scale: number): Promise<HTMLCanvasElement> {
  const canvases = await Promise.all(svgs.map(svg => svgToCanvas(svg, scale)));
  if (canvases.length === 1) return canvases[0];
  const totalWidth = Math.max(...canvases.map(c => c.width));
  const totalHeight = canvases.reduce((sum, c) => sum + c.height, 0);
  const composite = document.createElement('canvas');
  composite.width = totalWidth;
  composite.height = totalHeight;
  const ctx = composite.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalWidth, totalHeight);
  let yOffset = 0;
  for (const canvas of canvases) {
    ctx.drawImage(canvas, 0, yOffset);
    yOffset += canvas.height;
  }
  return composite;
}

export async function svgToCanvas(svg: SVGSVGElement, scale: number): Promise<HTMLCanvasElement> {
  const serialized = serializeSvg(svg);
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode rendered SVG image.'));
      img.src = svgUrl;
    });

    const svgWidth = svg.viewBox.baseVal?.width || svg.clientWidth || image.naturalWidth;
    const svgHeight = svg.viewBox.baseVal?.height || svg.clientHeight || image.naturalHeight;

    if (svgWidth <= 0 || svgHeight <= 0) throw new Error('Rendered score has invalid dimensions.');

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(svgWidth * scale));
    canvas.height = Math.max(1, Math.round(svgHeight * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context is unavailable in this browser.');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export async function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error(`Failed to create ${type} blob.`)); return; }
      resolve(blob);
    }, type);
  });
}

// Stitch AlphaTab SVG strip-chunks into page-sized canvases suitable for PDF or print.
// Auto-detects orientation: if the stitched canvas is much wider than tall (horizontal
// scroll layout), uses landscape slicing; otherwise uses portrait (vertical) slicing.
export interface PageCanvasResult {
  pages: HTMLCanvasElement[];
  isLandscape: boolean;
}
export async function alphaTabSvgsToPageCanvases(
  svgs: SVGSVGElement[],
  isLetter: boolean,
  renderScale = 2,
): Promise<PageCanvasResult> {
  const marginIn = 0.5;
  const dpi = 96;

  const stitched = await stitchCanvases(svgs, renderScale);
  if (stitched.width === 0 || stitched.height === 0) return { pages: [], isLandscape: false };

  // Detect orientation from the fully-stitched canvas, NOT from individual SVG strips.
  // AlphaTab system strips are each wide-and-short (aspect > 2), so checking a single
  // strip would always misfire as "landscape" even for a tall portrait score.
  const isLandscape = stitched.width > stitched.height * 2;

  // Page dimensions in inches (landscape swaps the long/short edges)
  const pageW = isLandscape ? (isLetter ? 11 : 11.69) : (isLetter ? 8.5 : 8.27);
  const pageH = isLandscape ? (isLetter ? 8.5 : 8.27) : (isLetter ? 11 : 11.69);

  const availW = (pageW - marginIn * 2) * dpi;
  const availH = (pageH - marginIn * 2) * dpi;

  const pages: HTMLCanvasElement[] = [];

  if (isLandscape) {
    // Horizontal layout: slice canvas into column-width chunks
    const pageWPx = Math.round((availW / availH) * stitched.height);
    if (pageWPx <= 0) return { pages: [], isLandscape: true };
    const numPages = Math.ceil(stitched.width / pageWPx);
    for (let i = 0; i < numPages; i++) {
      const srcX = Math.round(i * pageWPx);
      const srcW = Math.min(pageWPx, stitched.width - srcX);
      if (srcW <= 0) break;
      const chunk = document.createElement('canvas');
      chunk.width = srcW;
      chunk.height = stitched.height;
      const ctx = chunk.getContext('2d');
      if (!ctx) continue;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, chunk.width, chunk.height);
      ctx.drawImage(stitched, srcX, 0, srcW, stitched.height, 0, 0, srcW, stitched.height);
      pages.push(chunk);
    }
  } else {
    // Portrait layout: slice canvas into row-height chunks matching the page aspect ratio
    const pageHPx = (availH / availW) * stitched.width;
    const numPages = Math.ceil(stitched.height / pageHPx);
    for (let i = 0; i < numPages; i++) {
      const srcY = Math.round(i * pageHPx);
      const srcH = Math.min(Math.ceil(pageHPx), stitched.height - srcY);
      if (srcH <= 0) break;
      const chunk = document.createElement('canvas');
      chunk.width = stitched.width;
      chunk.height = srcH;
      const ctx = chunk.getContext('2d');
      if (!ctx) continue;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, chunk.width, chunk.height);
      ctx.drawImage(stitched, 0, srcY, stitched.width, srcH, 0, 0, stitched.width, srcH);
      pages.push(chunk);
    }
  }

  return { pages, isLandscape };
}
