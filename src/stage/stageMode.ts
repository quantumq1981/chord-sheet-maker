/**
 * stageMode.ts — "Stage Mode": chord-free lyric sheets for live performance.
 *
 * Takes the raw source text of a ChordPro / Ultimate-Guitar / chords-over-words
 * chart, strips ALL chord information, and produces a clean, lyrics-only
 * structure (`StageLyricSheet`) plus stage-ready output renderers:
 *
 *   - `buildStagePdf`         → single-song A4/Letter PDF (dark background, big text)
 *   - `buildCombinedStagePdf` → many songs in one PDF, page break between each
 *   - `buildStageHtml`        → standalone auto-scrolling HTML page for iPad/foot-pedal use
 *   - `buildStageZip`         → ZIP of per-song PDFs (+ optional combined PDF)
 *
 * Why strip from RAW text instead of the parsed `ChordChartDocument`?
 * ─────────────────────────────────────────────────────────────────
 * The tokenizer in `chordProParser` calls `trimEnd()` on the lyric segment that
 * precedes the first inline chord on a line (the "pre" token).  That throws away
 * the trailing space, so reconstructing lyrics from tokens jams words together —
 * e.g. "I'm [Am]your vehicle" would come back as "I'myour vehicle".  Stripping the
 * `[...]` brackets directly out of the raw line preserves every space exactly.
 *
 * Metadata (title / artist / key / tempo / capo) IS taken from the parsed
 * document because that logic is shared across all three text dialects.
 */

import { jsPDF } from 'jspdf';
import { parseChordChart, isChordLine, UG_SECTION_RE } from '../parsers/chordProParser';
import { transposeChord, type EnharmonicPreference } from '../renderers/ChordChart';
import type { SourceFormat } from '../ingest/sniffFormat';

// ─── Data model ────────────────────────────────────────────────────────────────

export interface StageLyricSection {
  /** Section heading, e.g. "Verse 1", "Chorus". Absent for a leading body block. */
  header?: string;
  /** Lyric lines. An empty string represents a blank-line paragraph break. */
  lines: string[];
}

export interface StageLyricSheet {
  title?: string;
  artist?: string;
  /** Already transposed for display when a transpose offset is supplied. */
  key?: string;
  tempo?: string;
  capo?: string;
  sections: StageLyricSection[];
}

export interface StageExtractOptions {
  transposeSteps?: number;
  enharmonicPreference?: EnharmonicPreference;
}

// ─── Lyric extraction ───────────────────────────────────────────────────────────

const DIRECTIVE_RE = /^\{([^:}]+)(?::([^}]*))?\}$/;

/** ChordPro metadata directives we consume into the metadata box, not the body. */
const META_DIRECTIVES = new Set([
  'title', 't', 'artist', 'a', 'subtitle', 'st', 'composer', 'key', 'tempo',
  'time', 'capo', 'album', 'year', 'ccli', 'columns', 'col', 'colb',
]);

/** Map a structural / comment directive to a section header (or null to ignore). */
function headerFromDirective(key: string, value?: string): string | null {
  const k = key.toLowerCase();
  if (k === 'comment' || k === 'c' || k === 'comment_italic' || k === 'ci' ||
      k === 'comment_box' || k === 'cb') {
    return value?.trim() || null;
  }
  if (k === 'soc' || k === 'start_of_chorus') return value?.trim() || 'Chorus';
  if (k === 'sov' || k === 'start_of_verse') return value?.trim() || 'Verse';
  if (k === 'sob' || k === 'start_of_bridge') return value?.trim() || 'Bridge';
  return null;
}

/** Remove all inline [chord] brackets and collapse the spaces they leave behind. */
export function stripInlineChords(line: string): string {
  return line
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Drop leading/trailing blank-line markers from a section's line list. */
function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start++;
  while (end > start && lines[end - 1] === '') end--;
  return lines.slice(start, end);
}

