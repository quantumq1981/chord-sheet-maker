import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  convertMusicXmlToChordPro,
  extractMusicXmlTextFromFile,
  getDefaultConvertOptions,
  type ChordBracketStyle,
  type ChordProFormatMode,
  type ConverterDiagnostics,
  type RepeatStrategy,
} from './converters/musicXMLtochordpro';
import { musicXMLToVexTabScore, getScoreNotePositions, type VexTabScore, type NotePositionMap } from './converters/musicXMLtoVexFlow';
import AlphaTabRenderer from './renderers/AlphaTabRenderer';
import AlphaTabControls from './components/AlphaTabControls';
import FretboardPositionsPanel from './components/FretboardPositionsPanel';
import type { AlphaTabUiSettings } from './types/alphatab';
import type * as alphaTabNS from '@coderline/alphatab';
import {
  sniffFormatFromBytes,
  isMusicXmlFormat,
  isChordChartFormat,
  isGuitarProFormat,
  isPdfFormat,
  isPowerTabFormat,
  asSourceFormat,
} from './ingest/sniffFormat';
import { ptbToVexTabScore, ptbTuningToNoteNames } from './converters/powerTabConverter';
import {
  gpScoreToChordPro,
  gpScoreTrackNames,
  gpScoreNotePositions,
} from './converters/guitarProConverter';
import { parseChordChart } from './parsers/chordProParser';
import { parseUgAscii } from './parsers/ugAsciiParser';
import type { ChordChartDocument } from './models/ChordChartModel';
import type { UnifiedSongModel } from './types/unifiedSongModel';
import SongAnalyticsPanel from './components/SongAnalyticsPanel';
import ChordChart, { transposeChord, type EnharmonicPreference } from './renderers/ChordChart';
import VexFlowTabRenderer from './renderers/VexFlowTabRenderer';
import {
  extractRehearsalMarkTexts,
  repositionRehearsalMarksBetweenSystems,
} from './utils/rehearsalMarkLayout';
import {
  getRenderedSvgs,
  triggerBlobDownload,
  serializeSvg,
  stitchSvgsToSingle,
  stitchCanvases,
  svgToCanvas,
  canvasToBlob,
  alphaTabSvgsToPageCanvases,
} from './utils/svgRaster';
import { useOsmd } from './hooks/useOsmd';
import { useTranspose } from './hooks/useTranspose';
import OmrImportPanel from './components/OmrImportPanel';
import {
  createOmrJob,
  getOmrArtifactPath,
  getOmrJobError,
  getOmrJobResult,
  getOmrJobStatus,
  parseOmrError,
  postSyncProcess,
  resolveOmrUrl,
} from './services/omrApi';
import type {
  OMRJobResultResponse,
  OMRProcessingMode,
  OmrApiError,
  OmrArtifactLinks,
  OmrJobStatus,
  OmrLogs,
  OmrSummary,
} from './types/omr';
import { loadMusicXmlFromString } from './utils/loadMusicXmlFromString';
import { DEFAULT_STAVE_PROFILE, DEFAULT_SCALE } from './utils/platform';

// ─── Types ────────────────────────────────────────────────────────────────────

type AppMode = 'empty' | 'notation' | 'chord-chart' | 'tablature' | 'alphatab';

type Diagnostics = {
  isValidXml: boolean;
  isMusicXml: boolean;
  parseError?: string;
  rootName: string;
  version: string;
  parts: number;
  measures: number;
  notes: number;
  harmonies: number;
  hasKey: boolean;
  hasTime: boolean;
  hasDivisions: boolean;
};

type PdfPageSize = 'letter' | 'a4';
type PrintPageSize = PdfPageSize;

type ExportFeedback = {
  type: 'success' | 'error';
  message: string;
};

type ChordProModeUi = 'auto' | 'lyrics-inline' | 'grid-only' | 'fakebook';
type ChordProBracketUi = 'separate' | 'combined';
type ChordProRepeatUi = 'none' | 'simple-unroll';

type ChordProEnharmonicUi = 'auto' | 'flats' | 'sharps';

type ChordProUiState = {
  barsPerLine: number;
  mode: ChordProModeUi;
  chordBracketStyle: ChordProBracketUi;
  repeatStrategy: ChordProRepeatUi;
  enharmonicStyle: ChordProEnharmonicUi;
  jazzSymbols: boolean;
};

// ─── File-accept string ───────────────────────────────────────────────────────
// Use "*" (no filter) so iOS shows all file types in the picker.
// Guitar Pro files have no registered MIME type / UTI, so iOS greys them out
// when a strict accept list is used. Our sniffFormat handles bad types with an
// error message, so it is safe to accept everything here.
const FILE_INPUT_ACCEPT = '*';


const OMR_FILE_INPUT_ACCEPT = ['.pdf', '.png', '.jpg', '.jpeg', 'application/pdf', 'image/png', 'image/jpeg'].join(',');

// ─── Guitar tuning presets ────────────────────────────────────────────────────

const TUNING_PRESETS: Record<string, string[]> = {
  'Standard (EADGBe)':  ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
  'Drop D (DADGBe)':    ['E4', 'B3', 'G3', 'D3', 'A2', 'D2'],
  'Open G (DGDGBd)':    ['D4', 'B3', 'G3', 'D3', 'G2', 'D2'],
  'Open D (DADf#Ad)':   ['D4', 'A3', 'F#3', 'D3', 'A2', 'D2'],
  'Open E (EBE G#Be)':  ['E4', 'B3', 'G#3', 'E3', 'B2', 'E2'],
  'DADGAD':             ['D4', 'A3', 'G3', 'D3', 'A2', 'D2'],
  'Half Step Down (Eb)':['Eb4','Bb3','Gb3','Db3','Ab2','Eb2'],
  'Bass (EADGb)':       ['G2', 'D2', 'A1', 'E1'],
};
const OMR_ALLOWED_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg']);
const OMR_POLL_MS_FAST = 2000;
const OMR_POLL_MS_SLOW = 4500;
const OMR_POLL_SLOWDOWN_AFTER_MS = 30000;

// ─── OSMD helpers ─────────────────────────────────────────────────────────────

const PRINT_ZOOM = 1.0;


function applyPrintProfile(osmd: OpenSheetMusicDisplay, pageSize: PrintPageSize): void {
  // setPageFormat handles all internal dimension/margin values in OSMD's own coordinate
  // system. Do NOT override PageWidth/PageHeight/margins after this call — those properties
  // use OSMD abstract units, not inches or mm, and passing inch values would make each
  // "page" ~20× too narrow, producing dozens of near-empty pages in the output.
  osmd.setPageFormat(pageSize === 'letter' ? 'Letter_P' : 'A4_P');
}

function restoreDisplayMode(osmd: OpenSheetMusicDisplay): void {
  osmd.setPageFormat('Endless');
}

// ─── General helpers ──────────────────────────────────────────────────────────

function getBaseFilename(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return 'score';
  const parts = cleaned.split('.');
  if (parts.length === 1) return cleaned;
  parts.pop();
  return parts.join('.') || 'score';
}


function getOmrSourceType(file: File): 'pdf' | 'image' | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!OMR_ALLOWED_EXTENSIONS.has(ext)) return null;
  return ext === 'pdf' ? 'pdf' : 'image';
}

async function fetchTextOrArrayBuffer(response: Response): Promise<{ xmlText?: string; mxlBuffer?: ArrayBuffer }> {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('zip') || contentType.includes('application/vnd.recordare.musicxml')) {
    return { mxlBuffer: await response.arrayBuffer() };
  }
  return { xmlText: await response.text() };
}


function parseXmlWithDiagnostics(xmlText: string): { doc: Document; diagnostics: Diagnostics } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const parserErrorNode =
    doc.querySelector('parsererror') ?? doc.getElementsByTagName('parsererror').item(0);

  if (parserErrorNode) {
    const errorText = parserErrorNode.textContent?.trim();
    return {
      doc,
      diagnostics: {
        isValidXml: false, isMusicXml: false,
        parseError: errorText ? errorText.slice(0, 300) : 'Invalid XML',
        rootName: 'error', version: 'n/a',
        parts: 0, measures: 0, notes: 0, harmonies: 0,
        hasKey: false, hasTime: false, hasDivisions: false,
      },
    };
  }

  const root = doc.documentElement;
  const rootName = root?.nodeName ?? 'unknown';
  const isMusicXml = rootName === 'score-partwise' || rootName === 'score-timewise';

  if (!isMusicXml) {
    return {
      doc,
      diagnostics: {
        isValidXml: true, isMusicXml: false, rootName, version: 'n/a',
        parts: 0, measures: 0, notes: 0, harmonies: 0,
        hasKey: false, hasTime: false, hasDivisions: false,
      },
    };
  }

  const queryCount = (selector: string) => doc.querySelectorAll(selector).length;

  return {
    doc,
    diagnostics: {
      isValidXml: true, isMusicXml: true, parseError: undefined,
      rootName, version: root?.getAttribute('version') ?? 'n/a',
      parts: queryCount('part'),
      measures: queryCount('measure'),
      notes: queryCount('note'),
      harmonies: queryCount('harmony'),
      hasKey: doc.querySelector('attributes > key') !== null,
      hasTime: doc.querySelector('attributes > time') !== null,
      hasDivisions: doc.querySelector('attributes > divisions') !== null,
    },
  };
}

const FIFTHS_MAJOR_KEYS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'] as const;
const FIFTHS_MINOR_KEYS = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'] as const;

function transposeKeyDisplayFromXml(xmlText: string, semitones: number, pref: EnharmonicPreference = 'auto'): string | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const keyEl = doc.querySelector('attributes > key');
  if (!keyEl) return null;
  const fifths = Number.parseInt(keyEl.querySelector('fifths')?.textContent ?? '', 10);
  if (!Number.isFinite(fifths) || fifths < -7 || fifths > 7) return null;
  const mode = (keyEl.querySelector('mode')?.textContent ?? 'major').trim().toLowerCase();
  const keyTable = mode === 'minor' ? FIFTHS_MINOR_KEYS : FIFTHS_MAJOR_KEYS;
  const starting = keyTable[fifths + 7];
  if (!starting) return null;
  return transposeChord(starting, semitones, pref);
}

function buildChordProOptionsFromUI(uiState: ChordProUiState) {
  const defaultOptions = getDefaultConvertOptions();
  const formatModeMap: Record<ChordProModeUi, ChordProFormatMode> = {
    auto: 'auto', 'lyrics-inline': 'lyrics-inline', 'grid-only': 'grid-only', fakebook: 'fakebook',
  };
  const bracketStyleMap: Record<ChordProBracketUi, ChordBracketStyle> = {
    separate: 'separate', combined: 'combined',
  };
  const repeatMap: Record<ChordProRepeatUi, RepeatStrategy> = {
    none: 'none', 'simple-unroll': 'simple-unroll',
  };

  return {
    ...defaultOptions,
    barsPerLine: uiState.barsPerLine,
    formatMode: formatModeMap[uiState.mode],
    chordBracketStyle: bracketStyleMap[uiState.chordBracketStyle],
    repeatStrategy: repeatMap[uiState.repeatStrategy],
    barlineStyle: 'pipes' as const,
    wrapPolicy: 'bars-per-line' as const,
    enharmonicStyle: uiState.enharmonicStyle,
    jazzSymbols: uiState.jazzSymbols,
  };
}

function deriveProFilename(loadedFilename: string): string {
  const trimmed = loadedFilename.trim();
  if (!trimmed) return 'song.pro';
  const lower = trimmed.toLowerCase();
  if (lower.endsWith('.musicxml')) return `${trimmed.slice(0, -'.musicxml'.length)}.pro`;
  if (lower.endsWith('.xml') || lower.endsWith('.mxl')) return `${trimmed.slice(0, -4)}.pro`;
  // For chord chart files already in a text format, keep the base name
  const dot = trimmed.lastIndexOf('.');
  return dot > 0 ? `${trimmed.slice(0, dot)}.pro` : `${trimmed}.pro`;
}

/** Serialize a ChordChartDocument back to canonical ChordPro text. */
function serializeChordProFromDocument(doc: ChordChartDocument, transposeSteps: number, uiState: ChordProUiState, enharmonicPref: EnharmonicPreference = 'auto'): { text: string; warnings: string[] } {
  const lines: string[] = [];
  const warnings: string[] = [];

  if (doc.title)    lines.push(`{title: ${doc.title}}`);
  if (doc.artist)   lines.push(`{artist: ${doc.artist}}`);
  if (doc.subtitle) lines.push(`{subtitle: ${doc.subtitle}}`);
  if (doc.key) {
    const displayKey = transposeSteps !== 0 ? transposeChord(doc.key, transposeSteps, enharmonicPref) : doc.key;
    lines.push(`{key: ${displayKey}}`);
  }
  if (doc.capo)  lines.push(`{capo: ${doc.capo}}`);
  if (doc.tempo) lines.push(`{tempo: ${doc.tempo}}`);
  if (doc.time)  lines.push(`{time: ${doc.time}}`);

  const isGridOnly = uiState.mode === 'grid-only';
  const isCombinedBracket = uiState.chordBracketStyle === 'combined';

  if (!isGridOnly && uiState.barsPerLine !== 4) {
    warnings.push('Bars-per-line currently applies to Grid Only mode for text-chart imports.');
  }

  for (const section of doc.sections) {
    lines.push('');
    if (section.type !== 'unknown') {
      const directive = section.type === 'chorus' ? 'chorus'
        : section.type === 'verse' ? 'verse'
        : section.type === 'bridge' ? 'bridge'
        : section.type === 'grid' ? 'grid'
        : section.type;
      if (section.label) {
        lines.push(`{start_of_${directive}: ${section.label}}`);
      } else {
        lines.push(`{start_of_${directive}}`);
      }
    }

    for (const line of section.lines) {
      // Grid lines from pipe-bar-grid source: always serialize as | chord | chord | ...
      // This preserves the original structure regardless of export mode.
      if (line.isGrid) {
        const chords = line.tokens
          .filter((token) => token.kind === 'chord')
          .map((token) => (transposeSteps !== 0 ? transposeChord(token.text, transposeSteps, enharmonicPref) : token.text));
        if (chords.length === 0) continue;
        lines.push('| ' + chords.join(' | ') + ' |');
        continue;
      }

      if (isGridOnly) {
        const chords = line.tokens
          .filter((token) => token.kind === 'chord')
          .map((token) => (transposeSteps !== 0 ? transposeChord(token.text, transposeSteps, enharmonicPref) : token.text));
        if (chords.length === 0) continue;
        const chunked: string[] = [];
        for (let i = 0; i < chords.length; i += uiState.barsPerLine) {
          chunked.push(chords.slice(i, i + uiState.barsPerLine).join(' '));
        }
        lines.push(chunked.join(' | '));
        continue;
      }

      const parts: string[] = [];
      for (let index = 0; index < line.tokens.length; index += 1) {
        const token = line.tokens[index];
        if (token.kind === 'chord') {
          const displayed = transposeSteps !== 0 ? transposeChord(token.text, transposeSteps, enharmonicPref) : token.text;
          const nextToken = line.tokens[index + 1];
          if (isCombinedBracket && nextToken?.kind === 'lyric') {
            parts.push(`[${displayed} ${nextToken.text}]`);
            index += 1;
          } else {
            parts.push(`[${displayed}]`);
          }
        } else if (token.kind === 'lyric') {
          parts.push(token.text);
        } else if (token.kind === 'comment') {
          parts.push(`{comment: ${token.text}}`);
        }
      }
      lines.push(parts.join(''));
    }

    if (section.type !== 'unknown') {
      const directive = section.type === 'chorus' ? 'chorus'
        : section.type === 'verse' ? 'verse'
        : section.type === 'bridge' ? 'bridge'
        : section.type === 'grid' ? 'grid'
        : section.type;
      lines.push(`{end_of_${directive}}`);
    }
  }

  return { text: lines.join('\n').trimStart(), warnings };
}

