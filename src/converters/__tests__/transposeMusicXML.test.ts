import { describe, expect, it } from 'vitest';
import { transposeMusicXML } from '../transposeMusicXML';

function compact(xml: string): string {
  return xml.replace(/\s+/g, ' ').trim();
}

describe('transposeMusicXML', () => {
  it('transposes pitched notes by semitones', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <note><pitch><step>C</step><octave>4</octave></pitch></note>
      <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch></note>
    </measure>
  </part>
</score-partwise>`;

    const result = transposeMusicXML(xml, 2);
    const oneLine = compact(result.xml);
    expect(oneLine).toContain('<step>D</step><octave>4</octave>');
    expect(oneLine).toContain('<step>G</step><alter>1</alter><octave>4</octave>');
  });

  it('transposes key signatures and harmony roots/bass', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <key><fifths>0</fifths><mode>major</mode></key>
      </attributes>
      <harmony>
        <root><root-step>B</root-step><root-alter>-1</root-alter></root>
        <kind>minor</kind>
        <bass><bass-step>F</bass-step><bass-alter>1</bass-alter></bass>
      </harmony>
    </measure>
  </part>
</score-partwise>`;
    const result = transposeMusicXML(xml, 2);
    const oneLine = compact(result.xml);
    expect(oneLine).toContain('<fifths>2</fifths>');
    expect(oneLine).toContain('<root-step>C</root-step>');
    expect(oneLine).toContain('<bass-step>G</bass-step><bass-alter>1</bass-alter>');
  });

  it('returns source unchanged when semitones is zero', () => {
    const xml = '<score-partwise version="4.0"><part-list/></score-partwise>';
    const result = transposeMusicXML(xml, 0);
    expect(result.xml).toBe(xml);
    expect(result.warnings).toEqual([]);
  });
});