/**
 * Strip all chords from a chart's raw text and return a lyrics-only sheet.
 *
 * Handles all three text dialects uniformly:
 *   - ChordPro directives ({c:…}, {soc}, {title:…}, …)
 *   - Ultimate-Guitar section headers ([Verse 1], [Chorus])
 *   - inline bracket chords ([Am]word) and standalone chord lines (chords-over-words)
 */
export function extractStageSheet(
  rawText: string,
  sourceFormat: SourceFormat,
  opts: StageExtractOptions = {},
): StageLyricSheet {
  const { transposeSteps = 0, enharmonicPreference = 'auto' } = opts;

  // Metadata comes from the shared parser (reliable across all dialects).
  const meta = parseChordChart(rawText, sourceFormat);
  const sheet: StageLyricSheet = {
    title: meta.title,
    artist: meta.artist,
    key: meta.key ? transposeChord(meta.key, transposeSteps, enharmonicPreference) : undefined,
    tempo: meta.tempo,
    capo: meta.capo,
    sections: [],
  };

  const sections: StageLyricSection[] = [];
  const startSection = (header?: string) => { sections.push({ header, lines: [] }); };
  const lastSection = (): StageLyricSection | undefined => sections[sections.length - 1];
  const ensureSection = (): StageLyricSection => {
    if (sections.length === 0) sections.push({ lines: [] });
    return sections[sections.length - 1];
  };

  let inTab = false; // skip {start_of_tab}…{end_of_tab} blocks entirely

  for (const rawLine of rawText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    // ── ChordPro directive ──
    const dir = trimmed.match(DIRECTIVE_RE);
    if (dir) {
      const k = dir[1].trim().toLowerCase();
      const v = dir[2]?.trim();
      if (k === 'sot' || k === 'start_of_tab') { inTab = true; continue; }
      if (k === 'eot' || k === 'end_of_tab') { inTab = false; continue; }
      if (META_DIRECTIVES.has(k)) continue; // already captured as metadata
      const header = headerFromDirective(k, v);
      if (header) startSection(header);
      continue; // ignore end-of-section + unknown directives
    }
    if (inTab) continue;

    // ── Blank line → paragraph break within the current section ──
    if (!trimmed) {
      const sec = lastSection();
      if (sec && sec.lines.length && sec.lines[sec.lines.length - 1] !== '') {
        sec.lines.push('');
      }
      continue;
    }

    // ── Line comments ──
    if (trimmed.startsWith('#') || trimmed.startsWith('%')) continue;

    // ── Ultimate-Guitar section header, e.g. [Verse 1] ──
    if (UG_SECTION_RE.test(trimmed)) {
      startSection(trimmed.slice(1, -1).trim());
      continue;
    }

    // ── Standalone chord line (chords-over-words) → drop ──
    if (!trimmed.includes('[') && isChordLine(trimmed)) continue;

    // ── Strip inline chords; skip lines that were nothing but chords ──
    const lyric = stripInlineChords(trimmed);
    if (!lyric) continue;

    ensureSection().lines.push(lyric);
  }

  // Tidy: trim blank edges per section and drop sections with no lyrics
  // (e.g. Intro / Instrumental / Solo sections that were nothing but chords).
  sheet.sections = sections
    .map((s) => ({ ...s, lines: trimBlankEdges(s.lines) }))
    .filter((s) => s.lines.length > 0);

  return sheet;
}

// ─── Stage styling ───────────────────────────────────────────────────────────────

export type StagePageSize = 'letter' | 'a4';
export type StageOrientation = 'portrait' | 'landscape';

export interface StageStyle {
  pageSize: StagePageSize;
  orientation: StageOrientation;
  /** Lyric / header text colour. */
  textColor: string;
  /** Page background colour. */
  bgColor: string;
  /** Point sizes. */
  titleSize: number;
  headerSize: number;
  bodySize: number;
  metaSize: number;
  /** Multiplier applied to body size for inter-line spacing. */
  lineSpacing: number;
}

export const DEFAULT_STAGE_STYLE: StageStyle = {
  pageSize: 'letter',
  orientation: 'portrait',
  textColor: '#FFFFFF',
  bgColor: '#000000',
  titleSize: 40,
  headerSize: 26,
  bodySize: 24,
  metaSize: 14,
  lineSpacing: 1.5,
};

