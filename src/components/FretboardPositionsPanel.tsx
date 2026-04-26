// Fretboard diagram panel showing all possible fingering positions for every
// pitch found in the loaded score.
//
// Layout: a scrollable list of note names on the left; clicking one highlights
// all of its valid (string, fret) positions on a classic fretboard SVG diagram.

import { useState } from 'react';
import type { NotePositionMap } from '../converters/musicXMLtoVexFlow';

interface Props {
  notePositions: NotePositionMap[];
  stringCount: number; // e.g. 6 for standard guitar, 4 for bass
}

// Diagram dimensions (SVG units).
const FRET_COUNT = 22;
const STRING_SPACING = 22;
const FRET_SPACING = 32;
const MARGIN_LEFT = 36;
const MARGIN_TOP = 24;
const NUT_WIDTH = 4;
const DOT_R = 8;

const DIAGRAM_WIDTH = MARGIN_LEFT + FRET_COUNT * FRET_SPACING + 20;

function FretboardDiagram({
  positions,
  stringCount,
}: {
  positions: NotePositionMap['positions'];
  stringCount: number;
}) {
  const height = MARGIN_TOP + (stringCount - 1) * STRING_SPACING + 20;

  // x position of a fret marker (centre of fret slot)
  const fretX = (fret: number) =>
    fret === 0
      ? MARGIN_LEFT - NUT_WIDTH / 2 - DOT_R / 2
      : MARGIN_LEFT + (fret - 0.5) * FRET_SPACING;

  // y position of a string (string 1 = highest = top)
  const stringY = (str: number) => MARGIN_TOP + (str - 1) * STRING_SPACING;

  return (
    <svg
      viewBox={`0 0 ${DIAGRAM_WIDTH} ${height}`}
      width="100%"
      className="fretboard-svg"
      aria-label="Fretboard diagram"
    >
      {/* Nut */}
      <rect
        x={MARGIN_LEFT - NUT_WIDTH}
        y={MARGIN_TOP}
        width={NUT_WIDTH}
        height={(stringCount - 1) * STRING_SPACING}
        fill="#1e293b"
      />

      {/* Strings */}
      {Array.from({ length: stringCount }, (_, i) => (
        <line
          key={`str-${i}`}
          x1={MARGIN_LEFT}
          y1={stringY(i + 1)}
          x2={MARGIN_LEFT + FRET_COUNT * FRET_SPACING}
          y2={stringY(i + 1)}
          stroke="#94a3b8"
          strokeWidth={i === stringCount - 1 ? 2.5 : 1}
        />
      ))}

      {/* Fret wires */}
      {Array.from({ length: FRET_COUNT + 1 }, (_, f) => (
        <line
          key={`fret-${f}`}
          x1={MARGIN_LEFT + f * FRET_SPACING}
          y1={stringY(1)}
          x2={MARGIN_LEFT + f * FRET_SPACING}
          y2={stringY(stringCount)}
          stroke="#cbd5e1"
          strokeWidth={1}
        />
      ))}

      {/* Fret position markers (3, 5, 7, 9, 12, 15, 17, 19, 21) */}
      {[3, 5, 7, 9, 15, 17, 19, 21].map((f) => (
        <circle
          key={`marker-${f}`}
          cx={MARGIN_LEFT + (f - 0.5) * FRET_SPACING}
          cy={stringY(Math.ceil(stringCount / 2))}
          r={3}
          fill="#cbd5e1"
        />
      ))}
      {/* Double dot at 12 */}
      {[stringCount <= 4 ? [2, 3] : [2, 5]].map((strPair) =>
        strPair.map((s) => (
          <circle
            key={`dot12-${s}`}
            cx={MARGIN_LEFT + 11.5 * FRET_SPACING}
            cy={stringY(s)}
            r={3}
            fill="#cbd5e1"
          />
        ))
      )}

      {/* Fret number labels */}
      {[1, 3, 5, 7, 9, 12, 15, 17, 19, 21].map((f) => (
        <text
          key={`fnum-${f}`}
          x={MARGIN_LEFT + (f - 0.5) * FRET_SPACING}
          y={height - 4}
          textAnchor="middle"
          fontSize={9}
          fill="#64748b"
        >
          {f}
        </text>
      ))}

      {/* Open string label */}
      <text
        x={MARGIN_LEFT - NUT_WIDTH - 4}
        y={stringY(1) + 4}
        textAnchor="middle"
        fontSize={8}
        fill="#64748b"
      >
        0
      </text>

      {/* Highlighted note positions */}
      {positions.map((pos, idx) => {
        const cx = fretX(pos.fret as number);
        const cy = stringY(pos.str);
        return (
          <g key={idx}>
            <circle cx={cx} cy={cy} r={DOT_R} fill="#2563eb" opacity={0.9} />
            <text
              x={cx}
              y={cy + 4}
              textAnchor="middle"
              fontSize={9}
              fontWeight="bold"
              fill="#fff"
            >
              {pos.fret}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function FretboardPositionsPanel({ notePositions, stringCount }: Props) {
  const [selectedMidi, setSelectedMidi] = useState<number | null>(
    notePositions.length > 0 ? notePositions[0].midi : null,
  );

  if (notePositions.length === 0) {
    return <p className="at-panel-empty">No note positions to display.</p>;
  }

  const selected = notePositions.find((n) => n.midi === selectedMidi) ?? notePositions[0];

  return (
    <div className="fretboard-panel">
      <h2>All Fingering Positions</h2>
      <p className="fretboard-hint">
        Click a note to see every position where it can be played across the fretboard.
      </p>

      {/* Note picker */}
      <div className="fretboard-note-list">
        {notePositions.map((n) => (
          <button
            key={n.midi}
            type="button"
            className={`fretboard-note-btn${n.midi === selected.midi ? ' active' : ''}`}
            onClick={() => setSelectedMidi(n.midi)}
          >
            <span className="note-name">{n.name}</span>
            <span className="note-pos-count">{n.positions.length} pos</span>
          </button>
        ))}
      </div>

      {/* Selected note heading */}
      <div className="fretboard-selected-heading">
        <strong>{selected.name}</strong>
        <span> — {selected.positions.length} position{selected.positions.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Position table */}
      <table className="fretboard-pos-table">
        <thead>
          <tr>
            <th>String</th>
            <th>Fret</th>
          </tr>
        </thead>
        <tbody>
          {selected.positions.map((p, i) => (
            <tr key={i}>
              <td>String {p.str}</td>
              <td>{p.fret === 'x' ? 'muted' : p.fret === 0 ? 'open' : p.fret}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Fretboard diagram */}
      <FretboardDiagram positions={selected.positions} stringCount={stringCount} />
    </div>
  );
}
