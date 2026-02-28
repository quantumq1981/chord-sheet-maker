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

const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Normalise flat enharmonics to their sharp equivalents for lookup. */
const ENHARMONIC: Record<string, string> = {
  Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B',
};

function transposeRoot(root: string, steps: number): string {
  if (steps === 0) return root;
  const normalized = ENHARMONIC[root] ?? root;
  const idx = CHROMATIC.indexOf(normalized as (typeof CHROMATIC)[number]);
  if (idx === -1) return root;
  return CHROMATIC[((idx + steps) % 12 + 12) % 12];
}

/**
 * Transpose a chord name by `steps` semitones.
 * Handles slash chords (Am/G) by transposing both root and bass separately.
 */
export function transposeChord(chord: string, steps: number): string {
  if (steps === 0) return chord;

  // Split on the last "/" that looks like a bass note separator
  const slashIdx = chord.lastIndexOf('/');
  if (slashIdx > 0) {
    const upper = chord.slice(0, slashIdx);
    const bass = chord.slice(slashIdx + 1);
    return `${transposeChord(upper, steps)}/${transposeChord(bass, steps)}`;
  }

  const match = chord.match(/^([A-G][#b]?)(.*)$/);
  if (!match) return chord;
  const [, root, rest] = match;
  return `${transposeRoot(root, steps)}${rest}`;
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

function ChordSpan({ text, steps }: { text: string; steps: number }) {
  return <span className="cc-chord">{transposeChord(text, steps)}</span>;
}

interface LineProps {
  line: ChartLine;
  steps: number;
}

function LineRow({ line, steps }: LineProps) {
  const { tokens } = line;
  if (tokens.length === 0) return null;

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
            <ChordSpan text={t.text} steps={steps} />
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
            {pair.chord ? <ChordSpan text={pair.chord} steps={steps} /> : '\u00A0'}
          </span>
          <span className="cc-pair__lyric">{pair.lyric ?? ''}</span>
        </span>
      ))}
    </div>
  );
}

function SectionBlock({ section, steps }: { section: ChartSection; steps: number }) {
  const label = section.label ?? (section.type !== 'unknown' ? section.type : undefined);
  return (
    <div className="cc-section">
      {label && <div className="cc-section-label">{label}</div>}
      {section.lines.map((line, i) => (
        <LineRow key={i} line={line} steps={steps} />
      ))}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export interface ChordChartProps {
  document: ChordChartDocument;
  /** Semitones to shift every chord (positive = up, negative = down). */
  transposeSteps?: number;
}

export default function ChordChart({ document: doc, transposeSteps = 0 }: ChordChartProps) {
  const displayKey =
    doc.key ? transposeChord(doc.key, transposeSteps) : undefined;

  return (
    <div className="chord-chart">
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
        <SectionBlock key={i} section={section} steps={transposeSteps} />
      ))}
    </div>
  );
}