function parseTempoFromMusicXml(xmlText: string): string | undefined {
  if (!xmlText.trim()) return undefined;
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const parserErrorNode =
      doc.querySelector('parsererror') ?? doc.getElementsByTagName('parsererror').item(0);
    if (parserErrorNode) return undefined;

    const soundTempo = doc.querySelector('sound[tempo]')?.getAttribute('tempo')?.trim();
    if (soundTempo) return soundTempo;

    const perMinute = doc.querySelector('metronome > per-minute')?.textContent?.trim();
    if (perMinute) return perMinute;

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns true when a raw text string (stored as a lyric token) looks like a
 * chord-only grid line, e.g. "| D#m7 | C#/F |" or "Am  G7  C  F".
 * These arise in ChordPro/UG files where pipe-grid lines aren't bracket-encoded.
 */
function isChordGridText(text: string): boolean {
  // Strip repeat markers and pipes, then check if most tokens look like chords
  const cleaned = text.replace(/\|:/g, '').replace(/:\|/g, '').replace(/\|/g, ' ').trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  // A token "looks like a chord" if it starts with a note letter (A-G),
  // is a repeat-bar symbol (%), or is a common chord-notation token.
  const chordLike = tokens.filter(
    (t) => /^[A-G][^\s]*$/.test(t) || t === '%' || t === 'x2' || t === 'x3' || t === 'x4',
  );
  return chordLike.length >= 1 && chordLike.length / tokens.length >= 0.55;
}

/**
 * Convert a raw chord-grid lyric text to a CSMPN-friendly chord line:
 * - Preserve |: and :| repeat markers
 * - Remove lone | bar separators (replaced by spaces)
 */
function lyricTextToCsmpnLine(text: string, transposeSteps: number, enharmonicPref: EnharmonicPreference = 'auto'): string {
  const RSTART = '\x00RS\x00';
  const REND = '\x00RE\x00';
  return text
    .replace(/\|:/g, RSTART)
    .replace(/:\|/g, REND)
    .replace(/\|/g, ' ')
    .replace(new RegExp(RSTART, 'g'), '|:')
    .replace(new RegExp(REND, 'g'), ':|')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      if (t === '|:' || t === ':|' || t === '%' || /^x\d+$/.test(t)) return t;
      // Attempt transposition; if it fails (non-chord token) return as-is
      if (transposeSteps !== 0) {
        try { return transposeChord(t, transposeSteps, enharmonicPref); } catch { return t; }
      }
      return t;
    })
    .join(' ');
}

function buildCsmpnFromChartDocument(
  doc: ChordChartDocument,
  transposeSteps: number,
  fallbackTitle: string,
  enharmonicPref: EnharmonicPreference = 'auto',
): string {
  const title = doc.title || fallbackTitle || 'Untitled';
  const style = doc.subtitle || 'Fake Book';
  const tempo = doc.tempo || '';
  const time = doc.time || '';
  const rawKey = doc.key ?? '';
  const key = rawKey && transposeSteps !== 0 ? transposeChord(rawKey, transposeSteps, enharmonicPref) : rawKey;

  const out: string[] = [
    `Title: ${title}`,
    `Style: ${style}`,
    `Tempo: ${tempo}`.trimEnd(),
    `Time: ${time}`,
    `Key: ${key}`,
    '',
  ];

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  for (const section of doc.sections) {
    const label = section.label
      || (section.type !== 'unknown' ? capitalize(section.type) : '');
    if (label) out.push(`- ${label}`);

    for (const line of section.lines) {
      // Primary path: line has explicit chord tokens (e.g. [Am]lyrics format)
      const chordTokens = line.tokens.filter((t) => t.kind === 'chord');
      if (chordTokens.length > 0) {
        const chords = chordTokens.map((t) =>
          transposeSteps !== 0 ? transposeChord(t.text, transposeSteps, enharmonicPref) : t.text,
        );
        out.push(chords.join(' '));
        continue;
      }

      // Fallback: line is all-lyric tokens — may be a pipe-grid chord line
      // (common in UG/ChordPro files where | C | G | Am | is stored as lyric text)
      const allLyric = line.tokens.every((t) => t.kind === 'lyric');
      if (allLyric) {
        const text = line.tokens.map((t) => t.text).join('');
        if (isChordGridText(text)) {
          out.push(lyricTextToCsmpnLine(text, transposeSteps, enharmonicPref));
        }
      }
    }
    out.push('');
  }

  return out.join('\n').trimEnd();
}

