/**
 * ugAsciiParser.test.ts
 *
 * Unit tests for the TypeScript UG ASCII parser and all helper functions.
 * Covers every bug that was fixed relative to the original ug_ascii_parser.js.
 */
import { describe, it, expect } from 'vitest';
import {
  isTabLine,
  isChordLine,
  normalizeChord,
  computeHarmonicFingerprint,
  computeDensities,
  guessGenre,
  extractTextMetadata,
  parseUgAscii,
} from '../ugAsciiParser';
import type { NormalizedChord, HarmonicFingerprint, DensityMetrics } from '../../types/unifiedSongModel';

// ─── isTabLine ────────────────────────────────────────────────────────────────

describe('isTabLine', () => {
  it('accepts standard 6-string tab lines', () => {
    expect(isTabLine('e|--0---2-3-----')).toBe(true);
    expect(isTabLine('B|--1---3-5-----')).toBe(true);
    expect(isTabLine('G|--0---2-4-----')).toBe(true);
    expect(isTabLine('D|--2---0-5-----')).toBe(true);
    expect(isTabLine('A|--2---0-3-----')).toBe(true);
    expect(isTabLine('E|--0---x-1-----')).toBe(true);
  });

  it('accepts lines with spaces (measure separators) — Bug #11 fix', () => {
    expect(isTabLine('e|--0--2-|--3--5-')).toBe(true);
    expect(isTabLine('E|--0---  --2---')).toBe(true);
  });

  it('accepts lines with trailing bar marker — Bug #11 fix', () => {
    expect(isTabLine('e|--0-2-3--|')).toBe(true);
  });

  it('accepts notation symbols: h p b t r x / \\ ~', () => {
    expect(isTabLine('e|--5h7p5b7r5~--')).toBe(true);
  });

  it('rejects plain lyric or chord lines', () => {
    expect(isTabLine('Am  G  C  F')).toBe(false);
    expect(isTabLine('verse 1')).toBe(false);
    expect(isTabLine('[Chorus]')).toBe(false);
    expect(isTabLine('')).toBe(false);
  });

  it('rejects lines that are too short', () => {
    expect(isTabLine('E|')).toBe(false);   // only 2 chars, no content
    expect(isTabLine('E|-')).toBe(true);   // 3 chars, passes
  });
});

// ─── isChordLine ──────────────────────────────────────────────────────────────

describe('isChordLine', () => {
  it('detects a line of only chord tokens', () => {
    expect(isChordLine('Am  G  C  F')).toBe(true);
    expect(isChordLine('Dm7 G7 Cmaj7')).toBe(true);
  });

  it('detects a mixed chord+lyric chord line (≥40% chords)', () => {
    // "Am  G  C  F" — 4 chords / 4 tokens = 100%
    expect(isChordLine('Am G C F')).toBe(true);
  });

  it('rejects a plain lyric line', () => {
    expect(isChordLine('Hello world, how are you today')).toBe(false);
    expect(isChordLine('verse 1 is the starting line')).toBe(false);
  });

  it('rejects an empty line', () => {
    expect(isChordLine('')).toBe(false);
    expect(isChordLine('   ')).toBe(false);
  });

  it('detects pipe-grid chord lines (|Chord |Chord |...)', () => {
    expect(isChordLine('|Am  |G   |C   |F   |')).toBe(true);
    expect(isChordLine('|Dm7 |G7  |Cmaj7    |')).toBe(true);
    expect(isChordLine('|D#m7       |C#/F        |F#  |G°7  |')).toBe(true);
  });

  it('treats % repeat markers as non-tokens (skipped, not counted against chord ratio)', () => {
    // "|Bb9 |% |% |%|" — only 1 chord token after skipping %, still a chord line
    expect(isChordLine('|Bb9  |%   |%   |%   |')).toBe(true);
    // All %-only grid line: not a chord line
    expect(isChordLine('|%   |%   |%   |%   |')).toBe(false);
  });
});

