import { useEffect, useRef, useState } from 'react';
import {
  Renderer,
  TabStave,
  TabNote,
  Voice,
  Formatter,
  GhostNote,
  Annotation,
  BarlineType,
  type RenderContext,
} from 'vexflow';
import type { VexTabMeasure, VexTabScore } from '../converters/musicXMLtoVexFlow';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface VexFlowTabRendererProps {
  scoreData: VexTabScore;
  tuning: string[];
  fontSize: number;
  measuresPerRow: number;
  onRenderError?: (err: string) => void;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const STAVE_X_MARGIN = 20;
const STAVE_Y_START = 50;
const ROW_HEIGHT = 140;      // px between stave top-edges for successive rows
const CLEF_WIDTH = 60;       // extra x reserved for tab clef on row-first stave
const TIME_SIG_WIDTH = 30;   // extra x reserved when time sig is shown

// ─── Component ────────────────────────────────────────────────────────────────

export default function VexFlowTabRenderer({
  scoreData,
  fontSize,
  measuresPerRow,
  onRenderError,
}: VexFlowTabRendererProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // Track container width via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 800;
      if (w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-render VexFlow whenever score or settings change
  useEffect(() => {
    const el = containerRef.current;
    if (!el || scoreData.measures.length === 0) return;

    try {
      renderScore(el, scoreData, { containerWidth, fontSize, measuresPerRow });
      onRenderError?.('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onRenderError?.(msg);
    }
  }, [scoreData, containerWidth, fontSize, measuresPerRow, onRenderError]);

  if (scoreData.measures.length === 0) {
    return (
      <div className="tab-empty">
        <p>No notes found in the selected part.</p>
        {scoreData.warnings.length > 0 && (
          <ul>{scoreData.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="tab-container" />
  );
}

// ─── Imperative rendering ─────────────────────────────────────────────────────

interface RenderOptions {
  containerWidth: number;
  fontSize: number;
  measuresPerRow: number;
}

function renderScore(
  container: HTMLDivElement,
  score: VexTabScore,
  opts: RenderOptions,
): void {
  container.innerHTML = '';

  const { containerWidth, fontSize, measuresPerRow } = opts;
  const { measures } = score;

  const totalRows = Math.ceil(measures.length / measuresPerRow);
  const svgWidth = Math.max(containerWidth, 200);
  const svgHeight = STAVE_Y_START + totalRows * ROW_HEIGHT + 40;

  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(svgWidth, svgHeight);
  const ctx = renderer.getContext();
  ctx.setFont('Arial', fontSize);

  // Title & composer
  if (score.title) {
    ctx.save();
    ctx.setFont('Arial', fontSize + 4);
    ctx.fillText(score.title, svgWidth / 2 - score.title.length * (fontSize * 0.35), 22);
    ctx.restore();
  }

  for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
    const rowStart = rowIdx * measuresPerRow;
    const rowEnd = Math.min(rowStart + measuresPerRow, measures.length);
    const rowMeasures = measures.slice(rowStart, rowEnd);
    const isFirstRow = rowIdx === 0;

    renderRow(ctx, rowMeasures, {
      rowIdx,
      isFirstRow,
      svgWidth,
      fontSize,
      defaultTimeSig: score.timeSignature,
    });
  }
}

interface RowOptions {
  rowIdx: number;
  isFirstRow: boolean;
  svgWidth: number;
  fontSize: number;
  defaultTimeSig: { beats: number; beatType: number };
}

function renderRow(
  ctx: RenderContext,
  measures: VexTabMeasure[],
  opts: RowOptions,
): void {
  const { rowIdx, isFirstRow, svgWidth, defaultTimeSig } = opts;
  const yTop = STAVE_Y_START + rowIdx * ROW_HEIGHT;

  // Calculate how much extra space the first stave needs (clef + possibly time sig)
  const firstMeasure = measures[0];
  const firstTimeSig = isFirstRow
    ? `${defaultTimeSig.beats}/${defaultTimeSig.beatType}`
    : firstMeasure?.timeSignature
      ? `${firstMeasure.timeSignature.beats}/${firstMeasure.timeSignature.beatType}`
      : null;

  const firstStaveExtra = CLEF_WIDTH + (firstTimeSig ? TIME_SIG_WIDTH : 0);

  const totalStaveWidth = svgWidth - STAVE_X_MARGIN * 2;
  const measureWidth = (totalStaveWidth - firstStaveExtra) / measures.length;

  let x = STAVE_X_MARGIN;

  for (let mIdx = 0; mIdx < measures.length; mIdx++) {
    const measure = measures[mIdx];
    const isFirstInRow = mIdx === 0;

    // Stave width: first measure gets extra room for clef
    const staveWidth = isFirstInRow ? measureWidth + firstStaveExtra : measureWidth;

    const stave = new TabStave(x, yTop, staveWidth);

    if (isFirstInRow) {
      stave.addClef('tab');
      const timeSigToShow = isFirstRow
        ? `${defaultTimeSig.beats}/${defaultTimeSig.beatType}`
        : measure.timeSignature
          ? `${measure.timeSignature.beats}/${measure.timeSignature.beatType}`
          : null;
      if (timeSigToShow) {
        stave.addTimeSignature(timeSigToShow);
      }
    } else if (measure.timeSignature) {
      stave.addTimeSignature(
        `${measure.timeSignature.beats}/${measure.timeSignature.beatType}`,
      );
    }

    // Repeat barlines
    if (measure.repeatStart) {
      stave.setBegBarType(BarlineType.REPEAT_BEGIN);
    }
    if (measure.repeatEnd) {
      stave.setEndBarType(BarlineType.REPEAT_END);
    }

    stave.setContext(ctx).draw();

    // Build voice
    if (measure.notes.length > 0) {
      renderMeasureNotes(ctx, stave, measure, defaultTimeSig);
    }

    x += staveWidth;
  }
}

function renderMeasureNotes(
  ctx: RenderContext,
  stave: TabStave,
  measure: VexTabMeasure,
  timeSig: { beats: number; beatType: number },
): void {
  const tickables = measure.notes.map((note, idx): TabNote | GhostNote => {
    if (note.isRest || note.positions.every((p) => p.fret === 'x')) {
      return new GhostNote({ duration: note.duration.replace('d', '') });
    }

    const tabNote = new TabNote({
      positions: note.positions.map((p) => ({ str: p.str, fret: p.fret })),
      duration: note.duration.replace('d', ''),  // VexFlow handles dots separately
    });

    // Attach chord symbol annotation above the stave
    const sym = measure.chordSymbols.find((cs) => cs.noteIndex === idx);
    if (sym) {
      const ann = new Annotation(sym.text)
        .setVerticalJustification(Annotation.VerticalJustify.TOP);
      tabNote.addModifier(ann, 0);
    }

    return tabNote;
  });

  const voice = new Voice({ numBeats: timeSig.beats, beatValue: timeSig.beatType });
  voice.setMode(Voice.Mode.SOFT);
  voice.addTickables(tickables);

  try {
    new Formatter().joinVoices([voice]).format([voice], stave.getWidth() - 30);
  } catch {
    // If formatting fails (e.g. mismatched tick count), just attempt to draw anyway
  }

  voice.draw(ctx, stave);
}
