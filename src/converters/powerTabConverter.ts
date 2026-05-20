// Power Tab v1.x binary file (.ptb) parser → VexTabScore
//
// PTB uses a Borland OC object-archive format. Each object is introduced by
// either a class-info header (0xFFFF + classId(2) + nameLen(2) + name) the
// first time a class appears, or just a 2-byte class-ID for subsequent uses.
//
// The file layout is roughly:
//   "ptab" magic (4) + version uint16 (2)
//   [CPowerTabFileHeader object: song metadata — Pascal strings, key, tempo …]
//   [CGuitarScore/CBassScore object:]
//     nrGuitars(1) + [CGuitar …] × nrGuitars
//     nrChordDiagrams(1) + [CChordDiagram …] × nrChordDiagrams
//     nrSections(1) + [CSection …] × nrSections
//       [CStaff …] × nrStaves
//         [CPosition …] × nrPositions
//           [CLineData …] × nrLines
//
// Strategy: scan the entire file for 0xFFFF class-info markers; use their
// positions as anchors rather than trying to navigate from a fixed offset.
//
// Sources: jelmer/ptabtools (C), powertab/powertabeditor (C++)

import type {
  VexTabScore,
  VexTabMeasure,
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

// ─── Class-info scanner ───────────────────────────────────────────────────────

interface ClassInfo {
  /** Byte offset of the 0xFFFF marker. */
  markerPos: number;
  /** 2-byte class ID assigned by the writer. */
  classId: number;
  name: string;
  /** Byte offset immediately after the class name (= start of the object's data). */
  dataStart: number;
}

/**
 * Scan the entire buffer for Borland OC class-info records:
 *   0xFFFF (2) + classId (2 LE) + nameLen (2 LE) + name (nameLen)
 *
 * Returns them ordered by file position. Also handles 1-byte Pascal nameLen
 * as a fallback (some PTB revisions use a Pascal-string length prefix).
 */
function scanClassInfos(bytes: Uint8Array, view: DataView): ClassInfo[] {
  const results: ClassInfo[] = [];

  for (let i = 6; i + 6 < bytes.length; i++) {
    if (view.getUint16(i, true) !== 0xFFFF) continue;

    // Try 2-byte nameLen first (the documented layout)
    const classId2 = view.getUint16(i + 2, true);
    const nameLen2 = view.getUint16(i + 4, true);
    if (nameLen2 >= 1 && nameLen2 <= 40 && i + 6 + nameLen2 <= bytes.length) {
      const nameBytes = bytes.subarray(i + 6, i + 6 + nameLen2);
      if (looksLikePtbClassName(nameBytes)) {
        const name = new TextDecoder('utf-8', { fatal: false }).decode(nameBytes);
        results.push({ markerPos: i, classId: classId2, name, dataStart: i + 6 + nameLen2 });
        i += 5 + nameLen2; // advance past this header
        continue;
      }
    }

    // Fallback: 1-byte Pascal nameLen (some files / revisions)
    const nameLen1 = bytes[i + 4];
    if (nameLen1 >= 1 && nameLen1 <= 40 && i + 5 + nameLen1 <= bytes.length) {
      const nameBytes = bytes.subarray(i + 5, i + 5 + nameLen1);
      if (looksLikePtbClassName(nameBytes)) {
        const name = new TextDecoder('utf-8', { fatal: false }).decode(nameBytes);
        const classId1 = view.getUint16(i + 2, true);
        results.push({ markerPos: i, classId: classId1, name, dataStart: i + 5 + nameLen1 });
        i += 4 + nameLen1;
        continue;
      }
    }
  }

  return results;
}

/** PTB class names start with 'C' and contain only ASCII letters. */
function looksLikePtbClassName(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes[0] !== 0x43 /* 'C' */) return false;
  return bytes.every(b => (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a));
}

// ─── Sequential byte reader ───────────────────────────────────────────────────