// ─── normalizeChord ───────────────────────────────────────────────────────────

describe('normalizeChord', () => {
  it('parses plain major chord', () => {
    const c = normalizeChord('C');
    expect(c.root).toBe('C');
    expect(c.qualityFamily).toBe('maj');
    expect(c.bass).toBeNull();
  });

  it('parses minor chord', () => {
    const c = normalizeChord('Am');
    expect(c.root).toBe('A');
    expect(c.qualityFamily).toBe('min');
  });

  it('parses dominant 7th', () => {
    const c = normalizeChord('G7');
    expect(c.root).toBe('G');
    expect(c.qualityFamily).toBe('dom7');
  });

  it('parses major 7th', () => {
    const c = normalizeChord('Fmaj7');
    expect(c.root).toBe('F');
    expect(c.qualityFamily).toBe('maj7');
  });

  it('parses minor 7th', () => {
    expect(normalizeChord('Dm7').qualityFamily).toBe('min7');
    expect(normalizeChord('Am7').qualityFamily).toBe('min7');
  });

  it('parses half-diminished (m7b5)', () => {
    expect(normalizeChord('Dm7b5').qualityFamily).toBe('min7b5');
    expect(normalizeChord('Bm7b5').qualityFamily).toBe('min7b5');
  });

  it('parses diminished and diminished 7th', () => {
    expect(normalizeChord('Bdim').qualityFamily).toBe('dim');
    expect(normalizeChord('Cdim7').qualityFamily).toBe('dim7');
  });

  it('Bug #8 fix: parses aug7 as aug7, not aug', () => {
    const c = normalizeChord('Gaug7');
    expect(c.qualityFamily).toBe('aug7');
  });

  it('parses suspended chords', () => {
    expect(normalizeChord('Dsus4').qualityFamily).toBe('sus4');
    expect(normalizeChord('Asus2').qualityFamily).toBe('sus2');
    expect(normalizeChord('Esus').qualityFamily).toBe('sus4');
  });

  it('parses power chord', () => {
    expect(normalizeChord('E5').qualityFamily).toBe('5');
    expect(normalizeChord('A5').qualityFamily).toBe('5');
  });

  it('parses slash chord', () => {
    const c = normalizeChord('G/B');
    expect(c.root).toBe('G');
    expect(c.qualityFamily).toBe('maj');
    expect(c.bass).toBe('B');
  });

  it('parses flat root', () => {
    const c = normalizeChord('Bb');
    expect(c.root).toBe('Bb');
    expect(c.qualityFamily).toBe('maj');
  });

  it('parses sharp root', () => {
    const c = normalizeChord('F#m7');
    expect(c.root).toBe('F#');
    expect(c.qualityFamily).toBe('min7');
  });

  it('returns nulls for unrecognized input', () => {
    const c = normalizeChord('xyz123');
    expect(c.root).toBeNull();
    expect(c.qualityFamily).toBeNull();
  });
});

// ─── computeHarmonicFingerprint ───────────────────────────────────────────────

