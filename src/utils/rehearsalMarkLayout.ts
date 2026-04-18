import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

/**
 * Extract every unique rehearsal-mark text string from a MusicXML document.
 * Used to identify which SVG <text> elements are rehearsal marks after rendering.
 */
export function extractRehearsalMarkTexts(xmlText: string): Set<string> {
  if (!xmlText) return new Set();
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) return new Set();
    const out = new Set<string>();
    doc.querySelectorAll('rehearsal').forEach((el) => {
      const t = el.textContent?.trim();
      if (t) out.add(t);
    });
    return out;
  } catch {
    return new Set();
  }
}

interface SystemBand { top: number; bottom: number }

/**
 * Read the OSMD graphical model to get the SVG-pixel Y range of each rendered
 * system (row of staves).  OSMD uses 10 SVG pixels per internal "music unit".
 */
function getSystemBands(osmd: OpenSheetMusicDisplay): SystemBand[] {
  const unitInPx = 10;
  const bands: SystemBand[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gfx = (osmd as any).GraphicSheet;
    for (const page of gfx.MusicPages) {
      for (const system of page.MusicSystems) {
        const pos = system.PositionAndShape;
        const ay: number = pos.AbsolutePosition.y;
        bands.push({
          top:    (ay + (pos.BorderTop    as number)) * unitInPx,
          bottom: (ay + (pos.BorderBottom as number)) * unitInPx,
        });
      }
    }
  } catch {
    // ignore – model not yet populated
  }
  return bands;
}

/**
 * After osmd.render(), translate every rehearsal-mark group in the SVG so it
 * sits vertically centred in the whitespace between the preceding system and
 * the system it heads.
 *
 * Detection strategy: a rehearsal mark in OSMD/VexFlow SVG is a <g> that
 * has a direct-child <rect> (the outline box) and a direct-child <text>.
 * We match candidates by checking that the <text> content is a known
 * rehearsal-mark string (extracted from the MusicXML before loading).
 */
export function repositionRehearsalMarksBetweenSystems(
  container: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  rehearsalTexts: Set<string>,
): void {
  if (rehearsalTexts.size === 0) return;

  const svg = container.querySelector('svg');
  if (!svg) return;

  const bands = getSystemBands(osmd);
  if (bands.length < 2) return;

  // Walk every <text> element in the SVG; if its content matches a known
  // rehearsal mark, walk up to find the enclosing <g> that owns the box <rect>.
  svg.querySelectorAll<SVGTextElement>('text').forEach((textEl) => {
    const label = textEl.textContent?.trim() ?? '';
    if (!rehearsalTexts.has(label)) return;

    // Find the nearest <g> ancestor that has a direct <rect> child
    let groupEl: Element | null = textEl.parentElement;
    while (groupEl && groupEl !== svg) {
      if (
        groupEl.tagName === 'g' &&
        Array.from(groupEl.children).some((c) => c.tagName === 'rect')
      ) break;
      groupEl = groupEl.parentElement;
    }
    if (!groupEl || groupEl === svg) return;

    const gEl = groupEl as SVGGraphicsElement;
    let bbox: DOMRect;
    try { bbox = gEl.getBBox(); } catch { return; }

    const centerY = bbox.y + bbox.height / 2;

    // Find which system band this mark currently sits inside (with generous
    // tolerance for marks that OSMD placed slightly above the top staff line).
    const idx = bands.findIndex(
      (b) => centerY >= b.top - 60 && centerY <= b.bottom + 10,
    );
    // Skip marks in the first system (no preceding gap) or unmatched marks.
    if (idx <= 0) return;

    const gapTop    = bands[idx - 1].bottom;
    const gapBottom = bands[idx].top;
    const gap = gapBottom - gapTop;
    if (gap < 5) return;

    const targetCenterY = gapTop + gap / 2;
    const dy = targetCenterY - centerY;

    // Merge with any existing transform on the group.
    const existing = gEl.getAttribute('transform') ?? '';
    const tMatch = existing.match(/translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/);
    if (tMatch) {
      const tx = parseFloat(tMatch[1]);
      const ty = parseFloat(tMatch[2]) + dy;
      gEl.setAttribute(
        'transform',
        existing.replace(/translate\([^)]*\)/, `translate(${tx},${ty})`),
      );
    } else {
      const prefix = existing.trim() ? `${existing.trim()} ` : '';
      gEl.setAttribute('transform', `${prefix}translate(0,${dy})`);
    }
  });
}
