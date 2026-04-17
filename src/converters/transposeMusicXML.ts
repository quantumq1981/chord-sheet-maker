export type EnharmonicPreference = 'auto' | 'flats' | 'sharps';

const STEP_TO_SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

// C C# D D# E F F# G G# A A# B
const SEMITONE_MAP_SHARPS: Array<{ step: string; alter: number }> = [
  { step: 'C', alter: 0 }, { step: 'C', alter: 1 },
  { step: 'D', alter: 0 }, { step: 'D', alter: 1 },
  { step: 'E', alter: 0 }, { step: 'F', alter: 0 },
  { step: 'F', alter: 1 }, { step: 'G', alter: 0 },
  { step: 'G', alter: 1 }, { step: 'A', alter: 0 },
  { step: 'A', alter: 1 }, { step: 'B', alter: 0 },
];

// C Db D Eb E F Gb G Ab A Bb B
const SEMITONE_MAP_FLATS: Array<{ step: string; alter: number }> = [
  { step: 'C', alter: 0 },  { step: 'D', alter: -1 },
  { step: 'D', alter: 0 },  { step: 'E', alter: -1 },
  { step: 'E', alter: 0 },  { step: 'F', alter: 0 },
  { step: 'G', alter: -1 }, { step: 'G', alter: 0 },
  { step: 'A', alter: -1 }, { step: 'A', alter: 0 },
  { step: 'B', alter: -1 }, { step: 'B', alter: 0 },
];

// Golden rule: Bb/Eb/Ab always flat; F# over Gb; Db default (C# for minor chord roots)
const SEMITONE_MAP_AUTO: Array<{ step: string; alter: number }> = [
  { step: 'C', alter: 0 },   // 0  C
  { step: 'D', alter: -1 },  // 1  Db (overridden to C# for minor chord roots)
  { step: 'D', alter: 0 },   // 2  D
  { step: 'E', alter: -1 },  // 3  Eb
  { step: 'E', alter: 0 },   // 4  E
  { step: 'F', alter: 0 },   // 5  F
  { step: 'F', alter: 1 },   // 6  F#
  { step: 'G', alter: 0 },   // 7  G
  { step: 'A', alter: -1 },  // 8  Ab
  { step: 'A', alter: 0 },   // 9  A
  { step: 'B', alter: -1 },  // 10 Bb
  { step: 'B', alter: 0 },   // 11 B
];

function semitoneToStepAlter(
  semitone: number,
  pref: EnharmonicPreference,
  isMinorContext = false,
): { step: string; alter: number } {
  const s = ((semitone % 12) + 12) % 12;
  if (pref === 'sharps') return SEMITONE_MAP_SHARPS[s];
  if (pref === 'flats') return SEMITONE_MAP_FLATS[s];
  // auto: at semitone 1 (Db/C#), use C# for minor chord roots
  if (s === 1 && isMinorContext) return { step: 'C', alter: 1 };
  return SEMITONE_MAP_AUTO[s];
}

function isMinorChordKind(kindText: string): boolean {
  const k = kindText.toLowerCase().trim();
  return k.startsWith('minor') || k.startsWith('diminished') || k === 'half-diminished';
}

function normalizeSemitones(semitones: number): number {
  if (!Number.isFinite(semitones)) return 0;
  return Math.trunc(semitones);
}

function parseIntOrDefault(text: string | null | undefined, fallback = 0): number {
  if (!text) return fallback;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n : fallback;
}

function pitchToMidi(step: string, alter: number, octave: number): number {
  return (octave + 1) * 12 + STEP_TO_SEMITONE[step] + alter;
}

function midiToPitch(midi: number, pref: EnharmonicPreference): { step: string; alter: number; octave: number } {
  const octave = Math.floor(midi / 12) - 1;
  const mapped = semitoneToStepAlter(midi, pref);
  return { step: mapped.step, alter: mapped.alter, octave };
}

function setOrCreateChild(parent: Element, tagName: string, value: string): void {
  let child = parent.querySelector(`:scope > ${tagName}`);
  if (!child) {
    child = parent.ownerDocument.createElement(tagName);
    parent.appendChild(child);
  }
  child.textContent = value;
}

function updatePitchNode(pitchEl: Element, semitones: number, pref: EnharmonicPreference, warnings: string[]): void {
  const stepEl = pitchEl.querySelector(':scope > step');
  const octaveEl = pitchEl.querySelector(':scope > octave');
  if (!stepEl || !octaveEl) {
    warnings.push('Skipped one <pitch> without <step> or <octave>.');
    return;
  }

  const step = (stepEl.textContent ?? '').trim().toUpperCase();
  if (!(step in STEP_TO_SEMITONE)) {
    warnings.push(`Skipped one <pitch> with unsupported step "${step}".`);
    return;
  }
  const alterEl = pitchEl.querySelector(':scope > alter');
  const alter = parseIntOrDefault(alterEl?.textContent, 0);
  const octave = parseIntOrDefault(octaveEl.textContent, 4);

  const midi = pitchToMidi(step, alter, octave) + semitones;
  const next = midiToPitch(midi, pref);

  stepEl.textContent = next.step;
  octaveEl.textContent = String(next.octave);
  if (next.alter === 0) {
    alterEl?.remove();
  } else {
    setOrCreateChild(pitchEl, 'alter', String(next.alter));
  }
}

