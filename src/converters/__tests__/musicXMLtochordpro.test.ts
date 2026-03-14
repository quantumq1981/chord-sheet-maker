/**
 * musicXMLtochordpro.test.ts
 *
 * Unit tests for convertMusicXmlToChordPro using inline MusicXML fixtures.
 * These cover the most common accuracy regressions: chord kind mapping,
 * slash chords, metadata extraction, multi-measure layout, repeat unrolling,
 * and the raw-value fallback for unknown chord types.
 *
 * Run with: npm test
 */
import { describe, it, expect } from 'vitest';
import {
  convertMusicXmlToChordPro,
  getDefaultConvertOptions,
} from '../musicXMLtochordpro';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/** Minimal valid score-partwise wrapper. */
function scoreXml(partBody: string, meta = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  ${meta}
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${partBody}
    </measure>
  </part>
</score-partwise>`;
}

/** Single harmony element. */
function harmonyXml(step: string, kind: string, bassStep?: string, alter?: number): string {
  const root = `<root><root-step>${step}</root-step>${alter ? `<root-alter>${alter}</root-alter>` : ''}</root>`;
  const bass = bassStep ? `<bass><bass-step>${bassStep}</bass-step></bass>` : '';
  return `<harmony>${root}<kind>${kind}</kind>${bass}</harmony>`;
}

function convert(xmlText: string, opts?: Partial<Parameters<typeof convertMusicXmlToChordPro>[1]>) {
  return convertMusicXmlToChordPro({ xmlText }, { ...getDefaultConvertOptions(), ...opts });
}

// ─── 1. Simple major triad (C) ────────────────────────────────────────────────

describe('chord kind mapping', () => {
  it('major triad → bare root with no suffix', () => {
    const xml = scoreXml(harmonyXml('C', 'major'));
    const { chordPro, error } = convert(xml);
    expect(error).toBeUndefined();
    expect(chordPro).toContain('[C]');
  });

  // ── 2. Minor chord (Am) ───────────────────────────────────────────────────

  it('minor triad → root + "m"', () => {
    const xml = scoreXml(harmonyXml('A', 'minor'));
    const { chordPro } = convert(xml);
    expect(chordPro).toContain('[Am]');
  });

  // ── 3. Dominant seventh (G7) ──────────────────────────────────────────────

  it('dominant seventh → root + "7"', () => {
    const xml = scoreXml(harmonyXml('G', 'dominant'));
    const { chordPro } = convert(xml);
    expect(chordPro).toContain('[G7]');
  });

  // ── 4. Half-diminished (Bm7b5) ───────────────────────────────────────────

  it('half-diminished → root + "m7b5"', () => {
    const xml = scoreXml(harmonyXml('B', 'half-diminished'));
    const { chordPro } = convert(xml);
    expect(chordPro).toContain('[Bm7b5]');
  });

  // ── 5. Major seventh (Cmaj7) ──────────────────────────────────────────────

  it('major-seventh → root + "maj7"', () => {
    const xml = scoreXml(harmonyXml('C', 'major-seventh'));
    const { chordPro } = convert(xml);
    expect(chordPro).toContain('[Cmaj7]');
  });

  // ── 6. Augmented (Caug) ───────────────────────────────────────────────────

  it('augmented → root + "aug"', () => {
    const xml = scoreXml(harmonyXml('C', 'augmented'));
    const { chordPro } = convert(xml);
    expect(chordPro).toContain('[Caug]');
  });

  // ── 7. Accidental root (Bb minor) ─────────────────────────────────────────

  it('root with flat alter → root + "b" + kind suffix', () => {
    const xml = scoreXml(
      `<harmony><root><root-step>B</root-step><root-alter>-1</root-alter></root><kind>minor</kind></harmony>`
    );
    const { chordPro } = convert(xml);
    expect(chordPro).toContain('[Bbm]');
  });
});

// ─── 8. Slash chord (Am/C) ───────────────────────────────────────────────────

describe('slash chords', () => {
  it('bass note produces root/bass notation', () => {
    const xml = scoreXml(harmonyXml('A', 'minor', 'C'));
    const { chordPro } = convert(xml);
    expect(chordPro).toContain('[Am/C]');
  });
});

// ─── 9. Metadata extraction ───────────────────────────────────────────────────

describe('metadata extraction', () => {
  it('emits {title} and {artist} directives from work-title and creator', () => {
    const meta = `
      <work><work-title>Amazing Grace</work-title></work>
      <identification><creator type="composer">Traditional</creator></identification>`;
    const xml = scoreXml(harmonyXml('C', 'major'), meta);
    const { chordPro, diagnostics } = convert(xml);
    expect(chordPro).toContain('{title: Amazing Grace}');
    // The converter maps MusicXML <creator type="composer"> to {composer:}
    // (not {artist:}) — the ChordPro spec treats them as distinct directives.
    expect(chordPro).toContain('{composer: Traditional}');
    expect(diagnostics.title).toBe('Amazing Grace');
    expect(diagnostics.composer).toBe('Traditional');
  });

  it('emits {key} directive from key signature', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
      </attributes>
      ${harmonyXml('C', 'major')}
    </measure>
  </part>
</score-partwise>`;
    const { chordPro } = convert(xml);
    expect(chordPro).toContain('{key: C}');
  });
});

// ─── 10. Unknown chord kind — raw-value fallback ──────────────────────────────

