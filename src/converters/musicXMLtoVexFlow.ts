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

  // Harmony events (chord symbols) keyed by onset division offset
  const harmonyMap = new Map<number, string>();
  let harmonyOffset = 0;
  for (const child of Array.from(measureEl.children)) {
    if (child.tagName === 'harmony') {
      const rootStep = queryText(child, 'root > root-step');
      if (rootStep) {
        const rootAlter = queryText(child, 'root > root-alter');
        const kind = queryText(child, 'kind');
        const bass = queryText(child, 'bass > bass-step');
        const bassAlter = queryText(child, 'bass > bass-alter');
        const chordText = buildChordText(rootStep, rootAlter ? parseFloat(rootAlter) : 0, kind, bass, bassAlter ? parseFloat(bassAlter) : 0);
        harmonyMap.set(harmonyOffset, chordText);
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
  const groups = groupIntoBeats(rawNotes);  // group simultaneous (chord) notes

  const vexNotes: VexTabNoteData[] = [];
  const chordSymbols: Array<{ noteIndex: number; text: string }> = [];

  let noteOffset = 0;  // tracks onset in divisions
  let harmonyAssignedOffsets = new Set<number>();

  for (const group of groups) {
    const noteIdx = vexNotes.length;

    // Assign chord symbol if harmony falls on or near this beat
    if (!harmonyAssignedOffsets.has(noteOffset) && harmonyMap.size > 0) {
      const sym = harmonyMap.get(noteOffset);
      if (sym) {
        chordSymbols.push({ noteIndex: noteIdx, text: sym });
        harmonyAssignedOffsets.add(noteOffset);
      }
    }

    // Is this group a rest?
    const isRest = group.every((n) => n.querySelector(':scope > rest') !== null);

    // Duration from first note
    const firstNote = group[0];
    const typeText = queryText(firstNote, 'type');
    const isDotted = firstNote.querySelector(':scope > dot') !== null;
    let vfDuration = MXL_TYPE_TO_VF[typeText] ?? 'q';
    if (isDotted) vfDuration += 'd';

    let positions: VexTabPosition[] = [];

    if (!isRest) {
      // Map pitches to fret/string positions
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

      // Sort highest pitch first so high notes map to low string numbers (standard tab layout)
      pitchMidis.sort((a, b) => b - a);

      const usedStrings = new Set<number>();
      for (const midi of pitchMidis) {
        const pos = midiToPosition(midi, openMidis, usedStrings);
        if (pos) {
          positions.push(pos);
          usedStrings.add(pos.str);
        } else {
          // Out of range: show as muted on the nearest string
          const nearestStr = findNearestString(midi, openMidis, usedStrings);
          positions.push({ str: nearestStr, fret: 'x' });
          usedStrings.add(nearestStr);
          outOfRange++;
        }
      }
    }

    if (positions.length === 0) {
      // Rest or unparseable note — use a ghost placeholder via empty positions
      positions = [{ str: 1, fret: 'x' }];
    }

    vexNotes.push({ positions, duration: vfDuration, isRest });

    // Advance offset by first note's duration
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

// ─── Chord symbol builder ─────────────────────────────────────────────────────

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