function transposeStepAlter(
  step: string,
  alter: number,
  semitones: number,
  pref: EnharmonicPreference,
  isMinorContext = false,
): { step: string; alter: number } {
  const midi = STEP_TO_SEMITONE[step] + alter + semitones;
  return semitoneToStepAlter(midi, pref, isMinorContext);
}

function updateHarmonyNode(harmonyEl: Element, semitones: number, pref: EnharmonicPreference, warnings: string[]): void {
  const kindEl = harmonyEl.querySelector(':scope > kind');
  const isMinor = pref === 'auto' ? isMinorChordKind(kindEl?.textContent ?? '') : false;

  const rootStepEl = harmonyEl.querySelector(':scope > root > root-step');
  if (rootStepEl) {
    const rootStep = (rootStepEl.textContent ?? '').trim().toUpperCase();
    if (rootStep in STEP_TO_SEMITONE) {
      const rootAlterEl = harmonyEl.querySelector(':scope > root > root-alter');
      const rootAlter = parseIntOrDefault(rootAlterEl?.textContent, 0);
      const mapped = transposeStepAlter(rootStep, rootAlter, semitones, pref, isMinor);
      rootStepEl.textContent = mapped.step;
      if (mapped.alter === 0) {
        rootAlterEl?.remove();
      } else {
        setOrCreateChild(harmonyEl.querySelector(':scope > root') ?? harmonyEl, 'root-alter', String(mapped.alter));
      }
    } else {
      warnings.push(`Skipped one <harmony> root with unsupported step "${rootStep}".`);
    }
  }

  const bassStepEl = harmonyEl.querySelector(':scope > bass > bass-step');
  if (bassStepEl) {
    const bassStep = (bassStepEl.textContent ?? '').trim().toUpperCase();
    if (bassStep in STEP_TO_SEMITONE) {
      const bassAlterEl = harmonyEl.querySelector(':scope > bass > bass-alter');
      const bassAlter = parseIntOrDefault(bassAlterEl?.textContent, 0);
      const mapped = transposeStepAlter(bassStep, bassAlter, semitones, pref, false);
      bassStepEl.textContent = mapped.step;
      if (mapped.alter === 0) {
        bassAlterEl?.remove();
      } else {
        setOrCreateChild(harmonyEl.querySelector(':scope > bass') ?? harmonyEl, 'bass-alter', String(mapped.alter));
      }
    } else {
      warnings.push(`Skipped one <harmony> bass with unsupported step "${bassStep}".`);
    }
  }
}

function semitonesToFifthsShift(semitones: number): number {
  const normalized = ((semitones % 12) + 12) % 12;
  const raw = (normalized * 7) % 12;
  return raw > 6 ? raw - 12 : raw;
}

function updateKeyNode(keyEl: Element, semitones: number, warnings: string[]): void {
  const fifthsEl = keyEl.querySelector(':scope > fifths');
  if (!fifthsEl) return;
  const current = parseIntOrDefault(fifthsEl.textContent, 0);
  const shifted = current + semitonesToFifthsShift(semitones);
  if (shifted > 7 || shifted < -7) {
    warnings.push('One key signature exceeded MusicXML fifths range; clamped to [-7, 7].');
  }
  const clamped = Math.max(-7, Math.min(7, shifted));
  fifthsEl.textContent = String(clamped);
}

/**
 * Transpose an in-memory MusicXML string by a number of semitones.
 * Pitch nodes are rewritten directly; key signatures and harmony symbols are
 * transposed too so notation mode and exports remain consistent.
 */
export function transposeMusicXML(
  xmlText: string,
  semitones: number,
  enharmonicPreference: EnharmonicPreference = 'auto',
): { xml: string; warnings: string[] } {
  const shift = normalizeSemitones(semitones);
  if (shift === 0) return { xml: xmlText, warnings: [] };

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parserErrorNode = doc.querySelector('parsererror');
  if (parserErrorNode) {
    return { xml: xmlText, warnings: ['Could not parse MusicXML for transposition.'] };
  }

  const warnings: string[] = [];
  doc.querySelectorAll('note pitch').forEach((pitchEl) => {
    updatePitchNode(pitchEl, shift, enharmonicPreference, warnings);
  });
  doc.querySelectorAll('harmony').forEach((harmonyEl) => {
    updateHarmonyNode(harmonyEl, shift, enharmonicPreference, warnings);
  });
  doc.querySelectorAll('attributes key').forEach((keyEl) => {
    updateKeyNode(keyEl, shift, warnings);
  });

  const transposeEls = doc.querySelectorAll('transpose');
  if (transposeEls.length > 0) {
    transposeEls.forEach((transposeEl) => {
      setOrCreateChild(transposeEl, 'chromatic', '0');
      const diatonicEl = transposeEl.querySelector(':scope > diatonic');
      if (diatonicEl) diatonicEl.textContent = '0';
      const octaveEl = transposeEl.querySelector(':scope > octave-change');
      if (octaveEl) octaveEl.textContent = '0';
    });
    warnings.push('Reset embedded <transpose> directives to zero after applying global transposition.');
  }

  return { xml: new XMLSerializer().serializeToString(doc), warnings };
}
