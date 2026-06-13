/**
 * StageModeModal.tsx — UI for "Stage Mode": chord-free lyric sheets for live use.
 *
 * Shows a dark, large-type, lyrics-only preview of the current chart and lets the
 * performer export a stage-ready PDF, a standalone auto-scrolling HTML page, or a
 * batch ZIP (one PDF per song) built from a multi-file selection.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { EnharmonicPreference } from '../renderers/ChordChart';
import type { SourceFormat } from '../ingest/sniffFormat';
import {
  extractStageSheet,
  buildStagePdf,
  buildStageHtml,
  buildStageZip,
  DEFAULT_STAGE_STYLE,
  NEON_TEXT_COLOR,
  type StageStyle,
  type StagePageSize,
  type StageOrientation,
  type StageLyricSheet,
} from './stageMode';
import { filesToStageEntries } from './stageBatch';

export interface StageModeModalProps {
  open: boolean;
  onClose: () => void;
  /** Raw source text of the currently loaded chart. */
  sourceText: string;
  sourceFormat: SourceFormat;
  transposeSteps: number;
  enharmonicPreference: EnharmonicPreference;
  /** Base filename (no extension) for downloads. */
  baseFilename: string;
  defaultPageSize: StagePageSize;
  onFeedback: (type: 'success' | 'error', message: string) => void;
}

type ColorScheme = 'white' | 'neon';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function metaLine(sheet: StageLyricSheet): string {
  const parts: string[] = [];
  if (sheet.key) parts.push(`Key: ${sheet.key}`);
  if (sheet.tempo) parts.push(`${sheet.tempo}${/\d$/.test(sheet.tempo) ? ' BPM' : ''}`);
  if (sheet.capo) parts.push(`Capo: ${sheet.capo}`);
  return parts.join('  |  ');
}

