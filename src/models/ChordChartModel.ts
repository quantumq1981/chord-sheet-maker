/**
 * ChordChartModel.ts
 *
 * Normalized internal model for text-based chord charts.  This is the
 * "ChordChartModel" described in the ecosystem analysis — a format-agnostic
 * representation of sections, lines, and tokens produced by any of the supported
 * text-chart parsers (ChordPro, Ultimate Guitar, chords-over-words).
 */

import type { SourceFormat } from '../ingest/sniffFormat';

// ─── Token types ─────────────────────────────────────────────────────────────

export interface ChordToken {
  kind: 'chord';
  /** Raw chord name as found in the source, e.g. "Am7", "F#/A", "Bbmaj7". */
  text: string;
}

export interface LyricToken {
  kind: 'lyric';
  text: string;
}

export interface CommentToken {
  kind: 'comment';
  text: string;
}

export type ChartToken = ChordToken | LyricToken | CommentToken;

// ─── Line ────────────────────────────────────────────────────────────────────

export interface ChartLine {
  tokens: ChartToken[];
}

// ─── Section ─────────────────────────────────────────────────────────────────

export type SectionType =
  | 'verse'
  | 'chorus'
  | 'bridge'
  | 'intro'
  | 'outro'
  | 'pre-chorus'
  | 'interlude'
  | 'solo'
  | 'grid'
  | 'tab'
  | 'unknown';

export interface ChartSection {
  type: SectionType;
  /** Human-readable label, e.g. "Verse 1", "Chorus". */
  label?: string;
  lines: ChartLine[];
}

// ─── Document ────────────────────────────────────────────────────────────────

export interface ChordChartDocument {
  title?: string;
  artist?: string;
  subtitle?: string;
  key?: string;
  capo?: string;
  tempo?: string;
  time?: string;
  sections: ChartSection[];
  /** Which parser produced this document. */
  sourceFormat: SourceFormat;
}