class ByteReader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  pos: number;
  /** classId → class name, populated as 0xFFFF headers are consumed. */
  classReg: Map<number, string>;

  constructor(buf: ArrayBuffer, startPos = 0, classReg?: Map<number, string>) {
    this.bytes = new Uint8Array(buf);
    this.view = new DataView(buf);
    this.pos = startPos;
    this.classReg = classReg ?? new Map();
  }

  get remaining(): number { return this.bytes.length - this.pos; }

  u8(): number {
    if (this.pos >= this.bytes.length) throw new Error('PTB EOF');
    return this.bytes[this.pos++];
  }

  u16le(): number {
    if (this.pos + 2 > this.bytes.length) throw new Error('PTB EOF');
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  peek16le(): number {
    if (this.pos + 2 > this.bytes.length) return -1;
    return this.view.getUint16(this.pos, true);
  }

  // Pascal string: 1-byte length + chars
  pascalStr(): string {
    const len = this.u8();
    if (this.pos + len > this.bytes.length) throw new Error('PTB EOF in string');
    const s = new TextDecoder('utf-8', { fatal: false }).decode(
      this.bytes.slice(this.pos, this.pos + len),
    );
    this.pos += len;
    return s;
  }

  skip(n: number): void {
    this.pos = Math.min(this.pos + n, this.bytes.length);
  }

  /**
   * Read a class-object tag.  Returns the class name or null for a null ref.
   * Advances the cursor past the tag (and class-info header when 0xFFFF).
   */
  readTag(): string | null {
    const tag = this.u16le();
    if (tag === 0x0000) return null;

    if (tag === 0xFFFF) {
      // New class definition: classId(2) + nameLen(2) + name
      const classId = this.u16le();
      const nameLen = this.u16le();
      if (nameLen === 0 || nameLen > 50 || this.pos + nameLen > this.bytes.length) {
        throw new Error(`Invalid class name length ${nameLen}`);
      }
      const name = new TextDecoder('utf-8', { fatal: false }).decode(
        this.bytes.slice(this.pos, this.pos + nameLen),
      );
      this.pos += nameLen;
      this.classReg.set(classId, name);
      return name;
    }

    // Back-reference: tag IS the class ID
    return this.classReg.get(tag) ?? null;
  }
}

// ─── Core parser ─────────────────────────────────────────────────────────────

function parsePtb(buffer: ArrayBuffer): PTBParseResult {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const warnings: string[] = [];

  if (!isPowerTabFile(buffer)) {
    return { score: makeEmpty(['Not a Power Tab file']), tuningMidi: STANDARD_MIDI };
  }

  // Scan every 0xFFFF class-info marker in the file
  const classInfos = scanClassInfos(bytes, view);

  // Build class ID → name registry (needed for back-reference tags)
  const classReg = new Map<number, string>();
  for (const ci of classInfos) classReg.set(ci.classId, ci.name);

  // Helper: find the first class-info record with a given name
  const findClass = (name: string) => classInfos.find(c => c.name === name);

  // ── Extract guitar tuning ─────────────────────────────────────────────────
  let tuningMidi: number[] = STANDARD_MIDI;
  const guitarNames: string[] = ['Guitar'];

  const guitarCI = findClass('CGuitar');
  if (guitarCI) {
    // The byte immediately before the 0xFFFF marker is the guitar count.
    // The first guitar's data starts at guitarCI.dataStart.
    try {
      const r = new ByteReader(buffer, guitarCI.dataStart, new Map(classReg));
      r.u8();            // guitar index
      const title = r.pascalStr();
      if (title) guitarNames[0] = title;
      r.u8();            // MIDI instrument
      r.u8();            // capo
      r.pascalStr();     // instrument type string
      const nrStrings = r.u8();
      if (nrStrings >= 4 && nrStrings <= 8 && r.remaining >= nrStrings) {
        tuningMidi = Array.from(bytes.slice(r.pos, r.pos + nrStrings));
      }
    } catch {
      warnings.push('Could not parse guitar tuning; using standard EADGBE.');
    }
  } else {
    // Fallback: heuristic MIDI string scan
    const found = heuristicTuningScan(bytes);
    if (found) tuningMidi = found;
  }

  // ── Extract note data ─────────────────────────────────────────────────────
  // Strategy: find the first CSection class-info marker and the nrSections
  // byte (the byte immediately before the CSection 0xFFFF marker), then parse
  // sequentially using the full class-registry for back-references.

  const sectionCI = findClass('CSection');
  if (!sectionCI) {
    warnings.push('No section data found in Power Tab file.');
    return finalize(tuningMidi, guitarNames, [], warnings);
  }

  // nrSections is 1 byte before the CSection 0xFFFF marker
  const nrSections = bytes[sectionCI.markerPos - 1];
  if (nrSections === 0 || nrSections > 200) {
    warnings.push(`Cannot determine section count (byte=${nrSections}); no notes extracted.`);
    return finalize(tuningMidi, guitarNames, [], warnings);
  }

  // Sequential parse starting from the first CSection's 0xFFFF marker
  const r = new ByteReader(buffer, sectionCI.markerPos, new Map(classReg));
  const measures: VexTabMeasure[] = [];

  try {
    for (let sec = 0; sec < nrSections; sec++) {
      const tag = r.readTag();
      if (tag !== 'CSection') break;
      parseSectionBody(r, measures, warnings);
    }
  } catch {
    // Partial parse — return whatever we collected
    if (measures.length === 0) {
      warnings.push('Note data could not be parsed; tuning is available.');
    }
  }

  return finalize(tuningMidi, guitarNames, measures, warnings);
}

// ─── Section / staff / position parsers ──────────────────────────────────────

