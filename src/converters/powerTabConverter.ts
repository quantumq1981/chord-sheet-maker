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

  u32le(): number {
    if (this.pos + 4 > this.bytes.length) throw new Error('PTB EOF');
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
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

  /**
   * MFC-style variable-length string (PowerTabInputStream::ReadMFCString):
   * ReadMFCStringLength reads 1 byte; if < 0xff return it; else read 2 more
   * bytes; if < 0xffff return; else read 4 more bytes and return.
   * Then reads that many chars.
   */
  readMfcString(): string {
    const b0 = this.u8();
    let len: number;
    if (b0 < 0xff) {
      len = b0;
    } else {
      const b12 = this.u16le();
      len = b12 < 0xffff ? b12 : this.u32le();
    }
    if (len === 0) return '';
    if (this.pos + len > this.bytes.length) throw new Error('PTB EOF in MFC string');
    const s = new TextDecoder('latin1', { fatal: false }).decode(
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
    // Guitar::Deserialize layout (from PowerTabEditor source):
    //   m_number (uint8) + ReadMFCString(m_description)
    //   + m_preset+m_initialVolume+m_pan+m_reverb+m_chorus+m_tremolo+m_phaser+m_capo (8 × uint8)
    //   + Tuning::Deserialize: ReadMFCString(name) + m_data(uint8)
    //     + ReadSmallVector(m_noteArray): count(uint8) + count MIDI bytes
    try {
      const r = new ByteReader(buffer, guitarCI.dataStart, new Map(classReg));
      r.u8();                    // m_number (guitar index)
      const desc = r.readMfcString();
      if (desc) guitarNames[0] = desc;
      r.skip(8);                 // m_preset…m_capo (8 × uint8)
      r.readMfcString();         // Tuning::m_name
      r.u8();                    // Tuning::m_data (capo/sharps flags)
      const nrStrings = r.u8();  // ReadSmallVector count
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
  // Strategy:
  //  1. Find the first CSection class-info marker.
  //  2. Determine nrSections from the bytes just before that marker.
  //     PTB files store counts as either uint8 OR uint16-LE depending on
  //     version; when bytes[markerPos-1] == 0, the count is in
  //     bytes[markerPos-2] (low byte of a uint16-LE pair).
  //  3. Parse sequentially using the class-ID registry.
  //  4. If the sequential parse yields nothing (struct offsets wrong for this
  //     file version), fall back to a linear class-ID scan of the whole file.

  const sectionCI = findClass('CSystem') ?? findClass('CSection');
  if (!sectionCI) {
    warnings.push('No section data found in Power Tab file.');
    return finalize(tuningMidi, guitarNames, [], warnings);
  }

  // Read nrSections: try 1 byte back, then 2 bytes back for uint16-LE files.
  const nrSections = readCountBefore(bytes, sectionCI.markerPos);
  if (nrSections === 0) {
    warnings.push('Cannot determine section count; falling back to note scan.');
  }

  // Sequential parse starting from the first CSection's 0xFFFF marker
  const r = new ByteReader(buffer, sectionCI.markerPos, new Map(classReg));
  const measures: VexTabMeasure[] = [];

  if (nrSections > 0) {
    try {
      for (let sec = 0; sec < nrSections; sec++) {
        const tag = r.readTag();
        if (tag !== 'CSection') break;
        parseSectionBody(r, measures, warnings);
      }
    } catch {
      // partial — fall through to fallback if empty
    }
  }

  // Fallback: sequential parse starting from the first CPosition's 0xFFFF marker
  if (measures.length === 0) {
    const posCI = findClass('CPosition');
    if (posCI) {
      sequentialNoteFallback(buffer, posCI, classReg, measures);
    }
    if (measures.length === 0) {
      warnings.push('Note data could not be parsed; tuning is available.');
    }
  }

  return finalize(tuningMidi, guitarNames, measures, warnings);
}

// ─── Count-byte helpers ───────────────────────────────────────────────────────

/**
 * Read the count stored immediately before a class-info 0xFFFF marker.
 * PTB files may store counts as uint8 OR uint16-LE depending on version.
 *
 * - If bytes[markerPos-1] is in [1, 200] → that IS the count (uint8).
 * - If bytes[markerPos-1] == 0 and bytes[markerPos-2] is in [1, 200]
 *   → the count is uint16-LE: low byte at markerPos-2, high byte = 0.
 * - Otherwise return 0 (unknown).
 */
function readCountBefore(bytes: Uint8Array, markerPos: number): number {
  if (markerPos < 1) return 0;
  const lo = bytes[markerPos - 1];
  if (lo >= 1 && lo <= 200) return lo;
  if (lo === 0 && markerPos >= 2) {
    const prev = bytes[markerPos - 2];
    if (prev >= 1 && prev <= 200) return prev;
  }
  return 0;
}

// ─── Fallback: sequential parse from first CPosition ─────────────────────────

/**
 * When the structural parse (CSection → CStaff → CPosition chain) fails,
 * start from the first CPosition's guaranteed-valid 0xFFFF class-info marker
 * and read tags sequentially, grouping every MEASURE_SIZE positions into a
 * synthetic VexTabMeasure.
 *
 * Starting at posCI.markerPos avoids the false-positive matches that arise
 * when scanning from byte 0 — random bytes in the binary header can match
 * 2-byte class IDs and produce hundreds of empty ghost positions.
 */
function sequentialNoteFallback(
  buffer: ArrayBuffer,
  posCI: ClassInfo,
  classReg: Map<number, string>,
  measures: VexTabMeasure[],
): void {
  const MEASURE_SIZE = 16;
  let currentMeasure: VexTabMeasure | null = null;
  let posCount = 0;

  const r = new ByteReader(buffer, posCI.markerPos, new Map(classReg));

  try {
    while (r.remaining >= 2) {
      const saved = r.pos;
      let tag: string | null = null;
      try { tag = r.readTag(); } catch { break; }

      if (tag === 'CPosition') {
        if (posCount % MEASURE_SIZE === 0) {
          currentMeasure = { notes: [], chordSymbols: [] };
          measures.push(currentMeasure);
        }
        posCount++;
        try {
          if (currentMeasure) parsePositionBody(r, currentMeasure, []);
        } catch {
          r.pos = saved + 1;
        }
      } else if (tag === 'CNote') {
        // Orphaned note not consumed by parsePositionBody — skip its body
        try { r.u8(); r.u16le(); const nc = r.u8(); r.skip(nc * 4); } catch { break; }
      } else if (tag === 'CStaff') {
        // Skip the 2-byte staff header (type + nrPositions hint) and continue
        try { r.skip(2); } catch { break; }
      } else {
        // CSection boundary, null ref, or unknown tag — stop
        break;
      }
    }
  } catch { /* partial data */ }
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

  // nrStaves may be uint8 or the low byte of a uint16-LE pair
  let nrStaves = r.u8();
  if (nrStaves === 0 && r.remaining >= 1) {
    // peek: if the next byte looks like a class tag low byte, nrStaves is
    // the uint8 we just read (it really is 0). Otherwise it was the high
    // byte of a uint16-LE and the value we want is the byte we consumed.
    // Since uint16-LE 0x0000 = null ref and non-zero = class-ID or 0xFFFF,
    // re-read the next byte as a potential low-byte override.
    const next = r.bytes[r.pos];
    if (next >= 1 && next <= 8) { nrStaves = next; r.pos++; }
  }
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
  // Staff::Deserialize (from PowerTabEditor source):
  //   m_data (uint8) — clef/staff-type
  //   m_standardNotationStaffAboveSpacing (uint8)
  //   m_standardNotationStaffBelowSpacing (uint8)
  //   m_symbolSpacing (uint8)
  //   m_tablatureStaffBelowSpacing (uint8)
  //   ReadVector(voice0): ReadCount(uint16) + [CPosition tag + pos_body] × count
  //   ReadVector(voice1): ReadCount(uint16) + [CPosition tag + pos_body] × count
  r.skip(5); // m_data + 4 spacing fields

  const measure: VexTabMeasure = { notes: [], chordSymbols: [] };

  // Voice 0 — primary melody
  const nrPos0 = r.u16le();
  if (nrPos0 > 250) return;
  for (let p = 0; p < nrPos0; p++) {
    const tag = r.readTag();
    if (tag !== 'CPosition') break;
    parsePositionBody(r, measure, warnings);
  }

  // Voice 1 — secondary (parse to advance cursor, discard notes)
  const nrPos1 = r.u16le();
  if (nrPos1 <= 250) {
    for (let p = 0; p < nrPos1; p++) {
      const tag = r.readTag();
      if (tag !== 'CPosition') break;
      const dummy: VexTabMeasure = { notes: [], chordSymbols: [] };
      parsePositionBody(r, dummy, []);
    }
  }

  if (staffIndex === 0 && measure.notes.length > 0) {
    measures.push(measure);
  }
}

function parsePositionBody(r: ByteReader, measure: VexTabMeasure, warnings: string[]): void {
  // Position::Deserialize (from PowerTabEditor source):
  //   m_position  (uint8)   — horizontal index in measure
  //   m_beaming   (uint16)  — beaming flags
  //   m_data      (uint32)  — bits 31-24 = duration type, bit 2 = rest, bit 0 = dotted
  //   ReadSmallVector(complexSymbols): count(uint8) + count × 4 bytes each
  //   ReadVector(noteArray): ReadCount(uint16) + [CNote tag + note_body] × count
  r.u8();                    // m_position
  r.u16le();                 // m_beaming
  const mData    = r.u32le();

  const nrComplex = r.u8();
  if (nrComplex > 16) return; // sanity — max is 3 complex symbols per position
  r.skip(nrComplex * 4);

  const durType  = (mData >>> 24) & 0xFF;
  const isDotted = (mData & 0x01) !== 0;
  const isRest   = (mData & 0x04) !== 0;

  // ReadCount() reads uint16 (= count for < 0xFFFF elements)
  const nrNotes = r.u16le();
  if (nrNotes > 8) {
    // Probably misaligned — skip rather than consuming garbage
    warnings.push(`CPosition: unexpected note count ${nrNotes}`);
    return;
  }

  const positions: VexTabPosition[] = [];

  for (let l = 0; l < nrNotes; l++) {
    const tag = r.readTag();
    if (tag !== 'CNote') break;

    // Note::Deserialize (from PowerTabEditor source):
    //   m_stringData (uint8)  — bits 7-5 = string (0 = highest), bits 4-0 = fret
    //   m_simpleData (uint16) — note flags (tied, muted, hammer-on, etc.)
    //   ReadSmallVector(complexSymbols): count(uint8) + count × 4 bytes each
    const stringData   = r.u8();
    r.u16le();                    // m_simpleData flags
    const nrNoteComplex = r.u8();
    if (nrNoteComplex > 16) break; // sanity
    r.skip(nrNoteComplex * 4);

    const fret      = stringData & 0x1F;
    const ptbString = (stringData >> 5) & 0x07;
    const vexString = ptbString + 1;        // VexFlow: str 1 = highest string

    if (fret <= 24 && ptbString <= 7) {
      positions.push({ str: vexString, fret });
    }
  }

  const dur = PTB_DUR[durType] ?? 'q';

  measure.notes.push({
    positions: positions.length > 0 ? positions : [{ str: 1, fret: 'x' }],
    duration: isDotted ? `${dur}d` : dur,
    isRest: isRest || nrNotes === 0,
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
