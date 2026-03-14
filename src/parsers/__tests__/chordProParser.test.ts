/**
 * chordProParser.test.ts
 *
 * Unit tests for all three chord-chart parsing dialects:
 *   1. ChordPro — {directives} + [chord] inline tokens
 *   2. Ultimate Guitar — [Section] headers + [chord] inline tokens
 *   3. Chords-over-words — chord line stacked above lyric line
 *
 * Tests cover metadata extraction, section detection, token shape,
 * comment handling, and the dispatch function.
 */
import { describe, it, expect } from 'vitest';
import {
  parseChordPro,
  parseUltimateGuitar,
  parseChordsOverWords,
  parseChordChart,
} from '../chordProParser';

// ─── 1. ChordPro metadata directives ─────────────────────────────────────────

describe('parseChordPro — metadata', () => {
  it('extracts title, artist, key, capo from directives', () => {
    const text = `
{title: Amazing Grace}
{artist: Traditional}
{key: G}
{capo: 2}
{tempo: 75}
{time: 3/4}
[G]Amazing [C]grace how [G]sweet the sound
`;
    const doc = parseChordPro(text);
    expect(doc.title).toBe('Amazing Grace');
    expect(doc.artist).toBe('Traditional');
    expect(doc.key).toBe('G');
    expect(doc.capo).toBe('2');
    expect(doc.tempo).toBe('75');
    expect(doc.time).toBe('3/4');
  });

  it('recognises short directive aliases: {t:}, {a:}, {st:}', () => {
    const doc = parseChordPro('{t: Short Title}\n{a: Me}\n{st: Sub}\n[C]text');
    expect(doc.title).toBe('Short Title');
    expect(doc.artist).toBe('Me');
    expect(doc.subtitle).toBe('Sub');
  });

  it('sets sourceFormat to "chordpro"', () => {
    const doc = parseChordPro('[Am]Hello');
    expect(doc.sourceFormat).toBe('chordpro');
  });
});

// ─── 2. ChordPro section markers ─────────────────────────────────────────────

describe('parseChordPro — section markers', () => {
  it('start_of_chorus / end_of_chorus creates a chorus section', () => {
    const text = `
{start_of_chorus}
[C]Oh how I [G]love you
{end_of_chorus}
`;
    const doc = parseChordPro(text);
    const chorus = doc.sections.find((s) => s.type === 'chorus');
    expect(chorus).toBeDefined();
    expect(chorus!.lines.length).toBeGreaterThan(0);
  });

  it('abbreviated soc / eoc markers are recognised', () => {
    const doc = parseChordPro('{soc}\n[Am]line\n{eoc}');
    expect(doc.sections.some((s) => s.type === 'chorus')).toBe(true);
  });

  it('start_of_verse with label sets section label', () => {
    const doc = parseChordPro('{start_of_verse: Verse 1}\n[G]word\n{end_of_verse}');
    const verse = doc.sections.find((s) => s.type === 'verse');
    expect(verse).toBeDefined();
    expect(verse!.label).toBe('Verse 1');
  });
});

// ─── 3. ChordPro inline chord tokens ─────────────────────────────────────────

describe('parseChordPro — inline chord tokens', () => {
  it('produces alternating chord / lyric tokens', () => {
    const doc = parseChordPro('[Am]Hello [G]world');
    expect(doc.sections.length).toBeGreaterThan(0);
    const tokens = doc.sections[0].lines[0].tokens;
    expect(tokens[0]).toMatchObject({ kind: 'chord', text: 'Am' });
    expect(tokens[1]).toMatchObject({ kind: 'lyric', text: 'Hello ' });
    expect(tokens[2]).toMatchObject({ kind: 'chord', text: 'G' });
  });

  it('text before the first bracket is emitted as a lyric token', () => {
    const doc = parseChordPro('Some intro [C]text');
    const tokens = doc.sections[0].lines[0].tokens;
    expect(tokens[0]).toMatchObject({ kind: 'lyric' });
    expect(tokens[0].text).toContain('Some intro');
  });
});

// ─── 4. ChordPro comment directive ───────────────────────────────────────────

