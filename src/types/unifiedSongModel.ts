// Unified Song Model — TypeScript types for the cross-format song schema.
// Spec: Unified-Song-Model+Ug-Ascii-JSparser-Techspec.md

export type SemanticTier =
  | 'tier_4_structured'  // MusicXML, LilyPond
  | 'tier_3_fretted'     // Guitar Pro, alphaTab
  | 'tier_2_leadsheet'   // ChordPro, ABC
  | 'tier_1_ascii';      // UG text, ASCII tab, plain text

export type SourceFormatTag =
  | 'musicxml' | 'lilypond'
  | 'gp3' | 'gp4' | 'gp5' | 'gpx' | 'gp' | 'alphatex'
  | 'chordpro' | 'abc'
  | 'ug_text' | 'ascii_tab' | 'plain_text';

export type RenderTheme =
  | 'score' | 'real_book' | 'chordpro' | 'alphatab' | 'ascii_tab' | 'lyrics_sheet';

export type GenrePrimary = 'jazz' | 'rock_blues' | 'folk_pop' | 'orchestral_score' | 'unknown';

export type QualityFamily =
  | 'maj' | 'min' | 'dom7' | 'maj7' | 'min7' | 'maj9'
  | 'min7b5' | 'dim' | 'dim7' | 'aug' | 'aug7'
  | 'sus2' | 'sus4' | 'add9' | '5' | 'unknown';

export interface NormalizedChord {
  root: string | null;
  qualityFamily: QualityFamily | null;
  extensions: string[];
  alterations: string[];
  suspension: string | null;
  bass: string | null;
}

export interface HarmonyEvent {
  measure: number;
  beat: number;
  symbol: string;
  normalized: NormalizedChord;
  sourceNative: string;
  confidence: number;
}

export interface HarmonicFingerprint {
  cowboyChordShare: number;
  dom7Rate: number;
  maj7Rate: number;
  min7b5Rate: number;
  altRate: number;
  powerChordRate: number;
  iiVRate: number;
  simpleMajMinRate: number;
}

export interface GenreGuess {
  primary: GenrePrimary;
  scores: { jazz: number; rock_blues: number; folk_pop: number };
  confidence: number;
}

export interface DensityMetrics {
  lyricDensity: number;
  tabDensity: number;
  chordDensity: number;
  gridDensity: number;
  sectionDensity: number;
}

export interface LossMap {
  rhythmExplicit: boolean;
  voicingExplicit: boolean;
  layoutExplicit: boolean;
  lyricsAligned: boolean;
  warnings: string[];
}

export interface RenderHints {
  preferredTheme: RenderTheme;
  preferredBarsPerLine: number | null;
  hideLyrics: boolean;
  showChordDiagrams: boolean;
  showTab: boolean;
  showConcertKey: boolean;
}

export interface UsmSection {
  id: string;
  label: string;
  type: string;
  startLine: number;
  endLine: number;
  sourceDeclared: boolean;
}

export interface UsmLyricLine {
  text: string;
  sectionId: string | null;
}

export interface TabBlock {
  lines: string[];
  startLine: number;
  endLine: number;
}

export interface UnifiedSongModel {
  schemaVersion: '1.0.0';
  songId: string;
  title: string;
  creators: {
    composer: string[];
    lyricist: string[];
    arranger: string[];
    artist: string[];
  };
  source: {
    format: SourceFormatTag;
    semanticTier: SemanticTier;
    sourceNative: Record<string, unknown>;
    importer: {
      name: string;
      version: string;
      warnings: string[];
    };
  };
  metadata: {
    key: { display: string; concert: string; detected: boolean; confidence: number };
    timeSignature: { numerator: number; denominator: number; pickupBeats: number; changes: unknown[] };
    tempo: { bpm: number; text: string; beatUnit: string; changes: unknown[] };
    capo: { fret: number | null; sourceDeclared: boolean };
    tuning: unknown[];
  };
  structure: {
    sections: UsmSection[];
    repeats: unknown[];
    endings: unknown[];
    rehearsalMarks: unknown[];
  };
  timeline: {
    divisionsPerQuarter: number;
    measures: unknown[];
  };
  parts: unknown[];
  harmony: {
    globalProgression: unknown[];
    events: HarmonyEvent[];
    grid: { present: boolean; cells: unknown[] };
  };
  lyrics: {
    lines: UsmLyricLine[];
    syllableAligned: boolean;
    language: string;
  };
  analytics: {
    density: DensityMetrics;
    harmonicFingerprint: HarmonicFingerprint;
    genreGuess: GenreGuess;
  };
  lossMap: LossMap;
  renderHints: RenderHints;
  /** Convenience: groups of 4+ consecutive ASCII tab lines extracted verbatim. */
  tabBlocks: TabBlock[];
}