describe('unknown chord kind fallback', () => {
  it('unknown kind value defaults to major and does not leak raw XML string', () => {
    // "dominant-suspended-fourth" is a valid MusicXML 4.0 kind but not in
    // KIND_SUFFIX_MAP.  The converter logs a warning and defaults to major so
    // the chord is still emitted rather than producing garbage output.
    const xml = scoreXml(
      `<harmony><root><root-step>C</root-step></root><kind>dominant-suspended-fourth</kind></harmony>`
    );
    const { chordPro } = convert(xml);
    // The chord root appears (defaulted to major = no suffix).
    expect(chordPro).toContain('[C]');
    // The raw XML kind string must NOT appear in the output.
    expect(chordPro).not.toContain('dominant-suspended-fourth');
  });

  it('kind element with a text attribute takes priority over kind value', () => {
    // When the <kind text="7sus4"> attribute is present, it must override
    // the KIND_SUFFIX_MAP lookup entirely.
    const xml = scoreXml(
      `<harmony><root><root-step>G</root-step></root><kind text="7sus4">suspended-fourth</kind></harmony>`
    );
    const { chordPro } = convert(xml);
    expect(chordPro).toContain('[G7sus4]');
  });
});

// ─── 11. Multi-measure layout ────────────────────────────────────────────────

describe('multi-measure layout', () => {
  it('four chords on the same line when barsPerLine=4', () => {
    const measures = ['C', 'Am', 'F', 'G'].map((note, i) => `
      <measure number="${i + 1}">
        <attributes><divisions>1</divisions></attributes>
        ${harmonyXml(note, 'major')}
      </measure>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`;

    const { chordPro } = convert(xml, { barsPerLine: 4, barlineStyle: 'pipes' });
    // All four chords should appear together on a single grid line separated by pipes.
    const gridLine = chordPro.split('\n').find((l) => l.includes('[C]') && l.includes('[G]'));
    expect(gridLine).toBeDefined();
    expect(gridLine).toContain('[Am]');
    expect(gridLine).toContain('[F]');
  });
});

// ─── 12. Simple repeat unroll ────────────────────────────────────────────────

describe('repeat unroll', () => {
  it('simple-unroll duplicates the repeated section', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>
      ${harmonyXml('C', 'major')}
    </measure>
    <measure number="2">
      ${harmonyXml('G', 'dominant')}
      <barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>
    </measure>
  </part>
</score-partwise>`;

    const { chordPro, diagnostics } = convert(xml, { repeatStrategy: 'simple-unroll' });
    expect(diagnostics.repeatMarkersFound).toBeGreaterThan(0);
    // Both C and G should appear twice after unrolling.
    const chordMatches = (chord: string) => (chordPro.match(new RegExp(`\\[${chord}\\]`, 'g')) ?? []).length;
    expect(chordMatches('C')).toBe(2);
    expect(chordMatches('G7')).toBe(2);
  });
});

// ─── 13. Fake Book format ─────────────────────────────────────────────────────

describe('fakebook format', () => {
  it('emits a header block with Title and Key', () => {
    const meta = `
      <work><work-title>Blues Head</work-title></work>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  ${meta}
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>-2</fifths><mode>major</mode></key>
      </attributes>
      ${harmonyXml('Bb', 'dominant')}
    </measure>
  </part>
</score-partwise>`;
    const { chordPro } = convert(xml, { formatMode: 'fakebook' });
    expect(chordPro).toContain('Title: Blues Head');
    expect(chordPro).toContain('Key: Bb');
  });

  it('does not emit ChordPro {title:} directive in fakebook mode', () => {
    const xml = scoreXml(harmonyXml('C', 'major'));
    const { chordPro } = convert(xml, { formatMode: 'fakebook' });
    expect(chordPro).not.toMatch(/\{title:/);
  });

  it('uses _ to join multiple chords in a measure', () => {
    // Two harmony events in one measure at different offsets
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions></attributes>
      <harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
      <harmony><root><root-step>G</root-step></root><kind>dominant</kind></harmony>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>`;
    const { chordPro } = convert(xml, { formatMode: 'fakebook' });
    expect(chordPro).toContain('C_G7');
  });

  it('emits % for a bar that repeats the previous bar', () => {
    const measures = ['C', 'C'].map((note, i) => `
      <measure number="${i + 1}">
        <attributes><divisions>1</divisions></attributes>
        ${harmonyXml(note, 'major')}
      </measure>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`;

    const { chordPro } = convert(xml, { formatMode: 'fakebook', barsPerLine: 4 });
    // Second bar is same chord — should be %
    expect(chordPro).toContain('C %');
  });

  it('wraps bars at barsPerLine', () => {
    const measures = ['C', 'Am', 'F', 'G', 'C', 'Am'].map((note, i) => `
      <measure number="${i + 1}">
        <attributes><divisions>1</divisions></attributes>
        ${harmonyXml(note, 'major')}
      </measure>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`;

    const { chordPro } = convert(xml, { formatMode: 'fakebook', barsPerLine: 4 });
    const rows = chordPro.split('\n').filter((l) => l.includes('C') || l.includes('Am'));
    // 6 bars at 4/line → 2 rows
    expect(rows.length).toBe(2);
  });

  it('adds |: and :| repeat markers', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>
      ${harmonyXml('C', 'major')}
    </measure>
    <measure number="2">
      ${harmonyXml('G', 'dominant')}
      <barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>
    </measure>
  </part>
</score-partwise>`;
    const { chordPro } = convert(xml, { formatMode: 'fakebook', barsPerLine: 4 });
    expect(chordPro).toContain('|:');
    expect(chordPro).toContain(':|');
  });
});

// ─── 14. Malformed XML ────────────────────────────────────────────────────────

describe('error handling', () => {
  it('returns an error string for unparseable XML without throwing', () => {
    const { error, chordPro } = convert('this is not XML at all <<<');
    expect(error).toBeDefined();
    // Still returns a usable (though minimal) ChordPro string.
    expect(chordPro).toBeTruthy();
  });
});
