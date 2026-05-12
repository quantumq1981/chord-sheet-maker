/**
 * sniffFormat.ts
 *
 * Lightweight format-detection utility. Reads up to 2 KB of a file's raw bytes
 * plus its filename extension and returns a discriminated-union tag identifying
 * the most likely format.  No external dependencies.
 *
 * Detection order (first match wins):
 *   1. Guitar Pro binary/header or GP-family extension
 *   2. ZIP magic bytes → MXL (compressed MusicXML)
 *   3. XML prolog + score root element → MusicXML
 *   4. ChordPro metadata directives  → chordpro
 *   5. UG-style section headers       → ultimateguitar
 *   6. Inline bracket chords          → chordpro (bracket style)
 *   7. Chord-over-words heuristic     → chords-over-words
 *   8. File-extension fallback        → chordpro or unknown
 */

export type SourceFormat = 'chordpro' | 'ultimateguitar' | 'chords-over-words';

export type DetectedFormat =
  | { format: 'mxl' }
  | { format: 'musicxml' }
  | { format: 'chordpro' }
  | { format: 'ultimateguitar' }
  | { format: 'chords-over-words' }
  | { format: 'ascii_tab' }
  | { format: 'guitarpro'; version: string }
  | { format: 'pdf' }
  | { format: 'unknown' };

// ZIP local-file magic: PK\x03\x04
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

// PDF magic bytes: %PDF-
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const;

// Guitar Pro file extensions
const GP_EXTENSIONS = new Set(['gp', 'gp3', 'gp4', 'gp5', 'gpx', 'gp6', 'gp7']);

// Canonical chord token pattern (root + optional quality + optional bass)
const CHORD_TOKEN_RE =
  /^[A-G][#b]?(?:m(?:aj)?|M|maj|min|dim|aug|sus[24]?|add\d*)?(?:\d+)?(?:\/[A-G][#b]?)?$/;

// ChordPro metadata / structural directives
const CHORDPRO_DIRECTIVE_RE =
  /\{\s*(?:title|t|artist|a|subtitle|st|key|capo|tempo|time|start_of_chorus|soc|start_of_verse|sov|start_of_grid|sog|start_of_bridge|sob|comment|c)\s*[}:]/i;

// UG-style section header inside square brackets, e.g. [Verse 1], [Chorus]
const UG_SECTION_RE =
  /^\[(?:Verse|Chorus|Bridge|Intro|Outro|Pre-?Chorus|Interlude|Hook|Solo|Instrumental|Refrain)[^\]]*\]/im;

// Inline bracket chord, e.g. [Am7], [F#/A], [Bbmaj7]
const BRACKET_CHORD_RE = /\[[A-G][#b]?[^\]\n]{0,10}\]/;

// ASCII guitar tab line: string name + pipe + tab content
const ASCII_TAB_LINE_RE = /^[eEBGDA]\|[\s\-0-9hpbtrx/\\~().|:]*$/;

/**
 * Detect Guitar Pro binary format. GP3/4/5 files begin with a Pascal-style
 * length-prefixed string: byte[0] = length, bytes[1..length] = "FICHIER GUITAR PRO vX.XX".
 * GPX (GP6/7) uses a different container — we fall through to extension matching.
 */
function detectGuitarPro(bytes: Uint8Array, ext: string): { format: 'guitarpro'; version: string } | null {
  if (bytes.length >= 5) {
    const len = bytes[0];
    if (len >= 5 && len <= 35 && bytes.length > len) {
      // 'latin-1' is not a valid WHATWG encoding label in iOS Safari — use
      // 'utf-8' instead. The GP header is pure ASCII, a UTF-8 subset.
      const header = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(1, len + 1));
      if (header.startsWith('FICHIER GUITAR PRO v')) {
        return { format: 'guitarpro', version: header.slice('FICHIER GUITAR PRO v'.length) };
      }
    }
  }
  // GPX / GP6 / GP7: no shared magic prefix; rely on extension
  if (GP_EXTENSIONS.has(ext)) {
    return { format: 'guitarpro', version: ext };
  }
  return null;
}

function hasZipMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === ZIP_MAGIC[0] &&
    bytes[1] === ZIP_MAGIC[1] &&
    bytes[2] === ZIP_MAGIC[2] &&
    bytes[3] === ZIP_MAGIC[3]
  );
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === PDF_MAGIC[0] &&
    bytes[1] === PDF_MAGIC[1] &&
    bytes[2] === PDF_MAGIC[2] &&
    bytes[3] === PDF_MAGIC[3]
  );
}

