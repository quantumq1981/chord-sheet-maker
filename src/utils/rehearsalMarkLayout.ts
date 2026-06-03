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
 * Read the OSMD graphical model to get the SVG-coordinate Y range of each
 * rendered system.  OSMD uses 10 SVG units per internal "music unit".
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
 * Match a Y centre to the system band it falls inside.
 * Generous upward tolerance (-60) because OSMD places rehearsal marks above the
 * top staff line, which may be slightly above BorderTop.
 */
function matchBand(bands: SystemBand[], centerY: number): number {
  return bands.findIndex((b) => centerY >= b.top - 60 && centerY <= b.bottom + 10);
}

/**
 * Find the associated <rect> (the rehearsal box outline) by walking backward
 * through siblings.  VexFlow StaveSection renders three consecutive siblings:
 *   <rect>       ← box outline
 *   <path d="">  ← empty artefact from ctx.stroke() after ctx.beginPath()
 *   <text>       ← label
 * so the <rect> is typically 2 siblings before <text>.
 */
function findRectSibling(textEl: Element): Element | null {
  let sibling: Element | null = textEl.previousElementSibling;
  for (let i = 0; i < 4 && sibling; i++) {
    if (sibling.tagName === 'rect') return sibling;
    sibling = sibling.previousElementSibling;
  }
  return null;
}

/**
 * After osmd.render(), translate every rehearsal-mark box+text in the SVG so
 * it sits vertically centred in the whitespace between the preceding system
 * and the system it heads.
 *
 * Performance: this runs after every render (display, each export render, the
 * restore render).  SVG elements are laid out independently of one another, so
 * moving one mark cannot change another mark's geometry.  We therefore split the
 * work into a READ phase (all `getBBox()` calls, no mutations) followed by a
 * WRITE phase (all attribute mutations).  This collapses what was previously up
 * to N interleaved read→write→read forced reflows into a single layout flush,
 * while producing byte-identical results to the old interleaved version.
 *
 * The text/rect `y` attributes are adjusted directly (rather than via a
 * transform) to avoid nesting issues.
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

  // ── READ PHASE ── gather geometry only; no DOM mutations means getBBox()
  // forces layout at most once for the whole batch.
  const updates: Array<{ text: SVGTextElement; rect: Element | null; dy: number }> = [];

  svg.querySelectorAll<SVGTextElement>('text').forEach((textEl) => {
    const label = textEl.textContent?.trim() ?? '';
    if (!rehearsalTexts.has(label)) return;

    // getBBox() returns coordinates in the SVG's internal coordinate system
    // (viewBox space), which matches OSMD's GraphicSheet positions × 10.
    let bbox: DOMRect;
    try { bbox = textEl.getBBox(); } catch { return; }

    const centerY = bbox.y + bbox.height / 2;

    // Skip marks in the first system (no preceding gap) or unmatched marks.
    const idx = matchBand(bands, centerY);
    if (idx <= 0) return;

    const gapTop    = bands[idx - 1].bottom;
    const gapBottom = bands[idx].top;
    const gap = gapBottom - gapTop;
    if (gap < 5) return;

    const targetCenterY = gapTop + gap / 2;
    updates.push({
      text: textEl,
      rect: findRectSibling(textEl),
      dy: targetCenterY - centerY,
    });
  });

  // ── WRITE PHASE ── apply all mutations together; layout is invalidated once.
  for (const { text, rect, dy } of updates) {
    const textY = parseFloat(text.getAttribute('y') ?? '0');
    text.setAttribute('y', String(textY + dy));
    if (rect) {
      const rectY = parseFloat(rect.getAttribute('y') ?? '0');
      rect.setAttribute('y', String(rectY + dy));
    }
  }
}
