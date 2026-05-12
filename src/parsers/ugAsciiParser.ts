/**
 * ugAsciiParser.ts
 *
 * Parses ASCII chord/lyric/tab text (Ultimate Guitar and similar formats) and
 * produces a UnifiedSongModel object per the spec in
 * Unified-Song-Model+Ug-Ascii-JSparser-Techspec.md.
 *
 * Multi-pass strategy:
 *   1. Classify every line as tab, section-marker, chord, or lyric/plain.
 *   2. Group 4+ consecutive tab lines into TabBlocks.
 *   3. Extract header metadata (capo, key, tempo) from early non-content lines.
 *   4. Build section structure, lyric lines, and harmony events.
 *   5. Compute density metrics and harmonic fingerprint.
 *   6. Produce a genre guess from the combined signals.
 *
 * Bug fixes vs. the original ug_ascii_parser.js:
 *   #1  Global regex .test() in loop — separate IS_CHORD_TOKEN_RE (non-global)
 *       from FIND_CHORDS_RE (global for .match() only).
 *   #2  folkPopScore incorrectly included powerChordRate — replaced with
 *       simpleMajMinRate (plain major/minor triads) and capo presence.
 *   #3  ii-V detection counted any 4th/5th interval — now requires min7 quality
 *       on the "ii" chord AND dom7 quality on the "V" chord.
 *   #4  song.structure.sections always empty — sections now populated.
 *   #5  song.lyrics.lines always empty — lyric lines now populated.
 *   #6  song.parts always empty — tab blocks stored in song.tabBlocks.
 *   #7  lyricsAligned set to lyricDensity > 0 — now only true when a chord
 *       line immediately precedes a lyric line (explicit alignment).
 *   #8  aug7 quality mapped to 'aug' — fixed to 'aug7'.
 *   #9  cowboyMinors used root+‘m’ Set hack — replaced with explicit root/quality checks.
 *  #10  Capo, key, and tempo never extracted — added extractTextMetadata().
 *  #11  isTabLine regex rejected spaces and trailing | — broadened pattern.
 *  #12  Beat position used token index in full line — now uses chord-local index.
 *  #13  CommonJS module.exports — ported to ESM named exports.
 */

import type {
  UnifiedSongModel,
  NormalizedChord,
  HarmonicFingerprint,
  GenreGuess,
  DensityMetrics,
  QualityFamily,
  TabBlock,
  UsmSection,
  UsmLyricLine,
  HarmonyEvent,
} from '../types/unifiedSongModel';

// ─── UUID ─────────────────────────────────────────────────────────────────────

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = (b: number) => b.toString(16).padStart(2, '0');
  return [
    [...bytes.slice(0, 4)].map(h).join(''),
    [...bytes.slice(4, 6)].map(h).join(''),
    [...bytes.slice(6, 8)].map(h).join(''),
    [...bytes.slice(8, 10)].map(h).join(''),
    [...bytes.slice(10, 16)].map(h).join(''),
  ].join('-');
}

// ─── Regex constants ──────────────────────────────────────────────────────────

/**
 * Tests a single whitespace-delimited token to see if it looks like a chord.
 * Non-global + anchored so it is safe to call with .test() in a loop.
 * Bug #1 fix: never use a global regex with .test() inside a loop.
 */
const IS_CHORD_TOKEN_RE =
  /^[A-G][#b]?[mMajdinugs°øØ+Δ#bA-G0-9/()]{0,12}$/;

/** Section markers: [Verse 1], [Chorus], etc. */
const SECTION_MARKER_RE = /^\[([^\]]+)\]$/;

// ─── Line classification ──────────────────────────────────────────────────────

/**
 * A tab line starts with a string name (E/A/D/G/B/e) followed by a pipe,
 * then tab content that may include digits, hyphens, notation symbols, spaces,
 * and inner/trailing pipes.
 *
 * Bug #11 fix: original regex rejected lines with spaces or trailing '|'.
 */
export function isTabLine(line: string): boolean {
  const t = line.trim();
  // Require at least one character of content after the opening pipe.
  return t.length >= 3 && /^[eEBGDA]\|[\s\-0-9hpbtrx/\\~().|:]*$/.test(t);
}

/**
 * Returns true when at least 40% of the whitespace-delimited tokens in the
 * line look like chord symbols AND there is at least one chord token.
 * Uses IS_CHORD_TOKEN_RE (non-global) for safe .test() calls.
 */