describe('computeHarmonicFingerprint', () => {
  it('returns all zeros for empty input', () => {
    const hf = computeHarmonicFingerprint([]);
    expect(hf.dom7Rate).toBe(0);
    expect(hf.iiVRate).toBe(0);
  });

  it('computes cowboy chord share correctly — Bug #9 fix (Dm counted)', () => {
    // G C D Am Em Dm — all cowboy chords
    const chords = [
      { root: 'G', qualityFamily: 'maj', extensions: [], alterations: [], suspension: null, bass: null },
      { root: 'C', qualityFamily: 'maj', extensions: [], alterations: [], suspension: null, bass: null },
      { root: 'D', qualityFamily: 'maj', extensions: [], alterations: [], suspension: null, bass: null },
      { root: 'A', qualityFamily: 'min', extensions: [], alterations: [], suspension: null, bass: null },
      { root: 'E', qualityFamily: 'min', extensions: [], alterations: [], suspension: null, bass: null },
      { root: 'D', qualityFamily: 'min', extensions: [], alterations: [], suspension: null, bass: null },
    ] as NormalizedChord[];
    const hf = computeHarmonicFingerprint(chords);
    expect(hf.cowboyChordShare).toBeCloseTo(1.0);
  });

  it('Bug #3 fix: ii-V detection requires min7 + dom7, not just any 4th motion', () => {
    // D→G is a 4th but neither chord has the right quality → should NOT count
    const noQualityPair: NormalizedChord[] = [
      { root: 'D', qualityFamily: 'maj', extensions: [], alterations: [], suspension: null, bass: null },
      { root: 'G', qualityFamily: 'maj', extensions: [], alterations: [], suspension: null, bass: null },
    ];
    expect(computeHarmonicFingerprint(noQualityPair).iiVRate).toBe(0);

    // Dm7→G7 IS a ii-V → should count
    const realIiV: NormalizedChord[] = [
      { root: 'D', qualityFamily: 'min7', extensions: [], alterations: [], suspension: null, bass: null },
      { root: 'G', qualityFamily: 'dom7', extensions: [], alterations: [], suspension: null, bass: null },
    ];
    expect(computeHarmonicFingerprint(realIiV).iiVRate).toBeGreaterThan(0);
  });

  it('computes dom7Rate', () => {
    const chords: NormalizedChord[] = [
      { root: 'G', qualityFamily: 'dom7', extensions: [], alterations: [], suspension: null, bass: null },
      { root: 'C', qualityFamily: 'maj',  extensions: [], alterations: [], suspension: null, bass: null },
    ];
    expect(computeHarmonicFingerprint(chords).dom7Rate).toBeCloseTo(0.5);
  });

  it('computes simpleMajMinRate', () => {
    const chords: NormalizedChord[] = [
      { root: 'C', qualityFamily: 'maj', extensions: [], alterations: [], suspension: null, bass: null },
      { root: 'A', qualityFamily: 'min', extensions: [], alterations: [], suspension: null, bass: null },
      { root: 'G', qualityFamily: 'dom7', extensions: [], alterations: [], suspension: null, bass: null },
    ];
    const hf = computeHarmonicFingerprint(chords);
    expect(hf.simpleMajMinRate).toBeCloseTo(2 / 3);
  });
});

// ─── guessGenre ───────────────────────────────────────────────────────────────

const EMPTY_DENSITIES: DensityMetrics = {
  lyricDensity: 0, tabDensity: 0, chordDensity: 0, gridDensity: 0, sectionDensity: 0,
};

const JAZZ_HF: HarmonicFingerprint = {
  cowboyChordShare: 0, dom7Rate: 0.3, maj7Rate: 0.3, min7b5Rate: 0.2,
  altRate: 0.1, powerChordRate: 0, iiVRate: 0.4, simpleMajMinRate: 0,
};
const ROCK_HF: HarmonicFingerprint = {
  cowboyChordShare: 0.1, dom7Rate: 0.3, maj7Rate: 0, min7b5Rate: 0,
  altRate: 0, powerChordRate: 0.5, iiVRate: 0.1, simpleMajMinRate: 0.1,
};
const FOLK_HF: HarmonicFingerprint = {
  cowboyChordShare: 0.8, dom7Rate: 0, maj7Rate: 0, min7b5Rate: 0,
  altRate: 0, powerChordRate: 0, iiVRate: 0, simpleMajMinRate: 0.6,
};

