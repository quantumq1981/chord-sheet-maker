/**
 * chordSymbolParser.ts
 *
 * Parses free-text chord symbols (as found in <direction><words> elements,
 * especially Finale-exported MusicXML) into structured chord data.
 *
 * Supported notation styles:
 *   Standard: Cmaj7, Dm7, G7, Fdim, Baug, Asus4, C/G
 *   Jazz:     C△7, G-7, F°, Bø7, E^7, Cmi7
 *   Finale:   C^7, Cmi, G-7, F°7, Bbø
 */

export interface ParsedChordSymbol {
  rootStep: string;   // "C", "D", "F", "B"
  rootAlter: number;  // -1 flat, 0 natural, 1 sharp
  kind: string;       // MusicXML <kind> value
  bassStep?: string;
  bassAlter?: number;
}

// ─── Quality table ────────────────────────────────────────────────────────────
// Ordered longest-first so more specific entries match before general ones.
// Each entry: [quality suffix after root+accidental, MusicXML kind value]
const QUALITY_ENTRIES: readonly [string, string][] = [
  // ── Major seventh variants ─────────────────────────────────────────────
  ["maj7",    "major-seventh"],
  ["M7",      "major-seventh"],
  ["ma7",     "major-seventh"],
  ["^7",      "major-seventh"],
  ["△7",      "major-seventh"],
  ["Δ7",      "major-seventh"],
  // ── Minor-major seventh ────────────────────────────────────────────────
  ["m(maj7)", "major-minor"],
  ["m(M7)",   "major-minor"],
  ["mMaj7",   "major-minor"],
  ["mM7",     "major-minor"],
  ["-maj7",   "major-minor"],
  // ── Half-diminished (m7b5 / ø) ────────────────────────────────────────
  ["m7b5",    "half-diminished"],
  ["-7b5",    "half-diminished"],
  ["ø7",      "half-diminished"],
  ["Ø7",      "half-diminished"],
  ["ø",       "half-diminished"],
  ["Ø",       "half-diminished"],
  // ── Diminished seventh ────────────────────────────────────────────────
  ["dim7",    "diminished-seventh"],
  ["°7",      "diminished-seventh"],
  ["o7",      "diminished-seventh"],
  // ── Diminished triad ──────────────────────────────────────────────────
  ["dim",     "diminished"],
  ["°",       "diminished"],
  ["o",       "diminished"],
  // ── Augmented seventh ─────────────────────────────────────────────────
  ["aug7",    "augmented-seventh"],
  ["+7",      "augmented-seventh"],
  // ── Augmented triad ───────────────────────────────────────────────────
  ["aug",     "augmented"],
  ["+",       "augmented"],
  // ── Major ninth / eleventh / thirteenth ───────────────────────────────
  ["maj9",    "major-ninth"],
  ["M9",      "major-ninth"],
  ["^9",      "major-ninth"],
  ["△9",      "major-ninth"],
  ["maj11",   "major-11th"],
  ["M11",     "major-11th"],
  ["maj13",   "major-13th"],
  ["M13",     "major-13th"],
  // ── Minor seventh ─────────────────────────────────────────────────────
  ["m7",      "minor-seventh"],
  ["min7",    "minor-seventh"],
  ["mi7",     "minor-seventh"],
  ["-7",      "minor-seventh"],
  // ── Minor ninth / eleventh / thirteenth ───────────────────────────────
  ["m9",      "minor-ninth"],
  ["min9",    "minor-ninth"],
  ["mi9",     "minor-ninth"],
  ["-9",      "minor-ninth"],
  ["m11",     "minor-11th"],
  ["min11",   "minor-11th"],
  ["-11",     "minor-11th"],
  ["m13",     "minor-13th"],
  ["min13",   "minor-13th"],
  ["-13",     "minor-13th"],
  // ── Minor sixth ───────────────────────────────────────────────────────
  ["m6",      "minor-sixth"],
  ["min6",    "minor-sixth"],
  ["-6",      "minor-sixth"],
  // ── Minor triad ───────────────────────────────────────────────────────
  ["m",       "minor"],
  ["min",     "minor"],
  ["mi",      "minor"],
  ["-",       "minor"],
  // ── Dominant 7 / 9 / 11 / 13 ─────────────────────────────────────────
  ["7",       "dominant"],
  ["9",       "dominant-ninth"],
  ["11",      "dominant-11th"],
  ["13",      "dominant-13th"],
  // ── Major sixth ───────────────────────────────────────────────────────
  ["6",       "major-sixth"],
  // ── Suspended ────────────────────────────────────────────────────────
  ["sus2",    "suspended-second"],
  ["sus4",    "suspended-fourth"],
  ["sus",     "suspended-fourth"],
  // ── Power chord ───────────────────────────────────────────────────────
  ["5",       "power"],
  // ── Major triad — explicit or empty (must be last) ───────────────────
  ["",        "major"],
  ["maj",     "major"],
  ["M",       "major"],
  ["major",   "major"],
  ["△",       "major"],
  ["^",       "major"],
  ["Δ",       "major"],
];

