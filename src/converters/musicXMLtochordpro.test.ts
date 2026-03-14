import { describe, expect, it, vi } from 'vitest';

import { convertMusicXmlToChordPro } from './musicXMLtochordpro';
import { parseChordPro } from '../parsers/chordProParser';

function makeMusicXml({
  title = 'Fixture Song',
  kind = 'major',
  kindText,
  includeLyrics = true,
  includeHarmony = true,
  lyricText = 'Hello',
}: {
  title?: string;
  kind?: string;
  kindText?: string;
  includeLyrics?: boolean;
  includeHarmony?: boolean;
  lyricText?: string;
} = {}): string {
  const kindTextAttr = kindText ? ` text="${kindText}"` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>${title}</work-title></work>
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      ${includeHarmony ? `<harmony>
        <root><root-step>C</root-step></root>
        <kind${kindTextAttr}>${kind}</kind>
      </harmony>` : ''}
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
        ${includeLyrics ? `<lyric number="1"><text>${lyricText}</text></lyric>` : ''}
      </note>
    </measure>
  </part>
</score-partwise>`;
}

describe('convertMusicXmlToChordPro fixtures', () => {
  it('converts a basic major chord with lyrics-inline output', () => {
    const output = convertMusicXmlToChordPro(
      { xmlText: makeMusicXml() },
      { metadataPolicy: 'omit' }
    );

    expect(output.error).toBeUndefined();
    expect(output.chordPro).toContain('[C]Hello');
    expect(output.warnings).toEqual([]);
  });

  it('uses kind text override when available', () => {
    const output = convertMusicXmlToChordPro(
      { xmlText: makeMusicXml({ kind: 'major-seventh', kindText: 'Δ7' }) },
      { metadataPolicy: 'omit' }
    );

    expect(output.chordPro).toContain('[CΔ7]Hello');
  });

  it('falls back and warns for unknown chord kinds without leaking raw XML value', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const output = convertMusicXmlToChordPro(
      { xmlText: makeMusicXml({ kind: 'mystery-kind' }) },
      { metadataPolicy: 'omit' }
    );

    expect(output.chordPro).toContain('[C]Hello');
    expect(output.chordPro).not.toContain('mystery-kind');
    expect(output.warnings).toContain("unknown chord kind 'mystery-kind' defaulted to major");
    expect(warnSpy).toHaveBeenCalledWith(
      "[musicXMLtochordpro] unknown chord kind 'mystery-kind' defaulted to major"
    );

    warnSpy.mockRestore();
  });

  it('renders grid-only when lyrics are missing', () => {
    const output = convertMusicXmlToChordPro(
      { xmlText: makeMusicXml({ includeLyrics: false }) },
      { formatMode: 'grid-only', metadataPolicy: 'omit' }
    );

    expect(output.chordPro).toContain('{start_of_grid}');
    expect(output.chordPro).toContain('[C]');
  });
});

describe('parseChordPro fixtures', () => {
  it('parses inline chord + lyric tokens', () => {
    const doc = parseChordPro('{title: Demo}\n[C]Hello [G]world');

    expect(doc.title).toBe('Demo');
    expect(doc.sections[0].lines[0].tokens).toEqual([
      { kind: 'chord', text: 'C' },
      { kind: 'lyric', text: 'Hello ' },
      { kind: 'chord', text: 'G' },
      { kind: 'lyric', text: 'world' },
    ]);
  });

  it('parses explicit section directives and comments', () => {
    const doc = parseChordPro(
      '{start_of_chorus: Hook}\n{comment: Sing loudly}\n[F]Go\n{end_of_chorus}'
    );

    expect(doc.sections[0].type).toBe('chorus');
    expect(doc.sections[0].label).toBe('Hook');
    expect(doc.sections[0].lines[0].tokens[0]).toEqual({ kind: 'comment', text: 'Sing loudly' });
    expect(doc.sections[0].lines[1].tokens[0]).toEqual({ kind: 'chord', text: 'F' });
  });

  it('parses UG-style section headers', () => {
    const doc = parseChordPro('[Verse 1]\n[Am]Line one');

    expect(doc.sections[0].type).toBe('verse');
    expect(doc.sections[0].label).toBe('Verse 1');
    expect(doc.sections[0].lines[0].tokens[0]).toEqual({ kind: 'chord', text: 'Am' });
  });
});