function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/** Returns true if every non-empty whitespace-delimited token looks like a chord. */
function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const matches = tokens.filter((t) => CHORD_TOKEN_RE.test(t)).length;
  // Require ≥2 chord tokens and ≥70% of tokens to be chords
  return matches >= 2 && matches / tokens.length >= 0.7;
}

/**
 * Sniff the format of a file from its raw bytes and optional filename.
 *
 * @param bytes  Raw bytes of the file (pass the full ArrayBuffer slice or at
 *               least the first 4 KB for best accuracy).
 * @param filename  Original filename, used for extension fallback.
 */
export function sniffFormatFromBytes(bytes: Uint8Array, filename = ''): DetectedFormat {
  const ext = fileExtension(filename);

  // 1. Guitar Pro binary/header or extension match. This intentionally runs
  // before ZIP detection because GPX/modern .gp files can be ZIP containers
  // too; otherwise Safari/iOS users see an XML/MXL parse error for GP uploads.
  const gp = detectGuitarPro(bytes, ext);
  if (gp) return gp;

  // 1b. PDF magic bytes or .pdf extension → needs async text extraction in caller
  if (hasPdfMagic(bytes) || ext === 'pdf') {
    return { format: 'pdf' };
  }

  // 2. ZIP magic → MXL
  if (hasZipMagic(bytes)) {
    return { format: 'mxl' };
  }

  // Decode up to 2 KB for text-based heuristics
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 2048));

  // 2. MusicXML detection
  if (head.includes('<score-partwise') || head.includes('<score-timewise')) {
    return { format: 'musicxml' };
  }
  if ((ext === 'xml' || ext === 'musicxml') && head.trimStart().startsWith('<?xml')) {
    return { format: 'musicxml' };
  }

  // 3. ChordPro directives
  if (CHORDPRO_DIRECTIVE_RE.test(head)) {
    return { format: 'chordpro' };
  }

  // 4. UG-style section headers
  if (UG_SECTION_RE.test(head)) {
    return { format: 'ultimateguitar' };
  }

  // 5. Inline bracket chords (without UG sections → treat as ChordPro)
  if (BRACKET_CHORD_RE.test(head)) {
    return { format: 'chordpro' };
  }

  // 6. ASCII tab: at least 4 consecutive tab lines in the first 2 KB
  {
    const headLines = head.split('\n');
    let consecutive = 0;
    for (const l of headLines) {
      const t = l.trim();
      if (t.length >= 3 && ASCII_TAB_LINE_RE.test(t)) {
        consecutive++;
        if (consecutive >= 4) return { format: 'ascii_tab' };
      } else {
        consecutive = 0;
      }
    }
  }

  // 7. Chord-over-words heuristic: count chord-only lines vs text lines
  const lines = head.split('\n');
  let chordLines = 0;
  let textLines = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (isChordLine(line)) {
      chordLines++;
    } else {
      textLines++;
    }
  }
  if (chordLines >= 2 && chordLines >= textLines * 0.25) {
    return { format: 'chords-over-words' };
  }

  // 8. Extension fallback for known chord-chart extensions
  if (['cho', 'chopro', 'chord', 'crd', 'pro'].includes(ext)) {
    return { format: 'chordpro' };
  }

  // 9. Extension fallback for raw tab files
  if (ext === 'tab') {
    return { format: 'ascii_tab' };
  }

  return { format: 'unknown' };
}

export function isMusicXmlFormat(detected: DetectedFormat): boolean {
  return detected.format === 'musicxml' || detected.format === 'mxl';
}

export function isGuitarProFormat(detected: DetectedFormat): detected is { format: 'guitarpro'; version: string } {
  return detected.format === 'guitarpro';
}

export function isChordChartFormat(detected: DetectedFormat): boolean {
  return (
    detected.format === 'chordpro' ||
    detected.format === 'ultimateguitar' ||
    detected.format === 'chords-over-words' ||
    detected.format === 'ascii_tab'
  );
}

export function isAsciiTabFormat(detected: DetectedFormat): boolean {
  return detected.format === 'ascii_tab';
}

export function isPdfFormat(detected: DetectedFormat): boolean {
  return detected.format === 'pdf';
}

export function asSourceFormat(detected: DetectedFormat): SourceFormat | null {
  if (
    detected.format === 'chordpro' ||
    detected.format === 'ultimateguitar' ||
    detected.format === 'chords-over-words'
  ) {
    return detected.format;
  }
  return null;
}