// Build sorted list (longest key first for greedy matching)
const QUALITY_SORTED = [...QUALITY_ENTRIES].sort((a, b) => b[0].length - a[0].length);

// ─── KIND → display suffix (mirrors KIND_SUFFIX_MAP in musicXMLtochordpro) ──
const KIND_TO_SUFFIX: Record<string, string> = {
  major:                "",
  minor:                "m",
  diminished:           "dim",
  augmented:            "aug",
  "suspended-second":   "sus2",
  "suspended-fourth":   "sus4",
  "major-sixth":        "6",
  "minor-sixth":        "m6",
  dominant:             "7",
  "major-seventh":      "maj7",
  "minor-seventh":      "m7",
  "diminished-seventh": "dim7",
  "augmented-seventh":  "aug7",
  "half-diminished":    "m7b5",
  "major-minor":        "mmaj7",
  "dominant-ninth":     "9",
  "major-ninth":        "maj9",
  "minor-ninth":        "m9",
  "dominant-11th":      "11",
  "major-11th":         "maj11",
  "minor-11th":         "m11",
  "dominant-13th":      "13",
  "major-13th":         "maj13",
  "minor-13th":         "m13",
  power:                "5",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseAlter(s: string): number {
  return s === "#" ? 1 : s === "b" ? -1 : 0;
}

function alterToAccidental(alter: number): string {
  return alter === 1 ? "#" : alter === -1 ? "b" : "";
}

// ─── Gate pattern ────────────────────────────────────────────────────────────
// Quick pre-check before attempting detailed parsing. The gate is intentionally
// permissive — it blocks obvious non-chords (dynamics like "mf", text like
// "D.S. al Coda") while allowing any string that could plausibly be a chord.
// False positives are fine; the quality table below is the real filter.
const GATE_RE = /^[A-G][#b]?[a-zA-Z\d+°øØ△Δ\-\^#]*(?:\/[A-G][#b]?)?$/u;

const ROOT_RE = /^([A-G])([#b]?)/;
const BASS_RE = /\/([A-G])([#b]?)$/;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Try to parse a free-text chord symbol.
 * Returns null if the text is not recognisable as a chord.
 */
export function parseChordSymbol(text: string): ParsedChordSymbol | null {
  const trimmed = text.trim();
  if (!trimmed || !GATE_RE.test(trimmed)) return null;

  const rootMatch = trimmed.match(ROOT_RE);
  if (!rootMatch) return null;

  const rootStep = rootMatch[1];
  const rootAlter = parseAlter(rootMatch[2]);
  let rest = trimmed.slice(rootMatch[0].length);

  // Extract optional slash bass
  let bassStep: string | undefined;
  let bassAlter: number | undefined;
  const bassMatch = rest.match(BASS_RE);
  if (bassMatch) {
    bassStep = bassMatch[1];
    bassAlter = parseAlter(bassMatch[2]);
    rest = rest.slice(0, rest.length - bassMatch[0].length);
  }

  // Match quality (longest key first)
  let kind: string | undefined;
  for (const [key, value] of QUALITY_SORTED) {
    if (rest === key) {
      kind = value;
      break;
    }
  }
  if (kind === undefined) return null;

  return { rootStep, rootAlter, kind, bassStep, bassAlter };
}

/**
 * Convert a ParsedChordSymbol to the same chord-text format that
 * harmonyToChordText() produces in musicXMLtochordpro.ts.
 */
export function parsedChordToText(parsed: ParsedChordSymbol): string {
  const root = `${parsed.rootStep}${alterToAccidental(parsed.rootAlter)}`;
  const suffix = KIND_TO_SUFFIX[parsed.kind] ?? "";
  const bass = parsed.bassStep
    ? `/${parsed.bassStep}${alterToAccidental(parsed.bassAlter ?? 0)}`
    : "";
  return `${root}${suffix}${bass}`;
}