function parseSectionBody(r: ByteReader, measures: VexTabMeasure[], warnings: string[]): void {
  // CSection fields:
  //   tempo        (uint16 LE)
  //   beat_value   (uint8)   — time-sig denominator
  //   nr_key_changes (uint8) — each 2 bytes
  //   title        (pascal string)
  //   nr_staves    (uint8)
  r.u16le();            // tempo
  r.u8();               // beat_value
  const nrKey = r.u8();
  if (nrKey <= 16) r.skip(nrKey * 2);
  r.pascalStr();        // section title

  const nrStaves = r.u8();
  if (nrStaves === 0 || nrStaves > 8) return;

  for (let st = 0; st < nrStaves; st++) {
    const tag = r.readTag();
    if (tag !== 'CStaff') break;
    parseStaffBody(r, st, measures, warnings);
  }
}

function parseStaffBody(
  r: ByteReader,
  staffIndex: number,
  measures: VexTabMeasure[],
  warnings: string[],
): void {
  // CStaff fields:
  //   clef / staff-type (uint8)
  //   nr_positions (uint8)
  r.u8();                         // staff type / clef
  const nrPositions = r.u8();

  if (nrPositions === 0 || nrPositions > 250) return;

  const measure: VexTabMeasure = { notes: [], chordSymbols: [] };

  for (let p = 0; p < nrPositions; p++) {
    const tag = r.readTag();
    if (tag !== 'CPosition') break;
    parsePositionBody(r, measure, warnings);
  }

  // Only keep the first staff per section (avoids duplicating notation+tab
  // staves when both are present in one section)
  if (staffIndex === 0 && measure.notes.length > 0) {
    measures.push(measure);
  }
}

function parsePositionBody(r: ByteReader, measure: VexTabMeasure, warnings: string[]): void {
  // CPosition (8 bytes minimum):
  //   offset       (uint8)
  //   properties   (uint16 LE)
  //   dots         (uint8)  — bit 0 = dotted
  //   palm_mute    (uint8)
  //   fermata      (uint8)
  //   length       (uint8)  — 1=whole 2=half 4=quarter 8=8th 16=16th 32=32nd
  //   nr_extra     (uint8)  — count of 4-byte extra-data blocks
  r.u8();                  // offset
  r.u16le();               // properties
  const dots   = r.u8();
  r.u8();                  // palm mute
  r.u8();                  // fermata
  const length = r.u8();
  const nrExtra = r.u8();
  if (nrExtra <= 32) r.skip(nrExtra * 4);

  const nrLines = r.u8();
  if (nrLines > 8) {
    warnings.push(`CPosition: unusual line count ${nrLines}`);
    return;
  }

  const positions: VexTabPosition[] = [];

  for (let l = 0; l < nrLines; l++) {
    const tag = r.readTag();
    if (tag !== 'CLineData') break;

    // CLineData (7 bytes):
    //   tone   (uint8) — fret[4:0], string[7:5]
    //   flags  (uint16 LE)
    //   bend   (uint8)
    //   slide  (uint8)
    //   hammer (uint8)
    //   pull   (uint8)
    const tone = r.u8();
    r.skip(6); // flags(2) + bend(1) + slide(1) + hammer(1) + pull(1)

    const fret      = tone & 0x1F;         // bits 0–4
    const ptbString = (tone >> 5) & 0x07;  // bits 5–7, 0 = highest string
    const vexString = ptbString + 1;       // VexFlow: 1 = highest

    if (fret <= 24 && ptbString <= 7) {
      positions.push({ str: vexString, fret });
    }
  }

  const dur      = PTB_DUR[length] ?? 'q';
  const isDotted = (dots & 0x01) !== 0;

  measure.notes.push({
    positions: positions.length > 0 ? positions : [{ str: 1, fret: 'x' }],
    duration: isDotted ? `${dur}d` : dur,
    isRest: nrLines === 0,
  });
}

// ─── Heuristic tuning scan ───────────────────────────────────────────────────

/**
 * Scan for a sequence of 4-8 bytes that look like guitar MIDI string values:
 * - All in range [33, 76] (open G1 → high C5 — generous guitar range)
 * - Strictly monotonically decreasing (highest to lowest string)
 * - Plausible intervals (adjacent strings differ by 3–6 semitones)
 */
function heuristicTuningScan(bytes: Uint8Array): number[] | null {
  for (let i = 6; i < bytes.length - 8; i++) {
    for (let nStr = 6; nStr >= 4; nStr--) {
      if (i + nStr > bytes.length) continue;
      const vals = Array.from(bytes.subarray(i, i + nStr));
      if (!vals.every(v => v >= 33 && v <= 76)) continue;
      // Strictly decreasing
      let ok = true;
      for (let j = 1; j < vals.length; j++) {
        const diff = vals[j - 1] - vals[j];
        if (diff < 3 || diff > 7) { ok = false; break; }
      }
      if (ok) return vals;
    }
  }
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