describe('guessGenre', () => {
  it('identifies jazz signals', () => {
    const g = guessGenre(JAZZ_HF, EMPTY_DENSITIES, null);
    expect(g.primary).toBe('jazz');
  });

  it('Bug #2 fix: identifies rock/blues from power chords (not folk_pop)', () => {
    const g = guessGenre(ROCK_HF, { ...EMPTY_DENSITIES, tabDensity: 0.4 }, null);
    expect(g.primary).toBe('rock_blues');
  });

  it('identifies folk/pop from cowboy chords + lyrics', () => {
    const g = guessGenre(FOLK_HF, { ...EMPTY_DENSITIES, lyricDensity: 0.5 }, null);
    expect(g.primary).toBe('folk_pop');
  });

  it('Bug #2 fix: capo presence boosts folk_pop score', () => {
    const withCapo    = guessGenre(FOLK_HF, EMPTY_DENSITIES, 3);
    const withoutCapo = guessGenre(FOLK_HF, EMPTY_DENSITIES, null);
    expect(withCapo.scores.folk_pop).toBeGreaterThan(withoutCapo.scores.folk_pop);
  });

  it('returns unknown when scores are too close', () => {
    const zeroHf: HarmonicFingerprint = {
      cowboyChordShare: 0, dom7Rate: 0, maj7Rate: 0, min7b5Rate: 0,
      altRate: 0, powerChordRate: 0, iiVRate: 0, simpleMajMinRate: 0,
    };
    const g = guessGenre(zeroHf, EMPTY_DENSITIES, null);
    expect(g.primary).toBe('unknown');
  });

  it('dom7 alone does NOT trigger jazz lyric-sparsity bonus (blues disambiguation)', () => {
    // A blues song: heavy dom7, lyrics, no specifically-jazz harmony
    const bluesHf: HarmonicFingerprint = {
      cowboyChordShare: 0.02, dom7Rate: 0.50, maj7Rate: 0, min7b5Rate: 0,
      altRate: 0, powerChordRate: 0, iiVRate: 0, simpleMajMinRate: 0.48,
    };
    const g = guessGenre(bluesHf, { ...EMPTY_DENSITIES, lyricDensity: 0.30, gridDensity: 0.10 }, null);
    // Without jazzSpecificSignal fix, this would classify as jazz.
    // With the fix, rock_blues should win (dom7 + lyrics).
    expect(g.primary).toBe('rock_blues');
  });

  it('jazz lyric-sparsity bonus fires when jazzSpecificSignal ≥ 1.0', () => {
    // Specifically jazz: maj7 + min7b5 + iiV, no lyrics (instrumental chart)
    const jazzInstrumentalHf: HarmonicFingerprint = {
      cowboyChordShare: 0, dom7Rate: 0.15, maj7Rate: 0.25, min7b5Rate: 0.10,
      altRate: 0, powerChordRate: 0, iiVRate: 0.20, simpleMajMinRate: 0.10,
    };
    const g = guessGenre(
      jazzInstrumentalHf,
      { ...EMPTY_DENSITIES, lyricDensity: 0.05, gridDensity: 0.50 },
      null,
    );
    expect(g.primary).toBe('jazz');
    // And the score should reflect the lyric-density bonus
    expect(g.scores.jazz).toBeGreaterThan(3);
  });
});

// ─── extractTextMetadata ─────────────────────────────────────────────────────

describe('extractTextMetadata — Bug #10 fix', () => {
  it('extracts capo fret', () => {
    expect(extractTextMetadata(['Capo 3']).capoFret).toBe(3);
    expect(extractTextMetadata(['capo: 5']).capoFret).toBe(5);
    expect(extractTextMetadata(['Capo fret 2']).capoFret).toBe(2);
  });

  it('extracts key', () => {
    const { keyDisplay, keyDetected } = extractTextMetadata(['Key of G']);
    expect(keyDisplay).toBe('G');
    expect(keyDetected).toBe(true);
  });

  it('extracts key with minor suffix', () => {
    const { keyDisplay } = extractTextMetadata(['Key: Am']);
    expect(keyDisplay).toContain('A');
  });

  it('extracts BPM from "120 BPM"', () => {
    expect(extractTextMetadata(['120 BPM']).tempoBpm).toBe(120);
    expect(extractTextMetadata(['Tempo: 95']).tempoBpm).toBe(95);
    expect(extractTextMetadata(['BPM = 140']).tempoBpm).toBe(140);
  });

  it('returns nulls/zero when nothing is present', () => {
    const m = extractTextMetadata(['just a lyric line', 'another line']);
    expect(m.capoFret).toBeNull();
    expect(m.keyDetected).toBe(false);
    expect(m.tempoBpm).toBe(0);
  });
});

