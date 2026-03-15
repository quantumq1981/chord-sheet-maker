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

  it('never starts a row with %', () => {
    // 8 bars where row 1 ends with G, row 2 begins with G again
    // Without the fix the second row would start with %; with it, it shows G
    const notes = ['C', 'Am', 'F', 'G', 'G', 'Am', 'F', 'C'];
    const measuresXml = notes.map((note, i) => `
      <measure number="${i + 1}">
        <attributes><divisions>1</divisions></attributes>
        ${harmonyXml(note, 'major')}
      </measure>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">${measuresXml}</part>
</score-partwise>`;
    const { chordPro } = convert(xml, { formatMode: 'fakebook', barsPerLine: 4 });
    const contentRows = chordPro.split('\n').filter(
      (l) => l.trim() && !l.startsWith('Title:') && !l.startsWith('Style:')
             && !l.startsWith('Time:') && !l.startsWith('Key:'),
    );
    for (const row of contentRows) {
      expect(row).not.toMatch(/^%/);
    }
  });

  it('drops ornamental harmonies shorter than 15% of the measure', () => {
    // 3 harmony events in one measure:
    //   C for 7 divisions (43.75%), F# for 1 division (6.25%), G7 for 8 divisions (50%)
    // F# < 15% → filtered; C and G7 are roughly equal → split bar C_G7
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      <harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>7</duration></note>
      <harmony><root><root-step>F</root-step></root><root-alter>1</root-alter><kind>major</kind></harmony>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration></note>
      <harmony><root><root-step>G</root-step></root><kind>dominant</kind></harmony>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration></note>
    </measure>
  </part>
</score-partwise>`;
    const { chordPro } = convert(xml, { formatMode: 'fakebook' });
    expect(chordPro).not.toContain('F#');
    expect(chordPro).toContain('C_G7');
  });

  it('reduces a dominated measure to a single chord when one harmony takes >75%', () => {
    // C for 14 units (87.5%), G7 for 2 units (12.5%) → only C survives
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      <harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>14</duration></note>
      <harmony><root><root-step>G</root-step></root><kind>dominant</kind></harmony>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration></note>
    </measure>
  </part>
</score-partwise>`;
    const { chordPro } = convert(xml, { formatMode: 'fakebook' });
    // G7 is too short to survive as a split; only C
    expect(chordPro).not.toContain('G7');
    expect(chordPro).toContain('C');
  });

  it('exposes fakebookStats in diagnostics', () => {
    const measuresXml = ['C', 'G', 'C'].map((note, i) => `
      <measure number="${i + 1}">
        <attributes><divisions>1</divisions></attributes>
        ${harmonyXml(note, 'major')}
      </measure>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">${measuresXml}</part>
</score-partwise>`;
    const { diagnostics } = convert(xml, { formatMode: 'fakebook' });
    expect(diagnostics.fakebookStats).toBeDefined();
    expect(diagnostics.fakebookStats!.measuresTotal).toBe(3);
    // Bar 1: C (single), bar 2: G (single), bar 3: C (single — prevChord is G, not C)
    expect(diagnostics.fakebookStats!.single).toBe(3);
    expect(diagnostics.fakebookStats!.repeat).toBe(0);
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

// ─── 14. Robustness / compatibility ──────────────────────────────────────────

describe('score-timewise transposition', () => {
  // Minimal score-timewise fixture: 1 measure, 1 part, one harmony event
  const timewiseXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-timewise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Music</part-name></score-part>
  </part-list>
  <measure number="1">
    <part id="P1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <harmony>
        <root><root-step>C</root-step></root>
        <kind>dominant</kind>
      </harmony>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
    </part>
  </measure>
  <measure number="2">
    <part id="P1">
      <harmony>
        <root><root-step>F</root-step></root>
        <kind>major</kind>
      </harmony>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration></note>
    </part>
  </measure>
</score-timewise>`;

  it('converts score-timewise to partwise and extracts chords', () => {
    const { chordPro, warnings, diagnostics } = convert(timewiseXml, { formatMode: 'fakebook' });
    expect(chordPro).toContain('C7');
    expect(chordPro).toContain('F');
    expect(diagnostics.scoreFormat).toBe('timewise-converted');
    expect(warnings.some((w) => w.includes('score-timewise'))).toBe(true);
  });

  it('sets measuresCount correctly after transposition', () => {
    const { diagnostics } = convert(timewiseXml);
    expect(diagnostics.measuresCount).toBe(2);
  });
});

describe('direction/words chord-hint detection', () => {
  const dirWordsXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <direction placement="above">
        <direction-type><words>Bb7</words></direction-type>
      </direction>
      <direction placement="above">
        <direction-type><words>Eb7</words></direction-type>
      </direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
    </measure>
  </part>
</score-partwise>`;

  it('counts direction/words chord hints when no <harmony> elements exist', () => {
    const { diagnostics, warnings } = convert(dirWordsXml);
    expect(diagnostics.directionWordsFound).toBe(2);
    // When inference succeeds, the warning mentions "inferred"; when it fails entirely
    // (e.g. unparseable text), it says "direction/words". Either way, a warning fires.
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('infers chords from direction/words into the chord output', () => {
    const { chordPro, diagnostics } = convert(dirWordsXml, { formatMode: 'fakebook' });
    expect(diagnostics.inferredHarmoniesCount).toBeGreaterThanOrEqual(1);
    expect(chordPro).toMatch(/Bb7|Eb7/);
  });
});

describe('per-part diagnostics', () => {
  it('reports partsInfo with harmony and lyric counts', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Melody</part-name></score-part>
    <score-part id="P2"><part-name>Chords</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration>
        <lyric><text>la</text></lyric>
      </note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${harmonyXml('C', 'major')}
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration></note>
    </measure>
  </part>
</score-partwise>`;
    const { diagnostics } = convert(xml);
    expect(diagnostics.partsInfo).toHaveLength(2);
    const melodyPart = diagnostics.partsInfo!.find((p) => p.id === 'P1');
    const chordPart = diagnostics.partsInfo!.find((p) => p.id === 'P2');
    expect(melodyPart?.lyricCount).toBe(1);
    expect(melodyPart?.harmonyCount).toBe(0);
    expect(chordPart?.harmonyCount).toBe(1);
  });
});

describe('missing root-step warning', () => {
  it('warns when a harmony element has no root-step', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <harmony><kind>dominant</kind></harmony>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
    </measure>
  </part>
</score-partwise>`;
    const { warnings } = convert(xml);
    expect(warnings.some((w) => w.includes('root-step'))).toBe(true);
  });
});

describe('harmoniesCollected diagnostic', () => {
  it('counts total harmony events collected across all measures', () => {
    const measuresXml = ['C', 'F', 'G'].map((note, i) => `
      <measure number="${i + 1}">
        <attributes><divisions>1</divisions></attributes>
        ${harmonyXml(note, 'major')}
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
      </measure>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">${measuresXml}</part>
</score-partwise>`;
    const { diagnostics } = convert(xml);
    expect(diagnostics.harmoniesCollected).toBe(3);
  });
});

// ─── 15. Chord token normalization ───────────────────────────────────────────

/** Build a multi-measure fakebook XML with a given key (fifths) and one chord per measure. */
function fakebookXml(chords: Array<{ step: string; alter?: number; kind: string }>, fifths: number): string {
  const measures = chords.map((c, i) => `
    <measure number="${i + 1}">
      ${i === 0 ? `<attributes><divisions>1</divisions><key><fifths>${fifths}</fifths><mode>major</mode></key></attributes>` : ''}
      ${harmonyXml(c.step, c.kind, undefined, c.alter)}
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
    </measure>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`;
}

describe('enharmonic normalization', () => {
  it('rewrites A# → Bb in a flat key (Bb major, fifths=-2)', () => {
    const xml = fakebookXml([{ step: 'A', alter: 1, kind: 'dominant' }], -2);
    const { chordPro } = convert(xml, { formatMode: 'fakebook', enharmonicStyle: 'flats' });
    expect(chordPro).toContain('Bb7');
    expect(chordPro).not.toContain('A#');
  });

  it('rewrites D# → Eb in a flat key', () => {
    const xml = fakebookXml([{ step: 'D', alter: 1, kind: 'minor-seventh' }], -3);
    const { chordPro } = convert(xml, { formatMode: 'fakebook', enharmonicStyle: 'flats' });
    expect(chordPro).toContain('Ebm7');
  });

  it('preserves Bb when style is flats', () => {
    const xml = fakebookXml([{ step: 'B', alter: -1, kind: 'major' }], -2);
    const { chordPro } = convert(xml, { formatMode: 'fakebook', enharmonicStyle: 'flats' });
    expect(chordPro).toContain('Bb');
  });

  it('rewrites Bb → A# when style is sharps', () => {
    const xml = fakebookXml([{ step: 'B', alter: -1, kind: 'dominant' }], 4);
    const { chordPro } = convert(xml, { formatMode: 'fakebook', enharmonicStyle: 'sharps' });
    expect(chordPro).toContain('A#7');
  });

  it('auto mode uses flats for key with fifths=−2 (Bb major)', () => {
    const xml = fakebookXml([{ step: 'A', alter: 1, kind: 'dominant' }], -2);
    const { chordPro, diagnostics } = convert(xml, { formatMode: 'fakebook', enharmonicStyle: 'auto' });
    expect(chordPro).toContain('Bb7');
    expect(diagnostics.enharmonicStyleApplied).toBe('flats');
  });

  it('auto mode uses sharps for key with fifths=+5 (B major)', () => {
    const xml = fakebookXml([{ step: 'A', alter: 1, kind: 'dominant' }], 5);
    const { chordPro, diagnostics } = convert(xml, { formatMode: 'fakebook', enharmonicStyle: 'auto' });
    expect(chordPro).toContain('A#7');
    expect(diagnostics.enharmonicStyleApplied).toBe('sharps');
  });

  it('normalizes bass note in slash chord (G#/D# → Ab/Eb)', () => {
    // Build XML with a slash chord G#/D#
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>-3</fifths><mode>major</mode></key></attributes>
      <harmony>
        <root><root-step>G</root-step><root-alter>1</root-alter></root>
        <kind>major</kind>
        <bass><bass-step>D</bass-step><bass-alter>1</bass-alter></bass>
      </harmony>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
    </measure>
  </part>
</score-partwise>`;
    const { chordPro } = convert(xml, { formatMode: 'fakebook', enharmonicStyle: 'flats' });
    expect(chordPro).toContain('Ab/Eb');
  });
});

describe('jazz symbol style', () => {
  it('maj7 → Δ7 when jazzSymbols=true', () => {
    const xml = scoreXml(harmonyXml('C', 'major-seventh'));
    const { chordPro } = convert(xml, { formatMode: 'fakebook', jazzSymbols: true });
    expect(chordPro).toContain('CΔ7');
  });

  it('m7b5 → ø7 when jazzSymbols=true', () => {
    const xml = scoreXml(harmonyXml('D', 'half-diminished'));
    const { chordPro } = convert(xml, { formatMode: 'fakebook', jazzSymbols: true });
    expect(chordPro).toContain('Dø7');
  });

  it('dim7 → °7 when jazzSymbols=true', () => {
    const xml = scoreXml(harmonyXml('G', 'diminished-seventh'));
    const { chordPro } = convert(xml, { formatMode: 'fakebook', jazzSymbols: true });
    expect(chordPro).toContain('G°7');
  });

  it('dim → ° when jazzSymbols=true', () => {
    const xml = scoreXml(harmonyXml('F', 'diminished'));
    const { chordPro } = convert(xml, { formatMode: 'fakebook', jazzSymbols: true });
    expect(chordPro).toContain('F°');
  });

  it('no jazz symbol substitution when jazzSymbols=false (default)', () => {
    const xml = scoreXml(harmonyXml('C', 'major-seventh'));
    const { chordPro } = convert(xml, { formatMode: 'fakebook' });
    expect(chordPro).toContain('Cmaj7');
    expect(chordPro).not.toContain('CΔ7');
  });

  it('m(maj7) is the display for major-minor kind (not mmaj7)', () => {
    const xml = scoreXml(harmonyXml('C', 'major-minor'));
    const { chordPro } = convert(xml, { formatMode: 'fakebook' });
    expect(chordPro).toContain('Cm(maj7)');
    expect(chordPro).not.toContain('mmaj7');
  });
});

describe('8-bar phrase grouping', () => {
  /** Build an XML with N identical measures each having one chord. */
  function multiMeasureXml(n: number): string {
    const measures = Array.from({ length: n }, (_, i) => `
      <measure number="${i + 1}">
        ${i === 0 ? '<attributes><divisions>1</divisions></attributes>' : ''}
        ${harmonyXml('C', 'dominant')}
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
      </measure>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`;
  }

  it('inserts blank line after every 8 bars in a 32-bar tune', () => {
    const { chordPro } = convert(multiMeasureXml(32), { formatMode: 'fakebook', barsPerLine: 4 });
    // 32 bars / 8 = 4 sections; 3 inter-section separators expected (not after last section)
    // The output structure: header (Style/Key/blank) then 8 chord rows with 3 blank separators
    const chordSection = chordPro.split('\n').slice(3); // skip header lines
    const blankLines = chordSection.filter((l) => l === '');
    expect(blankLines.length).toBe(3);
  });

  it('does NOT insert phrase separators for a 12-bar tune (12 % 8 ≠ 0)', () => {
    const { chordPro } = convert(multiMeasureXml(12), { formatMode: 'fakebook', barsPerLine: 4 });
    const lines = chordPro.split('\n');
    // Count consecutive blank lines after header — should be at most 1 (the header blank)
    const blankAfterFirstChord = lines.slice(6).filter((l) => l === '');
    expect(blankAfterFirstChord.length).toBe(0);
  });
});

// ─── 16. Malformed XML ────────────────────────────────────────────────────────

describe('error handling', () => {
  it('returns an error string for unparseable XML without throwing', () => {
    const { error, chordPro } = convert('this is not XML at all <<<');
    expect(error).toBeDefined();
    // Still returns a usable (though minimal) ChordPro string.
    expect(chordPro).toBeTruthy();
  });
});