export default function StageModeModal({
  open,
  onClose,
  sourceText,
  sourceFormat,
  transposeSteps,
  enharmonicPreference,
  baseFilename,
  defaultPageSize,
  onFeedback,
}: StageModeModalProps) {
  const [pageSize, setPageSize] = useState<StagePageSize>(defaultPageSize);
  const [orientation, setOrientation] = useState<StageOrientation>('portrait');
  const [colorScheme, setColorScheme] = useState<ColorScheme>('white');
  const [secPerLine, setSecPerLine] = useState(4);
  const [combined, setCombined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoScroll, setAutoScroll] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setPageSize(defaultPageSize); }, [defaultPageSize]);

  const sheet = useMemo<StageLyricSheet>(
    () => extractStageSheet(sourceText, sourceFormat, { transposeSteps, enharmonicPreference }),
    [sourceText, sourceFormat, transposeSteps, enharmonicPreference],
  );

  const textColor = colorScheme === 'neon' ? NEON_TEXT_COLOR : '#FFFFFF';

  const style = useMemo<StageStyle>(() => ({
    ...DEFAULT_STAGE_STYLE,
    pageSize,
    orientation,
    textColor,
  }), [pageSize, orientation, textColor]);

  // Auto-scroll the on-screen preview.
  useEffect(() => {
    if (!open || !autoScroll) return;
    const el = previewRef.current;
    if (!el) return;
    let raf = 0;
    let last: number | null = null;
    const lineH = DEFAULT_STAGE_STYLE.bodySize * DEFAULT_STAGE_STYLE.lineSpacing;
    const step = (ts: number) => {
      if (last == null) last = ts;
      const dt = (ts - last) / 1000;
      last = ts;
      el.scrollTop += (lineH / secPerLine) * dt;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) { setAutoScroll(false); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [open, autoScroll, secPerLine]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handlePdf = () => {
    try {
      const pdf = buildStagePdf(sheet, style);
      downloadBlob(pdf.output('blob'), `${baseFilename}-stage.pdf`);
      onFeedback('success', 'Stage PDF downloaded.');
    } catch (err) {
      onFeedback('error', `Stage PDF failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleHtml = () => {
    try {
      const html = buildStageHtml(sheet, style, { secondsPerLine: secPerLine });
      downloadBlob(new Blob([html], { type: 'text/html' }), `${baseFilename}-stage.html`);
      onFeedback('success', 'Auto-scroll HTML downloaded.');
    } catch (err) {
      onFeedback('error', `HTML export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleBatch = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    try {
      const { entries, failures } = await filesToStageEntries(Array.from(fileList), {
        transposeSteps,
        enharmonicPreference,
      });
      if (entries.length === 0) {
        onFeedback('error', `No usable charts found${failures.length ? ` (${failures.length} skipped)` : ''}.`);
        return;
      }
      const blob = await buildStageZip(entries, style, { combined, combinedName: 'stage-set' });
      downloadBlob(blob, 'stage-mode-lyrics.zip');
      const skipped = failures.length ? ` ${failures.length} skipped.` : '';
      onFeedback('success', `Stage ZIP ready: ${entries.length} song(s).${skipped}`);
    } catch (err) {
      onFeedback('error', `Batch export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const meta = metaLine(sheet);

  return (
    <div className="stage-modal-backdrop" role="dialog" aria-modal="true" aria-label="Stage Mode" onClick={onClose}>
      <div className="stage-modal" onClick={(e) => e.stopPropagation()}>
        <header className="stage-modal__bar">
          <h2 className="stage-modal__title">🎤 Stage Mode — Lyrics Only</h2>
          <button type="button" className="stage-modal__close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="stage-modal__controls">
          <label>Page
            <select value={pageSize} onChange={(e) => setPageSize(e.target.value as StagePageSize)}>
              <option value="letter">US Letter</option>
              <option value="a4">A4</option>
            </select>
          </label>
          <label>Orientation
            <select value={orientation} onChange={(e) => setOrientation(e.target.value as StageOrientation)}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label>Text
            <select value={colorScheme} onChange={(e) => setColorScheme(e.target.value as ColorScheme)}>
              <option value="white">White on black</option>
              <option value="neon">Neon on black</option>
            </select>
          </label>
          <label>Scroll
            <input
              type="range" min={1} max={10} step={0.5}
              value={secPerLine}
              onChange={(e) => setSecPerLine(Number(e.target.value))}
            />
            <span className="stage-modal__speedval">{secPerLine}s/line</span>
          </label>
          <button
            type="button"
            className={autoScroll ? 'btn-sm btn-primary' : 'btn-sm'}
            onClick={() => setAutoScroll((s) => !s)}
          >
            {autoScroll ? '❚❚ Pause' : '▶ Preview scroll'}
          </button>
        </div>

        <div
          ref={previewRef}
          className="stage-preview"
          style={{ background: '#000000', color: textColor }}
        >
          {sheet.title && <h1 className="stage-preview__title">{sheet.title}</h1>}
          {sheet.artist && <div className="stage-preview__artist">{sheet.artist}</div>}
          {meta && <div className="stage-preview__meta" style={{ borderColor: textColor }}>{meta}</div>}
          {sheet.sections.length === 0 && (
            <p className="stage-preview__empty">No lyrics found to display.</p>
          )}
          {sheet.sections.map((section, si) => (
            <section key={si} className="stage-preview__section">
              {section.header && <h2 className="stage-preview__header">{section.header}</h2>}
              {section.lines.map((line, li) => (
                line === ''
                  ? <div key={li} className="stage-preview__break" />
                  : <div key={li} className="stage-preview__line">{line}</div>
              ))}
            </section>
          ))}
        </div>

        <footer className="stage-modal__actions">
          <button type="button" className="btn-primary" onClick={handlePdf}>⬇ Stage PDF</button>
          <button type="button" onClick={handleHtml}>⬇ Auto-scroll HTML</button>
          <span className="stage-modal__divider" aria-hidden="true" />
          <label className="stage-modal__checkbox">
            <input type="checkbox" checked={combined} onChange={(e) => setCombined(e.target.checked)} />
            + combined PDF
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            title="Select multiple ChordPro/PDF files to export a ZIP of stage PDFs"
          >
            {busy ? 'Processing…' : '⬇ Batch ZIP from files…'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".cho,.chopro,.crd,.pro,.txt,.pdf"
            style={{ display: 'none' }}
            onChange={(e) => void handleBatch(e.target.files)}
          />
        </footer>
      </div>
    </div>
  );
}
