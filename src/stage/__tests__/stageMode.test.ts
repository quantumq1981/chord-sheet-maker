import { describe, it, expect } from 'vitest';
import {
  extractStageSheet,
  stripInlineChords,
  buildStageHtml,
  buildStagePdf,
  DEFAULT_STAGE_STYLE,
} from '../stageMode';

const VEHICLE = `{title: Vehicle}
{artist: The Ides of March}
{key: F#}

{c: Intro}
[Ebm7]     [Bbm7]     [Ebm7]     [Bbm7]

{c: Verse 1}
Hey well I'm the f[Ebm7]riendly stranger in the black sedan
Oh won't you [Bbm7]hop inside my car?
I'm [Am]your [Abm7]vehicle baby
I'll take you [Bbm7]anywhere you wanna go
By [Bbsus4]now I'm sure you [Bb]know

Great God in heaven, you know I love you
`;

describe('stripInlineChords', () => {
  it('removes bracket chords while preserving word spacing', () => {
    expect(stripInlineChords("I'm [Am]your [Abm7]vehicle baby")).toBe("I'm your vehicle baby");
  });

  it('rejoins a chord split inside a word', () => {
    expect(stripInlineChords('the f[Ebm7]riendly stranger')).toBe('the friendly stranger');
  });

  it('returns empty for an all-chord line', () => {
    expect(stripInlineChords('[Ebm7]     [Bbm7]     [Ebm7]')).toBe('');
  });
});

describe('extractStageSheet (ChordPro)', () => {
  const sheet = extractStageSheet(VEHICLE, 'chordpro');

  it('captures metadata', () => {
    expect(sheet.title).toBe('Vehicle');
    expect(sheet.artist).toBe('The Ides of March');
    expect(sheet.key).toBe('F#');
  });

  it('drops chord-only intro lines, keeping only section headers with lyrics', () => {
    const intro = sheet.sections.find((s) => s.header === 'Intro');
    expect(intro).toBeUndefined(); // intro had no lyrics → dropped
  });

  it('keeps section headers and clean lyric lines', () => {
    const verse = sheet.sections.find((s) => s.header === 'Verse 1');
    expect(verse).toBeDefined();
    expect(verse!.lines).toContain("I'm your vehicle baby");
    expect(verse!.lines).toContain("I'll take you anywhere you wanna go");
    expect(verse!.lines).toContain('By now I\'m sure you know');
  });

  it('produces no lines containing chord brackets', () => {
    const all = sheet.sections.flatMap((s) => s.lines).join('\n');
    expect(all).not.toMatch(/\[/);
  });

  it('preserves a paragraph break as an empty line', () => {
    const verse = sheet.sections.find((s) => s.header === 'Verse 1')!;
    expect(verse.lines).toContain('');
    expect(verse.lines).toContain('Great God in heaven, you know I love you');
  });

  it('transposes the displayed key', () => {
    const up = extractStageSheet(VEHICLE, 'chordpro', { transposeSteps: 1, enharmonicPreference: 'sharps' });
    expect(up.key).toBe('G');
  });
});

describe('extractStageSheet (chords-over-words)', () => {
  const COW = `Title Song
Am        G       F
Hello there world below
C            G
Sing it loud now`;
  const sheet = extractStageSheet(COW, 'chords-over-words');

  it('drops standalone chord lines and keeps lyrics', () => {
    const lines = sheet.sections.flatMap((s) => s.lines);
    expect(lines).toContain('Hello there world below');
    expect(lines).toContain('Sing it loud now');
    expect(lines.some((l) => /^Am\s+G\s+F$/.test(l))).toBe(false);
  });
});

describe('extractStageSheet (Ultimate Guitar)', () => {
  const UG = `[Verse 1]
[Am]Walking [G]down the road
[Chorus]
[F]Singing out [C]loud`;
  const sheet = extractStageSheet(UG, 'ultimateguitar');

  it('turns [Section] headers into stage headers', () => {
    const headers = sheet.sections.map((s) => s.header);
    expect(headers).toContain('Verse 1');
    expect(headers).toContain('Chorus');
  });

  it('strips inline chords from UG lyrics', () => {
    const verse = sheet.sections.find((s) => s.header === 'Verse 1')!;
    expect(verse.lines).toContain('Walking down the road');
  });
});

describe('output builders', () => {
  const sheet = extractStageSheet(VEHICLE, 'chordpro');

  it('buildStageHtml embeds title, lyrics and the scroll engine', () => {
    const html = buildStageHtml(sheet, DEFAULT_STAGE_STYLE, { secondsPerLine: 5 });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Vehicle');
    expect(html).toContain('your vehicle baby');
    expect(html).toContain('requestAnimationFrame');
    expect(html).not.toMatch(/\[Ebm7\]/);
  });

  it('buildStagePdf produces a non-empty PDF', () => {
    const pdf = buildStagePdf(sheet, DEFAULT_STAGE_STYLE);
    const out = pdf.output('arraybuffer');
    expect(out.byteLength).toBeGreaterThan(500);
  });
});
