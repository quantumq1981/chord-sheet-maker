// Power Tab v1.x binary file (.ptb) parser → VexTabScore
//
// Format is a serialized C++ object archive (Borland OC-style):
//   "ptab" magic (4) + version (2) + class info table + guitar data +
//   chord diagram data + section/staff/position/note data
//
// Sources: jelmer/ptabtools (C), powertab/powertabeditor (C++)

import type {
  VexTabScore,
  VexTabMeasure,
  VexTabNoteData,
  VexTabPosition,
} from './musicXMLtoVexFlow';

// ─── Public API ───────────────────────────────────────────────────────────────

export function isPowerTabFile(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer);
  return (
    b.length >= 6 &&
    b[0] === 0x70 && b[1] === 0x74 && // 'pt'
    b[2] === 0x61 && b[3] === 0x62    // 'ab'
  );
}

export interface PTBParseResult {
  score: VexTabScore;
  /** MIDI pitch per string, index 0 = highest string (same ordering as VexFlow str=1). */
  tuningMidi: number[];
}

export function ptbToVexTabScore(buffer: ArrayBuffer): PTBParseResult {
  try {
    return parsePtb(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      score: makeEmpty([`Power Tab parse error: ${msg}`]),
      tuningMidi: STANDARD_MIDI,
    };
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────

// Standard EADGBE tuning (index 0 = highest = E4)
const STANDARD_MIDI = [64, 59, 55, 50, 45, 40];

// PTB CPosition.length → VexFlow duration string
const PTB_DUR: Record<number, string> = {
  1: 'w', 2: 'h', 4: 'q', 8: '8', 16: '16', 32: '32',
};

const MIDI_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${MIDI_NAMES[pc]}${oct}`;
}

function makeEmpty(warnings: string[]): VexTabScore {
  return {
    timeSignature: { beats: 4, beatType: 4 },
    measures: [],
    parts: [{ id: '1', name: 'Guitar' }],
    warnings,
  };
}

// ─── Sequential byte reader ───────────────────────────────────────────────────

class ByteReader {
  private b: Uint8Array;
  private v: DataView;
  pos: number;

  constructor(buf: ArrayBuffer) {
    this.b = new Uint8Array(buf);
    this.v = new DataView(buf);
    this.pos = 0;
  }

  get length(): number { return this.b.length; }
  get remaining(): number { return this.b.length - this.pos; }

  u8(): number {
    if (this.pos >= this.b.length) throw new Error('EOF');
    return this.b[this.pos++];
  }

  u16le(): number {
    if (this.pos + 2 > this.b.length) throw new Error('EOF');
    const v = this.v.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  peek16le(): number {
    if (this.pos + 2 > this.b.length) return -1;
    return this.v.getUint16(this.pos, true);
  }

  // Pascal string: 1-byte length prefix + chars
  pascalStr(): string {
    const len = this.u8();
    if (this.pos + len > this.b.length) throw new Error('EOF in string');
    const s = new TextDecoder('utf-8', { fatal: false }).decode(
      this.b.slice(this.pos, this.pos + len),
    );
    this.pos += len;
    return s;
  }

  skip(n: number): void {
    this.pos = Math.min(this.pos + n, this.b.length);
  }
}

// ─── Core parser ─────────────────────────────────────────────────────────────

function parsePtb(buffer: ArrayBuffer): PTBParseResult {
  const r = new ByteReader(buffer);
  const warnings: string[] = [];

  if (!isPowerTabFile(buffer)) {
    return { score: makeEmpty(['Not a Power Tab file']), tuningMidi: STANDARD_MIDI };
  }

  r.pos = 4; // skip "ptab" magic
  const majorVersion = r.u8();
  /* const minorVersion = */ r.u8();

  if (majorVersion !== 1) {
    warnings.push(`Unsupported Power Tab version ${majorVersion}; attempting parse.`);
  }

  // ── 1. Skip class info table ────────────────────────────────────────────────
  // Each entry: 0xFFFF + classId(2 LE) + nameLen(2 LE) + name(nameLen)
  // Table ends when the next 2 bytes are NOT 0xFFFF.
  for (let guard = 0; guard < 200 && r.remaining >= 6; guard++) {
    if (r.peek16le() !== 0xFFFF) break;
    r.skip(2); // 0xFFFF marker
    r.skip(2); // class ID
    const nameLen = r.u16le();
    if (nameLen > 60 || r.remaining < nameLen) break;
    r.skip(nameLen);
  }

  // ── 2. Guitar definitions ───────────────────────────────────────────────────
  if (r.remaining < 1) return { score: makeEmpty(warnings), tuningMidi: STANDARD_MIDI };

  const nrGuitars = r.u8();
  if (nrGuitars === 0 || nrGuitars > 24) {
    warnings.push(`Unexpected guitar count: ${nrGuitars}`);
    return { score: makeEmpty(warnings), tuningMidi: STANDARD_MIDI };
  }

  let tuningMidi: number[] = STANDARD_MIDI;
  const guitarNames: string[] = [];

  for (let g = 0; g < nrGuitars; g++) {
    r.u8();                      // guitar index
    const title = r.pascalStr(); // instrument title
    guitarNames.push(title || `Guitar ${g + 1}`);
    r.u8();                // MIDI instrument
    r.u8();                // capo position
    r.pascalStr();         // instrument type string (e.g. "Acoustic Guitar")
    const nrStrings = r.u8();
    if (nrStrings < 4 || nrStrings > 8 || r.remaining < nrStrings) {
      warnings.push(`Guitar ${g}: invalid string count ${nrStrings}`);
      return { score: makeEmpty(warnings), tuningMidi: STANDARD_MIDI };
    }
    const midiVals = Array.from(new Uint8Array(buffer, r.pos, nrStrings));
    if (g === 0) tuningMidi = midiVals;
    r.skip(nrStrings);
    // PTB v1.x appends 2 extra bytes per guitar (initial transpose + reserved)
    if (r.remaining >= 2) r.skip(2);
  }

  // ── 3. Skip chord diagrams ──────────────────────────────────────────────────
  // Structure: nrDiagrams(1) + each: pascalName + type(1) + topFret(1) + frets[6] + fingers[6]
  if (r.remaining < 1) return finalize(tuningMidi, guitarNames, [], warnings);
  const nrDiags = r.u8();

  if (nrDiags <= 100) {
    for (let cd = 0; cd < nrDiags && r.remaining >= 1; cd++) {
      r.pascalStr(); // chord name
      r.skip(14);   // type(1) + topFret(1) + frets[6](6) + fingers[6](6) = 14
    }
  }
  // If nrDiags looks unreasonable, we fall through and likely fail on section parse

  // ── 4. Parse sections → measures ────────────────────────────────────────────
  if (r.remaining < 1) return finalize(tuningMidi, guitarNames, [], warnings);
  const nrSections = r.u8();

  if (nrSections === 0 || nrSections > 200) {
    warnings.push(`Unexpected section count: ${nrSections}`);
    return finalize(tuningMidi, guitarNames, [], warnings);
  }

  const measures: VexTabMeasure[] = [];

  for (let sec = 0; sec < nrSections && r.remaining >= 4; sec++) {
    // CSection fields:
    //   tempo       (uint16 LE)
    //   beat_value  (uint8)   — denominator of time signature
    //   nr_key_changes (uint8) — number of key-change events (each 2 bytes)
    //   [key changes: each 2 bytes: position(1) + key(1)]
    //   title       (pascal string)
    //   nr_staves   (uint8)
    const tempo  = r.u16le(); // e.g. 120
    void tempo;
    r.u8();                  // beat_value
    const nrKeySig = r.u8();
    if (nrKeySig <= 16) r.skip(nrKeySig * 2);
    r.pascalStr();           // section title / rehearsal mark

    if (r.remaining < 1) break;
    const nrStaves = r.u8();
    if (nrStaves === 0 || nrStaves > 8) {
      warnings.push(`Section ${sec}: unusual stave count ${nrStaves}; stopping.`);
      break;
    }

    for (let st = 0; st < nrStaves && r.remaining >= 2; st++) {
      // CStaff fields:
      //   clef / staff-type (uint8): 0=treble, 1=bass, 2=tab
      //   nr_positions (uint8)
      const staffType  = r.u8();
      void staffType;
      const nrPositions = r.u8();

      if (nrPositions > 200) {
        // Possible extra staff-type byte; back up 1 and re-read
        r.pos -= 1;
        const nrPos2 = r.u8();
        if (nrPos2 > 200) {
          warnings.push(`Section ${sec} staff ${st}: unparseable position count; stopping.`);
          return finalize(tuningMidi, guitarNames, measures, warnings);
        }
        // nrPos2 is the corrected position count (staffType was actually extra byte)
        parseStaffPositions(r, nrPos2, st, measures, warnings);
        continue;
      }

      parseStaffPositions(r, nrPositions, st, measures, warnings);
    }
  }

  return finalize(tuningMidi, guitarNames, measures, warnings);
}

function parseStaffPositions(
  r: ByteReader,
  nrPositions: number,
  staffIndex: number,
  measures: VexTabMeasure[],
  warnings: string[],
): void {
  const measure: VexTabMeasure = { notes: [], chordSymbols: [] };

  for (let p = 0; p < nrPositions && r.remaining >= 8; p++) {
    // CPosition (8 bytes minimum):
    //   offset       (uint8)   — rhythmic position within section
    //   properties   (uint16 LE)
    //   dots         (uint8)   — bit 0 = dotted note
    //   palm_mute    (uint8)
    //   fermata      (uint8)
    //   length       (uint8)   — 1=whole, 2=half, 4=quarter, 8=8th, 16=16th, 32=32nd
    //   nr_extra     (uint8)   — count of 4-byte extra data blocks
    r.u8();                         // offset
    r.u16le();                      // properties
    const dots = r.u8();
    r.u8();                         // palm mute
    r.u8();                         // fermata
    const length     = r.u8();
    const nrExtra    = r.u8();
    if (nrExtra <= 32) r.skip(nrExtra * 4);

    if (r.remaining < 1) break;
    const nrLines = r.u8();

    if (nrLines > 8) {
      warnings.push(`Position ${p}: unexpected line count ${nrLines}`);
      break;
    }

    const positions: VexTabPosition[] = [];

    for (let l = 0; l < nrLines && r.remaining >= 7; l++) {
      // CLineData (7 bytes):
      //   tone     (uint8)   — fret[4:0], string[7:5]
      //   flags    (uint16 LE)
      //   bend     (uint8)
      //   slide    (uint8)
      //   hammer   (uint8)
      //   pull     (uint8)
      const tone   = r.u8();
      r.skip(6); // flags(2) + bend(1) + slide(1) + hammer(1) + pull(1)

      const fret      = tone & 0x1F;         // bits 0–4
      const ptbString = (tone >> 5) & 0x07;  // bits 5–7, 0 = highest string
      const vexString = ptbString + 1;       // VexFlow: 1 = highest string

      if (fret > 24 || ptbString > 7) continue; // sanity-check; skip garbage
      positions.push({ str: vexString, fret });
    }

    const dur      = PTB_DUR[length] ?? 'q';
    const isDotted = (dots & 0x01) !== 0;

    const note: VexTabNoteData = {
      positions: positions.length > 0 ? positions : [{ str: 1, fret: 'x' }],
      duration: isDotted ? `${dur}d` : dur,
      isRest: nrLines === 0,
    };
    measure.notes.push(note);
  }

  // Only keep the first staff (guitar notation) to avoid duplicates from tab staff
  if (staffIndex === 0 && measure.notes.length > 0) {
    measures.push(measure);
  }
}

function finalize(
  tuningMidi: number[],
  guitarNames: string[],
  measures: VexTabMeasure[],
  warnings: string[],
): PTBParseResult {
  return {
    score: {
      timeSignature: { beats: 4, beatType: 4 },
      measures,
      parts: guitarNames.map((name, i) => ({ id: String(i + 1), name })),
      warnings,
    },
    tuningMidi,
  };
}

/** Convert a PTB MIDI tuning array to the note-name strings used by tabTuning state. */
export function ptbTuningToNoteNames(midiValues: number[]): string[] {
  return midiValues.map(midiToNoteName);
}
