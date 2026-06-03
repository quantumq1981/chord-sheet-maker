import { describe, it, expect } from 'vitest';
import { getRenderedSvgs, serializeSvg, stitchSvgsToSingle } from '../svgRaster';

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeSvg(markerId: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 100 200');
  svg.setAttribute('width', '100');
  svg.setAttribute('height', '200');
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('id', markerId);
  svg.appendChild(rect);
  return svg;
}

describe('getRenderedSvgs', () => {
  it('returns [] for a null container', () => {
    expect(getRenderedSvgs(null)).toEqual([]);
  });

  it('collects all <svg> children of a container', () => {
    const div = document.createElement('div');
    div.appendChild(makeSvg('a'));
    div.appendChild(makeSvg('b'));
    expect(getRenderedSvgs(div)).toHaveLength(2);
  });
});

describe('stitchSvgsToSingle', () => {
  it('returns a single SVG unchanged (round-trips through the serializer)', () => {
    const svg = makeSvg('only');
    const out = stitchSvgsToSingle([svg]);
    expect(out).toBe(serializeSvg(svg));
    expect(out).toContain('id="only"');
  });

  it('wraps multiple pages in stacked translate groups under one root svg', () => {
    const out = stitchSvgsToSingle([makeSvg('p1'), makeSvg('p2')]);
    // One <g transform="translate(0,...)"> per page, both inner markers present.
    const groups = out.match(/<g transform="translate\(0,/g) ?? [];
    expect(groups).toHaveLength(2);
    expect(out).toContain('id="p1"');
    expect(out).toContain('id="p2"');
    // Composed into a single root <svg> with a viewBox.
    expect(out).toMatch(/<svg[^>]*viewBox="0 0 /);
    // Second page is offset below the first (non-zero translate).
    expect(out).not.toMatch(/translate\(0,0\)[\s\S]*translate\(0,0\)/);
  });
});