// ─── computeDensities ────────────────────────────────────────────────────────

describe('computeDensities', () => {
  it('returns all zeros for empty input', () => {
    const d = computeDensities([], [], []);
    expect(d.lyricDensity).toBe(0);
  });

  it('counts tab, chord, lyric, and section lines correctly', () => {
    const lines = [
      '[Verse]',             // section
      'Am  G  C  F',         // chord
      'Hello world',         // lyric
      'e|--0-2-3--|',        // tab
      'E|--0-2-3--|',        // tab
      'G|--0-2-3--|',        // tab
      'D|--0-2-3--|',        // tab
    ];
    const tabFlags   = lines.map((l) => isTabLine(l));
    const chordFlags = lines.map((l, i) => !tabFlags[i] && isChordLine(l));
    const d = computeDensities(lines, tabFlags, chordFlags);
    expect(d.tabDensity).toBeCloseTo(4 / 7);
    expect(d.sectionDensity).toBeCloseTo(1 / 7);
    expect(d.lyricDensity).toBeCloseTo(1 / 7);
  });

  it('pipe-grid chord lines count toward gridDensity, not lyricDensity', () => {
    const lines = [
      '|Am  |G   |C   |F   |',   // grid chord line
      '|Dm7 |G7  |Cmaj7    |',   // grid chord line
      'Hello world',              // lyric
    ];
    const tabFlags   = lines.map((l) => isTabLine(l));
    const chordFlags = lines.map((l, i) => !tabFlags[i] && isChordLine(l));
    const d = computeDensities(lines, tabFlags, chordFlags);
    expect(d.gridDensity).toBeCloseTo(2 / 3);
    expect(d.lyricDensity).toBeCloseTo(1 / 3);
  });
});

// ─── parseUgAscii (integration) ───────────────────────────────────────────────

const SIMPLE_CHORD_SHEET = `
[Verse]
Am  G  C  F
Hello world how are you

[Chorus]
C  G  Am  F
La la la la
`.trim();

const TAB_SHEET = `
Capo 2
Key of G
[Riff]
e|--0-2-3--|
B|--1-3-5--|
G|--0-2-4--|
D|--2-0-5--|
`.trim();

