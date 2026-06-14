/**
 * ChordChart.tsx
 *
 * React component that renders a normalized ChordChartDocument in the classic
 * "chord name above lyric" style used by lead-sheet apps.
 *
 * Layout model
 * ─────────────
 * Each ChartLine is rendered as a horizontal row of "pairs".  A pair is one
 * optional chord name stacked above one optional lyric segment:
 *
 *   ┌───────┐ ┌────────┐ ┌──────┐
 *   │  Am   │ │        │ │  G   │
 *   │ Hello │ │  there │ │ world│
 *   └───────┘ └────────┘ └──────┘
 *
 * Chord-only lines (no lyrics) are rendered as a row of coloured chord names.
 * Comment tokens are rendered as a full-width italic annotation row.
 *
 * Transpose
 * ─────────
 * Pass `transposeSteps` (positive = up, negative = down) to shift every chord
 * root by that many semitones.  The key shown in the header is transposed too.
 */

import type {
  ChordChartDocument,
  ChartSection,
  ChartLine,
  ChartToken,
} from '../models/ChordChartModel';

// ─── Transpose helpers ────────────────────────────────────────────────────────

export type EnharmonicPreference = 'auto' | 'flats' | 'sharps';

// All-sharps scale used as the canonical semitone index
const CHROMATIC_SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const CHROMATIC_FLATS  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
// Family default: Bb/Eb/Ab flat, C#/F# sharp — ALWAYS (never A#/Db/D#/Gb/G#)
const CHROMATIC_AUTO   = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

/** Normalise flat enharmonics to their sharp equivalents for index lookup. */
const ENHARMONIC: Record<string, string> = {
  Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B',
};

function semitoneToName(semitone: number, pref: EnharmonicPreference, _isMinor = false): string {
  const s = ((semitone % 12) + 12) % 12;
  if (pref === 'sharps') return CHROMATIC_SHARPS[s];
  if (pref === 'flats')  return CHROMATIC_FLATS[s];
  // auto = family default: C# at semitone 1 ALWAYS (major or minor) — never Db
  return CHROMATIC_AUTO[s];
}

function transposeRoot(root: string, steps: number, pref: EnharmonicPreference, isMinor = false): string {
  if (steps === 0) return root;
  const normalized = ENHARMONIC[root] ?? root;
  const idx = CHROMATIC_SHARPS.indexOf(normalized as (typeof CHROMATIC_SHARPS)[number]);
  if (idx === -1) return root;
  return semitoneToName(idx + steps, pref, isMinor);
}

/**
 * Transpose a chord name by `steps` semitones.
 * Handles slash chords (Am/G) by transposing both root and bass separately.
 */
