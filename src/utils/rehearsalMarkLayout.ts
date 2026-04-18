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
 * After osmd.render(), translate every rehearsal-mark box+text in the SVG so
 * it sits vertically centred in the whitespace between the preceding system
 * and the system it heads.
 *
 * Detection strategy: VexFlow (OSMD's renderer) draws a StaveSection as three
 * consecutive siblings in the SVG: <rect> (the outline box), <path d=""> (an
 * empty stroke artefact), then <text> (the label).  We find the <text> by
 * exact content match, then search backward through siblings for the <rect>.
 * Both elements are moved by the same dy (modifying their "y" attributes
 * directly rather than adding a transform, which avoids nesting issues).
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

  svg.querySelectorAll<SVGTextElement>('text').forEach((textEl) => {
    const label = textEl.textContent?.trim() ?? '';
    if (!rehearsalTexts.has(label)) return;

    // getBBox() returns coordinates in the SVG's internal coordinate system
    // (viewBox space), which matches OSMD's GraphicSheet positions × 10.
    let bbox: DOMRect;
    try { bbox = textEl.getBBox(); } catch { return; }

    const centerY = bbox.y + bbox.height / 2;

    // Which system does this mark currently sit inside?
    // Generous upward tolerance (-60) because OSMD places rehearsal marks
    // above the top staff line, which may be slightly above BorderTop.
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

    // Move the <text> element by adjusting its y attribute.
    const textY = parseFloat(textEl.getAttribute('y') ?? '0');
    textEl.setAttribute('y', String(textY + dy));

    // Find the associated <rect> (the rehearsal box outline) by walking
    // backward through siblings.  VexFlow StaveSection renders:
    //   <rect>  ← box outline
    //   <path d="">  ← empty artefact from ctx.stroke() after ctx.beginPath()
    //   <text>  ← label (the element we already found above)
    // so the <rect> is typically 2 siblings before <text>.
    let sibling: Element | null = textEl.previousElementSibling;
    for (let i = 0; i < 4 && sibling; i++) {
      if (sibling.tagName === 'rect') {
        const rectY = parseFloat(sibling.getAttribute('y') ?? '0');
        sibling.setAttribute('y', String(rectY + dy));
        break;
      }
      sibling = sibling.previousElementSibling;
    }
  });
}