/** Neon-on-black variant (high contrast for dim stages). */
export const NEON_TEXT_COLOR = '#B0FF00';

function metaText(sheet: StageLyricSheet): string {
  const parts: string[] = [];
  if (sheet.key) parts.push(`Key: ${sheet.key}`);
  if (sheet.tempo) parts.push(`${sheet.tempo}${/\d$/.test(sheet.tempo) ? ' BPM' : ''}`);
  if (sheet.capo) parts.push(`Capo: ${sheet.capo}`);
  return parts.join('  |  ');
}

// ─── PDF rendering ────────────────────────────────────────────────────────────────

const PAGE_DIMS_PT: Record<StagePageSize, [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const v = m.length === 3
    ? m.split('').map((c) => c + c).join('')
    : m;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Render a single lyric sheet onto an existing jsPDF document, starting on the
 * current page. Returns when finished (the caller owns page breaks between songs).
 */
function renderSheetIntoPdf(pdf: jsPDF, sheet: StageLyricSheet, style: StageStyle): void {
  const [w, h] = style.orientation === 'landscape'
    ? [...PAGE_DIMS_PT[style.pageSize]].reverse() as [number, number]
    : PAGE_DIMS_PT[style.pageSize];

  const margin = Math.round(Math.min(w, h) * 0.07);
  const contentW = w - margin * 2;
  const [tr, tg, tb] = hexToRgb(style.textColor);
  const [br, bg, bb] = hexToRgb(style.bgColor);

  const paintBackground = () => {
    pdf.setFillColor(br, bg, bb);
    pdf.rect(0, 0, w, h, 'F');
  };
  paintBackground();
  pdf.setTextColor(tr, tg, tb);

  let y = margin;

  const newPage = () => {
    pdf.addPage(style.pageSize, style.orientation);
    paintBackground();
    pdf.setTextColor(tr, tg, tb);
    y = margin;
  };

  const ensureRoom = (lineHeight: number) => {
    if (y + lineHeight > h - margin) newPage();
  };

  // ── Title (centered) ──
  if (sheet.title) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(style.titleSize);
    const titleLines = pdf.splitTextToSize(sheet.title, contentW) as string[];
    const titleLH = style.titleSize * 1.15;
    for (const tl of titleLines) {
      ensureRoom(titleLH);
      pdf.text(tl, w / 2, y + titleLH * 0.8, { align: 'center' });
      y += titleLH;
    }
    if (sheet.artist) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(style.metaSize * 1.2);
      const artistLH = style.metaSize * 1.5;
      ensureRoom(artistLH);
      pdf.text(sheet.artist, w / 2, y + artistLH * 0.8, { align: 'center' });
      y += artistLH;
    }
  }

  // ── Metadata box (top-right) ──
  const meta = metaText(sheet);
  if (meta) {
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(style.metaSize);
    const tw = pdf.getTextWidth(meta);
    const pad = 6;
    const boxX = w - margin - tw - pad * 2;
    const boxY = Math.max(margin * 0.4, 6);
    const boxH = style.metaSize + pad;
    pdf.setDrawColor(tr, tg, tb);
    pdf.setLineWidth(0.75);
    pdf.rect(boxX, boxY, tw + pad * 2, boxH);
    pdf.text(meta, boxX + pad, boxY + style.metaSize * 0.85);
    y = Math.max(y, boxY + boxH + style.bodySize * 0.5);
  }

  y += style.bodySize * 0.4;

  const bodyLH = style.bodySize * style.lineSpacing;
  const headerLH = style.headerSize * 1.3;

  // ── Sections ──
  for (const section of sheet.sections) {
    if (section.header) {
      y += style.bodySize * 0.4;
      ensureRoom(headerLH);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(style.headerSize);
      pdf.text(section.header, margin, y + headerLH * 0.75);
      y += headerLH;
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(style.bodySize);
    for (const line of section.lines) {
      if (line === '') {
        y += bodyLH * 0.5; // paragraph break
        continue;
      }
      const wrapped = pdf.splitTextToSize(line, contentW) as string[];
      for (const wl of wrapped) {
        ensureRoom(bodyLH);
        pdf.text(wl, margin, y + bodyLH * 0.75);
        y += bodyLH;
      }
    }
  }
}

