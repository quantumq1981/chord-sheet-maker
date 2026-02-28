/**
 * chordProParser.ts
 *
 * Pure-TypeScript, zero-dependency parser for three text-chord dialects:
 *
 *   1. ChordPro  — `{directives}` + `[chord]` tokens inline with lyrics
 *   2. Ultimate Guitar (UG) — `[Section]` headers + `[chord]` tokens
 *   3. Chords-over-words — chord lines stacked above lyric lines
 *
 * All three produce a normalized `ChordChartDocument` (see ChordChartModel.ts).
 * No external parser library is required, keeping the bundle size and license
 * surface minimal.
 */

import type {
  ChordChartDocument,
  ChartSection,
  ChartLine,
  ChartToken,
  SectionType,
} from '../models/ChordChartModel';
import type { SourceFormat } from '../ingest/sniffFormat';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maps lower-cased directive names to ChordChartDocument metadata keys. */
const DIRECTIVE_META: Record<
  string,
  keyof Pick<ChordChartDocument, 'title' | 'artist' | 'subtitle' | 'key' | 'capo' | 'tempo' | 'time'>
> = {
  title: 'title',  t: 'title',
  artist: 'artist', a: 'artist',
  subtitle: 'subtitle', st: 'subtitle',
  key: 'key',
  capo: 'capo',
  tempo: 'tempo',
  time: 'time',
};

/** Maps lower-cased section-start directive names to SectionType. */
const SECTION_START: Record<string, SectionType> = {
  start_of_chorus: 'chorus',   soc: 'chorus',
  start_of_verse: 'verse',     sov: 'verse',
  start_of_bridge: 'bridge',   sob: 'bridge',
  start_of_grid: 'grid',       sog: 'grid',
  start_of_tab: 'tab',         sot: 'tab',
  start_of_pre_chorus: 'pre-chorus',
  start_of_intro: 'intro',
  start_of_outro: 'outro',
  start_of_interlude: 'interlude',
  start_of_solo: 'solo',
};

/** Lower-cased section-end directive names. */
const SECTION_END = new Set([
  'end_of_chorus', 'eoc',
  'end_of_verse', 'eov',
  'end_of_bridge', 'eob',
  'end_of_grid', 'eog',
  'end_of_tab', 'eot',
  'end_of_pre_chorus',
  'end_of_intro',
  'end_of_outro',
  'end_of_interlude',
  'end_of_solo',
]);

/** Recognizes UG-style section headers like [Verse 1] or [Chorus]. */
const UG_SECTION_RE =
  /^\[(Verse|Chorus|Bridge|Intro|Outro|Pre-?Chorus|Interlude|Hook|Solo|Instrumental|Refrain)[^\]]*\]$/i;

