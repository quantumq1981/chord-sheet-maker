/**
 * chordSymbolParser.test.ts
 *
 * Unit tests for parseChordSymbol and parsedChordToText.
 */
import { describe, it, expect } from 'vitest';
import { parseChordSymbol, parsedChordToText } from '../chordSymbolParser';

// ─── Helper ───────────────────────────────────────────────────────────────────
function text(input: string): string | null {
  const parsed = parseChordSymbol(input);
  return parsed ? parsedChordToText(parsed) : null;
}

// ─── Standard notation ────────────────────────────────────────────────────────
describe('standard notation', () => {
  it('major triad', () => expect(text('C')).toBe('C'));
  it('minor triad', () => expect(text('Dm')).toBe('Dm'));
  it('dominant 7th', () => expect(text('G7')).toBe('G7'));
  it('major 7th', () => expect(text('Fmaj7')).toBe('Fmaj7'));
  it('minor 7th', () => expect(text('Am7')).toBe('Am7'));
  it('diminished', () => expect(text('Bdim')).toBe('Bdim'));
  it('diminished 7th', () => expect(text('Cdim7')).toBe('Cdim7'));
  it('half-diminished', () => expect(text('Dm7b5')).toBe('Dm7b5'));
  it('augmented', () => expect(text('Eaug')).toBe('Eaug'));
  it('sus4', () => expect(text('Csus4')).toBe('Csus4'));
  it('sus2', () => expect(text('Dsus2')).toBe('Dsus2'));
  it('sus (no number)', () => expect(text('Gsus')).toBe('Gsus4'));
  it('6th', () => expect(text('C6')).toBe('C6'));
  it('minor 6th', () => expect(text('Am6')).toBe('Am6'));
  it('9th', () => expect(text('F9')).toBe('F9'));
  it('11th', () => expect(text('Bb11')).toBe('Bb11'));
  it('13th', () => expect(text('G13')).toBe('G13'));
  it('power chord', () => expect(text('C5')).toBe('C5'));
});

// ─── Accidentals ─────────────────────────────────────────────────────────────
describe('accidentals', () => {
  it('flat root', () => expect(text('Bb7')).toBe('Bb7'));
  it('sharp root', () => expect(text('F#m7')).toBe('F#m7'));
  it('Eb major', () => expect(text('Eb')).toBe('Eb'));
  it('Ab minor', () => expect(text('Abm')).toBe('Abm'));
  it('Bb minor 7', () => expect(text('Bbm7')).toBe('Bbm7'));
  it('C# dominant', () => expect(text('C#7')).toBe('C#7'));
});

// ─── Slash chords ─────────────────────────────────────────────────────────────
describe('slash chords', () => {
  it('major over bass note', () => expect(text('C/G')).toBe('C/G'));
  it('dominant 7 over bass note', () => expect(text('G7/B')).toBe('G7/B'));
  it('minor over flat bass', () => expect(text('Am7/E')).toBe('Am7/E'));
  it('flat bass note', () => expect(text('C/Bb')).toBe('C/Bb'));
  it('sharp bass note', () => expect(text('G/F#')).toBe('G/F#'));
});

// ─── Finale / jazz-specific notation ─────────────────────────────────────────
describe('Finale and jazz notation', () => {
  it('^7 = maj7', () => expect(text('C^7')).toBe('Cmaj7'));
  it('△7 = maj7', () => expect(text('C△7')).toBe('Cmaj7'));
  it('Δ7 = maj7', () => expect(text('CΔ7')).toBe('Cmaj7'));
  it('^ alone = major', () => expect(text('C^')).toBe('C'));
  it('△ alone = major', () => expect(text('C△')).toBe('C'));
  it('-7 = minor 7', () => expect(text('G-7')).toBe('Gm7'));
  it('- alone = minor', () => expect(text('F-')).toBe('Fm'));
  it('-9 = minor 9', () => expect(text('D-9')).toBe('Dm9'));
  it('-6 = minor 6', () => expect(text('A-6')).toBe('Am6'));
  it('mi7 = minor 7', () => expect(text('Cmi7')).toBe('Cm7'));
  it('mi alone = minor', () => expect(text('Fmi')).toBe('Fm'));
  it('mi9 = minor 9', () => expect(text('Bmi9')).toBe('Bm9'));
  it('ø = half-diminished', () => expect(text('Bø')).toBe('Bm7b5'));
  it('ø7 = half-diminished', () => expect(text('Dø7')).toBe('Dm7b5'));
  it('Ø = half-diminished', () => expect(text('EØ')).toBe('Em7b5'));
  it('° = diminished', () => expect(text('F°')).toBe('Fdim'));
  it('°7 = diminished 7th', () => expect(text('G°7')).toBe('Gdim7'));
  it('^9 = major 9', () => expect(text('F^9')).toBe('Fmaj9'));
  it('△9 = major 9', () => expect(text('Bb△9')).toBe('Bbmaj9'));
  it('M7 = maj7', () => expect(text('CM7')).toBe('Cmaj7'));
  it('M9 = maj9', () => expect(text('DM9')).toBe('Dmaj9'));
  it('ma7 = maj7', () => expect(text('Ema7')).toBe('Emaj7'));
});

// ─── Should return null (not a chord) ────────────────────────────────────────
describe('non-chord text returns null', () => {
  it('empty string', () => expect(text('')).toBeNull());
  it('arbitrary word', () => expect(text('Bridge')).toBeNull());
  it('dynamics', () => expect(text('mf')).toBeNull());
  it('tempo marking', () => expect(text('Allegro')).toBeNull());
  it('D.S.', () => expect(text('D.S.')).toBeNull());
  it('Fine', () => expect(text('Fine')).toBeNull());
  it('number only', () => expect(text('42')).toBeNull());
  it('repeat sign text', () => expect(text('D.C. al Coda')).toBeNull());
});

// ─── Specific Finale patterns from the Omnibook ──────────────────────────────
describe('common Parker / Omnibook chord symbols', () => {
  it('Bb7', () => expect(text('Bb7')).toBe('Bb7'));
  it('Eb7', () => expect(text('Eb7')).toBe('Eb7'));
  it('Abmaj7', () => expect(text('Abmaj7')).toBe('Abmaj7'));
  it('Fm7', () => expect(text('Fm7')).toBe('Fm7'));
  it('Cm7', () => expect(text('Cm7')).toBe('Cm7'));
  it('Gm7', () => expect(text('Gm7')).toBe('Gm7'));
  it('F7', () => expect(text('F7')).toBe('F7'));
  it('Dm7b5', () => expect(text('Dm7b5')).toBe('Dm7b5'));
  it('G#dim7', () => expect(text('G#dim7')).toBe('G#dim7'));
  it('Db7', () => expect(text('Db7')).toBe('Db7'));
});