/** Build a single-song stage PDF. */
export function buildStagePdf(sheet: StageLyricSheet, style: StageStyle = DEFAULT_STAGE_STYLE): jsPDF {
  const pdf = new jsPDF({ unit: 'pt', format: style.pageSize, orientation: style.orientation });
  renderSheetIntoPdf(pdf, sheet, style);
  return pdf;
}

/** Build one PDF containing every song, with a page break between each. */
export function buildCombinedStagePdf(sheets: StageLyricSheet[], style: StageStyle = DEFAULT_STAGE_STYLE): jsPDF {
  const pdf = new jsPDF({ unit: 'pt', format: style.pageSize, orientation: style.orientation });
  sheets.forEach((sheet, i) => {
    if (i > 0) pdf.addPage(style.pageSize, style.orientation);
    renderSheetIntoPdf(pdf, sheet, style);
  });
  return pdf;
}

// ─── HTML (auto-scrolling) rendering ──────────────────────────────────────────────

export interface StageHtmlOptions {
  /** Seconds per line for auto-scroll (used as the slider's initial value). */
  secondsPerLine?: number;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sheetBodyHtml(sheet: StageLyricSheet): string {
  const meta = metaText(sheet);
  const parts: string[] = [];
  parts.push('<div class="song">');
  if (meta) parts.push(`<div class="meta">${escapeHtml(meta)}</div>`);
  if (sheet.title) parts.push(`<h1 class="title">${escapeHtml(sheet.title)}</h1>`);
  if (sheet.artist) parts.push(`<div class="artist">${escapeHtml(sheet.artist)}</div>`);
  for (const section of sheet.sections) {
    parts.push('<section>');
    if (section.header) parts.push(`<h2 class="header">${escapeHtml(section.header)}</h2>`);
    for (const line of section.lines) {
      parts.push(line === ''
        ? '<div class="break"></div>'
        : `<div class="line">${escapeHtml(line)}</div>`);
    }
    parts.push('</section>');
  }
  parts.push('</div>');
  return parts.join('\n');
}

/**
 * Build a standalone, self-contained HTML page for one or more songs with a
 * smooth auto-scroll engine (adjustable seconds-per-line). Works on iPad Safari.
 */
export function buildStageHtml(
  sheets: StageLyricSheet | StageLyricSheet[],
  style: StageStyle = DEFAULT_STAGE_STYLE,
  opts: StageHtmlOptions = {},
): string {
  const list = Array.isArray(sheets) ? sheets : [sheets];
  const secPerLine = opts.secondsPerLine ?? 4;
  const docTitle = list.length === 1 && list[0].title ? list[0].title : 'Stage Mode — Lyrics';
  const body = list.map(sheetBodyHtml).join('\n<div class="song-break"></div>\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>${escapeHtml(docTitle)}</title>
<style>
  :root { --fg: ${style.textColor}; --bg: ${style.bgColor}; }
  * { box-sizing: border-box; -webkit-text-size-adjust: 100%; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg);
    font-family: Arial, Helvetica, Roboto, sans-serif; }
  #scroll { padding: 4vh 6vw 60vh; line-height: ${style.lineSpacing}; }
  .song { margin: 0 auto; max-width: 1100px; }
  .song-break { break-after: page; height: 8vh; }
  .title { font-size: ${style.titleSize}px; font-weight: 800; text-align: center; margin: 0 0 .2em; }
  .artist { text-align: center; opacity: .8; font-size: ${style.metaSize * 1.2}px; margin-bottom: .6em; }
  .meta { float: right; border: 2px solid var(--fg); border-radius: 6px; padding: .25em .6em;
    font-family: 'Courier New', monospace; font-size: ${style.metaSize}px; }
  .header { font-size: ${style.headerSize}px; font-weight: 800; margin: .8em 0 .2em; }
  .line { font-size: ${style.bodySize}px; font-weight: 700; }
  .break { height: ${style.bodySize * 0.6}px; }
  #controls { position: fixed; left: 0; right: 0; bottom: 0; display: flex; gap: 1rem;
    align-items: center; padding: .5rem 1rem; background: rgba(0,0,0,.85);
    border-top: 1px solid var(--fg); font-size: 14px; z-index: 10; }
  #controls button { font-size: 16px; padding: .3rem .9rem; background: var(--fg); color: var(--bg);
    border: none; border-radius: 6px; font-weight: 700; cursor: pointer; }
  #controls label { display: flex; align-items: center; gap: .4rem; flex: 1; }
  #controls input[type=range] { flex: 1; }
  @media print { #controls { display: none; } #scroll { padding-bottom: 4vh; } }
</style>
</head>
<body>
  <div id="scroll">
${body}
  </div>
  <div id="controls">
    <button id="toggle" type="button">▶ Auto-scroll</button>
    <label>Speed
      <input id="speed" type="range" min="1" max="10" step="0.5" value="${secPerLine}">
      <span id="speedval">${secPerLine}s/line</span>
    </label>
  </div>
  <script>
    (function () {
      var running = false, raf = null, last = null;
      var toggle = document.getElementById('toggle');
      var speed = document.getElementById('speed');
      var speedval = document.getElementById('speedval');
      // px per second derived from one line's height and the chosen sec/line.
      function lineHeight() {
        var el = document.querySelector('.line');
        return el ? el.getBoundingClientRect().height : ${style.bodySize * style.lineSpacing};
      }
      function pxPerSec() { return lineHeight() / parseFloat(speed.value); }
      function step(ts) {
        if (!running) return;
        if (last == null) last = ts;
        var dt = (ts - last) / 1000; last = ts;
        window.scrollBy(0, pxPerSec() * dt);
        var atEnd = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 2);
        if (atEnd) { stop(); return; }
        raf = requestAnimationFrame(step);
      }
      function start() { running = true; last = null; toggle.textContent = '❚❚ Pause'; raf = requestAnimationFrame(step); }
      function stop() { running = false; toggle.textContent = '▶ Auto-scroll'; if (raf) cancelAnimationFrame(raf); }
      toggle.addEventListener('click', function () { running ? stop() : start(); });
      speed.addEventListener('input', function () { speedval.textContent = speed.value + 's/line'; });
      // Tap anywhere (not on controls) to pause.
      document.getElementById('scroll').addEventListener('click', function () { if (running) stop(); });
    })();
  </script>