/** Chord token pattern used by the chords-over-words heuristic. */
const CHORD_TOKEN_RE =
  /^[A-G][#b]?(?:m(?:aj)?|M|maj|min|dim|aug|sus[24]?|add\d*)?(?:\d+)?(?:\/[A-G][#b]?)?$/;

// ─── Shared helpers ───────────────────────────────────────────────────────────

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function sectionTypeFromLabel(label: string): SectionType {
  const l = label.toLowerCase();
  if (l.includes('chorus')) return 'chorus';
  if (l.includes('verse')) return 'verse';
  if (l.includes('bridge')) return 'bridge';
  if (l.includes('intro')) return 'intro';
  if (l.includes('outro')) return 'outro';
  if (l.includes('pre-chorus') || l.includes('prechorus')) return 'pre-chorus';
  if (l.includes('interlude')) return 'interlude';
  if (l.includes('solo')) return 'solo';
  if (l.includes('grid')) return 'grid';
  if (l.includes('tab')) return 'tab';
  return 'unknown';
}

/** Flush a section into the document, ignoring fully-empty sections. */
function flushSection(doc: ChordChartDocument, section: ChartSection): void {
  const nonEmpty = section.lines.filter((l) => l.tokens.length > 0);
  if (nonEmpty.length > 0) {
    doc.sections.push({ ...section, lines: nonEmpty });
  }
}

/** Build an empty unnamed section. */
function makeSection(type: SectionType = 'unknown', label?: string): ChartSection {
  return { type, label, lines: [] };
}

/**
 * Parse a single line that may contain inline bracket-chord tokens.
 * e.g. "[Am]Hello [G]world" → [{chord:'Am'},{lyric:'Hello '},{chord:'G'},{lyric:'world'}]
 */
function parseBracketLine(line: string): ChartLine {
  const tokens: ChartToken[] = [];
  const bracketRe = /\[([^\]]+)\]([^\[]*)/g;
  let match: RegExpExecArray | null;

  // Text before the first bracket
  const firstBracket = line.indexOf('[');
  if (firstBracket > 0) {
    const pre = line.slice(0, firstBracket);
    if (pre.trim()) tokens.push({ kind: 'lyric', text: pre.trimEnd() });
  }

  while ((match = bracketRe.exec(line)) !== null) {
    const chordText = match[1].trim();
    const lyricText = match[2]; // keep internal spacing

    tokens.push({ kind: 'chord', text: chordText });
    if (lyricText.trim() || lyricText.includes(' ')) {
      // Preserve trailing space so words don't jam together at render time
      const safe = lyricText.trimEnd();
      if (safe || lyricText.startsWith(' ')) {
        tokens.push({ kind: 'lyric', text: lyricText.length > 0 ? lyricText : '' });
      }
    }
  }

  return { tokens };
}

// ─── 1. ChordPro parser ───────────────────────────────────────────────────────

/**
 * Parse canonical ChordPro text (v5/v6-compatible subset).
 * Handles `{directives}`, `[chord]` inline tokens, and UG-style `[Section]`
 * headers (since many real-world files mix both conventions).
 */
export function parseChordPro(text: string): ChordChartDocument {
  const doc: ChordChartDocument = { sections: [], sourceFormat: 'chordpro' };
  let current = makeSection();

  for (const rawLine of normalizeLineEndings(text).split('\n')) {
    const trimmed = rawLine.trim();

    // Blank lines act as soft section separators in un-directed files
    if (!trimmed) continue;

    // Comment lines beginning with %
    if (trimmed.startsWith('%')) continue;

    // ── Directive: {name: value} or {name} ──
    const directiveMatch = trimmed.match(/^\{([^:}]+)(?::([^}]*))?\}$/);
    if (directiveMatch) {
      const key = directiveMatch[1].trim().toLowerCase();
      const value = directiveMatch[2]?.trim();

      // Metadata directives
      const metaKey = DIRECTIVE_META[key];
      if (metaKey && value) {
        (doc as unknown as Record<string, unknown>)[metaKey] = value;
        continue;
      }

      // Section-start directives
      const sType = SECTION_START[key];
      if (sType !== undefined) {
        flushSection(doc, current);
        current = makeSection(sType, value || undefined);
        continue;
      }

      // Section-end directives
      if (SECTION_END.has(key)) {
        flushSection(doc, current);
        current = makeSection();
        continue;
      }

      // Comment / annotation directive
      if ((key === 'comment' || key === 'c' || key === 'comment_italic' || key === 'ci') && value) {
        current.lines.push({ tokens: [{ kind: 'comment', text: value }] });
        continue;
      }

      // All other directives are silently ignored
      continue;
    }

    // ── UG-style section header: [Verse 1], [Chorus], … ──
    if (UG_SECTION_RE.test(trimmed)) {
      flushSection(doc, current);
      const label = trimmed.slice(1, -1); // strip []
      current = makeSection(sectionTypeFromLabel(label), label);
      continue;
    }

    // ── Content line (may have inline [chord] tokens) ──
    if (trimmed.includes('[')) {
      const line = parseBracketLine(trimmed);
      if (line.tokens.length > 0) current.lines.push(line);
      continue;
    }

    // ── Plain lyric / text line ──
    current.lines.push({ tokens: [{ kind: 'lyric', text: trimmed }] });
  }

  flushSection(doc, current);
  return doc;
}

// ─── 2. Ultimate Guitar parser ────────────────────────────────────────────────

/**
 * Parse Ultimate Guitar–style text (section headers in [Brackets] + inline
 * bracket chords).  Reuses `parseChordPro` since UG files are handled there.
 */
export function parseUltimateGuitar(text: string): ChordChartDocument {
  const doc = parseChordPro(text);
  doc.sourceFormat = 'ultimateguitar';
  return doc;
}

// ─── 3. Chords-over-words parser ─────────────────────────────────────────────

/** Return true when every non-empty token in the line looks like a chord name. */
function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 1) return false;
  const chordCount = tokens.filter((t) => CHORD_TOKEN_RE.test(t)).length;
  return chordCount >= 1 && chordCount / tokens.length >= 0.7;
}

/**
 * Parse "chords-over-lyrics" format: each chord line sits immediately above
 * the lyric line it annotates.  The chords are paired with the lyric and
 * emitted as a single ChartLine of alternating chord/lyric tokens.
 */
export function parseChordsOverWords(text: string): ChordChartDocument {
  const doc: ChordChartDocument = { sections: [], sourceFormat: 'chords-over-words' };
  const current = makeSection();
  const rawLines = normalizeLineEndings(text).split('\n');
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    if (isChordLine(trimmed)) {
      const chordTokens: ChartToken[] = trimmed
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => ({ kind: 'chord' as const, text: t }));

      const nextLine = rawLines[i + 1]?.trim() ?? '';
      if (nextLine && !isChordLine(nextLine)) {
        // Pair chord tokens with the following lyric line
        current.lines.push({
          tokens: [...chordTokens, { kind: 'lyric', text: nextLine }],
        });
        i += 2;
      } else {
        // Orphaned chord line (no following lyric)
        current.lines.push({ tokens: chordTokens });
        i++;
      }
      continue;
    }

    // Plain lyric or title-like line
    current.lines.push({ tokens: [{ kind: 'lyric', text: trimmed }] });
    i++;
  }

  flushSection(doc, current);
  return doc;
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Route text to the appropriate parser based on the pre-detected source format
 * and return a normalized ChordChartDocument.
 */
export function parseChordChart(text: string, sourceFormat: SourceFormat): ChordChartDocument {
  switch (sourceFormat) {
    case 'ultimateguitar':   return parseUltimateGuitar(text);
    case 'chords-over-words': return parseChordsOverWords(text);
    default:                 return parseChordPro(text);
  }
}
