// MusicXML → VexFlow tablature conversion engine.
//
// Parses a partwise (or timewise, auto-converted) MusicXML document and
// produces a VexTabScore ready to render with VexFlowTabRenderer.

// ─── Public types ─────────────────────────────────────────────────────────────

export interface VexTabPosition {
  str: number;   // 1 = highest string (thin e), 6 = lowest (thick E)
  fret: number | 'x';
}

/** One rendered beat position in the tab: may represent a chord (multiple positions). */
export interface VexTabNoteData {
  positions: VexTabPosition[];
  duration: string;  // VexFlow duration code: 'w','h','q','8','16','32'; append 'd' for dotted
  isRest: boolean;
}

export interface VexTabMeasure {
  notes: VexTabNoteData[];
  /** Present only when this measure introduces a time-signature change. */
  timeSignature?: { beats: number; beatType: number };
  repeatStart?: boolean;
  repeatEnd?: boolean;
  /** Chord symbol text objects keyed to the note index they sit above. */
  chordSymbols: Array<{ noteIndex: number; text: string }>;
}

export interface VexTabScore {
  title?: string;
  composer?: string;
  /** Initial (global) time signature. */
  timeSignature: { beats: number; beatType: number };
  measures: VexTabMeasure[];
  parts: Array<{ id: string; name: string }>;
  warnings: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_TO_SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

// MusicXML <type> → VexFlow duration string
const MXL_TYPE_TO_VF: Record<string, string> = {
  breve: 'w',
  whole: 'w',
  half: 'h',
  quarter: 'q',
  eighth: '8',
  '16th': '16',
  '32nd': '32',
  '64th': '64',
  '128th': '64',  // approximate
};

// Standard guitar tuning open-string MIDI notes (index 0 = string 1 = high E4)
const STANDARD_OPEN_MIDI = [64, 59, 55, 50, 45, 40];

const MAX_FRET = 22;

// ─── Pitch helpers ────────────────────────────────────────────────────────────

function parseTuningNote(note: string): number {
  const m = note.trim().match(/^([A-G])(b|#?)(-?\d+)$/);
  if (!m) return 0;
  const [, step, acc, octStr] = m;
  const oct = parseInt(octStr, 10);
  const sem = STEP_TO_SEMITONE[step] ?? 0;
  const alter = acc === '#' ? 1 : acc === 'b' ? -1 : 0;
  return (oct + 1) * 12 + sem + alter;
}

function pitchToMidi(step: string, alter: number, octave: number): number {
  const sem = STEP_TO_SEMITONE[step.toUpperCase()] ?? 0;
  return (octave + 1) * 12 + sem + Math.round(alter);
}

/**
 * Find the lowest-fret valid (str, fret) pair for a MIDI note given open-string
 * MIDI numbers.  Returns null when the note is entirely out of range.
 */
function midiToPosition(
  midi: number,
  openMidis: number[],
  usedStrings: Set<number>,
): VexTabPosition | null {
  let best: VexTabPosition | null = null;
  for (let i = 0; i < openMidis.length; i++) {
    const strNum = i + 1;
    if (usedStrings.has(strNum)) continue;
    const fret = midi - openMidis[i];
    if (fret < 0 || fret > MAX_FRET) continue;
    if (!best || fret < (best.fret as number)) {
      best = { str: strNum, fret };
    }
  }
  return best;
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

function textContent(el: Element | null | undefined): string {
  return el?.textContent?.trim() ?? '';
}

function queryText(parent: Element | Document, selector: string): string {
  return textContent(parent.querySelector(selector));
}

/** Convert score-timewise → score-partwise in-memory. */
function timewiseToPartwise(doc: Document): Document {
  const root = doc.documentElement;
  if (root.nodeName !== 'score-timewise') return doc;

  const newDoc = document.implementation.createDocument(null, 'score-partwise', null);
  const newRoot = newDoc.documentElement;
  // Copy attributes
  for (const attr of Array.from(root.attributes)) {
    newRoot.setAttribute(attr.name, attr.value);
  }

  // Copy header nodes (work, identification, part-list, etc.)
  const measures = Array.from(root.querySelectorAll(':scope > measure'));
  const partIds: string[] = [];

  for (const m of measures) {
    for (const p of Array.from(m.querySelectorAll(':scope > part'))) {
      const id = p.getAttribute('id') ?? '';
      if (id && !partIds.includes(id)) partIds.push(id);
    }
  }

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (el.tagName === 'measure') continue;
      newRoot.appendChild(newDoc.importNode(el, true));
    }
  }

  for (const partId of partIds) {
    const partEl = newDoc.createElement('part');
    partEl.setAttribute('id', partId);
    for (const mEl of measures) {
      const mNum = mEl.getAttribute('number') ?? '';
      const partChild = mEl.querySelector(`:scope > part[id="${partId}"]`);
      if (!partChild) continue;
      const newMeasure = newDoc.createElement('measure');
      newMeasure.setAttribute('number', mNum);
      for (const c of Array.from(partChild.childNodes)) {
        newMeasure.appendChild(newDoc.importNode(c, true));
      }
      partEl.appendChild(newMeasure);
    }
    newRoot.appendChild(partEl);
  }

  return newDoc;
}

// ─── Main converter ───────────────────────────────────────────────────────────

export function musicXMLToVexTabScore(
  xmlText: string,
  tuning: string[],
  partIndex = 0,
): VexTabScore {
  const warnings: string[] = [];

  // Parse XML
  let doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return emptyScore(warnings, 'XML parse error');
  }

  // Timewise conversion
  const rootName = doc.documentElement.nodeName;
  if (rootName === 'score-timewise') {
    doc = timewiseToPartwise(doc);
    warnings.push('score-timewise converted to partwise for tab rendering');
  } else if (rootName !== 'score-partwise') {
    return emptyScore(warnings, `Unknown root element: ${rootName}`);
  }

  // Collect open-string MIDI values from tuning array
  const openMidis: number[] = tuning.map(parseTuningNote);
  if (openMidis.some((m) => m === 0)) {
    warnings.push('One or more tuning strings could not be parsed; defaulting to standard tuning');
    for (let i = 0; i < openMidis.length; i++) {
      if (openMidis[i] === 0) openMidis[i] = STANDARD_OPEN_MIDI[i] ?? 40;
    }
  }

  // Metadata
  const title = queryText(doc, 'work > work-title') || queryText(doc, 'movement-title') || undefined;
  const composerNode = Array.from(doc.querySelectorAll('identification > creator'))
    .find((c) => (c.getAttribute('type') ?? '').toLowerCase() === 'composer');
  const composer = composerNode?.textContent?.trim() || undefined;

  // Parts
  const partEls = Array.from(doc.querySelectorAll('score-partwise > part'));
  const parts = partEls.map((p) => {
    const id = p.getAttribute('id') ?? '';
    const name = queryText(doc, `part-list > score-part[id="${id}"] > part-name`) || id;
    return { id, name };
  });

  if (partEls.length === 0) {
    return emptyScore(warnings, 'No parts found in score');
  }

  const selectedIdx = Math.min(partIndex, partEls.length - 1);
  const selectedPart = partEls[selectedIdx];

  // Initial time signature
  let globalBeats = 4;
  let globalBeatType = 4;
  const firstAttr = doc.querySelector('attributes');
  if (firstAttr) {
    const b = parseInt(queryText(firstAttr, 'time > beats'), 10);
    const bt = parseInt(queryText(firstAttr, 'time > beat-type'), 10);
    if (Number.isFinite(b) && b > 0) globalBeats = b;
    if (Number.isFinite(bt) && bt > 0) globalBeatType = bt;
  }

  // Current state while iterating measures
  let currentBeats = globalBeats;
  let currentBeatType = globalBeatType;
  let divisions = 1;
  let outOfRangeCount = 0;

  const measures: VexTabMeasure[] = [];

  for (const measureEl of Array.from(selectedPart.querySelectorAll(':scope > measure'))) {
    const measure = parseMeasure(
      measureEl,
      openMidis,
      { currentBeats, currentBeatType, divisions, outOfRangeCount },
    );

    // Update running state
    divisions = measure._divisions ?? divisions;
    outOfRangeCount += measure._outOfRange ?? 0;
    if (measure.timeSignature) {
      currentBeats = measure.timeSignature.beats;
      currentBeatType = measure.timeSignature.beatType;
    }

    // Strip internal tracking fields before storing
    const { _divisions: _d, _outOfRange: _o, ...cleanMeasure } = measure as VexTabMeasure & {
      _divisions?: number; _outOfRange?: number;
    };
    measures.push(cleanMeasure);
  }

  if (outOfRangeCount > 0) {
    warnings.push(
      `${outOfRangeCount} note(s) out of range for the current tuning/fretboard and shown as muted (×).`,
    );
  }

  return {
    title,
    composer,
    timeSignature: { beats: globalBeats, beatType: globalBeatType },
    measures,
    parts,
    warnings,
  };
}

// ─── Measure parser ───────────────────────────────────────────────────────────

interface MeasureParseState {
  currentBeats: number;
  currentBeatType: number;
  divisions: number;
  outOfRangeCount: number;
}

function parseMeasure(
  measureEl: Element,
  openMidis: number[],
  state: MeasureParseState,
): VexTabMeasure & { _divisions?: number; _outOfRange?: number } {
  let { divisions } = state;
  let timeSigChange: { beats: number; beatType: number } | undefined;
  let outOfRange = 0;

  // Attributes (time sig, divisions)
  const attrEl = measureEl.querySelector(':scope > attributes');
  if (attrEl) {
    const divText = queryText(attrEl, 'divisions');
    if (divText) {
      const d = parseInt(divText, 10);
      if (Number.isFinite(d) && d > 0) divisions = d;
    }
    const beatsText = queryText(attrEl, 'time > beats');
    const beatTypeText = queryText(attrEl, 'time > beat-type');
    if (beatsText && beatTypeText) {
      const b = parseInt(beatsText, 10);
      const bt = parseInt(beatTypeText, 10);
      if (Number.isFinite(b) && Number.isFinite(bt) && b > 0 && bt > 0) {
        timeSigChange = { beats: b, beatType: bt };
      }
    }
  }

  // Repeat markers
  const repeatStart = Array.from(measureEl.querySelectorAll('barline repeat'))
    .some((r) => (r.getAttribute('direction') ?? '') === 'forward');
  const repeatEnd = Array.from(measureEl.querySelectorAll('barline repeat'))
    .some((r) => (r.getAttribute('direction') ?? '') === 'backward');

  // Slash/rhythm notation detection
  const slashMeasure = isSlashMeasure(measureEl);

  // Harmony events keyed by onset division offset
  const harmonyMap = new Map<number, string>();
  const harmonyVoicingMap = new Map<number, { rootChromatic: number; intervals: number[] }>();
  let harmonyOffset = 0;
  for (const child of Array.from(measureEl.children)) {
    if (child.tagName === 'harmony') {
      const rootStep = queryText(child, 'root > root-step');
      if (rootStep) {
        const rootAlterText = queryText(child, 'root > root-alter');
        const rootAlter = rootAlterText ? parseFloat(rootAlterText) : 0;
        const kind = queryText(child, 'kind');
        const bass = queryText(child, 'bass > bass-step');
        const bassAlterText = queryText(child, 'bass > bass-alter');
        const bassAlter = bassAlterText ? parseFloat(bassAlterText) : 0;
        harmonyMap.set(harmonyOffset, buildChordText(rootStep, rootAlter, kind, bass, bassAlter));
        const intervals = KIND_INTERVALS[kind];
        if (intervals) {
          harmonyVoicingMap.set(harmonyOffset, {
            rootChromatic: rootToChromatic(rootStep, rootAlter),
            intervals,
          });
        }
      }
    }
    if (child.tagName === 'note') {
      const isChordNote = child.querySelector(':scope > chord') !== null;
      if (!isChordNote) {
        const dur = parseInt(queryText(child, 'duration'), 10) || 0;
        harmonyOffset += dur;
      }
    }
  }

  // Notes
  const rawNotes = collectNoteElements(measureEl);
  const groups = groupIntoBeats(rawNotes);

  // All-same-pitch heuristic: when every non-rest note shares a MIDI pitch (jazz B4 convention),
  // treat the measure as rhythm slashes so we can substitute chord voicings.
  let effectiveSlash = slashMeasure;
  if (!effectiveSlash && groups.length > 1) {
    const nonRestMidis: number[] = [];
    for (const group of groups) {
      if (group.every((n) => n.querySelector(':scope > rest') !== null)) continue;
      for (const n of group) {
        const p = n.querySelector(':scope > pitch');
        if (!p) continue;
        const step = queryText(p, 'step');
        const alter = parseFloat(queryText(p, 'alter') || '0');
        const octave = parseInt(queryText(p, 'octave'), 10);
        if (step && Number.isFinite(octave)) nonRestMidis.push(pitchToMidi(step, alter, octave));
      }
    }
    if (nonRestMidis.length > 1 && nonRestMidis.every((m) => m === nonRestMidis[0])) {
      effectiveSlash = true;
    }
  }

  const vexNotes: VexTabNoteData[] = [];
  const chordSymbols: Array<{ noteIndex: number; text: string }> = [];

  let noteOffset = 0;
  const harmonyAssignedOffsets = new Set<number>();
  let currentVoicingData: { rootChromatic: number; intervals: number[] } | null = null;

  for (const group of groups) {
    const noteIdx = vexNotes.length;

    // Sticky: update current voicing whenever a harmony event fires at this offset
    const voicingAtOffset = harmonyVoicingMap.get(noteOffset);
    if (voicingAtOffset) currentVoicingData = voicingAtOffset;

    // Assign chord symbol
    if (!harmonyAssignedOffsets.has(noteOffset) && harmonyMap.size > 0) {
      const sym = harmonyMap.get(noteOffset);
      if (sym) {
        chordSymbols.push({ noteIndex: noteIdx, text: sym });
        harmonyAssignedOffsets.add(noteOffset);
      }
    }

    const isRest = group.every((n) => n.querySelector(':scope > rest') !== null);

    const firstNote = group[0];
    const typeText = queryText(firstNote, 'type');
    const isDotted = firstNote.querySelector(':scope > dot') !== null;
    let vfDuration = MXL_TYPE_TO_VF[typeText] ?? 'q';
    if (isDotted) vfDuration += 'd';

    let positions: VexTabPosition[] = [];

    if (!isRest) {
      const isSlash = effectiveSlash || group.some((n) => isSlashNote(n));

      // For slash/rhythm notes substitute a proper guitar chord voicing when available
      if (isSlash && currentVoicingData) {
        positions = computeChordVoicing(
          currentVoicingData.rootChromatic,
          currentVoicingData.intervals,
          openMidis,
        );
      }

      // Fall back to literal pitch mapping (ordinary notes, or voicing failed)
      if (positions.length === 0) {
        const pitchEls = group.map((n) => n.querySelector(':scope > pitch'));
        const pitchMidis: number[] = [];
        for (const p of pitchEls) {
          if (!p) continue;
          const step = queryText(p, 'step');
          const alter = parseFloat(queryText(p, 'alter') || '0');
          const octave = parseInt(queryText(p, 'octave'), 10);
          if (!step || !Number.isFinite(octave)) continue;
          pitchMidis.push(pitchToMidi(step, alter, octave));
        }
        pitchMidis.sort((a, b) => b - a);
        const usedStrings = new Set<number>();
        for (const midi of pitchMidis) {
          const pos = midiToPosition(midi, openMidis, usedStrings);
          if (pos) {
            positions.push(pos);
            usedStrings.add(pos.str);
          } else {
            const nearestStr = findNearestString(midi, openMidis, usedStrings);
            positions.push({ str: nearestStr, fret: 'x' });
            usedStrings.add(nearestStr);
            outOfRange++;
          }
        }
      }
    }

    if (positions.length === 0) {
      positions = [{ str: 1, fret: 'x' }];
    }

    vexNotes.push({ positions, duration: vfDuration, isRest });

    const dur = parseInt(queryText(firstNote, 'duration'), 10) || 0;
    noteOffset += dur;
  }

  return {
    notes: vexNotes,
    timeSignature: timeSigChange,
    repeatStart: repeatStart || undefined,
    repeatEnd: repeatEnd || undefined,
    chordSymbols,
    _divisions: divisions,
    _outOfRange: outOfRange,
  };
}

// ─── Note element helpers ─────────────────────────────────────────────────────

/** Collect all <note> elements from a measure element. */
function collectNoteElements(measureEl: Element): Element[] {
  return Array.from(measureEl.querySelectorAll(':scope > note'));
}

/**
 * Group notes into "beats" — consecutive notes with <chord/> share a beat.
 * Returns arrays where index 0 is the "head" note (no <chord/>) and the rest
 * are simultaneous chord tones.
 */
function groupIntoBeats(notes: Element[]): Element[][] {
  const groups: Element[][] = [];
  for (const note of notes) {
    const isChordContinuation = note.querySelector(':scope > chord') !== null;
    if (isChordContinuation && groups.length > 0) {
      groups[groups.length - 1].push(note);
    } else {
      groups.push([note]);
    }
  }
  return groups;
}

function findNearestString(midi: number, openMidis: number[], usedStrings: Set<number>): number {
  let best = 1;
  let bestDist = Infinity;
  for (let i = 0; i < openMidis.length; i++) {
    const s = i + 1;
    if (usedStrings.has(s)) continue;
    const dist = Math.abs(midi - openMidis[i]);
    if (dist < bestDist) { bestDist = dist; best = s; }
  }
  return best;
}

// ─── Chord voicing helpers ────────────────────────────────────────────────────

function rootToChromatic(step: string, alter: number): number {
  return ((STEP_TO_SEMITONE[step.toUpperCase()] ?? 0) + Math.round(alter) + 12) % 12;
}

function pickGuitarIntervals(intervals: number[]): number[] {
  let result = [...intervals];
  // For extended chords drop the 5th to keep voicings compact
  if (result.length > 4) result = result.filter((v) => v !== 7);
  // Cap at 4 tones: root + top 3 intervals
  if (result.length > 4) result = [result[0], ...result.slice(-3)];
  return result;
}

function tryVoicingFromRoot(
  rootChromatic: number,
  intervals: number[],
  openMidis: number[],
  rootStrIdx: number,
): VexTabPosition[] | null {
  if (rootStrIdx >= openMidis.length) return null;
  const rootOpenMidi = openMidis[rootStrIdx];

  // Find root fret on rootStrIdx, preferring frets 2–14 (moveable shape)
  let rootFret = -1;
  for (let fret = 0; fret <= MAX_FRET; fret++) {
    if (((rootOpenMidi + fret) % 12) === rootChromatic) {
      if (fret >= 2) { rootFret = fret; break; }
      if (rootFret === -1) rootFret = fret;
    }
  }
  if (rootFret < 0) return null;

  const result: VexTabPosition[] = [{ str: rootStrIdx + 1, fret: rootFret }];
  const usedStrings = new Set<number>([rootStrIdx + 1]);

  for (const interval of intervals.slice(1)) {
    const targetPc = (rootChromatic + interval) % 12;
    let placed = false;

    // First pass: require fret within 5 of root fret
    for (let si = rootStrIdx - 1; si >= 0; si--) {
      const strNum = si + 1;
      if (usedStrings.has(strNum)) continue;
      const openM = openMidis[si];
      let bestFret = -1;
      let bestDist = Infinity;
      for (let fret = 0; fret <= MAX_FRET; fret++) {
        if (((openM + fret) % 12) === targetPc) {
          const dist = Math.abs(fret - rootFret);
          if (dist <= 5 && dist < bestDist) { bestDist = dist; bestFret = fret; }
        }
      }
      if (bestFret >= 0) {
        result.push({ str: strNum, fret: bestFret });
        usedStrings.add(strNum);
        placed = true;
        break;
      }
    }

    // Second pass: any octave, no fret-stretch constraint
    if (!placed) {
      for (let si = rootStrIdx - 1; si >= 0; si--) {
        const strNum = si + 1;
        if (usedStrings.has(strNum)) continue;
        const openM = openMidis[si];
        for (let fret = 0; fret <= MAX_FRET; fret++) {
          if (((openM + fret) % 12) === targetPc) {
            result.push({ str: strNum, fret });
            usedStrings.add(strNum);
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }
  }

  if (result.length < Math.min(2, intervals.length)) return null;
  result.sort((a, b) => a.str - b.str);
  return result;
}

function computeChordVoicing(
  rootChromatic: number,
  intervals: number[],
  openMidis: number[],
): VexTabPosition[] {
  const picked = pickGuitarIntervals(intervals);
  for (const rootStrIdx of [5, 4, 3]) {
    if (rootStrIdx >= openMidis.length) continue;
    const result = tryVoicingFromRoot(rootChromatic, picked, openMidis, rootStrIdx);
    if (result && result.length >= Math.min(2, picked.length)) return result;
  }
  return [];
}

function isSlashMeasure(measureEl: Element): boolean {
  if (measureEl.querySelector('measure-style > slash[type="start"]')) return true;
  for (const note of Array.from(measureEl.querySelectorAll(':scope > note'))) {
    if (textContent(note.querySelector('notehead')) === 'slash') return true;
  }
  return false;
}

function isSlashNote(noteEl: Element): boolean {
  return textContent(noteEl.querySelector('notehead')) === 'slash';
}

// ─── Chord symbol builder ─────────────────────────────────────────────────────

// MusicXML <kind> → interval array (semitones from root, mod-12 for pitch class)
const KIND_INTERVALS: Record<string, number[]> = {
  major:               [0, 4, 7],
  minor:               [0, 3, 7],
  augmented:           [0, 4, 8],
  diminished:          [0, 3, 6],
  'suspended-second':  [0, 2, 7],
  'suspended-fourth':  [0, 5, 7],
  'major-sixth':       [0, 4, 7, 9],
  'minor-sixth':       [0, 3, 7, 9],
  dominant:            [0, 4, 7, 10],
  'major-seventh':     [0, 4, 7, 11],
  'minor-seventh':     [0, 3, 7, 10],
  'diminished-seventh':[0, 3, 6, 9],
  'half-diminished':   [0, 3, 6, 10],
  'augmented-seventh': [0, 4, 8, 10],
  'major-minor':       [0, 3, 7, 11],
  'dominant-ninth':    [0, 4, 10, 14],
  'major-ninth':       [0, 4, 11, 14],
  'minor-ninth':       [0, 3, 10, 14],
  'dominant-11th':     [0, 4, 10, 17],
  'major-11th':        [0, 4, 11, 17],
  'minor-11th':        [0, 3, 10, 17],
  'dominant-13th':     [0, 4, 10, 21],
  'major-13th':        [0, 4, 11, 21],
  'minor-13th':        [0, 3, 10, 21],
  power:               [0, 7],
};

const KIND_MAP: Record<string, string> = {
  major: '', minor: 'm', diminished: 'dim', augmented: 'aug',
  'suspended-second': 'sus2', 'suspended-fourth': 'sus4',
  'major-sixth': '6', 'minor-sixth': 'm6',
  dominant: '7', 'major-seventh': 'maj7', 'minor-seventh': 'm7',
  'diminished-seventh': 'dim7', 'augmented-seventh': 'aug7',
  'half-diminished': 'm7b5', 'major-minor': 'm(maj7)',
  'dominant-ninth': '9', 'major-ninth': 'maj9', 'minor-ninth': 'm9',
  'dominant-11th': '11', 'major-11th': 'maj11', 'minor-11th': 'm11',
  'dominant-13th': '13', 'major-13th': 'maj13', 'minor-13th': 'm13',
  power: '5', pedal: 'ped',
};

function buildChordText(
  rootStep: string,
  rootAlter: number,
  kind: string,
  bassStep: string,
  bassAlter: number,
): string {
  const alterChar = (a: number) => (a > 0 ? '#' : a < 0 ? 'b' : '');
  const root = `${rootStep}${alterChar(rootAlter)}`;
  const suffix = KIND_MAP[kind] ?? kind;
  const bass = bassStep ? `/${bassStep}${alterChar(bassAlter)}` : '';
  return `${root}${suffix}${bass}`;
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

function emptyScore(warnings: string[], reason: string): VexTabScore {
  warnings.push(reason);
  return {
    timeSignature: { beats: 4, beatType: 4 },
    measures: [],
    parts: [],
    warnings,
  };
}

// ─── All-positions / fretboard diagram API ────────────────────────────────────

/** One note pitch and every string/fret position where it can be played. */
export interface NotePositionMap {
  /** MIDI pitch number. */
  midi: number;
  /** Friendly name, e.g. "A4", "C#3". */
  name: string;
  /** Every valid (string, fret) pair within frets 0–22. */
  positions: VexTabPosition[];
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pc]}${oct}`;
}

/**
 * Return every valid (string, fret) position for a MIDI pitch given the open-
 * string MIDI values.  Unlike midiToPosition() this returns all candidates, not
 * just the lowest-fret one, so callers can display every voicing option.
 */
export function getAllFretboardPositions(
  midi: number,
  openMidis: number[],
): VexTabPosition[] {
  const positions: VexTabPosition[] = [];
  for (let i = 0; i < openMidis.length; i++) {
    const fret = midi - openMidis[i];
    if (fret >= 0 && fret <= MAX_FRET) {
      positions.push({ str: i + 1, fret });
    }
  }
  return positions;
}

/**
 * Parse a MusicXML document and collect every unique pitch that appears in the
 * selected part (default: part 0).  For each pitch, compute all playable
 * positions across the fretboard given the supplied tuning.
 *
 * Returns the results ordered by ascending MIDI pitch value so the caller can
 * render them in a logical musical order (low → high).
 */
export function getScoreNotePositions(
  xmlText: string,
  tuning: string[],
  partIndex = 0,
): NotePositionMap[] {
  let doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  if (doc.documentElement.nodeName === 'score-timewise') {
    doc = timewiseToPartwise(doc);
  }
  if (doc.documentElement.nodeName !== 'score-partwise') return [];

  const openMidis = tuning.map(parseTuningNote);
  for (let i = 0; i < openMidis.length; i++) {
    if (openMidis[i] === 0) openMidis[i] = STANDARD_OPEN_MIDI[i] ?? 40;
  }

  const partEls = Array.from(doc.querySelectorAll('score-partwise > part'));
  const selectedPart = partEls[Math.min(partIndex, partEls.length - 1)];
  if (!selectedPart) return [];

  const seenMidi = new Set<number>();
  for (const noteEl of Array.from(selectedPart.querySelectorAll('note'))) {
    if (noteEl.querySelector('rest')) continue;
    const p = noteEl.querySelector('pitch');
    if (!p) continue;
    const step = textContent(p.querySelector('step'));
    const alter = parseFloat(textContent(p.querySelector('alter')) || '0');
    const octave = parseInt(textContent(p.querySelector('octave')), 10);
    if (!step || !Number.isFinite(octave)) continue;
    seenMidi.add(pitchToMidi(step, alter, octave));
  }

  return Array.from(seenMidi)
    .sort((a, b) => a - b)
    .map((midi) => ({
      midi,
      name: midiToName(midi),
      positions: getAllFretboardPositions(midi, openMidis),
    }))
    .filter((n) => n.positions.length > 0);
}
