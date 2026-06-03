import { describe, it, expect } from 'vitest';
import { svgsToVectorPdfBlob } from '../vectorPdf';

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 200 300');
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', '10');
  rect.setAttribute('y', '10');
  rect.setAttribute('width', '120');
  rect.setAttribute('height', '60');
  rect.setAttribute('fill', '#000000');
  svg.appendChild(rect);
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', '10');
  text.setAttribute('y', '120');
  text.textContent = 'Cmaj7';
  svg.appendChild(text);
  return svg;
}

async function pdfHeader(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return String.fromCharCode(...bytes.subarray(0, 5));
}

describe('svgsToVectorPdfBlob', () => {
  it('produces a non-empty PDF blob with the %PDF- magic header', async () => {
    const blob = await svgsToVectorPdfBlob([makeSvg()], { pageSize: 'letter' });
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
    expect(await pdfHeader(blob)).toBe('%PDF-');
  });

  it('handles multiple pages (a4)', async () => {
    const blob = await svgsToVectorPdfBlob([makeSvg(), makeSvg(), makeSvg()], { pageSize: 'a4' });
    expect(await pdfHeader(blob)).toBe('%PDF-');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('rejects when given no pages', async () => {
    await expect(svgsToVectorPdfBlob([], { pageSize: 'letter' })).rejects.toThrow();
  });
});