export function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const chordCount = tokens.filter((t) => IS_CHORD_TOKEN_RE.test(t)).length;
  return chordCount >= 1 && chordCount / tokens.length >= 0.4;
}

/** Extract all chord-looking tokens from a line (order preserved). */
function findChordsInLine(line: string): string[] {
  return line.trim().split(/\s+/).filter((t) => IS_CHORD_TOKEN_RE.test(t));
}

// ─── Quality table ────────────────────────────────────────────────────────────

// Tested in declaration order — longest entries must appear before shorter
// ones that share a common prefix (e.g. 'min7b5' before 'min7' before 'min').
const QUALITY_TABLE: Array<[string, QualityFamily]> = [
  ['min7b5b9', 'min7b5'],
  ['min7b5',   'min7b5'],
  ['m7b5b9',   'min7b5'],
  ['m7b5',     'min7b5'],
  ['maj9',     'maj9'],   ['M9',   'maj9'],
  ['maj7',     'maj7'],   ['M7',   'maj7'],  ['△7', 'maj7'],
  ['min9',     'min7'],   ['m9',   'min7'],
  ['min7',     'min7'],   ['m7',   'min7'],
  ['dim7',     'dim7'],   ['°7',   'dim7'],
  ['aug7',     'aug7'],                          // Bug #8 fix: was 'aug'
  ['add11',    'add9'],
  ['add9',     'add9'],
  ['sus4',     'sus4'],
  ['sus2',     'sus2'],
  ['sus',      'sus4'],
  ['maj',      'maj'],
  ['min',      'min'],
  ['dim',      'dim'],    ['°',    'dim'],
  ['aug',      'aug'],    ['+',    'aug'],
  ['13',       'dom7'],
  ['11',       'dom7'],
  ['9',        'dom7'],
  ['7',        'dom7'],
  ['5',        '5'],
];

// ─── Chord normalisation ──────────────────────────────────────────────────────

/**
 * Split a chord symbol into its canonical Harte-inspired components.
 * Examples:
 *   "G#m7b5" → { root:"G#", qualityFamily:"min7b5", alterations:[], ... }
 *   "Bbmaj7" → { root:"Bb", qualityFamily:"maj7", ... }
 *   "C/E"    → { root:"C",  qualityFamily:"maj",  bass:"E", ... }
 *   "E5"     → { root:"E",  qualityFamily:"5",    ... }
 */
