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
import {
  sniffFormatFromBytes,
  isMusicXmlFormat,
  isChordChartFormat,
  asSourceFormat,
} from './ingest/sniffFormat';
import { parseChordChart } from './parsers/chordProParser';
import type { ChordChartDocument } from './models/ChordChartModel';
import ChordChart, { transposeChord } from './renderers/ChordChart';
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

// ─── Types ────────────────────────────────────────────────────────────────────

type AppMode = 'empty' | 'notation' | 'chord-chart';

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

const FILE_INPUT_ACCEPT = [
  // MusicXML / MXL
  '.xml', '.musicxml', '.mxl',
  'application/vnd.recordare.musicxml+xml',
  'application/xml', 'text/xml', 'application/zip',
  // ChordPro dialects
  '.cho', '.chopro', '.chord', '.crd', '.pro',
  // Generic text (UG-style, chords-over-words)
  '.txt',
].join(',');


const OMR_FILE_INPUT_ACCEPT = ['.pdf', '.png', '.jpg', '.jpeg', 'application/pdf', 'image/png', 'image/jpeg'].join(',');
const OMR_ALLOWED_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg']);
const OMR_POLL_MS_FAST = 2000;
const OMR_POLL_MS_SLOW = 4500;
const OMR_POLL_SLOWDOWN_AFTER_MS = 30000;

// ─── OSMD helpers ─────────────────────────────────────────────────────────────

const IOS_USER_AGENT = /iPad|iPhone|iPod/;
const PRINT_ZOOM = 1.0;

type MutableEngravingRules = OpenSheetMusicDisplay['EngravingRules'] & {
  PageWidth?: number;
};

type EngravingRulesSnapshot = Partial<{
  PageWidth: number;
  PageHeight: number;
  PageTopMargin: number;
  PageBottomMargin: number;
  PageLeftMargin: number;
  PageRightMargin: number;
  SystemLeftMargin: number;
  SystemRightMargin: number;
}> & {
  PageFormatWidth?: number;
  PageFormatHeight?: number;
};

function getRuleValue(rules: MutableEngravingRules, key: keyof EngravingRulesSnapshot): number | undefined {
  if (!(key in rules)) return undefined;
  const value = (rules as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

function setRuleValue(rules: MutableEngravingRules, key: keyof EngravingRulesSnapshot, value: number): void {
  if (!(key in rules)) return;
  (rules as unknown as Record<string, unknown>)[key] = value;
}

function snapshotEngravingRules(osmd: OpenSheetMusicDisplay): EngravingRulesSnapshot {
  const rules = osmd.EngravingRules as MutableEngravingRules;
  const pageFormat = 'PageFormat' in rules
    ? (rules.PageFormat as { width?: number; height?: number } | undefined)
    : undefined;

  return {
    PageWidth: getRuleValue(rules, 'PageWidth'),
    PageHeight: getRuleValue(rules, 'PageHeight'),
    PageTopMargin: getRuleValue(rules, 'PageTopMargin'),
    PageBottomMargin: getRuleValue(rules, 'PageBottomMargin'),
    PageLeftMargin: getRuleValue(rules, 'PageLeftMargin'),
    PageRightMargin: getRuleValue(rules, 'PageRightMargin'),
    SystemLeftMargin: getRuleValue(rules, 'SystemLeftMargin'),
    SystemRightMargin: getRuleValue(rules, 'SystemRightMargin'),
    PageFormatWidth: typeof pageFormat?.width === 'number' ? pageFormat.width : undefined,
    PageFormatHeight: typeof pageFormat?.height === 'number' ? pageFormat.height : undefined,
  };
}

function applyPrintProfile(osmd: OpenSheetMusicDisplay, pageSize: PrintPageSize): void {
  const rules = osmd.EngravingRules as MutableEngravingRules;
  const formatId = pageSize === 'letter' ? 'Letter_P' : 'A4_P';
  osmd.setPageFormat(formatId);

  if (pageSize === 'letter') {
    setRuleValue(rules, 'PageWidth', 8.5);
    setRuleValue(rules, 'PageHeight', 11);
    setRuleValue(rules, 'PageTopMargin', 0.5);
    setRuleValue(rules, 'PageBottomMargin', 0.5);
    setRuleValue(rules, 'PageLeftMargin', 0.5);
    setRuleValue(rules, 'PageRightMargin', 0.5);
  } else {
    setRuleValue(rules, 'PageWidth', 210);
    setRuleValue(rules, 'PageHeight', 297);
    setRuleValue(rules, 'PageTopMargin', 12);
    setRuleValue(rules, 'PageBottomMargin', 12);
    setRuleValue(rules, 'PageLeftMargin', 12);
    setRuleValue(rules, 'PageRightMargin', 12);
  }
}

function restoreEngravingRules(osmd: OpenSheetMusicDisplay, snapshot: EngravingRulesSnapshot): void {
  const rules = osmd.EngravingRules as MutableEngravingRules;

  if (typeof snapshot.PageFormatWidth === 'number' && typeof snapshot.PageFormatHeight === 'number') {
    osmd.setCustomPageFormat(snapshot.PageFormatWidth, snapshot.PageFormatHeight);
  }

  const ruleKeys: (keyof EngravingRulesSnapshot)[] = [
    'PageWidth', 'PageHeight',
    'PageTopMargin', 'PageBottomMargin',
    'PageLeftMargin', 'PageRightMargin',
    'SystemLeftMargin', 'SystemRightMargin',
  ];

  for (const key of ruleKeys) {
    const value = snapshot[key];
    if (typeof value === 'number') setRuleValue(rules, key, value);
  }
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

function getRenderedSvgs(container: HTMLDivElement | null): SVGSVGElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll('svg'));
}

function isIOSBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return IOS_USER_AGENT.test(navigator.userAgent);
}