export function transposeChord(chord: string, steps: number, pref: EnharmonicPreference = 'auto'): string {
  if (steps === 0) return chord;

  // Split on the last "/" that looks like a bass note separator
  const slashIdx = chord.lastIndexOf('/');
  if (slashIdx > 0) {
    const upper = chord.slice(0, slashIdx);
    const bass = chord.slice(slashIdx + 1);
    return `${transposeChord(upper, steps, pref)}/${transposeChord(bass, steps, pref)}`;
  }

  const match = chord.match(/^([A-G][#b]?)(.*)$/);
  if (!match) return chord;
  const [, root, rest] = match;
  const isMinor = /^m(?!a)/i.test(rest) || /^dim/i.test(rest);
  return `${transposeRoot(root, steps, pref, isMinor)}${rest}`;
}

// ─── Line-level rendering helpers ─────────────────────────────────────────────

interface Pair {
  chord?: string;
  lyric?: string;
}

/**
 * Group a mixed chord+lyric token list into (chord, lyric) display pairs.
 * Each chord is paired with the lyric text that immediately follows it.
 */
function tokensToPairs(tokens: ChartToken[]): Pair[] {
  const pairs: Pair[] = [];

  for (const token of tokens) {
    if (token.kind === 'chord') {
      pairs.push({ chord: token.text });
    } else if (token.kind === 'lyric') {
      const last = pairs[pairs.length - 1];
      if (last && last.lyric === undefined) {
        last.lyric = token.text;
      } else {
        pairs.push({ lyric: token.text });
      }
    }
    // comment tokens are handled separately before this helper is called
  }

  return pairs;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ChordSpan({ text, steps, pref }: { text: string; steps: number; pref: EnharmonicPreference }) {
  return <span className="cc-chord">{transposeChord(text, steps, pref)}</span>;
}

interface LineProps {
  line: ChartLine;
  steps: number;
  pref: EnharmonicPreference;
}

/**
 * Grid row: renders a pipe-bar-grid line as a row of equal-width measure cells,
 * each showing a chord name with a visible bar-line separator.
 * Each cell = one bar from the original |Chord |Chord |... source line.
 */
function GridRow({ line, steps, pref }: LineProps) {
  const chords = line.tokens.filter((t) => t.kind === 'chord');
  if (chords.length === 0) return null;
  return (
    <div className="cc-line cc-grid-line">
      {chords.map((t, i) => (
        <span key={i} className="cc-grid-cell">
          <ChordSpan text={t.text} steps={steps} pref={pref} />
        </span>
      ))}
    </div>
  );
}

function LineRow({ line, steps, pref }: LineProps) {
  const { tokens } = line;
  if (tokens.length === 0) return null;

  // Pipe-bar-grid line
  if (line.isGrid) {
    return <GridRow line={line} steps={steps} pref={pref} />;
  }

  // Single comment token
  if (tokens.length === 1 && tokens[0].kind === 'comment') {
    return <div className="cc-line cc-comment">{tokens[0].text}</div>;
  }

  const hasChord = tokens.some((t) => t.kind === 'chord');
  const hasLyric = tokens.some((t) => t.kind === 'lyric');

  // Chord-only line (no lyrics)
  if (hasChord && !hasLyric) {
    return (
      <div className="cc-line cc-chords-only">
        {tokens.filter((t) => t.kind === 'chord').map((t, i) => (
          <span key={i} className="cc-chords-only__cell">
            <ChordSpan text={t.text} steps={steps} pref={pref} />
          </span>
        ))}
      </div>
    );
  }

  // Lyric-only line
  if (!hasChord && hasLyric) {
    return (
      <div className="cc-line cc-lyrics-only">
        {tokens.filter((t) => t.kind === 'lyric').map((t, i) => (
          <span key={i}>{t.text}</span>
        ))}
      </div>
    );
  }

  // Mixed chord + lyric → pair layout
  const pairs = tokensToPairs(tokens);
  return (
    <div className="cc-line cc-mixed">
      {pairs.map((pair, i) => (
        <span key={i} className="cc-pair">
          <span className="cc-pair__chord">
            {pair.chord ? <ChordSpan text={pair.chord} steps={steps} pref={pref} /> : '\u00A0'}
          </span>
          <span className="cc-pair__lyric">{pair.lyric ?? ''}</span>
        </span>
      ))}
    </div>
  );
}

function SectionBlock({ section, steps, pref }: { section: ChartSection; steps: number; pref: EnharmonicPreference }) {
  const label = section.label ?? (section.type !== 'unknown' ? section.type : undefined);
  return (
    <div className="cc-section">
      {label && <div className="cc-section-label">{label}</div>}
      {section.lines.map((line, i) => (
        <LineRow key={i} line={line} steps={steps} pref={pref} />
      ))}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export interface ChordChartProps {
  document: ChordChartDocument;
  /** Semitones to shift every chord (positive = up, negative = down). */
  transposeSteps?: number;
  /** Whether to spell transposed accidentals as sharps, flats, or auto (golden rule). */
  enharmonicPreference?: EnharmonicPreference;
  /** Render sections in two newspaper-style columns for compact print layout. */
  twoColumn?: boolean;
  /** Font size as a percentage of the base size (default 100). */
  fontSize?: number;
}

export default function ChordChart({ document: doc, transposeSteps = 0, enharmonicPreference = 'auto', twoColumn = false, fontSize = 100 }: ChordChartProps) {
  const displayKey =
    doc.key ? transposeChord(doc.key, transposeSteps, enharmonicPreference) : undefined;

  return (
    <div
      className={twoColumn ? 'chord-chart chord-chart--two-col' : 'chord-chart'}
      style={fontSize !== 100 ? { fontSize: `${fontSize}%` } : undefined}
    >
      {(doc.title || doc.artist) && (
        <div className="cc-header">
          {doc.title && <h2 className="cc-title">{doc.title}</h2>}
          {doc.artist && <p className="cc-artist">{doc.artist}</p>}
          {doc.subtitle && <p className="cc-subtitle">{doc.subtitle}</p>}
          {(displayKey || doc.capo || doc.tempo || doc.time) && (
            <div className="cc-meta">
              {displayKey && <span>Key: {displayKey}</span>}
              {doc.capo && <span>Capo: {doc.capo}</span>}
              {doc.tempo && <span>Tempo: {doc.tempo}</span>}
              {doc.time && <span>Time: {doc.time}</span>}
            </div>
          )}
        </div>
      )}

      {doc.sections.length === 0 && (
        <p className="cc-empty">No content found in this chord chart.</p>
      )}

      {doc.sections.map((section, i) => (
        <SectionBlock key={i} section={section} steps={transposeSteps} pref={enharmonicPreference} />
      ))}
    </div>
  );
}
