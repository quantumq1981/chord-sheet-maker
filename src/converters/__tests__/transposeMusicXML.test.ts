import { describe, expect, it } from 'vitest';
import { transposeMusicXML } from '../transposeMusicXML';

function compact(xml: string): string {
  return xml.replace(/\s+/g, ' ').trim();
}

describe('transposeMusicXML', () => {
  it('transposes pitched notes by semitones (auto mode uses golden-rule enharmonics)', () => {
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

    // +2 semitones: C→D, F#(semitone 6)→semitone 8 = Ab (auto golden rule)
    const result = transposeMusicXML(xml, 2);
    const oneLine = compact(result.xml);
    expect(oneLine).toContain('<step>D</step><octave>4</octave>');
    expect(oneLine).toContain('<step>A</step><alter>-1</alter><octave>4</octave>');
  });

  it('sharps mode always uses sharp spellings', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch></note>
    </measure>
  </part>
</score-partwise>`;

    // F#(semitone 6) +2 = semitone 8 → G# in sharps mode
    const result = transposeMusicXML(xml, 2, 'sharps');
    const oneLine = compact(result.xml);
    expect(oneLine).toContain('<step>G</step><alter>1</alter><octave>4</octave>');
  });

  it('transposes key signatures and harmony roots/bass (auto mode)', () => {
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

    // +2 semitones: key C→D (fifths 0→2), Bb minor→C minor (root semitone 10+2=0=C),
    // F# bass (semitone 6) +2 = semitone 8 → Ab in auto mode
    const result = transposeMusicXML(xml, 2);
    const oneLine = compact(result.xml);
    expect(oneLine).toContain('<fifths>2</fifths>');
    expect(oneLine).toContain('<root-step>C</root-step>');
    expect(oneLine).toContain('<bass-step>A</bass-step><bass-alter>-1</bass-alter>');
  });

  it('auto mode uses C# (not Db) for minor chord roots at semitone 1', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <harmony>
        <root><root-step>B</root-step></root>
        <kind>minor</kind>
      </harmony>
    </measure>
  </part>
</score-partwise>`;

    // B minor +2 semitones = C# minor (semitone 1, minor context → C#, not Db)
    const result = transposeMusicXML(xml, 2);
    const oneLine = compact(result.xml);
    expect(oneLine).toContain('<root-step>C</root-step><root-alter>1</root-alter>');
  });

  it('auto mode uses Db (not C#) for major chord roots at semitone 1', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <harmony>
        <root><root-step>B</root-step></root>
        <kind>major</kind>
      </harmony>
    </measure>
  </part>
</score-partwise>`;

    // B major +2 semitones = Db major (semitone 1, major context → Db)
    const result = transposeMusicXML(xml, 2);
    const oneLine = compact(result.xml);
    expect(oneLine).toContain('<root-step>D</root-step><root-alter>-1</root-alter>');
  });

  it('returns source unchanged when semitones is zero', () => {
    const xml = '<score-partwise version="4.0"><part-list/></score-partwise>';
    const result = transposeMusicXML(xml, 0);
    expect(result.xml).toBe(xml);
    expect(result.warnings).toEqual([]);
  });
});