</body>
</html>`;
}

// ─── ZIP batch packaging ──────────────────────────────────────────────────────────

export interface StageZipEntry {
  /** Base filename WITHOUT extension. */
  name: string;
  sheet: StageLyricSheet;
}

export interface StageZipOptions {
  /** Also include a single combined PDF of all songs. */
  combined?: boolean;
  /** Filename (no extension) for the combined PDF. */
  combinedName?: string;
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base || 'song';
  let i = 2;
  while (used.has(name.toLowerCase())) name = `${base}-${i++}`;
  used.add(name.toLowerCase());
  return name;
}

/** Package per-song stage PDFs (and optionally one combined PDF) into a ZIP blob. */
export async function buildStageZip(
  entries: StageZipEntry[],
  style: StageStyle = DEFAULT_STAGE_STYLE,
  opts: StageZipOptions = {},
): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();

  for (const entry of entries) {
    const pdf = buildStagePdf(entry.sheet, style);
    const name = uniqueName(entry.name, used);
    zip.file(`${name}.pdf`, pdf.output('arraybuffer'));
  }

  if (opts.combined && entries.length > 0) {
    const combined = buildCombinedStagePdf(entries.map((e) => e.sheet), style);
    zip.file(`${opts.combinedName ?? 'stage-set'}.pdf`, combined.output('arraybuffer'));
  }

  return zip.generateAsync({ type: 'blob' });
}