describe('parseChordPro — comments', () => {
  it('{comment: ...} produces a comment token', () => {
    const doc = parseChordPro('{comment: Capo 2nd fret}');
    const tokens = doc.sections[0]?.lines[0]?.tokens ?? [];
    expect(tokens[0]).toMatchObject({ kind: 'comment', text: 'Capo 2nd fret' });
  });

  it('% lines are silently skipped', () => {
    const doc = parseChordPro('% this whole line is a comment\n[C]actual');
    // Only the [C]actual content line, no comment token from the % line.
    const allTokens = doc.sections.flatMap((s) => s.lines.flatMap((l) => l.tokens));
    const commentTokens = allTokens.filter((t) => t.kind === 'comment');
    expect(commentTokens).toHaveLength(0);
  });
});

// ─── 5. Ultimate Guitar section headers ──────────────────────────────────────

describe('parseUltimateGuitar', () => {
  it('[Verse 1] creates a verse section', () => {
    const doc = parseUltimateGuitar('[Verse 1]\n[Am]words');
    expect(doc.sections.some((s) => s.type === 'verse')).toBe(true);
    expect(doc.sourceFormat).toBe('ultimateguitar');
  });

  it('[Chorus] creates a chorus section', () => {
    const doc = parseUltimateGuitar('[Chorus]\n[G]sing it');
    expect(doc.sections.some((s) => s.type === 'chorus')).toBe(true);
  });

  it('[Pre-Chorus] is mapped to pre-chorus type', () => {
    const doc = parseUltimateGuitar('[Pre-Chorus]\n[D]lead in');
    expect(doc.sections.some((s) => s.type === 'pre-chorus')).toBe(true);
  });

  it('multiple sections are ordered correctly', () => {
    const text = '[Verse 1]\n[C]v1\n[Chorus]\n[G]chorus\n[Verse 2]\n[Am]v2';
    const doc = parseUltimateGuitar(text);
    expect(doc.sections[0].type).toBe('verse');
    expect(doc.sections[1].type).toBe('chorus');
    expect(doc.sections[2].type).toBe('verse');
  });
});

// ─── 6. Chords-over-words ────────────────────────────────────────────────────

describe('parseChordsOverWords', () => {
  it('pairs chord line with following lyric line', () => {
    const text = 'Am  G  C\nHello world now';
    const doc = parseChordsOverWords(text);
    expect(doc.sections.length).toBeGreaterThan(0);
    const tokens = doc.sections[0].lines[0].tokens;
    const chordTokens = tokens.filter((t) => t.kind === 'chord');
    const lyricTokens = tokens.filter((t) => t.kind === 'lyric');
    expect(chordTokens.map((t) => t.text)).toEqual(['Am', 'G', 'C']);
    expect(lyricTokens[0].text).toBe('Hello world now');
  });

  it('orphaned chord line (no lyric below) is still emitted', () => {
    const text = 'C  G\n'; // trailing newline, no lyric
    const doc = parseChordsOverWords(text);
    const tokens = doc.sections[0].lines[0].tokens;
    expect(tokens.every((t) => t.kind === 'chord')).toBe(true);
  });

  it('sets sourceFormat to "chords-over-words"', () => {
    const doc = parseChordsOverWords('C G\nwords');
    expect(doc.sourceFormat).toBe('chords-over-words');
  });
});

// ─── 7. parseChordChart dispatch ─────────────────────────────────────────────

describe('parseChordChart — dispatch', () => {
  it('routes "chordpro" to parseChordPro', () => {
    const doc = parseChordChart('{title: A}\n[C]text', 'chordpro');
    expect(doc.sourceFormat).toBe('chordpro');
    expect(doc.title).toBe('A');
  });

  it('routes "ultimateguitar" to parseUltimateGuitar', () => {
    const doc = parseChordChart('[Verse 1]\n[Am]words', 'ultimateguitar');
    expect(doc.sourceFormat).toBe('ultimateguitar');
  });

  it('routes "chords-over-words" to parseChordsOverWords', () => {
    const doc = parseChordChart('Am G\nHello world', 'chords-over-words');
    expect(doc.sourceFormat).toBe('chords-over-words');
  });

  it('"chordpro" format routes to parseChordPro and parses inline chords', () => {
    // 'chordpro' is the default/fallback case in the dispatch switch.
    const doc = parseChordChart('[C]text', 'chordpro');
    expect(doc.sections.length).toBeGreaterThan(0);
    const tokens = doc.sections[0].lines[0].tokens;
    expect(tokens[0]).toMatchObject({ kind: 'chord', text: 'C' });
  });
});