function buildCsmpnFakeBookSource(fakeBookText: string, fallbackTitle: string, tempo?: string): string {
  const lines = fakeBookText
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  const extractHeaderValue = (prefix: string) => {
    const match = lines.find((line) => line.toLowerCase().startsWith(prefix.toLowerCase()));
    if (!match) return '';
    return match.slice(prefix.length).trim();
  };

  const title = extractHeaderValue('Title:') || fallbackTitle || 'Untitled';
  const style = extractHeaderValue('Style:') || 'Fake Book';
  const time = extractHeaderValue('Time:') || '';
  const key = extractHeaderValue('Key:') || '';

  const bodyStartIndex = lines.findIndex((line) =>
    !line.startsWith('Title:') &&
    !line.startsWith('Style:') &&
    !line.startsWith('Time:') &&
    !line.startsWith('Key:'),
  );
  const bodyLines = bodyStartIndex >= 0 ? lines.slice(bodyStartIndex) : [];

  return [
    `Title: ${title}`,
    `Style: ${style}`,
    `Tempo: ${tempo ?? ''}`.trimEnd(),
    `Time: ${time}`,
    `Key: ${key}`,
    '',
    ...bodyLines,
  ].join('\n').trimEnd();
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function App() {
  // ── Mode ──
  const [appMode, setAppMode] = useState<AppMode>('empty');

  // ── Shared ──
  const [loadedFilename, setLoadedFilename] = useState('');
  const [exportFeedback, setExportFeedback] = useState<ExportFeedback | null>(null);

  // ── OMR integration state ──
  const [omrFile, setOmrFile] = useState<File | null>(null);
  const [omrValidationMessage, setOmrValidationMessage] = useState('');
  const [omrSubmissionInFlight, setOmrSubmissionInFlight] = useState(false);
  const [omrJobId, setOmrJobId] = useState('');
  const [omrJobStatus, setOmrJobStatus] = useState<OmrJobStatus | null>(null);
  const [omrProgressMessage, setOmrProgressMessage] = useState('');
  const [omrMode, setOmrMode] = useState<OMRProcessingMode>('sync');
  const [omrSummary, setOmrSummary] = useState<OmrSummary | null>(null);
  const [omrLogs, setOmrLogs] = useState<OmrLogs | null>(null);
  const [omrInlineMusicXml, setOmrInlineMusicXml] = useState('');
  const [omrArtifacts, setOmrArtifacts] = useState<OmrArtifactLinks>({});
  const [omrFailure, setOmrFailure] = useState<OmrApiError | null>(null);
  const [omrUiError, setOmrUiError] = useState('');
  const omrPollingTimerRef = useRef<number | null>(null);
  const omrPollStartedAtRef = useRef<number>(0);

  // ── Notation (OSMD) mode state ──
  // OSMD instance/refs, zoom, renderError, renderedPageCount and the render
  // effect live in the useOsmd hook (called below, once its inputs exist).
  const chartRef = useRef<HTMLElement | null>(null);
  const [loadedXmlText, setLoadedXmlText] = useState('');
  const [pristineXmlText, setPristineXmlText] = useState('');
  const [isMxl, setIsMxl] = useState(false);
  const [pdfPageSize, setPdfPageSize] = useState<PdfPageSize>('letter');
  const [isDragging, setIsDragging] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfFilename, setPdfFilename] = useState('score.pdf');
  const [chordProUi, setChordProUi] = useState<ChordProUiState>({
    barsPerLine: 4, mode: 'auto', chordBracketStyle: 'separate', repeatStrategy: 'none',
    enharmonicStyle: 'auto', jazzSymbols: false,
  });
  const [chordProText, setChordProText] = useState('');
  const [chordProWarnings, setChordProWarnings] = useState<string[]>([]);
  const [chordProDiagnostics, setChordProDiagnostics] = useState<ConverterDiagnostics | null>(null);
  const [csmpnFakeBookText, setCsmpnFakeBookText] = useState('');
  const [csmpnWarnings, setCsmpnWarnings] = useState<string[]>([]);

  // ── Chord-chart mode state ──
  const [chartDocument, setChartDocument] = useState<ChordChartDocument | null>(null);
  const [songModel, setSongModel] = useState<UnifiedSongModel | null>(null);
  // transpose state + the debounced MusicXML transpose effect live in useTranspose
  // (called below, after pristineXmlText / setLoadedXmlText are available).
  const [detectedFormatLabel, setDetectedFormatLabel] = useState('');
  const [chartChordProText, setChartChordProText] = useState('');
  const [chartChordProWarnings, setChartChordProWarnings] = useState<string[]>([]);
  const [chartTwoColumn, setChartTwoColumn] = useState(false);
  const [chartFontSize, setChartFontSize] = useState(100);

  // ── Tablature mode state ──
  const [tabTuning, setTabTuning] = useState<string[]>(TUNING_PRESETS['Standard (EADGBe)']);
  const [tabTuningPreset, setTabTuningPreset] = useState('Standard (EADGBe)');
  const [tabFontSize, setTabFontSize] = useState(12);
  const [tabMeasuresPerRow, setTabMeasuresPerRow] = useState(4);
  const [tabPartIndex, setTabPartIndex] = useState(0);
  const [tabRenderError, setTabRenderError] = useState('');
  const [tabScoreData, setTabScoreData] = useState<VexTabScore | null>(null);

  // ── AlphaTab mode state ──
  const [alphaTabSettings, setAlphaTabSettings] = useState<AlphaTabUiSettings>({
    display: { staveProfile: DEFAULT_STAVE_PROFILE, layoutMode: 'page', barsPerRow: -1, scale: DEFAULT_SCALE },
    enablePlayer: false,
    partIndex: 0,
  });
  const [alphaTabRenderError, setAlphaTabRenderError] = useState('');
  const [alphaTabNotePositions, setAlphaTabNotePositions] = useState<NotePositionMap[]>([]);
  const [alphaTabFullscreen, setAlphaTabFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Guitar Pro file state ──
  const [gpFileBuffer, setGpFileBuffer] = useState<ArrayBuffer | null>(null);
  const [gpVersion, setGpVersion] = useState('');         // e.g. "4.06", "3.00"
  const [gpTracks, setGpTracks] = useState<string[]>([]);
  const [gpChordProText, setGpChordProText] = useState('');
  const [gpChordProWarnings, setGpChordProWarnings] = useState<string[]>([]);
  const [gpKeyRoot, setGpKeyRoot] = useState<string | null>(null);
  // Stable Uint8Array view — only recreated when gpFileBuffer changes, not on every render.
  // Without this, every App re-render (e.g. from onScoreLoaded state updates) creates a new
  // object, causing AlphaTabRenderer's fileData effect to fire and cancel the ongoing worker render.
  const gpFileBytes = useMemo(
    () => (gpFileBuffer ? new Uint8Array(gpFileBuffer) : undefined),
    [gpFileBuffer],
  );

  // ── Derived: XML diagnostics ──
  const parsedXml = useMemo(() => {
    if (!loadedXmlText) return null;
    return parseXmlWithDiagnostics(loadedXmlText);
  }, [loadedXmlText]);

  const diagnostics = parsedXml?.diagnostics ?? null;

  const xmlWarnings = useMemo(() => {
    if (!diagnostics) return [] as string[];
    if (!diagnostics.isValidXml) return ['Invalid MusicXML/XML (parse error).'];
    if (!diagnostics.isMusicXml) return ['XML is valid but not MusicXML.'];
    const list: string[] = [];
    if (diagnostics.harmonies === 0) list.push('No chord symbols (<harmony>) found — showing notation only.');
    if (!diagnostics.hasKey) list.push('No key signature found — key may be inferred.');
    if (!diagnostics.hasTime) list.push('No time signature found — time may be inferred.');
    if (!diagnostics.hasDivisions) list.push('No <divisions> found — rhythmic rendering may be unreliable.');
    return list;
  }, [diagnostics]);

  // ── Tab score computation ──
  // Re-runs only when XML, tuning, or selected part changes.
  const tabScore = useMemo<VexTabScore | null>(() => {
    if (!loadedXmlText || !diagnostics?.isMusicXml) return null;
    return musicXMLToVexTabScore(loadedXmlText, tabTuning, tabPartIndex);
  }, [loadedXmlText, tabTuning, tabPartIndex, diagnostics?.isMusicXml]);

  // Sync computed score into state so the renderer gets it reactively
  useEffect(() => { setTabScoreData(tabScore); }, [tabScore]);

  // ── AlphaTab: all-positions note map ──
  // For MusicXML: computed via heuristic fret-assignment from the XML.
  // For GP files: populated by onScoreLoaded callback (exact positions from file).
  const alphaTabNotePositionsComputed = useMemo<NotePositionMap[]>(() => {
    if (gpFileBuffer) return []; // GP positions come from onScoreLoaded
    if (!loadedXmlText || !diagnostics?.isMusicXml) return [];
    return getScoreNotePositions(loadedXmlText, tabTuning, alphaTabSettings.partIndex);
  }, [gpFileBuffer, loadedXmlText, tabTuning, alphaTabSettings.partIndex, diagnostics?.isMusicXml]);

  useEffect(() => {
    setAlphaTabNotePositions(alphaTabNotePositionsComputed);
  }, [alphaTabNotePositionsComputed]);

  // Unique rehearsal-mark labels for the loaded score. Parsed once per file and
  // reused across the display render and every export/print render so the SVG
  // post-processing pass never has to re-parse the MusicXML string.
  const rehearsalTexts = useMemo(
    () => extractRehearsalMarkTexts(loadedXmlText),
    [loadedXmlText],
  );

  // ── OSMD notation rendering (instance lifecycle, render effect, zoom) ──
  const {
    containerRef, osmdRef, didAutoFitRef, xmlLoadedRef,
    setZoom, adjustZoom, fitWidth,
    renderError, setRenderError,
    renderedPageCount, setRenderedPageCount,
  } = useOsmd({ loadedXmlText, diagnostics, rehearsalTexts });

  // ── Transpose state + debounced MusicXML transpose pipeline ──
  const {
    transposeSemitones, setTransposeSemitones,
    transposeEnharmonic, setTransposeEnharmonic,
    transposeWarnings, setTransposeWarnings,
    adjustTranspose,
  } = useTranspose({ pristineXmlText, setLoadedXmlText });

  // GP files: wire transpose semitones into AlphaTab settings so the renderer
  // re-applies notation.transpositionPitches and re-renders.
  // MusicXML files use transposeMusicXML() at the XML level instead.
  useEffect(() => {
    if (!gpFileBuffer) return;
    setAlphaTabSettings((prev) => ({ ...prev, transposeSemitones }));
  }, [transposeSemitones, gpFileBuffer]);

  // ── PDF blob cleanup ──
  useEffect(() => {
    return () => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); };
  }, [pdfBlobUrl]);

  useEffect(() => {
    return () => {
      if (omrPollingTimerRef.current !== null) {
        window.clearTimeout(omrPollingTimerRef.current);
      }
    };
  }, []);

  const stopOmrPolling = useCallback(() => {
    if (omrPollingTimerRef.current !== null) {
      window.clearTimeout(omrPollingTimerRef.current);
      omrPollingTimerRef.current = null;
    }
  }, []);

  const resetOmrState = useCallback(() => {
    stopOmrPolling();
    setOmrFile(null);
    setOmrValidationMessage('');
    setOmrSubmissionInFlight(false);
    setOmrJobId('');
    setOmrJobStatus(null);
    setOmrProgressMessage('');
    setOmrSummary(null);
    setOmrLogs(null);
    setOmrInlineMusicXml('');
    setOmrArtifacts({});
    setOmrFailure(null);
    setOmrUiError('');
  }, [stopOmrPolling]);

  const loadOmrResultIntoNotation = useCallback(async (result: OMRJobResultResponse['result'], jobId: string) => {
    if (!result) throw new Error('Invalid result payload: missing result object.');
    const selectedUrl = result.musicxmlUrl ?? result.mxlUrl;
    if (!selectedUrl) throw new Error('Invalid result payload: no musicxmlUrl or mxlUrl.');

    const resolvedUrl = resolveOmrUrl(selectedUrl);
    const response = await fetch(resolvedUrl);
    if (!response.ok) throw new Error(`Result download failed: ${await parseOmrError(response)}`);

    const { xmlText, mxlBuffer } = await fetchTextOrArrayBuffer(response);
    let parsedXmlText = xmlText ?? '';
    let loadedFromMxl = false;

    if (mxlBuffer) {
      const inferredFilename = `omr-${jobId}.mxl`;
      const mxlFile = new File([mxlBuffer], inferredFilename, { type: 'application/zip' });
      const extracted = await extractMusicXmlTextFromFile(mxlFile);
      parsedXmlText = extracted.xmlText;
      loadedFromMxl = true;
    }

    if (!parsedXmlText.trim()) throw new Error('Invalid result payload: empty MusicXML data.');

    didAutoFitRef.current = false;
    setLoadedFilename(`omr-${jobId}.${loadedFromMxl ? 'mxl' : 'musicxml'}`);
    setPristineXmlText(parsedXmlText);
    setIsMxl(loadedFromMxl);
    setRenderError('');
    setExportFeedback({ type: 'success', message: 'OMR conversion completed and score loaded.' });
    setChartDocument(null);
    setSongModel(null);
    setTransposeWarnings([]);
    setDetectedFormatLabel(loadedFromMxl ? 'MXL (OMR)' : 'MusicXML (OMR)');
    setAppMode('notation');
  }, []);

  const fetchOmrFailure = useCallback(async (jobId: string) => {
    try {
      const payload = await getOmrJobError(jobId);
      if (!payload?.error) return;
      setOmrFailure(payload.error);
      if (payload.error.logUrl) {
        setOmrArtifacts((prev) => ({ ...prev, logUrl: payload.error?.logUrl }));
      }
    } catch {
      // best effort only
    }
  }, []);

  const pollOmrJob = useCallback(async (jobId: string) => {
    try {
      const statusPayload = await getOmrJobStatus(jobId);
      setOmrJobStatus(statusPayload.status);
      setOmrProgressMessage(statusPayload.progress?.message ?? statusPayload.status);

      if (statusPayload.status === 'completed') {
        stopOmrPolling();
        const resultPayload = await getOmrJobResult(jobId);
        const links: OmrArtifactLinks = {
          musicxmlUrl: resultPayload.result?.musicxmlUrl ?? undefined,
          mxlUrl: resultPayload.result?.mxlUrl ?? undefined,
          logUrl: getOmrArtifactPath(jobId, 'log'),
          summaryUrl: getOmrArtifactPath(jobId, 'summary'),
        };
        setOmrArtifacts(links);
        setOmrSummary(resultPayload.result?.summary ?? null);
        setOmrLogs(resultPayload.result?.logs ?? null);
        await loadOmrResultIntoNotation(resultPayload.result, jobId);
        return;
      }

      if (statusPayload.status === 'failed') {
        stopOmrPolling();
        await fetchOmrFailure(jobId);
        return;
      }

      const elapsed = Date.now() - omrPollStartedAtRef.current;
      const interval = elapsed >= OMR_POLL_SLOWDOWN_AFTER_MS ? OMR_POLL_MS_SLOW : OMR_POLL_MS_FAST;
      omrPollingTimerRef.current = window.setTimeout(() => {
        void pollOmrJob(jobId);
      }, interval);
    } catch (error) {
      stopOmrPolling();
      const message = error instanceof Error ? error.message : String(error);
      setOmrUiError(`Polling failure: ${message}`);
    }
  }, [fetchOmrFailure, loadOmrResultIntoNotation, stopOmrPolling]);

  // ── Clear all ──
  const clearAll = useCallback(() => {
    setAppMode('empty');
    setLoadedFilename('');
    setRenderError('');
    setExportFeedback(null);
    // Notation
    setLoadedXmlText('');
    setPristineXmlText('');
    setIsMxl(false);
    setZoom(1);
    setRenderedPageCount(0);
    setPdfBlobUrl(null);
    setPdfFilename('score.pdf');
    setChordProText('');
    setChordProWarnings([]);
    setChordProDiagnostics(null);
    setCsmpnFakeBookText('');
    setCsmpnWarnings([]);
    xmlLoadedRef.current = '';
    if (containerRef.current) containerRef.current.innerHTML = '';
    // Chart
    setChartDocument(null);
    setSongModel(null);
    setTransposeSemitones(0);
    setTransposeWarnings([]);
    setDetectedFormatLabel('');
    setChartChordProText('');
    setChartChordProWarnings([]);
    // Tablature
    setTabScoreData(null);
    setTabRenderError('');
    setTabPartIndex(0);
    // AlphaTab
    setAlphaTabRenderError('');
    setAlphaTabNotePositions([]);
    setAlphaTabSettings({
      display: { staveProfile: DEFAULT_STAVE_PROFILE, layoutMode: 'page', barsPerRow: -1, scale: DEFAULT_SCALE },
      enablePlayer: false,
      partIndex: 0,
      printProfile: false,
    });
    // Guitar Pro
    setGpFileBuffer(null);
    setGpVersion('');
    setGpTracks([]);
    setGpChordProText('');
    setGpChordProWarnings([]);
    setGpKeyRoot(null);
    // OMR
    resetOmrState();
  }, [resetOmrState]);

  // ── File loading ──
  const loadFile = useCallback(async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const detected = sniffFormatFromBytes(bytes, file.name);

      if (isMusicXmlFormat(detected)) {
        // ── Notation path ──
        const { filename, xmlText, isMxl: loadedFromMxl } =
          await extractMusicXmlTextFromFile(file);
        didAutoFitRef.current = false;
        setLoadedFilename(filename);
        setPristineXmlText(xmlText);
        setIsMxl(loadedFromMxl);
        setRenderError('');
        setExportFeedback(null);
        setChordProText('');
        setChordProWarnings([]);
        setChordProDiagnostics(null);
        setCsmpnFakeBookText('');
        setCsmpnWarnings([]);
        // Clear chord-chart state
        setChartDocument(null);
        setSongModel(null);
        setDetectedFormatLabel(detected.format === 'mxl' ? 'MXL' : 'MusicXML');
        setTransposeWarnings([]);
        setChartChordProText('');
        setChartChordProWarnings([]);
        setGpFileBuffer(null);
        setGpVersion('');
        setGpTracks([]);
        setGpChordProText('');
        setGpChordProWarnings([]);
        setAppMode('notation');

      } else if (isGuitarProFormat(detected)) {
        // ── Guitar Pro path ──
        setLoadedFilename(file.name);
        setGpFileBuffer(arrayBuffer);
        setGpVersion(detected.version);
        setGpTracks([]);          // populated by onScoreLoaded after AlphaTab parses
        setGpChordProText('');
        setGpChordProWarnings([]);
        setAlphaTabRenderError('');
        setAlphaTabNotePositions([]);
        setAlphaTabSettings(prev => ({ ...prev, partIndex: 0 }));
        setRenderError('');
        setExportFeedback(null);
        // Clear MusicXML + chord-chart state
        setLoadedXmlText('');
        setPristineXmlText('');
        setIsMxl(false);
        setRenderedPageCount(0);
        setPdfBlobUrl(null);
        setChordProText('');
        setChordProWarnings([]);
        setChordProDiagnostics(null);
        setCsmpnFakeBookText('');
        setCsmpnWarnings([]);
        setChartDocument(null);
        setSongModel(null);
        setTransposeWarnings([]);
        setChartChordProText('');
        setChartChordProWarnings([]);
        setDetectedFormatLabel(`Guitar Pro ${detected.version}`);
        if (containerRef.current) containerRef.current.innerHTML = '';
        xmlLoadedRef.current = '';
        setAppMode('alphatab');

      } else if (isPowerTabFormat(detected)) {
        // ── Power Tab path ──
        const { score, tuningMidi } = ptbToVexTabScore(arrayBuffer);
        const tuningNotes = ptbTuningToNoteNames(tuningMidi);

        setLoadedFilename(file.name);
        setTabScoreData(score);
        setTabTuning(tuningNotes);
        setTabTuningPreset('Custom');
        setTabPartIndex(0);
        setTabRenderError('');
        setDetectedFormatLabel('Power Tab');
        setRenderError('');
        setExportFeedback(null);
        // Clear all other state
        setLoadedXmlText('');
        setPristineXmlText('');
        setIsMxl(false);
        setRenderedPageCount(0);
        setPdfBlobUrl(null);
        setChordProText('');
        setChordProWarnings([]);
        setChordProDiagnostics(null);
        setCsmpnFakeBookText('');
        setCsmpnWarnings([]);
        setChartDocument(null);
        setSongModel(null);
        setTransposeWarnings([]);
        setChartChordProText('');
        setChartChordProWarnings([]);
        setGpFileBuffer(null);
        setGpVersion('');
        setGpTracks([]);
        setGpChordProText('');
        setGpChordProWarnings([]);
        if (containerRef.current) containerRef.current.innerHTML = '';
        xmlLoadedRef.current = '';
        setAppMode('tablature');

      } else if (isChordChartFormat(detected)) {
        // ── Chord-chart path ──
        const text = new TextDecoder('utf-8').decode(bytes);

        // ascii_tab has no ChordPro-syntax source format; map to chordpro so
        // parseChordChart renders the content (tab lines appear as plain text).
        const sourceFormat = detected.format === 'ascii_tab'
          ? 'chordpro'
          : asSourceFormat(detected)!;
        const doc = parseChordChart(text, sourceFormat);

        // Unified Song Model — analytics for any text-based chord/tab file
        setSongModel(parseUgAscii(text, { title: doc.title, artist: doc.artist }));

        const formatLabels: Record<string, string> = {
          chordpro: 'ChordPro',
          ultimateguitar: 'Ultimate Guitar',
          'chords-over-words': 'Chords over Words',
          ascii_tab: 'ASCII Tab',
        };

        setLoadedFilename(file.name);
        setChartDocument(doc);
        setDetectedFormatLabel(formatLabels[detected.format] ?? detected.format);
        setTransposeWarnings([]);
        const chartExport = serializeChordProFromDocument(doc, transposeSemitones, chordProUi, transposeEnharmonic);
        setChartChordProText(chartExport.text);
        setChartChordProWarnings(chartExport.warnings);
        setRenderError('');
        setExportFeedback(null);
        // Clear notation state
        setLoadedXmlText('');
        setPristineXmlText('');
        setIsMxl(false);
        setRenderedPageCount(0);
        setPdfBlobUrl(null);
        setChordProText('');
        setChordProWarnings([]);
        setChordProDiagnostics(null);
        setCsmpnFakeBookText('');
        setCsmpnWarnings([]);
        if (containerRef.current) containerRef.current.innerHTML = '';
        xmlLoadedRef.current = '';
        setAppMode('chord-chart');

      } else if (isPdfFormat(detected)) {
        // ── PDF text-extraction path ──
        // Lazy-load pdfjs-dist only when a PDF is actually dropped, keeping it
        // out of the main bundle for users who never use this path.
        setRenderError('');
        const { extractPdfText } = await import('./utils/extractPdfText');
        const extracted = await extractPdfText(arrayBuffer);
        const trimmed = extracted.trim();

        if (trimmed.length < 50) {
          setRenderError(
            'Could not extract readable text from this PDF — it may be a scanned image. ' +
            'Use the OMR panel (backend required) for scanned scores, or paste the text manually.'
          );
          return;
        }

        // Re-detect the format of the extracted text
        const extractedBytes = new TextEncoder().encode(trimmed);
        const redetected = sniffFormatFromBytes(extractedBytes, file.name.replace(/\.pdf$/i, '.txt'));

        if (!isChordChartFormat(redetected)) {
          setRenderError(
            'PDF text extracted but no chord chart content recognised. ' +
            'For music notation scores use the OMR panel (backend required).'
          );
          return;
        }

        const pdfSourceFormat = redetected.format === 'ascii_tab'
          ? 'chordpro'
          : asSourceFormat(redetected)!;
        const pdfDoc = parseChordChart(trimmed, pdfSourceFormat);
        setSongModel(parseUgAscii(trimmed, { title: pdfDoc.title, artist: pdfDoc.artist }));

        const pdfFormatLabels: Record<string, string> = {
          chordpro: 'PDF → ChordPro',
          ultimateguitar: 'PDF → Ultimate Guitar',
          'chords-over-words': 'PDF → Chord Chart',
          ascii_tab: 'PDF → ASCII Tab',
        };

        setLoadedFilename(file.name);
        setChartDocument(pdfDoc);
        setDetectedFormatLabel(pdfFormatLabels[redetected.format] ?? 'PDF → Chord Chart');
        setTransposeWarnings([]);
        const pdfChartExport = serializeChordProFromDocument(pdfDoc, transposeSemitones, chordProUi, transposeEnharmonic);
        setChartChordProText(pdfChartExport.text);
        setChartChordProWarnings(pdfChartExport.warnings);
        setRenderError('');
        setExportFeedback(null);
        setLoadedXmlText('');
        setPristineXmlText('');
        setIsMxl(false);
        setRenderedPageCount(0);
        setPdfBlobUrl(null);
        setChordProText('');
        setChordProWarnings([]);
        setChordProDiagnostics(null);
        setCsmpnFakeBookText('');
        setCsmpnWarnings([]);
        setGpFileBuffer(null);
        setGpVersion('');
        setGpTracks([]);
        setGpChordProText('');
        setGpChordProWarnings([]);
        if (containerRef.current) containerRef.current.innerHTML = '';
        xmlLoadedRef.current = '';
        setAppMode('chord-chart');

      } else {
        setRenderError(
          'Unsupported file type. Upload .xml / .musicxml / .mxl (notation), ' +
          '.gp / .gp3 / .gp4 / .gp5 / .gpx (Guitar Pro), ' +
          '.ptb (Power Tab), ' +
          '.cho / .chopro / .crd / .pro / .txt (chord chart), ' +
          'or .pdf (selectable-text chord sheet).'
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRenderError(`Failed to read file: ${message}`);
    }
  }, [chordProUi, transposeSemitones, transposeEnharmonic]);

  const onFileInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      await loadFile(file);
      event.target.value = '';
    },
    [loadFile],
  );

  const onDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      await loadFile(file);
    },
    [loadFile],
  );

  const onOmrFileInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    const sourceType = getOmrSourceType(file);
    if (!sourceType) {
      setOmrFile(null);
      setOmrValidationMessage('Unsupported file type. Please choose PDF, PNG, JPG, or JPEG.');
      return;
    }
    setOmrFile(file);
    setOmrValidationMessage('');
    setOmrUiError('');
    setOmrFailure(null);
    event.target.value = '';
  }, []);

  const onOmrDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0] ?? null;
    if (!file) return;
    const sourceType = getOmrSourceType(file);
    if (!sourceType) {
      setOmrFile(null);
      setOmrValidationMessage('Unsupported file type. Please choose PDF, PNG, JPG, or JPEG.');
      return;
    }
    setOmrFile(file);
    setOmrValidationMessage('');
    setOmrUiError('');
    setOmrFailure(null);
  }, []);

  const submitOmrJob = useCallback(async () => {
    if (!omrFile) {
      setOmrValidationMessage('Select a PDF/image file before starting OMR.');
      return;
    }
    const sourceType = getOmrSourceType(omrFile);
    if (!sourceType) {
      setOmrValidationMessage('Unsupported file type. Please choose PDF, PNG, JPG, or JPEG.');
      return;
    }

    stopOmrPolling();
    setOmrSubmissionInFlight(true);
    setOmrUiError('');
    setOmrFailure(null);
    setOmrSummary(null);
    setOmrLogs(null);
    setOmrArtifacts({});

    try {
      if (omrMode === 'sync') {
        setOmrJobId('sync');
        setOmrJobStatus('running_omr');
        setOmrProgressMessage('Running quick process...');
        const response = await postSyncProcess(omrFile);
        if (response.status !== 'completed') {
          setOmrFailure(response.error ?? { message: 'Sync process did not complete successfully.' });
          setOmrJobStatus('failed');
          return;
        }
        const parsedXmlText = loadMusicXmlFromString(response.musicxml ?? '');
        didAutoFitRef.current = false;
        setLoadedFilename(`omr-sync-${getBaseFilename(omrFile.name)}.musicxml`);
        setPristineXmlText(parsedXmlText);
        setOmrInlineMusicXml(parsedXmlText);
        setIsMxl(false);
        setRenderError('');
        setExportFeedback({ type: 'success', message: 'OMR quick process completed and score loaded.' });
        setChartDocument(null);
        setDetectedFormatLabel('MusicXML (OMR Sync)');
        setTransposeWarnings([]);
        setAppMode('notation');
        setOmrJobStatus('completed');
        setOmrProgressMessage('Completed');
        setOmrSummary(response.summary ?? null);
        setOmrLogs(response.logs ?? null);
        return;
      }

      const created = await createOmrJob(omrFile, sourceType);
      setOmrJobId(created.jobId);
      setOmrJobStatus(created.status);
      setOmrProgressMessage('Queued for processing');
      omrPollStartedAtRef.current = Date.now();
      void pollOmrJob(created.jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOmrUiError(message);
      setOmrJobStatus('failed');
    } finally {
      setOmrSubmissionInFlight(false);
    }
  }, [omrFile, omrMode, pollOmrJob, stopOmrPolling]);

  // ── Notation controls ──
  const adjustAlphaTabZoom = useCallback((delta: number) => {
    setAlphaTabSettings((prev) => ({
      ...prev,
      display: {
        ...prev.display,
        scale: Math.max(0.5, Math.min(2.0, Number((prev.display.scale + delta).toFixed(2)))),
      },
    }));
  }, []);

  // ── Feedback helpers ──
  const showExportError   = useCallback((msg: string) => setExportFeedback({ type: 'error', message: msg }), []);
  const showExportSuccess = useCallback((msg: string) => setExportFeedback({ type: 'success', message: msg }), []);

  const clearPdfOutput = useCallback(() => { setPdfBlobUrl(null); setPdfFilename('score.pdf'); }, []);

  const baseName = getBaseFilename(loadedFilename);

  // ── Notation exports ──
  const downloadXml = useCallback(() => {
    if (!loadedXmlText) { showExportError('Load a file before downloading XML.'); return; }
    try {
      triggerBlobDownload(new Blob([loadedXmlText], { type: 'application/xml;charset=utf-8' }), `${baseName}.xml`);
      showExportSuccess('Downloaded XML.');
    } catch (error) {
      showExportError(`XML download failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [baseName, loadedXmlText, showExportError, showExportSuccess]);

  const downloadDiagnostics = useCallback(() => {
    if (!loadedXmlText) { showExportError('Load a file before downloading diagnostics.'); return; }
    try {
      const payload = { filename: loadedFilename || `${baseName}.xml`, diagnostics, warnings: xmlWarnings, renderError: renderError || null, timestamp: new Date().toISOString() };
      triggerBlobDownload(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }), `${baseName}.diagnostics.json`);
      showExportSuccess('Downloaded diagnostics JSON.');
    } catch (error) {
      showExportError(`Diagnostics export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [baseName, diagnostics, loadedFilename, loadedXmlText, renderError, showExportError, showExportSuccess, xmlWarnings]);

  const exportSvg = useCallback(() => {
    const svgs = getRenderedSvgs(containerRef.current);
    if (svgs.length === 0) { showExportError('No rendered score found.'); return; }
    try {
      const combined = stitchSvgsToSingle(svgs);
      triggerBlobDownload(new Blob([combined], { type: 'image/svg+xml;charset=utf-8' }), `${baseName}.svg`);
      showExportSuccess(`Exported ${svgs.length} page(s) as SVG.`);
    } catch (error) {
      showExportError(`SVG export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [baseName, showExportError, showExportSuccess]);

  const exportPng = useCallback(async () => {
    const svgs = getRenderedSvgs(containerRef.current);
    if (svgs.length === 0) { showExportError('No rendered score found.'); return; }
    try {
      const canvas = await stitchCanvases(svgs, 2);
      const blob = await canvasToBlob(canvas, 'image/png');
      triggerBlobDownload(blob, `${baseName}.png`, true);
      showExportSuccess(`Exported ${svgs.length} page(s) as PNG.`);
    } catch (error) {
      showExportError(`PNG export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [baseName, showExportError, showExportSuccess]);

  // ── Tab exports: grab the VexFlow SVG from the rendered div ──

  const getTabSvgEl = useCallback((): SVGSVGElement | null => {
    // The tab container div holds a single SVG element rendered by VexFlow
    const tabDiv = document.querySelector('.tab-container svg') as SVGSVGElement | null;
    return tabDiv;
  }, []);

  const exportTabSvg = useCallback(() => {
    const svg = getTabSvgEl();
    if (!svg) { showExportError('No tab SVG found. Generate the tab first.'); return; }
    try {
      triggerBlobDownload(
        new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' }),
        `${baseName}.tab.svg`,
      );
      showExportSuccess('Tab exported as SVG.');
    } catch (err) {
      showExportError(`Tab SVG export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [baseName, getTabSvgEl, showExportError, showExportSuccess]);

  const exportTabPng = useCallback(async () => {
    const svg = getTabSvgEl();
    if (!svg) { showExportError('No tab SVG found. Generate the tab first.'); return; }
    try {
      const canvas = await svgToCanvas(svg, 2);
      const blob = await canvasToBlob(canvas, 'image/png');
      triggerBlobDownload(blob, `${baseName}.tab.png`, true);
      showExportSuccess('Tab exported as PNG.');
    } catch (err) {
      showExportError(`Tab PNG export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [baseName, getTabSvgEl, showExportError, showExportSuccess]);

  const exportTabPdf = useCallback(async () => {
    const svg = getTabSvgEl();
    if (!svg) { showExportError('No tab SVG found. Generate the tab first.'); return; }
    const isLetter = pdfPageSize === 'letter';
    const unit = isLetter ? 'in' : 'mm';
    const format: [number, number] = isLetter ? [8.5, 11] : [210, 297];
    const margin = isLetter ? 0.5 : 12;
    try {
      const canvas = await svgToCanvas(svg, 1.5);
      const jpegData = canvas.toDataURL('image/jpeg', 0.92);
      const pdf = new jsPDF({ orientation: 'portrait', unit, format });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const availW = pageW - margin * 2;
      const availH = pageH - margin * 2;
      const aspect = canvas.width / canvas.height;
      let w = availW;
      let h = w / aspect;
      if (h > availH) { h = availH; w = h * aspect; }
      const x = (pageW - w) / 2;
      const y = margin;
      pdf.addImage(jpegData, 'JPEG', x, y, w, h, undefined, 'FAST');
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      setPdfBlobUrl(url);
      setPdfFilename(`${baseName}.tab.pdf`);
      showExportSuccess('Tab PDF ready. Tap Open PDF.');
    } catch (err) {
      showExportError(`Tab PDF failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [baseName, getTabSvgEl, pdfPageSize, showExportError, showExportSuccess]);

  const getAlphaTabSvgEls = useCallback((): SVGSVGElement[] => {
    return Array.from(document.querySelectorAll<SVGSVGElement>('.alphatab-container svg')).filter(
      (svg) => {
        // Exclude nested SVGs (inner chunks inside a page-wrapper SVG).
        // AlphaTab nests per-system SVGs inside per-page wrapper SVGs; grabbing
        // all descendants gives duplicate blank/content pairs → double page count.
        if (svg.parentElement?.closest('svg')) return false;
        // Exclude blank background SVGs that contain no rendered notation
        // (they only have rect elements for the page background).
        return svg.querySelector('path, text') !== null;
      },
    );
  }, []);

  const exportAlphaTabSvg = useCallback(() => {
    const svgs = getAlphaTabSvgEls();
    if (svgs.length === 0) { showExportError('No AlphaTab SVG found.'); return; }
    try {
      const combined = stitchSvgsToSingle(svgs);
      triggerBlobDownload(new Blob([combined], { type: 'image/svg+xml;charset=utf-8' }), `${baseName}.alphatab.svg`);
      showExportSuccess(`AlphaTab exported as SVG (${svgs.length} page(s)).`);
    } catch (error) {
      showExportError(`AlphaTab SVG export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [baseName, getAlphaTabSvgEls, showExportError, showExportSuccess]);

  const exportAlphaTabPng = useCallback(async () => {
    const svgs = getAlphaTabSvgEls();
    if (svgs.length === 0) { showExportError('No AlphaTab SVG found.'); return; }
    try {
      const canvas = await stitchCanvases(svgs, 2);
      const blob = await canvasToBlob(canvas, 'image/png');
      triggerBlobDownload(blob, `${baseName}.alphatab.png`, true);
      showExportSuccess(`AlphaTab exported as PNG (${svgs.length} page(s)).`);
    } catch (error) {
      showExportError(`AlphaTab PNG export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [baseName, getAlphaTabSvgEls, showExportError, showExportSuccess]);

  const exportAlphaTabPdf = useCallback(async () => {
    const svgs = getAlphaTabSvgEls();
    if (svgs.length === 0) { showExportError('No AlphaTab SVG found.'); return; }
    const isLetter = pdfPageSize === 'letter';
    const unit = isLetter ? 'in' : 'mm';
    const format: [number, number] = isLetter ? [8.5, 11] : [210, 297];
    const margin = isLetter ? 0.5 : 12; // in or mm
    try {
      // AlphaTab renders many narrow system-strip SVGs, not one-per-page. Stitch them
      // all then slice into page-sized chunks (portrait or landscape auto-detected).
      const { pages, isLandscape } = await alphaTabSvgsToPageCanvases(svgs, isLetter, 1.5);
      if (pages.length === 0) { showExportError('Could not compute page layout for PDF.'); return; }

      const orientation = isLandscape ? 'landscape' : 'portrait';
      const pageFormat: [number, number] = isLandscape
        ? (isLetter ? [11, 8.5] : [297, 210])
        : format;
      const pdf = new jsPDF({ orientation, unit, format: pageFormat });
      const pageWidth  = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const availableWidth  = pageWidth  - margin * 2;
      const availableHeight = pageHeight - margin * 2;
      for (let i = 0; i < pages.length; i++) {
        const canvas = pages[i];
        const jpegData = canvas.toDataURL('image/jpeg', 0.92);
        if (i > 0) pdf.addPage(pageFormat, orientation);
        // Aspect-ratio-constrained fit: scale to fill available width, but never
        // exceed available height (would clip content at the page bottom).
        const aspect = canvas.width / canvas.height;
        let imgW = availableWidth;
        let imgH = imgW / aspect;
        if (imgH > availableHeight) { imgH = availableHeight; imgW = imgH * aspect; }
        const x = margin + (availableWidth  - imgW) / 2;
        const y = margin + (availableHeight - imgH) / 2;
        pdf.addImage(jpegData, 'JPEG', x, y, imgW, imgH, undefined, 'FAST');
      }
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      setPdfBlobUrl(url);
      setPdfFilename(`${baseName}.alphatab.pdf`);
      showExportSuccess(`AlphaTab PDF ready (${pages.length} page(s)). Tap Open PDF.`);
    } catch (error) {
      showExportError(`AlphaTab PDF export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [baseName, getAlphaTabSvgEls, pdfPageSize, showExportError, showExportSuccess]);

  const exportPdf = useCallback(async (maxPages?: number) => {
    const osmd = osmdRef.current;
    if (!osmd) { showExportError('Renderer is not ready yet.'); return; }
    const initialSvgs = getRenderedSvgs(containerRef.current);
    if (initialSvgs.length === 0) { showExportError('No rendered score found.'); return; }

    const isLetter = pdfPageSize === 'letter';
    const unit = isLetter ? 'in' : 'mm';
    const format: [number, number] = isLetter ? [8.5, 11] : [210, 297];
    const margin = isLetter ? 0.5 : 12;
    const zoomSnapshot = osmd.Zoom;

    try {
      applyPrintProfile(osmd, pdfPageSize);
      osmd.Zoom = PRINT_ZOOM;
      osmd.render();
      if (containerRef.current) {
        try {
          repositionRehearsalMarksBetweenSystems(
            containerRef.current, osmd, rehearsalTexts,
          );
        } catch { /* don't block export */ }
      }
      const svgs = getRenderedSvgs(containerRef.current);
      if (svgs.length === 0) throw new Error('No rendered score found after applying print layout.');
      const pdf = new jsPDF({ orientation: 'portrait', unit, format });
      const pagesToExport = typeof maxPages === 'number' ? svgs.slice(0, maxPages) : svgs;

      // Rasterize every page in parallel — the SVG→Image decode inside
      // svgToCanvas is the slow async step and the pages are independent. JPEG
      // encoding and page placement stay sequential to preserve page order.
      const canvases = await Promise.all(
        pagesToExport.map((svg) => svgToCanvas(svg, 1.5)),
      );

      for (let index = 0; index < canvases.length; index++) {
        const canvas = canvases[index];
        const jpegData = canvas.toDataURL('image/jpeg', 0.92);
        if (index > 0) pdf.addPage(format, 'portrait');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const availableWidth = pageWidth - margin * 2;
        const availableHeight = pageHeight - margin * 2;
        const imgAspect = canvas.width / canvas.height;
        let w = availableWidth;
        let h = w / imgAspect;
        if (h > availableHeight) { h = availableHeight; w = h * imgAspect; }
        const x = (pageWidth - w) / 2;
        const y = (pageHeight - h) / 2;
        pdf.addImage(jpegData, 'JPEG', x, y, w, h, undefined, 'FAST');
      }

      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      setPdfBlobUrl(url);
      setPdfFilename(`${baseName}.pdf`);
      showExportSuccess('PDF ready. Tap Open PDF.');
    } catch (error) {
      showExportError(`PDF export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      restoreDisplayMode(osmd);
      osmd.Zoom = zoomSnapshot;
      osmd.render();
      if (containerRef.current) {
        try {
          repositionRehearsalMarksBetweenSystems(
            containerRef.current, osmd, rehearsalTexts,
          );
        } catch { /* ignore */ }
      }
    }
  }, [baseName, rehearsalTexts, pdfPageSize, showExportError, showExportSuccess]);

  const printScore = useCallback(() => {
    const osmd = osmdRef.current;
    if (!osmd || renderedPageCount === 0) { showExportError('No rendered score found.'); return; }
    const zoomSnapshot = osmd.Zoom;
    let restored = false;
    const restoreAfterPrint = () => {
      if (restored) return;
      restored = true;
      window.removeEventListener('afterprint', restoreAfterPrint);
      restoreDisplayMode(osmd);
      osmd.Zoom = zoomSnapshot;
      osmd.render();
      if (containerRef.current) {
        try {
          repositionRehearsalMarksBetweenSystems(
            containerRef.current, osmd, rehearsalTexts,
          );
        } catch { /* ignore */ }
      }
    };
    try {
      applyPrintProfile(osmd, pdfPageSize);
      osmd.Zoom = PRINT_ZOOM;
      osmd.render();
      if (containerRef.current) {
        try {
          repositionRehearsalMarksBetweenSystems(
            containerRef.current, osmd, rehearsalTexts,
          );
        } catch { /* don't block print */ }
      }
      window.addEventListener('afterprint', restoreAfterPrint, { once: true });
      window.print();
      setTimeout(restoreAfterPrint, 1000);
    } catch (error) {
      restoreAfterPrint();
      showExportError(`Print failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [rehearsalTexts, pdfPageSize, renderedPageCount, showExportError]);

  const printAlphaTab = useCallback(() => {
    const svgs = getAlphaTabSvgEls();
    if (appMode !== 'alphatab' || svgs.length === 0) {
      showExportError('No AlphaTab score found. Wait for rendering to finish, then try Print.');
      return;
    }
    setAlphaTabFullscreen(false);

    // Open the print window NOW, synchronously within the user-gesture context.
    // Calling window.open() after an await is blocked on mobile Safari.
    const printWin = window.open('', '_blank');
    if (!printWin) {
      showExportError('Pop-up blocked. Allow pop-ups to print, or use Export PDF instead.');
      return;
    }
    printWin.document.write(
      '<html><head><title>Print Score</title></head>' +
      '<body style="background:#fff;padding:2rem;text-align:center;font-family:sans-serif;">' +
      '<p>Preparing print layout…</p></body></html>',
    );

    const isLetter = pdfPageSize === 'letter';
    const marginIn = 0.5;

    // Async: stitch system strips into page-sized images, then write to the opened window.
    alphaTabSvgsToPageCanvases(svgs, isLetter, 2)
      .then(({ pages, isLandscape }) => {
        if (pages.length === 0) {
          showExportError('Print failed: could not compute page layout.');
          try { printWin.close(); } catch { /* ignore */ }
          return;
        }

        // Use explicit physical dimensions so iOS AirPrint scales correctly at 100%.
        const cssSize = isLetter
          ? (isLandscape ? '11in 8.5in'   : '8.5in 11in')
          : (isLandscape ? '297mm 210mm'  : '210mm 297mm');
        const pgW  = isLetter ? (isLandscape ? '11in'  : '8.5in') : (isLandscape ? '297mm' : '210mm');
        const pgH  = isLetter ? (isLandscape ? '8.5in' : '11in')  : (isLandscape ? '210mm' : '297mm');

        const imgs = pages
          .map((c) => `<div class="pg"><img src="${c.toDataURL('image/jpeg', 0.92)}" alt=""></div>`)
          .join('');
        // Wrap each image in a .pg div with exact physical page dimensions so iOS
        // knows the intended scale without the user having to adjust it manually.
        // The inline <script> triggers print once all images have decoded.
        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Print Score</title>
<style>
@page{size:${cssSize};margin:0}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#fff}
.pg{
  width:${pgW};height:${pgH};
  display:flex;align-items:center;justify-content:center;
  padding:${marginIn}in;
  page-break-after:always;break-after:page;
  overflow:hidden
}
.pg:last-child{page-break-after:avoid;break-after:auto}
img{width:100%;height:100%;object-fit:contain;display:block}
@media print{.pg{page-break-after:always;break-after:page}.pg:last-child{page-break-after:avoid;break-after:auto}}
</style>
</head>
<body>
${imgs}
<script>(function(){
function go(){window.focus();window.print();}
if(document.readyState==='complete'){go();}
else{window.addEventListener('load',go,{once:true});}
})();<\/script>
</body>
</html>`;
        printWin.document.open();
        printWin.document.write(html);
        printWin.document.close();
      })
      .catch((err) => {
        showExportError(`Print failed: ${err instanceof Error ? err.message : String(err)}`);
        try { printWin.close(); } catch { /* ignore */ }
      });
  }, [appMode, getAlphaTabSvgEls, pdfPageSize, showExportError]);

  // ── MusicXML → ChordPro ──
  const generateChordPro = useCallback(async () => {
    if (!loadedXmlText) { showExportError('Load a MusicXML file before generating ChordPro.'); return; }
    try {
      const options = buildChordProOptionsFromUI(chordProUi);
      const result = await convertMusicXmlToChordPro({ filename: loadedFilename, xmlText: loadedXmlText }, options);
      setChordProText(result.chordPro);
      setChordProWarnings(result.warnings);
      setChordProDiagnostics(result.diagnostics);
      if (result.error) { showExportError(`ChordPro generated with issues: ${result.error}`); return; }
      showExportSuccess('ChordPro generated.');
    } catch (error) {
      showExportError(`ChordPro conversion failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [chordProUi, loadedFilename, loadedXmlText, showExportError, showExportSuccess]);

  const generateCsmpnFakeBook = useCallback(async () => {
    if (!loadedXmlText) { showExportError('Load a MusicXML file before generating CSMPN Fake Book.'); return; }
    try {
      const options = {
        ...buildChordProOptionsFromUI(chordProUi),
        formatMode: 'fakebook' as const,
      };
      const result = await convertMusicXmlToChordPro({ filename: loadedFilename, xmlText: loadedXmlText }, options);
      const tempo = parseTempoFromMusicXml(loadedXmlText);
      const fallbackTitle = getBaseFilename(loadedFilename);
      const csmpn = buildCsmpnFakeBookSource(result.chordPro, fallbackTitle, tempo);
      setCsmpnFakeBookText(csmpn);
      setCsmpnWarnings(result.warnings);
      if (result.error) { showExportError(`CSMPN Fake Book generated with issues: ${result.error}`); return; }
      showExportSuccess('CSMPN Fake Book generated.');
    } catch (error) {
      showExportError(`CSMPN Fake Book conversion failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [chordProUi, loadedFilename, loadedXmlText, showExportError, showExportSuccess]);

  const copyChordPro = useCallback(async (text: string) => {
    if (!text) { showExportError('Nothing to copy.'); return; }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.cssText = 'position:fixed;opacity:0';
        document.body.append(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Copy command was not successful.');
      }
      showExportSuccess('Copied.');
    } catch (error) {
      showExportError(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [showExportError, showExportSuccess]);

  const downloadChordProText = useCallback((text: string, filename: string) => {
    if (!text) { showExportError('Nothing to download.'); return; }
    try {
      triggerBlobDownload(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename);
      showExportSuccess('Downloaded .pro file.');
    } catch (error) {
      showExportError(`ChordPro download failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [showExportError, showExportSuccess]);

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const shareText = useCallback(async (text: string, filename: string) => {
    if (!text) { showExportError('Nothing to share.'); return; }
    if (!canShare) { showExportError('Share is not supported in this browser.'); return; }
    try {
      const file = new File([text], filename, { type: 'text/plain' });
      await navigator.share({ files: [file], title: filename });
      showExportSuccess('Shared.');
    } catch (error) {
      showExportError(`Share failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [canShare, showExportError, showExportSuccess]);

  const canSharePdf = typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function';

  const sharePdf = useCallback(async () => {
    if (!pdfBlobUrl) { showExportError('Generate PDF first.'); return; }
    if (!canSharePdf) { showExportError('PDF share is not supported in this browser.'); return; }
    try {
      const response = await fetch(pdfBlobUrl);
      const blob = await response.blob();
      const file = new File([blob], pdfFilename, { type: 'application/pdf' });
      if (!navigator.canShare({ files: [file] })) { showExportError('PDF share is not supported in this browser.'); return; }
      await navigator.share({ files: [file], title: pdfFilename });
      showExportSuccess('PDF shared.');
    } catch (error) {
      showExportError(`PDF share failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [canSharePdf, pdfBlobUrl, pdfFilename, showExportError, showExportSuccess]);

  // ── GP → Chord Chart: load extracted ChordPro text into chord-chart mode ──
  const loadGpAsChordChart = useCallback(() => {
    if (!gpChordProText) return;
    const doc = parseChordChart(gpChordProText, 'chordpro');
    const chartExport = serializeChordProFromDocument(doc, transposeSemitones, chordProUi, transposeEnharmonic);
    setChartDocument(doc);
    setDetectedFormatLabel('Guitar Pro (ChordPro)');
    setChartChordProText(chartExport.text);
    setChartChordProWarnings([...gpChordProWarnings, ...chartExport.warnings]);
    setLoadedXmlText('');
    setPristineXmlText('');
    setIsMxl(false);
    setRenderedPageCount(0);
    setRenderError('');
    setExportFeedback(null);
    setAppMode('chord-chart');
  }, [gpChordProText, gpChordProWarnings, transposeSemitones, chordProUi, transposeEnharmonic,
      setChartDocument, setDetectedFormatLabel, setChartChordProText, setChartChordProWarnings,
      setLoadedXmlText, setPristineXmlText, setIsMxl, setRenderedPageCount, setRenderError,
      setExportFeedback, setAppMode]);

  // ── Chord-chart PDF export ──
  const exportChordChartPdf = useCallback(async () => {
    const chartEl = chartRef.current?.querySelector('.chord-chart') as HTMLElement | null;
    if (!chartEl) { showExportError('No chord chart to export.'); return; }

    const isLetter = pdfPageSize === 'letter';
    const unit = isLetter ? 'in' : 'mm';
    const format: [number, number] = isLetter ? [8.5, 11] : [210, 297];
    const margin = isLetter ? 0.5 : 12;

    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(chartEl, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });

      const pdf = new jsPDF({ orientation: 'portrait', unit, format });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const contentW = pageW - margin * 2;
      const contentH = pageH - margin * 2;

      // pxPerUnit: canvas pixels per inch (or mm)
      const pxPerUnit = canvas.width / contentW;
      const pageCanvasPx = Math.floor(contentH * pxPerUnit);
      const totalPages = Math.ceil(canvas.height / pageCanvasPx);

      for (let p = 0; p < totalPages; p++) {
        if (p > 0) pdf.addPage(format, 'portrait');
        const srcY = p * pageCanvasPx;
        const srcH = Math.min(pageCanvasPx, canvas.height - srcY);
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = srcH;
        slice.getContext('2d')!.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
        const imgData = slice.toDataURL('image/jpeg', 0.92);
        pdf.addImage(imgData, 'JPEG', margin, margin, contentW, srcH / pxPerUnit, undefined, 'FAST');
      }

      const blob = pdf.output('blob');
      setPdfBlobUrl(URL.createObjectURL(blob));
      setPdfFilename(`${baseName}.pdf`);
      showExportSuccess('PDF ready. Tap Open PDF.');
    } catch (error) {
      showExportError(`PDF export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [baseName, pdfPageSize, showExportError, showExportSuccess]);

  const printChordChart = useCallback(() => {
    if (!chartDocument) { showExportError('No chord chart loaded.'); return; }
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      window.removeEventListener('afterprint', restore);
      document.body.classList.remove('printing-chord-chart', 'print-page-letter', 'print-page-a4');
    };
    window.addEventListener('afterprint', restore);
    setTimeout(restore, 10_000);
    document.body.classList.add('printing-chord-chart');
    document.body.classList.add(pdfPageSize === 'a4' ? 'print-page-a4' : 'print-page-letter');
    window.print();
  }, [chartDocument, pdfPageSize, showExportError]);

  // ── Chord-chart controls ──
  const displayTranspose = transposeSemitones;

  const chartExportPreview = useMemo(() => {
    if (!chartDocument) return { text: '', warnings: [] as string[] };
    return serializeChordProFromDocument(chartDocument, transposeSemitones, chordProUi, transposeEnharmonic);
  }, [chartDocument, transposeSemitones, chordProUi, transposeEnharmonic]);

  const generateChartCsmpn = useCallback(() => {
    if (!chartDocument) {
      showExportError('Load a chord chart file before generating CSMPN Fake Book.');
      return;
    }
    const csmpn = buildCsmpnFromChartDocument(chartDocument, transposeSemitones, getBaseFilename(loadedFilename), transposeEnharmonic);
    setCsmpnFakeBookText(csmpn);
    setCsmpnWarnings([]);
    showExportSuccess('CSMPN Fake Book generated.');
  }, [chartDocument, transposeSemitones, transposeEnharmonic, loadedFilename, showExportError, showExportSuccess]);

  const generateChartChordPro = useCallback(() => {
    if (!chartDocument) {
      showExportError('Load a chord chart file before generating ChordPro.');
      return;
    }
    setChartChordProText(chartExportPreview.text);
    setChartChordProWarnings(chartExportPreview.warnings);
    const csmpn = buildCsmpnFromChartDocument(chartDocument, transposeSemitones, getBaseFilename(loadedFilename), transposeEnharmonic);
    setCsmpnFakeBookText(csmpn);
    setCsmpnWarnings([]);
    showExportSuccess('ChordPro generated.');
  }, [chartDocument, chartExportPreview, transposeSemitones, transposeEnharmonic, loadedFilename, showExportError, showExportSuccess]);

  useEffect(() => {
    if (!chartDocument) return;
    setChartChordProText(chartExportPreview.text);
    setChartChordProWarnings(chartExportPreview.warnings);
  }, [chartDocument, chartExportPreview]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        adjustTranspose(1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        adjustTranspose(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [adjustTranspose]);

  const transposeKeyDisplay = useMemo(() => {
    if (appMode === 'chord-chart') return chartDocument?.key ? transposeChord(chartDocument.key, transposeSemitones, transposeEnharmonic) : null;
    if (gpFileBuffer && gpKeyRoot) return transposeChord(gpKeyRoot, transposeSemitones, transposeEnharmonic);
    if (!pristineXmlText) return null;
    return transposeKeyDisplayFromXml(pristineXmlText, transposeSemitones, transposeEnharmonic);
  }, [appMode, chartDocument?.key, gpFileBuffer, gpKeyRoot, pristineXmlText, transposeSemitones, transposeEnharmonic]);

  // ── Guitar Pro: score loaded callback ──
  // Called by AlphaTabRenderer after ScoreLoader parses the GP file.
  const handleGpScoreLoaded = useCallback((score: alphaTabNS.model.Score) => {
    const names = gpScoreTrackNames(score);
    setGpTracks(names);
    const partIdx = alphaTabSettings.partIndex;
    const { text, warnings } = gpScoreToChordPro(score, partIdx);
    setGpChordProText(text);
    setGpChordProWarnings(warnings);
    const positions = gpScoreNotePositions(score, partIdx);
    setAlphaTabNotePositions(positions);
    // Extract tonic of the first bar's key signature for the transpose display.
    // KeySignature is an enum value from -7 (Cb) to +7 (C#).
    const keySig: number = (score.masterBars?.[0]?.keySignature as number) ?? 0;
    const GP_KEY_ROOTS: Record<number, string> = {
      [-7]: 'Cb', [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F',
      0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
    };
    setGpKeyRoot(GP_KEY_ROOTS[keySig] ?? null);
  }, [alphaTabSettings.partIndex]);

  // ─── Render ───────────────────────────────────────────────────────────────

  const canExportNotation = appMode === 'notation' && Boolean(loadedXmlText);
  const canExportTab = appMode === 'tablature' && Boolean(tabScoreData?.measures.length);
  const canExportAlphaTab = appMode === 'alphatab' && Boolean(loadedXmlText || gpFileBuffer);

  return (
    <div className="app-shell">
      {/* ── Top bar ── */}
      <header className="top-bar">
        {/* ── Left zone: upload + mode + view controls ── */}
        <div className="top-bar__start">
          <label className="upload-btn">
            ♪ Open
            <input type="file" accept={FILE_INPUT_ACCEPT} onChange={onFileInput} />
          </label>

          {appMode === 'empty' && (
            <span className="hint">Drop a file or click Open</span>
          )}

          {loadedFilename && appMode !== 'empty' && (
            <span className="filename-chip" title={loadedFilename}>{loadedFilename}</span>
          )}

          {/* ── Mode badge + view controls for notation/tab/alphatab ── */}
          {appMode === 'notation' && (
            <>
              <div className="view-controls">
                <button type="button" className="btn-view btn-view--active">Notation</button>
                <button type="button" className="btn-view" onClick={() => setAppMode('tablature')}>Tab</button>
                <button type="button" className="btn-view" onClick={() => setAppMode('alphatab')}>AlphaTab</button>
              </div>
              <button type="button" className="btn-sm" onClick={() => adjustZoom(-0.1)} title="Zoom out">−</button>
              <button type="button" className="btn-sm" onClick={() => adjustZoom(0.1)} title="Zoom in">+</button>
              <button type="button" className="btn-sm" onClick={fitWidth}>Fit</button>
            </>
          )}

          {appMode === 'tablature' && (
            <div className="view-controls">
              <button type="button" className="btn-view" onClick={() => setAppMode('notation')}>Notation</button>
              <button type="button" className="btn-view btn-view--active">Tab</button>
              <button type="button" className="btn-view" onClick={() => setAppMode('alphatab')}>AlphaTab</button>
            </div>
          )}

          {appMode === 'alphatab' && (
            <>
              <span className="mode-badge mode-badge--alphatab">
                {gpFileBuffer ? `GP ${gpVersion}` : 'AlphaTab'}
              </span>
              {!gpFileBuffer && (
                <div className="view-controls">
                  <button type="button" className="btn-view" onClick={() => setAppMode('notation')}>Notation</button>
                  <button type="button" className="btn-view" onClick={() => setAppMode('tablature')}>Tab</button>
                  <button type="button" className="btn-view btn-view--active">AlphaTab</button>
                </div>
              )}
              <button type="button" className="btn-sm" onClick={() => adjustAlphaTabZoom(-0.1)} title="Zoom out">−</button>
              <button type="button" className="btn-sm" onClick={() => adjustAlphaTabZoom(0.1)} title="Zoom in">+</button>
              <button type="button" className="btn-sm" onClick={() => setAlphaTabFullscreen((f) => !f)}>
                {alphaTabFullscreen ? '⊠ Exit' : '⊡ Full'}
              </button>
            </>
          )}

          {appMode === 'chord-chart' && (
            <span className="mode-badge mode-badge--chart">Chord Chart · {detectedFormatLabel}</span>
          )}
        </div>

        {/* ── Right zone: transpose + utility actions ── */}
        <div className="top-bar__end">
          {appMode !== 'empty' && (
            <div className="transpose-row transpose-row--topbar">
              <span className="transpose-label">Transpose</span>
              <button type="button" className="btn-sm" onClick={() => adjustTranspose(-1)} disabled={transposeSemitones <= -12}>−</button>
              <span className="transpose-value">
                {displayTranspose > 0 ? `+${displayTranspose}` : displayTranspose}
              </span>
              <button type="button" className="btn-sm" onClick={() => adjustTranspose(1)} disabled={transposeSemitones >= 12}>+</button>
              <button type="button" className="btn-sm" onClick={() => setTransposeSemitones(0)} disabled={transposeSemitones === 0}>
                Reset
              </button>
              <select
                className="transpose-enharmonic"
                value={transposeEnharmonic}
                onChange={(e) => setTransposeEnharmonic(e.target.value as EnharmonicPreference)}
                aria-label="Enharmonic spelling"
              >
                <option value="auto">Auto (♭/♯)</option>
                <option value="flats">Flats (♭)</option>
                <option value="sharps">Sharps (♯)</option>
              </select>
              {transposeKeyDisplay && (
                <span className="transpose-meta">{transposeKeyDisplay}</span>
              )}
            </div>
          )}

          {appMode !== 'empty' && (
            <button type="button" className="btn-sm btn-danger" onClick={clearAll}>✕ Clear</button>
          )}
          {appMode !== 'empty' && (
            <button
              type="button"
              className="sidebar-toggle-btn btn-sm"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-expanded={sidebarOpen}
            >
              {sidebarOpen ? 'Hide ▲' : '⚙ Settings'}
            </button>
          )}
        </div>
      </header>

      {/* ── Error banners ── */}
      {loadedXmlText && diagnostics && !diagnostics.isValidXml && (
        <div className="error-banner">XML parse error: {diagnostics.parseError ?? 'Invalid XML'}</div>
      )}
      {renderError && <div className="error-banner">{renderError}</div>}
      {transposeWarnings.length > 0 && (
        <div className="warning-block">
          <strong>Transpose warnings:</strong>
          <ul>
            {transposeWarnings.map((warning, index) => <li key={`transpose-warning-${index}`}>{warning}</li>)}
          </ul>
        </div>
      )}

      {/* ── Content area ── */}
      <main className="content-grid">

        {/* ── Left: score viewport, tab view, or chord chart ── */}
        {appMode === 'chord-chart' ? (
          <section
            ref={chartRef}
            className={`chord-chart-viewport ${isDragging ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            {chartDocument && (
              <ChordChart document={chartDocument} transposeSteps={transposeSemitones} enharmonicPreference={transposeEnharmonic} twoColumn={chartTwoColumn} fontSize={chartFontSize} />
            )}
          </section>
        ) : appMode === 'tablature' ? (
          <section
            className={`score-viewport ${isDragging ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            {tabRenderError && (
              <div className="error-banner">Tab render error: {tabRenderError}</div>
            )}
            {tabScoreData && (
              <VexFlowTabRenderer
                scoreData={tabScoreData}
                tuning={tabTuning}
                fontSize={tabFontSize}
                measuresPerRow={tabMeasuresPerRow}
                onRenderError={(e) => setTabRenderError(e)}
              />
            )}
          </section>
        ) : appMode === 'alphatab' ? (
          <section
            className={`score-viewport alphatab-viewport${alphaTabFullscreen ? ' alphatab-viewport--fullscreen' : ''} ${isDragging ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            {alphaTabFullscreen && (
              <button
                type="button"
                className="alphatab-fullscreen-close"
                onClick={() => setAlphaTabFullscreen(false)}
                aria-label="Exit full screen"
              >
                ✕
              </button>
            )}
            {alphaTabRenderError && (
              <div className="error-banner">AlphaTab error: {alphaTabRenderError}</div>
            )}
            {(loadedXmlText || gpFileBuffer) && (
              <AlphaTabRenderer
                key={gpFileBuffer ? `gp-${loadedFilename}` : `at-${loadedXmlText.slice(0, 40)}`}
                xmlText={gpFileBuffer ? undefined : loadedXmlText}
                fileBytes={gpFileBytes}
                uiSettings={alphaTabSettings}
                onScoreLoaded={gpFileBuffer ? handleGpScoreLoaded : undefined}
                onError={setAlphaTabRenderError}
              />
            )}
          </section>
        ) : (
          <section
            className={`score-viewport ${isDragging ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            {appMode === 'empty' && (
              <div className="empty-state">
                <div className="empty-state__icon">♬</div>
                <h2 className="empty-state__title">Open a Music File</h2>
                <p className="empty-state__subtitle">Drag &amp; drop onto this area, or click <strong>♪ Open</strong> above</p>
                <div className="empty-state__formats">
                  <span>MusicXML</span>
                  <span>.mxl</span>
                  <span>.gp3</span>
                  <span>.gp4</span>
                  <span>.gp5</span>
                  <span>.gpx</span>
                  <span>ChordPro</span>
                  <span>.cho</span>
                  <span>.pro</span>
                  <span>.txt</span>
                </div>
              </div>
            )}
            <div ref={containerRef} className="score-container" />
          </section>
        )}

        {/* ── Right: side panel ── */}
        <aside className={`side-panel${sidebarOpen ? ' side-panel--open' : ''}`}>
          {appMode !== 'alphatab' && <div className="panel-section"><OmrImportPanel
            accept={OMR_FILE_INPUT_ACCEPT}
            file={omrFile}
            mode={omrMode}
            isSubmitting={omrSubmissionInFlight}
            validationMessage={omrValidationMessage}
            uiError={omrUiError}
            jobId={omrJobId}
            jobStatus={omrJobStatus}
            progressMessage={omrProgressMessage}
            summary={omrSummary}
            logs={omrLogs}
            artifacts={omrArtifacts}
            failure={omrFailure}
            onModeChange={setOmrMode}
            onFileInput={onOmrFileInput}
            onDrop={onOmrDrop}
            onSubmit={() => void submitOmrJob()}
            resolveUrl={resolveOmrUrl}
            onCopySummary={async () => {
              if (!omrSummary) return;
              if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(JSON.stringify(omrSummary, null, 2));
                showExportSuccess('Copied OMR summary JSON.');
                return;
              }
              showExportError('Clipboard not supported in this browser.');
            }}
            hasInlineMusicXml={Boolean(omrInlineMusicXml)}
            onDownloadInlineMusicXml={() => {
              if (!omrInlineMusicXml) {
                showExportError('No inline MusicXML found to download.');
                return;
              }
              triggerBlobDownload(new Blob([omrInlineMusicXml], { type: 'application/xml;charset=utf-8' }), `${getBaseFilename(loadedFilename)}.omr.musicxml`);
              showExportSuccess('Downloaded OMR-generated MusicXML.');
            }}
          /></div>}

          {/* ── Chord-chart mode panel ── */}
          {appMode === 'chord-chart' && chartDocument && (
            <>
              <div className="panel-section">
                <h2 className="section-label" style={{ marginBottom: '0.6rem' }}>Chart Info</h2>
                <ul>
                  <li><strong>File:</strong> {loadedFilename}</li>
                  <li><strong>Format:</strong> {detectedFormatLabel}</li>
                  {chartDocument.title && <li><strong>Title:</strong> {chartDocument.title}</li>}
                  {chartDocument.artist && <li><strong>Artist:</strong> {chartDocument.artist}</li>}
                  {chartDocument.key && <li><strong>Key:</strong> {chartDocument.key}</li>}
                  {chartDocument.capo && <li><strong>Capo:</strong> {chartDocument.capo}</li>}
                  <li><strong>Sections:</strong> {chartDocument.sections.length}</li>
                </ul>
              </div>

              {/* ── Song Analytics (USM) ── */}
              {songModel && (
                <div className="panel-section">
                  <h2 className="section-label" style={{ marginBottom: '0.6rem' }}>Song Analytics</h2>
                  <SongAnalyticsPanel model={songModel} />
                </div>
              )}

              <div className="panel-section">
                <h2 className="section-label" style={{ marginBottom: '0.6rem' }}>Print / Export</h2>
                <label className="export-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={chartTwoColumn}
                    onChange={(e) => setChartTwoColumn(e.target.checked)}
                  />
                  2-column layout
                </label>
                <label className="export-label" htmlFor="chart-font-size" style={{ marginBottom: '0.2rem' }}>
                  Font Size: {chartFontSize}%
                </label>
                <input
                  id="chart-font-size"
                  type="range"
                  min={70}
                  max={140}
                  step={5}
                  value={chartFontSize}
                  onChange={(e) => setChartFontSize(Number(e.target.value))}
                  style={{ width: '100%', marginBottom: '0.6rem' }}
                />
                <label className="export-label" htmlFor="chart-pdf-size">Page Size</label>
                <select
                  id="chart-pdf-size"
                  value={pdfPageSize}
                  onChange={(e) => setPdfPageSize(e.target.value as PdfPageSize)}
                  style={{ marginBottom: '0.6rem' }}
                >
                  <option value="letter">Letter (Portrait)</option>
                  <option value="a4">A4 (Portrait)</option>
                </select>
                <div className="export-actions">
                  <button type="button" className="btn-primary" onClick={printChordChart}>
                    Print / Save PDF
                  </button>
                  <button type="button" onClick={() => void exportChordChartPdf()}>
                    Generate PDF
                  </button>
                </div>
                {pdfBlobUrl && pdfFilename && (
                  <div className="pdf-ready-box">
                    <a href={pdfBlobUrl} download={pdfFilename} className="btn-primary">
                      Open PDF
                    </a>
                  </div>
                )}
                <p className="export-hint">Print uses browser dialog — choose "Save as PDF" for a file. Generate PDF produces a rasterized PDF directly.</p>
              </div>

              <div className="panel-section">
              <h2 className="section-label" style={{ marginBottom: '0.6rem' }}>ChordPro Export</h2>
              <div className="chordpro-options-grid">
                <label className="export-label" htmlFor="chart-chordpro-bars">Bars per line</label>
                <input
                  id="chart-chordpro-bars" type="number" min={1} max={16}
                  value={chordProUi.barsPerLine}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setChordProUi((p) => ({ ...p, barsPerLine: Number.isFinite(v) ? Math.max(1, Math.min(16, v)) : p.barsPerLine }));
                  }}
                />
                <label className="export-label" htmlFor="chart-chordpro-mode">Mode</label>
                <select id="chart-chordpro-mode" value={chordProUi.mode}
                  onChange={(e) => setChordProUi((p) => ({ ...p, mode: e.target.value as ChordProModeUi }))}>
                  <option value="auto">Auto</option>
                  <option value="lyrics-inline">Lyrics Inline</option>
                  <option value="grid-only">Grid Only</option>
                  <option value="fakebook">Fake Book</option>
                </select>
                <label className="export-label" htmlFor="chart-chordpro-brackets">Chord bracket style</label>
                <select id="chart-chordpro-brackets" value={chordProUi.chordBracketStyle}
                  onChange={(e) => setChordProUi((p) => ({ ...p, chordBracketStyle: e.target.value as ChordProBracketUi }))}>
                  <option value="separate">Separate</option>
                  <option value="combined">Combined</option>
                </select>
              </div>

              <div className="chart-actions">
                <button type="button" className="btn-primary" onClick={generateChartChordPro}>
                  Generate ChordPro
                </button>
                <button type="button" onClick={generateChartCsmpn}>
                  Generate CSMPN Fake Book
                </button>
                <button type="button" onClick={() => void copyChordPro(chartChordProText)}>
                  Copy ChordPro
                </button>
                <button type="button" onClick={() => downloadChordProText(chartChordProText, deriveProFilename(loadedFilename))}>
                  Download .pro
                </button>
                {canShare && (
                  <button type="button" onClick={() => void shareText(chartChordProText, deriveProFilename(loadedFilename))}>
                    Share
                  </button>
                )}
              </div>

              <textarea
                className="chordpro-output"
                value={chartChordProText}
                placeholder="Generated ChordPro output will appear here."
                wrap="off"
                spellCheck={false}
                readOnly
              />
              {chartChordProWarnings.length > 0 && (
                <div className="warning-block">
                  <strong>ChordPro warnings</strong>
                  <ul>{chartChordProWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
              )}
              </div>

              <div className="panel-section">
              <h2 className="section-label" style={{ marginBottom: '0.6rem' }}>CSMPN Source</h2>
              <div className="export-actions">
                <button type="button" onClick={() => void copyChordPro(csmpnFakeBookText)} disabled={!csmpnFakeBookText}>
                  Copy CSMPN
                </button>
                <button type="button" onClick={() => downloadChordProText(csmpnFakeBookText, `${baseName}.csmpn.txt`)} disabled={!csmpnFakeBookText}>
                  Download .txt
                </button>
                {canShare && (
                  <button type="button" onClick={() => void shareText(csmpnFakeBookText, `${baseName}.csmpn.txt`)} disabled={!csmpnFakeBookText}>
                    Share
                  </button>
                )}
              </div>
              <textarea
                className="chordpro-output"
                value={csmpnFakeBookText}
                placeholder="Generated CSMPN fake-book source will appear here..."
                wrap="off" spellCheck={false} readOnly
              />
              {csmpnWarnings.length > 0 && (
                <div className="warning-block">
                  <strong>CSMPN warnings</strong>
                  <ul>{csmpnWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
              )}
              </div>
            </>
          )}

          {/* ── Notation mode panel ── */}
          {appMode === 'notation' && (
            <>
              <div className="panel-section">
                <h2 className="section-label" style={{ marginBottom: '0.6rem' }}>Diagnostics</h2>
                {diagnostics ? (
                  <ul>
                    <li><strong>File:</strong> {loadedFilename || 'n/a'}</li>
                    <li><strong>Root:</strong> {diagnostics.rootName}</li>
                    <li><strong>Version:</strong> {diagnostics.version}</li>
                    {!diagnostics.isValidXml && diagnostics.parseError && (
                      <li><strong>Parse error:</strong> {diagnostics.parseError}</li>
                    )}
                    <li><strong>Parts:</strong> {diagnostics.parts}</li>
                    <li><strong>Measures:</strong> {diagnostics.measures}</li>
                    <li><strong>Notes:</strong> {diagnostics.notes}</li>
                    <li><strong>Harmonies:</strong> {diagnostics.harmonies}</li>
                    <li><strong>Has key:</strong> {diagnostics.hasKey ? 'yes' : 'no'}</li>
                    <li><strong>Has time:</strong> {diagnostics.hasTime ? 'yes' : 'no'}</li>
                    <li><strong>Has divisions:</strong> {diagnostics.hasDivisions ? 'yes' : 'no'}</li>
                    <li><strong>Source type:</strong> {isMxl ? 'MXL archive' : 'XML text'}</li>
                  </ul>
                ) : (
                  <p>No file loaded.</p>
                )}
                {xmlWarnings.length > 0 && (
                  <div className="warning-block">
                    <strong>Warnings</strong>
                    <ul>{xmlWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
                  </div>
                )}
              </div>

              <div className="panel-section">
                <h2 className="section-label" style={{ marginBottom: '0.6rem' }}>ChordPro Export</h2>
                <div className="chordpro-options-grid">
                  <label className="export-label" htmlFor="chordpro-bars">Bars per line</label>
                  <input
                    id="chordpro-bars" type="number" min={1} max={16}
                    value={chordProUi.barsPerLine}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setChordProUi((p) => ({ ...p, barsPerLine: Number.isFinite(v) ? Math.max(1, Math.min(16, v)) : p.barsPerLine }));
                    }}
                  />
                  <label className="export-label" htmlFor="chordpro-mode">Mode</label>
                  <select id="chordpro-mode" value={chordProUi.mode}
                    onChange={(e) => setChordProUi((p) => ({ ...p, mode: e.target.value as ChordProModeUi }))}>
                    <option value="auto">Auto</option>
                    <option value="lyrics-inline">Lyrics Inline</option>
                    <option value="grid-only">Grid Only</option>
                    <option value="fakebook">Fake Book</option>
                  </select>
                  <label className="export-label" htmlFor="chordpro-brackets">Chord bracket style</label>
                  <select id="chordpro-brackets" value={chordProUi.chordBracketStyle}
                    onChange={(e) => setChordProUi((p) => ({ ...p, chordBracketStyle: e.target.value as ChordProBracketUi }))}>
                    <option value="separate">Separate</option>
                    <option value="combined">Combined</option>
                  </select>
                  <label className="export-label" htmlFor="chordpro-repeat">Repeat</label>
                  <select id="chordpro-repeat" value={chordProUi.repeatStrategy}
                    onChange={(e) => setChordProUi((p) => ({ ...p, repeatStrategy: e.target.value as ChordProRepeatUi }))}>
                    <option value="none">None</option>
                    <option value="simple-unroll">Simple Unroll</option>
                  </select>
                  <label className="export-label" htmlFor="chordpro-enharmonic">Enharmonic</label>
                  <select id="chordpro-enharmonic" value={chordProUi.enharmonicStyle}
                    onChange={(e) => setChordProUi((p) => ({ ...p, enharmonicStyle: e.target.value as ChordProEnharmonicUi }))}>
                    <option value="auto">Auto (key-based)</option>
                    <option value="flats">Prefer flats</option>
                    <option value="sharps">Prefer sharps</option>
                  </select>
                  <label className="export-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4em' }}>
                    <input type="checkbox" checked={chordProUi.jazzSymbols}
                      onChange={(e) => setChordProUi((p) => ({ ...p, jazzSymbols: e.target.checked }))} />
                    Jazz symbols (Δ7 ø7 °7)
                  </label>
                </div>

                <div className="export-actions">
                  <button type="button" className="btn-primary" onClick={() => void generateChordPro()} disabled={!canExportNotation}>
                    Generate ChordPro
                  </button>
                  <button type="button" onClick={() => void generateCsmpnFakeBook()} disabled={!canExportNotation}>
                    Generate CSMPN
                  </button>
                  <button type="button" onClick={() => void copyChordPro(chordProText)} disabled={!chordProText}>
                    Copy
                  </button>
                  <button type="button" onClick={() => downloadChordProText(chordProText, deriveProFilename(loadedFilename))} disabled={!chordProText}>
                    Download .pro
                  </button>
                  {canShare && (
                    <button type="button" onClick={() => void shareText(chordProText, deriveProFilename(loadedFilename))} disabled={!chordProText}>
                      Share
                    </button>
                  )}
                </div>

                <textarea
                  className="chordpro-output"
                  value={chordProText}
                  placeholder="Generated ChordPro will appear here..."
                  wrap="off" spellCheck={false} readOnly
                />

                {chordProWarnings.length > 0 && (
                  <div className="warning-block">
                    <strong>ChordPro warnings</strong>
                    <ul>{chordProWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
                  </div>
                )}

                {chordProDiagnostics && (
                  <div className="hint-text">
                    {chordProDiagnostics.xmlIntake && (
                      <p>
                        <span
                          className={`reducibility-badge reducibility-badge--${chordProDiagnostics.xmlIntake.reducibilityClass}`}
                          title={chordProDiagnostics.xmlIntake.reasons.join(' · ') || undefined}
                        >
                          {chordProDiagnostics.xmlIntake.reducibilityLabel}
                          {' '}({chordProDiagnostics.xmlIntake.reducibilityScore}/100)
                        </span>
                      </p>
                    )}
                    <p>
                      Mode: <strong>{chordProDiagnostics.formatModeResolved}</strong>
                      {' · '}Measures: {chordProDiagnostics.measuresCount}
                      {chordProDiagnostics.harmoniesCollected !== undefined &&
                        <> · {chordProDiagnostics.harmoniesCollected} chords
                          {chordProDiagnostics.inferredHarmoniesCount !== undefined &&
                            <em> (inferred)</em>}
                        </>}
                      {chordProDiagnostics.scoreFormat === 'timewise-converted' &&
                        <> · <em>timewise converted</em></>}
                    </p>
                  </div>
                )}
              </div>

              <div className="panel-section">
                <h2 className="section-label" style={{ marginBottom: '0.6rem' }}>CSMPN Source</h2>
                <div className="export-actions">
                  <button type="button" onClick={() => void copyChordPro(csmpnFakeBookText)} disabled={!csmpnFakeBookText}>
                    Copy CSMPN
                  </button>
                  <button type="button" onClick={() => downloadChordProText(csmpnFakeBookText, `${baseName}.csmpn.txt`)} disabled={!csmpnFakeBookText}>
                    Download .txt
                  </button>
                  {canShare && (
                    <button type="button" onClick={() => void shareText(csmpnFakeBookText, `${baseName}.csmpn.txt`)} disabled={!csmpnFakeBookText}>
                      Share
                    </button>
                  )}
                </div>
                <textarea
                  className="chordpro-output"
                  value={csmpnFakeBookText}
                  placeholder="Generated CSMPN fake-book source will appear here..."
                  wrap="off" spellCheck={false} readOnly
                />
                {csmpnWarnings.length > 0 && (
                  <div className="warning-block">
                    <strong>CSMPN warnings</strong>
                    <ul>{csmpnWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
                  </div>
                )}
              </div>

              <div className="panel-section">
                <h2 className="section-label" style={{ marginBottom: '0.6rem' }}>Export</h2>
                <label className="export-label" htmlFor="pdf-page-size">PDF Page Size</label>
                <select id="pdf-page-size" value={pdfPageSize}
                  onChange={(e) => setPdfPageSize(e.target.value as PdfPageSize)}
                  disabled={!canExportNotation}>
                  <option value="letter">Letter (Portrait)</option>
                  <option value="a4">A4 (Portrait)</option>
                </select>

                <div className="export-actions">
                  <button type="button" className="btn-primary" onClick={() => void exportPdf()} disabled={!canExportNotation}>
                    Generate PDF
                  </button>
                  <button type="button" onClick={printScore} disabled={renderedPageCount === 0}>
                    Print / Save as PDF
                  </button>
                  {renderedPageCount > 6 && (
                    <button type="button" onClick={() => void exportPdf(1)} disabled={!canExportNotation}>
                      PDF (First Page)
                    </button>
                  )}
                  <button type="button" onClick={exportSvg} disabled={!canExportNotation}>
                    Export SVG
                  </button>
                  <button type="button" onClick={() => void exportPng()} disabled={!canExportNotation}>
                    Export PNG
                  </button>
                  <button type="button" onClick={downloadXml} disabled={!canExportNotation}>
                    Download XML
                  </button>
                  <button type="button" onClick={downloadDiagnostics} disabled={!canExportNotation}>
                    Download Diagnostics
                  </button>
                </div>

                {pdfBlobUrl && (
                  <div className="pdf-ready-box">
                    <p className="pdf-ready-title">PDF Ready</p>
                    <div className="pdf-ready-actions">
                      <a href={pdfBlobUrl} target="_blank" rel="noopener noreferrer" className="open-pdf-link">
                        Open PDF
                      </a>
                      <a href={pdfBlobUrl} download={pdfFilename}>Download PDF</a>
                      {canSharePdf && (
                        <button type="button" onClick={() => void sharePdf()}>Share PDF</button>
                      )}
                      <button type="button" onClick={clearPdfOutput}>Clear PDF</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Tablature mode panel ── */}
          {appMode === 'tablature' && tabScoreData && (
            <>
              <div className="panel-section">
                <h2 className="section-label" style={{ marginBottom: '0.6rem' }}>Tab Settings</h2>

                <label className="export-label" htmlFor="tab-tuning-preset">Tuning preset</label>
                <select
                  id="tab-tuning-preset"
                  value={tabTuningPreset}
                  onChange={(e) => {
                    const preset = e.target.value;
                    setTabTuningPreset(preset);
                    const strings = TUNING_PRESETS[preset];
                    if (strings) setTabTuning(strings);
                  }}
                >
                  {Object.keys(TUNING_PRESETS).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>

                <label className="export-label">Custom tuning (high→low)</label>
                <div className="tab-tuning-grid">
                  {tabTuning.map((note, i) => (
                    <input
                      key={i}
                      type="text"
                      className="tab-tuning-input"
                      value={note}
                      aria-label={`String ${i + 1}`}
                      onChange={(e) => {
                        const next = [...tabTuning];
                        next[i] = e.target.value;
                        setTabTuning(next);
                        setTabTuningPreset('Custom');
                      }}
                    />
                  ))}
                </div>

                {tabScoreData.parts.length > 1 && (
                  <>
                    <label className="export-label" htmlFor="tab-part">Part</label>
                    <select
                      id="tab-part"
                      value={tabPartIndex}
                      onChange={(e) => setTabPartIndex(Number(e.target.value))}
                    >
                      {tabScoreData.parts.map((p, i) => (
                        <option key={p.id} value={i}>{p.name}</option>
                      ))}
                    </select>
                  </>
                )}

                <div className="tab-settings-row">
                  <label className="export-label" htmlFor="tab-font-size">
                    Font size: {tabFontSize}px
                  </label>
                  <input
                    id="tab-font-size"
                    type="range"
                    min={8}
                    max={20}
                    value={tabFontSize}
                    onChange={(e) => setTabFontSize(Number(e.target.value))}
                    className="tab-range"
                  />
                </div>

                <div className="tab-settings-row">
                  <label className="export-label" htmlFor="tab-mpr">
                    Measures per row: {tabMeasuresPerRow}
                  </label>
                  <input
                    id="tab-mpr"
                    type="range"
                    min={1}
                    max={8}
                    value={tabMeasuresPerRow}
                    onChange={(e) => setTabMeasuresPerRow(Number(e.target.value))}
                    className="tab-range"
                  />
                </div>

                {tabScoreData.warnings.length > 0 && (
                  <div className="warning-block">
                    <strong>Tab warnings</strong>
                    <ul>{tabScoreData.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </div>
                )}
              </div>

              <div className="panel-section">
                <h2 className="section-label" style={{ marginBottom: '0.6rem' }}>Export Tab</h2>
                <label className="export-label" htmlFor="tab-pdf-size">PDF Page Size</label>
                <select
                  id="tab-pdf-size"
                  value={pdfPageSize}
                  onChange={(e) => setPdfPageSize(e.target.value as PdfPageSize)}
                  disabled={!canExportTab}
                >
                  <option value="letter">Letter (Portrait)</option>
                  <option value="a4">A4 (Portrait)</option>
                </select>
                <div className="export-actions">
                  <button type="button" className="btn-primary" onClick={() => void exportTabPdf()} disabled={!canExportTab}>
                    Generate PDF
                  </button>
                  <button type="button" onClick={exportTabSvg} disabled={!canExportTab}>
                    Export SVG
                  </button>
                  <button type="button" onClick={() => void exportTabPng()} disabled={!canExportTab}>
                    Export PNG
                  </button>
                </div>

                {pdfBlobUrl && (
                  <div className="pdf-ready-box">
                    <p className="pdf-ready-title">PDF Ready</p>
                    <div className="pdf-ready-actions">
                      <a href={pdfBlobUrl} target="_blank" rel="noopener noreferrer" className="open-pdf-link">
                        Open PDF
                      </a>
                      <a href={pdfBlobUrl} download={pdfFilename}>Download PDF</a>
                      <button type="button" onClick={clearPdfOutput}>Clear PDF</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── AlphaTab mode panel ── */}
          {appMode === 'alphatab' && (loadedXmlText || gpFileBuffer) && (
            <>
              <div className="panel-section">
                <AlphaTabControls
                  settings={alphaTabSettings}
                  parts={
                    gpFileBuffer
                      ? gpTracks.map((name, i) => ({ id: String(i), name }))
                      : (tabScoreData?.parts ?? [])
                  }
                  onSettingsChange={setAlphaTabSettings}
                />
              </div>

              {/* GP ChordPro extraction */}
              {gpFileBuffer && gpChordProText && (
                <div className="panel-section">
                  <h2 className="section-label" style={{ marginBottom: '0.6rem' }}>Extracted Chords</h2>
                  {gpChordProWarnings.map((w, i) => (
                    <p key={i} className="warning-block">{w}</p>
                  ))}
                  <textarea
                    className="chordpro-output"
                    readOnly
                    value={gpChordProText}
                    rows={10}
                  />
                  <div className="chart-actions" style={{ marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={loadGpAsChordChart}
                    >
                      View as Chord Chart
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyChordPro(gpChordProText)}
                    >
                      Copy ChordPro
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const blob = new Blob([gpChordProText], { type: 'text/plain' });
                        const base = loadedFilename.replace(/\.[^.]+$/, '');
                        triggerBlobDownload(blob, `${base}.cho`);
                      }}
                    >
                      Download .cho
                    </button>
                    {canShare && (
                      <button
                        type="button"
                        onClick={() => void shareText(gpChordProText, loadedFilename.replace(/\.[^.]+$/, '') + '.cho')}
                      >
                        Share
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="panel-section">
                <h2 className="section-label" style={{ marginBottom: '0.6rem' }}>Export</h2>
                <label className="export-label" htmlFor="alphatab-pdf-size">PDF / Print Page Size</label>
                <select
                  id="alphatab-pdf-size"
                  value={pdfPageSize}
                  onChange={(e) => setPdfPageSize(e.target.value as PdfPageSize)}
                  disabled={!canExportAlphaTab}
                >
                  <option value="letter">Letter (Portrait)</option>
                  <option value="a4">A4 (Portrait)</option>
                </select>
                <p className="export-hint">Portrait layout, 15mm top / 10mm side margins — optimised for iPhone/iPad Save to PDF.</p>
                <div className="export-actions">
                  <button type="button" className="btn-primary" onClick={printAlphaTab} disabled={!canExportAlphaTab}>
                    Print
                  </button>
                  <button type="button" onClick={() => void exportAlphaTabPdf()} disabled={!canExportAlphaTab}>
                    Generate PDF
                  </button>
                  <button type="button" onClick={exportAlphaTabSvg} disabled={!canExportAlphaTab}>
                    Export SVG
                  </button>
                  <button type="button" onClick={() => void exportAlphaTabPng()} disabled={!canExportAlphaTab}>
                    Export PNG
                  </button>
                </div>

                {pdfBlobUrl && pdfFilename && (
                  <div className="pdf-ready-box">
                    <p className="pdf-ready-title">PDF Ready</p>
                    <div className="pdf-ready-actions">
                      <a href={pdfBlobUrl} target="_blank" rel="noopener noreferrer" className="open-pdf-link">
                        Open PDF
                      </a>
                      <a href={pdfBlobUrl} download={pdfFilename}>Download PDF</a>
                      {canSharePdf && (
                        <button type="button" onClick={() => void sharePdf()}>Share PDF</button>
                      )}
                      <button type="button" onClick={clearPdfOutput}>Clear PDF</button>
                    </div>
                  </div>
                )}
              </div>

              <div className="panel-section">
                <FretboardPositionsPanel
                  notePositions={alphaTabNotePositions}
                  stringCount={
                    gpFileBuffer
                      ? (alphaTabNotePositions[0]?.positions.length
                          ? Math.max(...alphaTabNotePositions.flatMap(n => n.positions.map(p => p.str)))
                          : 6)
                      : tabTuning.length
                  }
                />
              </div>
            </>
          )}

          {/* ── Empty state panel ── */}
          {appMode === 'empty' && (
            <div className="panel-section">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0 }}>Open a file to see options here.</p>
            </div>
          )}

          {exportFeedback && (
            <div className="panel-section" style={{ borderTop: '1px solid var(--border-muted)' }}>
              <p className={`export-feedback ${exportFeedback.type}`} style={{ margin: 0 }}>{exportFeedback.message}</p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