function triggerBlobDownload(blob: Blob, filename: string, iOSFallbackToTab = false): void {
  const url = URL.createObjectURL(blob);
  if (iOSFallbackToTab && isIOSBrowser()) {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) throw new Error('Popup blocked. Please allow popups and try export again.');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

function serializeSvg(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svg);
}

async function svgToCanvas(svg: SVGSVGElement, scale: number): Promise<HTMLCanvasElement> {
  const serialized = serializeSvg(svg);
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode rendered SVG image.'));
      img.src = svgUrl;
    });

    const svgWidth = svg.viewBox.baseVal?.width || svg.clientWidth || image.naturalWidth;
    const svgHeight = svg.viewBox.baseVal?.height || svg.clientHeight || image.naturalHeight;

    if (svgWidth <= 0 || svgHeight <= 0) throw new Error('Rendered score has invalid dimensions.');

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(svgWidth * scale));
    canvas.height = Math.max(1, Math.round(svgHeight * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context is unavailable in this browser.');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error(`Failed to create ${type} blob.`)); return; }
      resolve(blob);
    }, type);
  });
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
function serializeChordProFromDocument(doc: ChordChartDocument, transposeSteps: number, uiState: ChordProUiState): { text: string; warnings: string[] } {
  const lines: string[] = [];
  const warnings: string[] = [];

  if (doc.title)    lines.push(`{title: ${doc.title}}`);
  if (doc.artist)   lines.push(`{artist: ${doc.artist}}`);
  if (doc.subtitle) lines.push(`{subtitle: ${doc.subtitle}}`);
  if (doc.key) {
    const displayKey = transposeSteps !== 0 ? transposeChord(doc.key, transposeSteps) : doc.key;
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
      if (isGridOnly) {
        const chords = line.tokens
          .filter((token) => token.kind === 'chord')
          .map((token) => (transposeSteps !== 0 ? transposeChord(token.text, transposeSteps) : token.text));
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
          const displayed = transposeSteps !== 0 ? transposeChord(token.text, transposeSteps) : token.text;
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

function buildCsmpnFromChartDocument(
  doc: ChordChartDocument,
  transposeSteps: number,
  fallbackTitle: string,
): string {
  const title = doc.title || fallbackTitle || 'Untitled';
  const style = doc.subtitle || 'Fake Book';
  const tempo = doc.tempo || '';
  const time = doc.time || '';
  const rawKey = doc.key ?? '';
  const key = rawKey && transposeSteps !== 0 ? transposeChord(rawKey, transposeSteps) : rawKey;

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
      const chords = line.tokens
        .filter((t) => t.kind === 'chord')
        .map((t) => (transposeSteps !== 0 ? transposeChord(t.text, transposeSteps) : t.text));
      if (chords.length > 0) out.push(chords.join(' '));
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
  const [renderError, setRenderError] = useState('');
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const didAutoFitRef = useRef(false);
  const xmlLoadedRef = useRef('');
  const [loadedXmlText, setLoadedXmlText] = useState('');
  const [isMxl, setIsMxl] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pdfPageSize, setPdfPageSize] = useState<PdfPageSize>('letter');
  const [isDragging, setIsDragging] = useState(false);
  const [renderedPageCount, setRenderedPageCount] = useState(0);
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
  const [transposeSteps, setTransposeSteps] = useState(0);
  const [detectedFormatLabel, setDetectedFormatLabel] = useState('');
  const [chartChordProText, setChartChordProText] = useState('');
  const [chartChordProWarnings, setChartChordProWarnings] = useState<string[]>([]);

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

  // ── OSMD initialisation ──
  useEffect(() => {
    if (!containerRef.current || osmdRef.current) return;
    osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: true,
      drawingParameters: 'default',
    });
    return () => { osmdRef.current = null; };
  }, []);

  // ── OSMD render on XML / zoom change ──
  useEffect(() => {
    const render = async () => {
      const osmd = osmdRef.current;
      if (!osmd || !loadedXmlText) return;
      if (!diagnostics?.isValidXml || !diagnostics.isMusicXml) {
        if (containerRef.current) containerRef.current.innerHTML = '';
        xmlLoadedRef.current = '';
        setRenderedPageCount(0);
        return;
      }
      try {
        setRenderError('');
        if (xmlLoadedRef.current !== loadedXmlText) {
          await osmd.load(loadedXmlText);
          xmlLoadedRef.current = loadedXmlText;
        }
        osmd.Zoom = zoom;
        osmd.render();
        setRenderedPageCount(getRenderedSvgs(containerRef.current).length);
        if (!didAutoFitRef.current) {
          didAutoFitRef.current = true;
          requestAnimationFrame(fitWidth);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRenderError(message);
        xmlLoadedRef.current = '';
        setRenderedPageCount(0);
      }
    };
    void render();
  }, [loadedXmlText, zoom, diagnostics]);

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
  }, [chordProUi]);

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
    setLoadedXmlText(parsedXmlText);
    setIsMxl(loadedFromMxl);
    setRenderError('');
    setExportFeedback({ type: 'success', message: 'OMR conversion completed and score loaded.' });
    setChartDocument(null);
    setTransposeSteps(0);
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
    setTransposeSteps(0);
    setDetectedFormatLabel('');
    setChartChordProText('');
    setChartChordProWarnings([]);
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
        setLoadedXmlText(xmlText);
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
        setTransposeSteps(0);
        setDetectedFormatLabel(detected.format === 'mxl' ? 'MXL' : 'MusicXML');
        setChartChordProText('');
        setChartChordProWarnings([]);
        setAppMode('notation');

      } else if (isChordChartFormat(detected)) {
        // ── Chord-chart path ──
        const text = new TextDecoder('utf-8').decode(bytes);
        const sourceFormat = asSourceFormat(detected)!;
        const doc = parseChordChart(text, sourceFormat);

        const formatLabels: Record<string, string> = {
          chordpro: 'ChordPro',
          ultimateguitar: 'Ultimate Guitar',
          'chords-over-words': 'Chords over Words',
        };

        setLoadedFilename(file.name);
        setChartDocument(doc);
        setTransposeSteps(0);
        setDetectedFormatLabel(formatLabels[sourceFormat] ?? sourceFormat);
        const chartExport = serializeChordProFromDocument(doc, 0, chordProUi);
        setChartChordProText(chartExport.text);
        setChartChordProWarnings(chartExport.warnings);
        setRenderError('');
        setExportFeedback(null);
        // Clear notation state
        setLoadedXmlText('');
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

      } else {
        setRenderError(
          'Unsupported file type. Upload .xml, .musicxml, .mxl (notation) ' +
          'or .cho, .chopro, .crd, .pro, .txt (chord chart).'
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRenderError(`Failed to read file: ${message}`);
    }
  }, []);

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
        setLoadedXmlText(parsedXmlText);
        setOmrInlineMusicXml(parsedXmlText);
        setIsMxl(false);
        setRenderError('');
        setExportFeedback({ type: 'success', message: 'OMR quick process completed and score loaded.' });
        setChartDocument(null);
        setTransposeSteps(0);
        setDetectedFormatLabel('MusicXML (OMR Sync)');
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
  const adjustZoom = useCallback((delta: number) => {
    setZoom((prev) => Math.max(0.4, Math.min(2.5, Number((prev + delta).toFixed(2)))));
  }, []);

  const fitWidth = useCallback(() => {
    const container = containerRef.current;
    const osmd = osmdRef.current;
    if (!container || !osmd) return;
    const firstPage = container.querySelector('.osmd-page') as HTMLElement | null;
    const containerWidth = container.clientWidth;
    if (firstPage && firstPage.offsetWidth > 0) {
      const ratio = containerWidth / firstPage.offsetWidth;
      const target = osmd.Zoom * ratio;
      setZoom(Math.max(0.4, Math.min(2.5, Number(target.toFixed(2)))));
      return;
    }
    setZoom(containerWidth < 600 ? 0.6 : containerWidth < 900 ? 0.8 : 1.0);
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
    const svg = getRenderedSvgs(containerRef.current)[0];
    if (!svg) { showExportError('No rendered score found.'); return; }
    try {
      triggerBlobDownload(new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' }), `${baseName}.page1.svg`);
      showExportSuccess('Exported first SVG page.');
    } catch (error) {
      showExportError(`SVG export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [baseName, showExportError, showExportSuccess]);

  const exportPng = useCallback(async () => {
    const svg = getRenderedSvgs(containerRef.current)[0];
    if (!svg) { showExportError('No rendered score found.'); return; }
    try {
      const canvas = await svgToCanvas(svg, 2);
      const blob = await canvasToBlob(canvas, 'image/png');
      triggerBlobDownload(blob, `${baseName}.png`, true);
      showExportSuccess('Exported first page as PNG.');
    } catch (error) {
      showExportError(`PNG export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [baseName, showExportError, showExportSuccess]);

  const exportPdf = useCallback(async (maxPages?: number) => {
    const osmd = osmdRef.current;
    if (!osmd) { showExportError('Renderer is not ready yet.'); return; }
    const initialSvgs = getRenderedSvgs(containerRef.current);
    if (initialSvgs.length === 0) { showExportError('No rendered score found.'); return; }

    const isLetter = pdfPageSize === 'letter';
    const unit = isLetter ? 'in' : 'mm';
    const format: [number, number] = isLetter ? [8.5, 11] : [210, 297];
    const margin = isLetter ? 0.5 : 12;
    const rulesSnapshot = snapshotEngravingRules(osmd);
    const zoomSnapshot = osmd.Zoom;

    try {
      applyPrintProfile(osmd, pdfPageSize);
      osmd.Zoom = PRINT_ZOOM;
      osmd.render();
      const svgs = getRenderedSvgs(containerRef.current);
      if (svgs.length === 0) throw new Error('No rendered score found after applying print layout.');
      const pdf = new jsPDF({ orientation: 'portrait', unit, format });
      const pagesToExport = typeof maxPages === 'number' ? svgs.slice(0, maxPages) : svgs;

      for (let index = 0; index < pagesToExport.length; index++) {
        const canvas = await svgToCanvas(pagesToExport[index], 1.5);
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
      restoreEngravingRules(osmd, rulesSnapshot);
      osmd.Zoom = zoomSnapshot;
      osmd.render();
    }
  }, [baseName, pdfPageSize, showExportError, showExportSuccess]);

  const printScore = useCallback(() => {
    const osmd = osmdRef.current;
    if (!osmd || renderedPageCount === 0) { showExportError('No rendered score found.'); return; }
    const rulesSnapshot = snapshotEngravingRules(osmd);
    const zoomSnapshot = osmd.Zoom;
    let restored = false;
    const restoreAfterPrint = () => {
      if (restored) return;
      restored = true;
      window.removeEventListener('afterprint', restoreAfterPrint);
      restoreEngravingRules(osmd, rulesSnapshot);
      osmd.Zoom = zoomSnapshot;
      osmd.render();
    };
    try {
      applyPrintProfile(osmd, pdfPageSize);
      osmd.Zoom = PRINT_ZOOM;
      osmd.render();
      window.addEventListener('afterprint', restoreAfterPrint, { once: true });
      window.print();
      setTimeout(restoreAfterPrint, 1000);
    } catch (error) {
      restoreAfterPrint();
      showExportError(`Print failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [pdfPageSize, renderedPageCount, showExportError]);

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

  // ── Chord-chart controls ──
  const adjustTranspose = useCallback((delta: number) => {
    setTransposeSteps((prev) => ((prev + delta + 12) % 12 + 12) % 12 === 0 && delta < 0
      ? -12 + ((prev + delta + 12) % 12 + 12) % 12
      : prev + delta);
  }, []);

  const normalizedTranspose = ((transposeSteps % 12) + 12) % 12;
  const displayTranspose = normalizedTranspose > 6 ? normalizedTranspose - 12 : normalizedTranspose;

  const chartExportPreview = useMemo(() => {
    if (!chartDocument) return { text: '', warnings: [] as string[] };
    return serializeChordProFromDocument(chartDocument, transposeSteps, chordProUi);
  }, [chartDocument, transposeSteps, chordProUi]);

  const generateChartCsmpn = useCallback(() => {
    if (!chartDocument) {
      showExportError('Load a chord chart file before generating CSMPN Fake Book.');
      return;
    }
    const csmpn = buildCsmpnFromChartDocument(chartDocument, transposeSteps, getBaseFilename(loadedFilename));
    setCsmpnFakeBookText(csmpn);
    setCsmpnWarnings([]);
    showExportSuccess('CSMPN Fake Book generated.');
  }, [chartDocument, transposeSteps, loadedFilename, showExportError, showExportSuccess]);

  const generateChartChordPro = useCallback(() => {
    if (!chartDocument) {
      showExportError('Load a chord chart file before generating ChordPro.');
      return;
    }
    setChartChordProText(chartExportPreview.text);
    setChartChordProWarnings(chartExportPreview.warnings);
    const csmpn = buildCsmpnFromChartDocument(chartDocument, transposeSteps, getBaseFilename(loadedFilename));
    setCsmpnFakeBookText(csmpn);
    setCsmpnWarnings([]);
    showExportSuccess('ChordPro generated.');
  }, [chartDocument, chartExportPreview, transposeSteps, loadedFilename, showExportError, showExportSuccess]);

  useEffect(() => {
    if (!chartDocument) return;
    setChartChordProText(chartExportPreview.text);
    setChartChordProWarnings(chartExportPreview.warnings);
  }, [chartDocument, chartExportPreview]);

  // ─── Render ───────────────────────────────────────────────────────────────

  const canExportNotation = appMode === 'notation' && Boolean(loadedXmlText);

  return (
    <div className="app-shell">
      {/* ── Top bar ── */}
      <header className="top-bar">
        <label className="upload-btn">
          Upload
          <input type="file" accept={FILE_INPUT_ACCEPT} onChange={onFileInput} />
        </label>

        {appMode === 'empty' && (
          <span className="hint">
            Drag &amp; drop .xml / .musicxml / .mxl (notation) or .cho / .pro / .txt (chord chart)
          </span>
        )}

        {appMode === 'notation' && (
          <>
            <span className="mode-badge mode-badge--notation">Notation</span>
            <button type="button" onClick={() => adjustZoom(-0.1)}>Zoom −</button>
            <button type="button" onClick={() => adjustZoom(0.1)}>Zoom +</button>
            <button type="button" onClick={fitWidth}>Fit Width</button>
          </>
        )}

        {appMode === 'chord-chart' && (
          <span className="mode-badge mode-badge--chart">Chord Chart · {detectedFormatLabel}</span>
        )}

        {appMode !== 'empty' && (
          <button type="button" onClick={clearAll}>Clear</button>
        )}
      </header>

      {/* ── Error banners ── */}
      {loadedXmlText && diagnostics && !diagnostics.isValidXml && (
        <div className="error-banner">XML parse error: {diagnostics.parseError ?? 'Invalid XML'}</div>
      )}
      {renderError && <div className="error-banner">{renderError}</div>}

      {/* ── Content area ── */}
      <main className="content-grid">

        {/* ── Left: score viewport OR chord chart ── */}
        {appMode !== 'chord-chart' ? (
          <section
            className={`score-viewport ${isDragging ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            {appMode === 'empty' && (
              <p className="placeholder">Upload a MusicXML / MXL file or a ChordPro / text chord chart.</p>
            )}
            <div ref={containerRef} className="score-container" />
          </section>
        ) : (
          <section
            className={`chord-chart-viewport ${isDragging ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            {chartDocument && (
              <ChordChart document={chartDocument} transposeSteps={transposeSteps} />
            )}
          </section>
        )}

        {/* ── Right: side panel ── */}
        <aside className="side-panel">
          <OmrImportPanel
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
          />

          {/* ── Chord-chart mode panel ── */}
          {appMode === 'chord-chart' && chartDocument && (
            <>
              <h2>Chart Info</h2>
              <ul>
                <li><strong>File:</strong> {loadedFilename}</li>
                <li><strong>Format:</strong> {detectedFormatLabel}</li>
                {chartDocument.title && <li><strong>Title:</strong> {chartDocument.title}</li>}
                {chartDocument.artist && <li><strong>Artist:</strong> {chartDocument.artist}</li>}
                {chartDocument.key && <li><strong>Key:</strong> {chartDocument.key}</li>}
                {chartDocument.capo && <li><strong>Capo:</strong> {chartDocument.capo}</li>}
                <li><strong>Sections:</strong> {chartDocument.sections.length}</li>
              </ul>

              <h2>Transpose</h2>
              <div className="transpose-row">
                <button type="button" onClick={() => adjustTranspose(-1)}>−1</button>
                <span className="transpose-value">
                  {displayTranspose > 0 ? `+${displayTranspose}` : displayTranspose}
                </span>
                <button type="button" onClick={() => adjustTranspose(1)}>+1</button>
                <button type="button" onClick={() => setTransposeSteps(0)} disabled={transposeSteps === 0}>
                  Reset
                </button>
              </div>

              <h2>ChordPro Export</h2>
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
                <button type="button" onClick={generateChartChordPro}>
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

              <h2>CSMPN Source (ChordSheet-compatible)</h2>
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
            </>
          )}

          {/* ── Notation mode panel ── */}
          {appMode === 'notation' && (
            <>
              <h2>Diagnostics</h2>
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

              <h2>Warnings</h2>
              {xmlWarnings.length > 0 ? (
                <ul>{xmlWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
              ) : (
                <p>No warnings.</p>
              )}

              <h2>ChordPro Export</h2>
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
                <button type="button" onClick={() => void generateChordPro()} disabled={!canExportNotation}>
                  Generate ChordPro
                </button>
                <button type="button" onClick={() => void generateCsmpnFakeBook()} disabled={!canExportNotation}>
                  Generate CSMPN Fake Book
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

              <h2>CSMPN Source (ChordSheet-compatible)</h2>
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
                    Resolved mode: <strong>{chordProDiagnostics.formatModeResolved}</strong>
                    {' · '}Measures: {chordProDiagnostics.measuresCount}
                    {chordProDiagnostics.harmoniesCollected !== undefined &&
                      <> · Harmonies: {chordProDiagnostics.harmoniesCollected}
                        {chordProDiagnostics.inferredHarmoniesCount !== undefined &&
                          <em> (inferred from text)</em>}
                      </>}
                    {chordProDiagnostics.enharmonicStyleApplied &&
                      <> · enh: {chordProDiagnostics.enharmonicStyleApplied}</>}
                    {chordProDiagnostics.scoreFormat === 'timewise-converted' &&
                      <> · <em>score-timewise converted</em></>}
                  </p>
                  {chordProDiagnostics.partsInfo && chordProDiagnostics.partsInfo.length > 1 && (
                    <p>
                      Parts:{' '}
                      {chordProDiagnostics.partsInfo.map((p) => (
                        <span key={p.id} style={{ marginRight: '0.75em' }}>
                          <strong>{p.name}</strong> ({p.harmonyCount}♩ {p.lyricCount}📝)
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              )}

              <h2>Export</h2>
              <label className="export-label" htmlFor="pdf-page-size">PDF Page Size</label>
              <select id="pdf-page-size" value={pdfPageSize}
                onChange={(e) => setPdfPageSize(e.target.value as PdfPageSize)}
                disabled={!canExportNotation}>
                <option value="letter">Letter (Portrait)</option>
                <option value="a4">A4 (Portrait)</option>
              </select>

              <div className="export-actions">
                <button type="button" onClick={downloadXml} disabled={!canExportNotation}>
                  Download XML
                </button>
                <button type="button" onClick={downloadDiagnostics} disabled={!canExportNotation}>
                  Download Diagnostics JSON
                </button>
                <button type="button" onClick={exportSvg} disabled={!canExportNotation}>
                  Export SVG (first page)
                </button>
                <button type="button" onClick={() => void exportPng()} disabled={!canExportNotation}>
                  Export PNG (first page)
                </button>
                <button type="button" onClick={() => void exportPdf()} disabled={!canExportNotation}>
                  Generate PDF
                </button>
                {renderedPageCount > 6 && (
                  <button type="button" onClick={() => void exportPdf(1)} disabled={!canExportNotation}>
                    Export PDF (First Page)
                  </button>
                )}
                <button type="button" onClick={printScore} disabled={renderedPageCount === 0}>
                  Print / Save as PDF
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
            </>
          )}

          {/* ── Empty state ── */}
          {appMode === 'empty' && (
            <p>Upload a file to get started.</p>
          )}

          {exportFeedback && (
            <p className={`export-feedback ${exportFeedback.type}`}>{exportFeedback.message}</p>
          )}
        </aside>
      </main>
    </div>
  );
}