export function normalizeChord(symbol: string): NormalizedChord {
  const m = /^([A-G](?:#|b)?)(.*?)(?:\/([A-G](?:#|b)?))?$/.exec(symbol);
  if (!m) {
    return { root: null, qualityFamily: null, extensions: [], alterations: [], suspension: null, bass: null };
  }

  const root = m[1];
  let remainder = m[2] ?? '';
  const bass = m[3] ?? null;

  let qualityFamily: QualityFamily | null = null;
  const extensions: string[] = [];
  const alterations: string[] = [];
  let suspension: string | null = null;

  // Walk quality table (longest-first order avoids prefix mis-matches)
  for (const [key, fam] of QUALITY_TABLE) {
    if (remainder.startsWith(key)) {
      qualityFamily = fam;
      remainder = remainder.slice(key.length);
      break;
    }
  }

  // Bug #9 fix: lone lowercase 'm' minor fallback — covers "Am", "Dm" etc.
  // No 'i' flag: 'M' alone is rare and ambiguous; 'M7'/'M9' already handled above.
  // Negative lookahead [a-zA-Z] ensures we don't consume 'm' from 'maj', 'min', etc.
  // (those would have matched the quality table already).
  if (qualityFamily === null && /^m(?![a-zA-Z])/.test(remainder)) {
    qualityFamily = 'min';
    remainder = remainder.slice(1);
  }

  if (qualityFamily === null) qualityFamily = 'maj';

  // Remaining digits are extension numbers
  const extM = remainder.match(/\d+/g);
  if (extM) extensions.push(...extM);

  // Remaining [#b]\d patterns are alterations
  const altM = remainder.match(/[#b]\d+/g);
  if (altM) alterations.push(...altM);

  // Suspension degree (sus2 / sus4 already captured in qualityFamily)
  if (qualityFamily === 'sus2') suspension = '2';
  else if (qualityFamily === 'sus4') suspension = '4';

  return { root, qualityFamily, extensions, alterations, suspension, bass };
}

// ─── Metadata extraction ──────────────────────────────────────────────────────

interface TextMetadata {
  capoFret: number | null;
  keyDisplay: string;
  keyDetected: boolean;
  tempoBpm: number;
}

/**
 * Scan early lines for common UG header annotations:
 *   "Capo 3", "Capo: 3", "Key of G", "Key: Am", "Tempo: 120", "120 BPM"
 *
 * Bug #10 fix: original parser never extracted these fields.
 */
export function extractTextMetadata(lines: string[]): TextMetadata {
  let capoFret: number | null = null;
  let keyDisplay = '';
  let keyDetected = false;
  let tempoBpm = 0;

  for (const line of lines) {
    const t = line.trim();

    if (capoFret === null) {
      const cm = /\bcapo\s*(?:fret\s*)?[:\s]\s*(\d+)/i.exec(t);
      if (cm) capoFret = parseInt(cm[1], 10);
    }

    if (!keyDetected) {
      const km = /\bkey\s*(?:of\s*)?[:\s]\s*([A-G][#b]?\s*(?:major|minor|maj|min|m)?)/i.exec(t);
      if (km) { keyDisplay = km[1].trim(); keyDetected = true; }
    }

    if (tempoBpm === 0) {
      const tm =
        /\b(\d{2,3})\s*bpm\b|\bbpm\s*[=:]\s*(\d{2,3})\b|\btempo\s*[=:]\s*(\d{2,3})\b/i.exec(t);
      if (tm) tempoBpm = parseInt(tm[1] ?? tm[2] ?? tm[3], 10);
    }
  }

  return { capoFret, keyDisplay, keyDetected, tempoBpm };
}

// ─── Section type inference ───────────────────────────────────────────────────

function sectionTypeFromLabel(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('pre-chorus') || l.includes('prechorus')) return 'pre-chorus';
  if (l.includes('chorus')) return 'chorus';
  if (l.includes('verse')) return 'verse';
  if (l.includes('bridge')) return 'bridge';
  if (l.includes('intro')) return 'intro';
  if (l.includes('outro')) return 'outro';
  if (l.includes('interlude')) return 'interlude';
  if (l.includes('solo')) return 'solo';
  if (l.includes('tab')) return 'tab';
  return 'unknown';
}

// ─── Tab block grouping ───────────────────────────────────────────────────────

/** Group runs of 4+ consecutive tab lines into TabBlock objects. */
function groupTabBlocks(lines: string[], isTabFlags: boolean[]): TabBlock[] {
  const blocks: TabBlock[] = [];
  let current: string[] | null = null;
  let start = -1;

  for (let i = 0; i <= lines.length; i++) {
    if (i < lines.length && isTabFlags[i]) {
      if (!current) { current = []; start = i; }
      current.push(lines[i]);
    } else {
      if (current && current.length >= 4) {
        blocks.push({ lines: current, startLine: start, endLine: i - 1 });
      }
      current = null;
      start = -1;
    }
  }

  return blocks;
}

// ─── Density metrics ──────────────────────────────────────────────────────────

/**
 * Compute per-line-type density ratios across all lines.
 */
export function computeDensities(
  lines: string[],
  isTabFlags: boolean[],
  isChordFlags: boolean[],
): DensityMetrics {
  const total = lines.length;
  if (total === 0) {
    return { lyricDensity: 0, tabDensity: 0, chordDensity: 0, gridDensity: 0, sectionDensity: 0 };
  }

  let lyricCount = 0;
  let tabCount = 0;
  let chordTokenTotal = 0;
  let gridSymbolTotal = 0;
  let sectionCount = 0;

  for (let i = 0; i < total; i++) {
    const line = lines[i];
    const t = line.trim();

    if (isTabFlags[i]) { tabCount++; continue; }
    if (SECTION_MARKER_RE.test(t)) { sectionCount++; continue; }
    if (isChordFlags[i]) {
      chordTokenTotal += findChordsInLine(line).length;
      continue;
    }
    gridSymbolTotal += (line.match(/[|.:]/g) ?? []).length;
    if (t.length > 0) lyricCount++;
  }

  return {
    lyricDensity:    lyricCount    / total,
    tabDensity:      tabCount      / total,
    chordDensity:    chordTokenTotal / total,
    gridDensity:     gridSymbolTotal / total,
    sectionDensity:  sectionCount  / total,
  };
}

// ─── Harmonic fingerprint ─────────────────────────────────────────────────────

const SEMITONE: Record<string, number> = {
  C: 0,  'C#': 1, Db: 1, D: 2,  'D#': 3, Eb: 3,
  E: 4,  F: 5,   'F#': 6, Gb: 6, G: 7,  'G#': 8,
  Ab: 8, A: 9,  'A#': 10, Bb: 10, B: 11,
};

/**
 * Compute harmonic feature rates from a list of normalized chords.
 *
 * Bug #3 fix: ii-V detection now requires min7 quality on the "ii" chord AND
 * dom7 quality on the "V" chord, not just any root motion by a 4th or 5th.
 *
 * Bug #9 fix: cowboy chord detection uses explicit root+quality checks instead
 * of the fragile `root + 'm'` Set approach. Dm is now correctly counted.
 */
export function computeHarmonicFingerprint(normalizedChords: NormalizedChord[]): HarmonicFingerprint {
  const total = normalizedChords.length;
  if (total === 0) {
    return { cowboyChordShare: 0, dom7Rate: 0, maj7Rate: 0, min7b5Rate: 0,
             altRate: 0, powerChordRate: 0, iiVRate: 0, simpleMajMinRate: 0 };
  }

  // Bug #9 fix: cowboy major = G C D A E F (major/dom7/maj7); cowboy minor = Am Dm Em
  const COWBOY_MAJ_ROOTS = new Set(['G', 'C', 'D', 'A', 'E', 'F']);
  const COWBOY_MIN_ROOTS = new Set(['A', 'D', 'E']);
  const MIN7_QUALITIES: QualityFamily[] = ['min7', 'min7b5'];

  let cowboyCount = 0, dom7Count = 0, maj7Count = 0, min7b5Count = 0;
  let altCount = 0, powerCount = 0, iiVCount = 0, simpleMajMinCount = 0;

  for (let i = 0; i < total; i++) {
    const c = normalizedChords[i];
    if (!c?.root || !c.qualityFamily) continue;

    const qf = c.qualityFamily;

    if (COWBOY_MAJ_ROOTS.has(c.root) && (qf === 'maj' || qf === 'dom7' || qf === 'maj7')) cowboyCount++;
    if (COWBOY_MIN_ROOTS.has(c.root) && (qf === 'min' || qf === 'min7')) cowboyCount++;
    if (qf === 'dom7')   dom7Count++;
    if (qf === 'maj7' || qf === 'maj9') maj7Count++;
    if (qf === 'min7b5') min7b5Count++;
    if (qf === 'aug7' || c.alterations.some((a) => a.includes('alt'))) altCount++;
    if (qf === '5')      powerCount++;
    if (qf === 'maj' || qf === 'min') simpleMajMinCount++;

    // Bug #3 fix: only count as ii-V when chord qualities match the pattern
    if (i < total - 1) {
      const n = normalizedChords[i + 1];
      if (n?.root && n.qualityFamily === 'dom7' && MIN7_QUALITIES.includes(qf)) {
        const si = SEMITONE[c.root];
        const sn = SEMITONE[n.root];
        if (si !== undefined && sn !== undefined) {
          const interval = (sn - si + 12) % 12;
          if (interval === 5) iiVCount++;  // minor 7th resolves up a 4th to dominant
        }
      }
    }
  }

  return {
    cowboyChordShare:  cowboyCount       / total,
    dom7Rate:          dom7Count         / total,
    maj7Rate:          maj7Count         / total,
    min7b5Rate:        min7b5Count       / total,
    altRate:           altCount          / total,
    powerChordRate:    powerCount        / total,
    iiVRate:           total > 1 ? iiVCount / (total - 1) : 0,
    simpleMajMinRate:  simpleMajMinCount / total,
  };
}

// ─── Genre detection ──────────────────────────────────────────────────────────

/**
 * Estimate the primary genre from harmonic and density signals.
 *
 * Bug #2 fix: folkPopScore no longer includes powerChordRate (a rock/metal
 * signal). It now uses simpleMajMinRate and capo presence instead.
 *
 * The 2.0-unit margin threshold from the spec is preserved: if the top two
 * genres are within 0.2 of each other (since we use raw rates not z-scores),
 * the result is 'unknown'.
 */
export function guessGenre(
  hf: HarmonicFingerprint,
  densities: DensityMetrics,
  capoFret: number | null,
): GenreGuess {
  // The lyric-sparsity term (jazz charts tend to have no lyrics) only fires when
  // there is at least some harmonic jazz evidence; otherwise zero-input gets a
  // spurious jazz score of 2.0 solely from (1 - 0) lyricDensity.
  const jazzHarmonicSignal =
    6 * hf.min7b5Rate + 6 * hf.altRate + 5 * hf.maj7Rate + 4 * hf.dom7Rate + 4 * hf.iiVRate;
  const jazzScore =
    jazzHarmonicSignal +
    2 * densities.gridDensity +
    (jazzHarmonicSignal > 0 ? 2 * (1 - densities.lyricDensity) : 0);

  const rockBluesScore =
    5 * hf.powerChordRate +
    4 * hf.dom7Rate +
    3 * densities.tabDensity +
    2 * hf.iiVRate;

  // Bug #2 fix: simpleMajMinRate + capo replaces the erroneous powerChordRate term
  const folkPopScore =
    5 * hf.cowboyChordShare +
    4 * densities.lyricDensity +
    3 * hf.simpleMajMinRate +
    2 * (capoFret !== null ? 1 : 0);

  const scores = { jazz: jazzScore, rock_blues: rockBluesScore, folk_pop: folkPopScore };
  const sorted = (Object.entries(scores) as Array<[string, number]>).sort((a, b) => b[1] - a[1]);
  const [best, second] = sorted;
  const margin = best[1] - second[1];

  const primary = (margin < 0.2 || best[1] < 0.5)
    ? 'unknown'
    : best[0] as GenreGuess['primary'];

  return {
    primary,
    scores,
    confidence: Math.max(0, Math.min(1, margin / 5)),
  };
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export interface ParseUgAsciiOptions {
  title?: string;
  composer?: string | string[];
  lyricist?: string | string[];
  arranger?: string | string[];
  artist?: string | string[];
}

function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Parse raw ASCII text (Ultimate Guitar chord/lyric/tab format) and return
 * a UnifiedSongModel object.
 *
 * All 13 bugs from the original ug_ascii_parser.js are fixed — see the
 * per-bug comments at the top of this file and on the relevant functions.
 */
export function parseUgAscii(text: string, options: ParseUgAsciiOptions = {}): UnifiedSongModel {
  const lines = text.split(/\r?\n/);

  // ── Pass 1: Classify lines ───────────────────────────────────────────────
  const isTabFlags   = lines.map(isTabLine);
  const isChordFlags = lines.map((line, i) => !isTabFlags[i] && isChordLine(line));
  const isSectionFlags = lines.map((line, i) =>
    !isTabFlags[i] && !isChordFlags[i] && SECTION_MARKER_RE.test(line.trim()),
  );

  // ── Pass 2: Group tab blocks ─────────────────────────────────────────────
  const tabBlocks = groupTabBlocks(lines, isTabFlags);

  // ── Pass 3: Extract header metadata ──────────────────────────────────────
  const { capoFret, keyDisplay, keyDetected, tempoBpm } = extractTextMetadata(lines);

  // ── Pass 4: Build sections, lyrics, chord events ─────────────────────────
  const sections: UsmSection[] = [];
  const lyricLines: UsmLyricLine[] = [];
  const harmonyEvents: HarmonyEvent[] = [];

  let currentSectionId: string | null = null;
  let currentSectionLabel = '';
  let currentSectionType  = 'unknown';
  let currentSectionStart = 0;
  let sectionCounter = 0;
  let measureCounter = 1;

  // Bug #7 fix: lyricsAligned only true when a chord line immediately precedes a lyric line
  let lyricsAligned = false;

  function flushSection(endLine: number): void {
    if (currentSectionId !== null) {
      sections.push({
        id:             currentSectionId,
        label:          currentSectionLabel,
        type:           currentSectionType,
        startLine:      currentSectionStart,
        endLine,
        sourceDeclared: true,
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line  = lines[i];
    const trimmed = line.trim();

    if (isTabFlags[i]) continue;  // tab lines handled via tabBlocks

    if (isSectionFlags[i]) {
      flushSection(i - 1);
      const label = SECTION_MARKER_RE.exec(trimmed)![1];
      currentSectionId    = `s${++sectionCounter}`;
      currentSectionLabel = label;
      currentSectionType  = sectionTypeFromLabel(label);
      currentSectionStart = i;
      continue;
    }

    if (isChordFlags[i]) {
      // Bug #12 fix: beat index is local to chord tokens, not to all tokens
      const chordTokens = findChordsInLine(line);
      const beatStep = chordTokens.length > 0 ? 4.0 / chordTokens.length : 4.0;

      chordTokens.forEach((sym, localIdx) => {
        const norm = normalizeChord(sym);
        harmonyEvents.push({
          measure:     measureCounter,
          beat:        1.0 + localIdx * beatStep,
          symbol:      sym,
          normalized:  norm,
          sourceNative: sym,
          confidence:  0.5,  // rhythm inferred
        });
      });

      measureCounter++;

      // Bug #7: check for chord-lyric alignment
      if (!lyricsAligned) {
        const nextTrimmed = lines[i + 1]?.trim() ?? '';
        if (nextTrimmed && !isTabFlags[i + 1] && !isChordFlags[i + 1] && !isSectionFlags[i + 1]) {
          lyricsAligned = true;
        }
      }
      continue;
    }

    // Lyric / plain line
    if (trimmed.length > 0) {
      lyricLines.push({ text: trimmed, sectionId: currentSectionId });
    }
  }

  flushSection(lines.length - 1);

  // ── Pass 5: Densities and fingerprint ────────────────────────────────────
  const densities = computeDensities(lines, isTabFlags, isChordFlags);

  const allChordSymbols: string[] = [];
  lines.forEach((line, i) => {
    if (isChordFlags[i]) allChordSymbols.push(...findChordsInLine(line));
  });
  const normalizedChords = allChordSymbols.map(normalizeChord);
  const hf  = computeHarmonicFingerprint(normalizedChords);
  const genre = guessGenre(hf, densities, capoFret);

  // ── Format / tier inference ───────────────────────────────────────────────
  const hasTab    = densities.tabDensity > 0;
  const hasChords = densities.chordDensity > 0;
  const format    = hasTab ? 'ascii_tab' : hasChords ? 'ug_text' : 'plain_text';

  const preferredTheme =
    hasTab ? 'ascii_tab'
    : densities.lyricDensity > densities.chordDensity ? 'chordpro'
    : 'lyrics_sheet';

  const lossWarnings: string[] = [];
  if (!hasTab && !hasChords) lossWarnings.push('No chord symbols or tab content detected.');

  return {
    schemaVersion: '1.0.0',
    songId: generateUUID(),
    title:  options.title ?? '',
    creators: {
      composer: toArray(options.composer),
      lyricist: toArray(options.lyricist),
      arranger: toArray(options.arranger),
      artist:   toArray(options.artist),
    },
    source: {
      format,
      semanticTier: 'tier_1_ascii',
      sourceNative: {},
      importer: { name: 'ugAsciiParser', version: '1.1.0', warnings: [] },
    },
    metadata: {
      key: {
        display:    keyDisplay,
        concert:    keyDisplay,
        detected:   keyDetected,
        confidence: keyDetected ? 0.7 : 0.0,
      },
      timeSignature: { numerator: 4, denominator: 4, pickupBeats: 0, changes: [] },
      tempo: {
        bpm:      tempoBpm,
        text:     '',
        beatUnit: tempoBpm > 0 ? 'quarter' : '',
        changes:  [],
      },
      capo: { fret: capoFret, sourceDeclared: capoFret !== null },
      tuning: [],
    },
    structure: {
      sections,           // Bug #4 fix: populated
      repeats:   [],
      endings:   [],
      rehearsalMarks: [],
    },
    timeline: {
      divisionsPerQuarter: 480,
      measures: [],
    },
    parts: [],             // Bug #6 fix: tab content stored in tabBlocks instead
    harmony: {
      globalProgression: [],
      events: harmonyEvents,
      grid: { present: false, cells: [] },
    },
    lyrics: {
      lines: lyricLines,   // Bug #5 fix: populated
      syllableAligned: lyricsAligned,  // Bug #7 fix
      language: 'en',
    },
    analytics: {
      density: densities,
      harmonicFingerprint: hf,
      genreGuess: genre,
    },
    lossMap: {
      rhythmExplicit:  false,
      voicingExplicit: false,
      layoutExplicit:  false,
      lyricsAligned,
      warnings: lossWarnings,
    },
    renderHints: {
      preferredTheme,
      preferredBarsPerLine: null,
      hideLyrics: false,
      showChordDiagrams: false,
      showTab: hasTab,
      showConcertKey: true,
    },
    tabBlocks,             // Bug #6 fix: populated
  };
}