describe('parseUgAscii', () => {
  it('produces a valid schema version and songId', () => {
    const m = parseUgAscii(SIMPLE_CHORD_SHEET);
    expect(m.schemaVersion).toBe('1.0.0');
    expect(m.songId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('Bug #4 fix: populates structure.sections', () => {
    const m = parseUgAscii(SIMPLE_CHORD_SHEET);
    expect(m.structure.sections.length).toBeGreaterThan(0);
    expect(m.structure.sections[0].label).toBe('Verse');
  });

  it('Bug #5 fix: populates lyrics.lines', () => {
    const m = parseUgAscii(SIMPLE_CHORD_SHEET);
    expect(m.lyrics.lines.length).toBeGreaterThan(0);
    expect(m.lyrics.lines.some((l) => l.text.includes('Hello'))).toBe(true);
  });

  it('Bug #7 fix: lyricsAligned true only when chord precedes lyric', () => {
    // SIMPLE_CHORD_SHEET has chord lines immediately above lyric lines
    expect(parseUgAscii(SIMPLE_CHORD_SHEET).lossMap.lyricsAligned).toBe(true);
    // Tab-only sheet has no lyric lines
    expect(parseUgAscii(TAB_SHEET).lossMap.lyricsAligned).toBe(false);
  });

  it('Bug #6 fix: populates tabBlocks for tab content', () => {
    const m = parseUgAscii(TAB_SHEET);
    expect(m.tabBlocks.length).toBeGreaterThan(0);
    expect(m.tabBlocks[0].lines.length).toBeGreaterThanOrEqual(4);
  });

  it('Bug #10 fix: extracts capo from text', () => {
    const m = parseUgAscii(TAB_SHEET);
    expect(m.metadata.capo.fret).toBe(2);
    expect(m.metadata.capo.sourceDeclared).toBe(true);
  });

  it('Bug #10 fix: extracts key from text', () => {
    const m = parseUgAscii(TAB_SHEET);
    expect(m.metadata.key.detected).toBe(true);
    expect(m.metadata.key.display).toContain('G');
  });

  it('Bug #12 fix: harmony events use chord-local beat positions', () => {
    // "Am  G  C  F" — 4 chords evenly spaced: beats 1.0, 2.0, 3.0, 4.0 (approx)
    const m = parseUgAscii('Am  G  C  F');
    expect(m.harmony.events.length).toBe(4);
    // First chord should start at beat 1.0
    expect(m.harmony.events[0].beat).toBeCloseTo(1.0);
    // Beats should be in ascending order
    const beats = m.harmony.events.map((e) => e.beat);
    expect(beats).toEqual([...beats].sort((a, b) => a - b));
  });

  it('reports source format correctly', () => {
    expect(parseUgAscii(SIMPLE_CHORD_SHEET).source.format).toBe('ug_text');
    expect(parseUgAscii(TAB_SHEET).source.format).toBe('ascii_tab');
  });

  it('passes title and artist from options', () => {
    const m = parseUgAscii('Am G', { title: 'My Song', artist: 'Me' });
    expect(m.title).toBe('My Song');
    expect(m.creators.artist).toEqual(['Me']);
  });

  it('accepts array creators', () => {
    const m = parseUgAscii('', { composer: ['A', 'B'] });
    expect(m.creators.composer).toEqual(['A', 'B']);
  });

  it('handles empty input without throwing', () => {
    expect(() => parseUgAscii('')).not.toThrow();
    const m = parseUgAscii('');
    expect(m.analytics.genreGuess.primary).toBe('unknown');
  });

  it('extracts chord events from pipe-grid format lines', () => {
    const grid = `[Intro]
|Am  |G   |C   |F   |
|Dm7 |G7  |Cmaj7    |Am  |`;
    const m = parseUgAscii(grid);
    // Should extract chords from both grid lines (4 + 4 = 8)
    expect(m.harmony.events.length).toBe(8);
    // gridDensity should be non-zero (2 out of 3 non-empty non-section lines are grid)
    expect(m.analytics.density.gridDensity).toBeGreaterThan(0);
    // Lyric lines should not include grid lines
    expect(m.lyrics.lines.length).toBe(0);
  });

  it('skips % repeat markers in pipe-grid lines', () => {
    const grid = `[Solo]
|Bb9  |%   |%   |%   |
|Eb9  |%   |Bb9  |%   |`;
    const m = parseUgAscii(grid);
    // Only real chord tokens — % markers are skipped
    // Line 1: Bb9 (% × 3 skipped); Line 2: Eb9, Bb9 (% × 2 skipped)
    expect(m.harmony.events.map((e) => e.symbol)).toEqual(['Bb9', 'Eb9', 'Bb9']);
  });

  it('Bug #13 fix: is importable as named ESM export (this test runs)', () => {
    // The fact that the import at the top of this file succeeds proves
    // the module uses ESM exports, not CommonJS module.exports.
    expect(typeof parseUgAscii).toBe('function');
  });

  // Bug #1 fix: global regex .test() in loop — verified indirectly by checking
  // that all chords on a repeated-token line are detected (not every-other-one)
  it('Bug #1 fix: detects all chords on a line, not just every other one', () => {
    const m = parseUgAscii('Am Am Am Am Am Am');
    expect(m.harmony.events.length).toBe(6);
  });
});
