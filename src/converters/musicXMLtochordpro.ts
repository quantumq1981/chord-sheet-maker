import JSZip from "jszip";
import { parseChordSymbol, parsedChordToText } from "./chordSymbolParser";

export type PageSize = "letter" | "a4";

export type ChordProFormatMode =
  | "lyrics-inline"
  | "grid-only"
  | "fakebook"
  | "auto";

export type RepeatStrategy =
  | "none"
  | "simple-unroll";

export type ChordBracketStyle =
  | "separate"
  | "combined";

export type BarlineStyle =
  | "pipes"
  | "none";

export type MeasureWrapPolicy =
  | "bars-per-line"
  | "no-wrap";

export type KeySignaturePolicy =
  | "emit-if-known"
  | "omit";

export type TimeSignaturePolicy =
  | "emit-if-known"
  | "omit";

export type MetadataPolicy =
  | "emit"
  | "omit";

export interface ConvertOptions {
  barsPerLine: number;
  gridSlotsPerMeasure?: number;
  barlineStyle: BarlineStyle;
  wrapPolicy: MeasureWrapPolicy;
  chordBracketStyle: ChordBracketStyle;
  formatMode: ChordProFormatMode;
  repeatStrategy: RepeatStrategy;
  annotateUnexpandedRepeats: boolean;
  metadataPolicy: MetadataPolicy;
  keyPolicy: KeySignaturePolicy;
  timePolicy: TimeSignaturePolicy;
  normalizeWhitespace: boolean;
  /**
   * Enharmonic spelling preference for chord root/bass notes.
   * 'auto' (default) = infer from key signature: flat keys → flats, ≥4 sharps → sharps.
   * This normalises e.g. A# → Bb in Bb major, D# → Eb in Eb major.
   */
  enharmonicStyle?: "auto" | "flats" | "sharps";
  /**
   * Replace standard quality suffixes with compact jazz symbols in fakebook output.
   * maj7 → Δ7, m7b5 → ø7, dim7 → °7, dim → °
   */
  jazzSymbols?: boolean;
}

export interface ConvertInput {
  filename?: string;
  xmlText: string;
}

export interface ConvertOutput {
  chordPro: string;
  warnings: string[];
  error?: string;
  diagnostics: ConverterDiagnostics;
}

export interface PartInfo {
  id: string;
  name: string;
  harmonyCount: number;
  lyricCount: number;
}

export interface FakebookStats {
  measuresTotal: number;
  /** Measures reduced to a single chord token */
  single: number;
  /** Measures emitted as a split-bar (two-chord) token */
  split: number;
  /** Measures emitted as % (repeat shorthand) */
  repeat: number;
  /** Measures with no harmony events (carry-forward) */
  empty: number;
  /** Measures where duration-weighting dropped ≥1 ornamental harmony */
  durationReduced: number;
}

export interface ConverterDiagnostics {
  filename?: string;
  timestampIso: string;
  isMxl: boolean;
  partsCount: number;
  selectedLyricPartId?: string;
  title?: string;
  composer?: string;
  key?: string;
  time?: string;
  measuresCount: number;
  versesDetected: string[];
  hasAnyLyrics: boolean;
  hasAnyHarmony: boolean;
  repeatMarkersFound: number;
  endingsFound: number;
  barsPerLine: number;
  formatModeResolved: "lyrics-inline" | "grid-only" | "fakebook";
  fakebookStats?: FakebookStats;
  /** 'partwise' = native; 'timewise-converted' = was score-timewise, transposed in-memory */
  scoreFormat?: "partwise" | "timewise-converted";
  /** Per-part harmony and lyric counts — useful for diagnosing multi-part files */
  partsInfo?: PartInfo[];
  /** Total harmony events collected across all measures (after deduplication) */
  harmoniesCollected?: number;
  /** Count of <direction><words> elements that look like chord symbols */
  directionWordsFound?: number;
  /** How many of those were actually inferred as chords (only set when inference ran) */
  inferredHarmoniesCount?: number;
  /** Raw circle-of-fifths value from the key signature (-7…+7) */
  keyFifths?: number;
  /** Enharmonic style actually applied to chord tokens */
  enharmonicStyleApplied?: "flats" | "sharps";
}

export interface HarmonyEvent {
  measureIndex: number;
  offsetDivisions: number;
  chordText: string;
}

export interface LyricEvent {
  verse: string;
  measureIndex: number;
  offsetDivisions: number;
  text: string;
  syllabic?: "single" | "begin" | "middle" | "end";
  extend?: boolean;
}

export interface MeasureData {
  measureIndex: number;
  durationDivisions: number;
  harmonies: HarmonyEvent[];
  lyricsByVerse: Record<string, LyricEvent[]>;
  repeatStart?: boolean;
  repeatEnd?: boolean;
  endings?: number[];
}

export interface MeasureRenderResult {
  measureIndex: number;
  hasLyrics: boolean;
  text: string;
  gridCells?: string[];
}

interface ParsedMetadata {
  title?: string;
  composer?: string;
  key?: string;
  time?: string;
  /** Raw circle-of-fifths from <key><fifths> — used for enharmonic normalization */
  fifths?: number;
}

const KIND_SUFFIX_MAP: Record<string, string> = {
  // Triads
  major: "",
  minor: "m",
  diminished: "dim",
  augmented: "aug",
  // Suspended
  "suspended-second": "sus2",
  "suspended-fourth": "sus4",
  // Sixths
  "major-sixth": "6",
  "minor-sixth": "m6",
  // Sevenths
  dominant: "7",
  "major-seventh": "maj7",
  "minor-seventh": "m7",
  "diminished-seventh": "dim7",
  "augmented-seventh": "aug7",
  "half-diminished": "m7b5",
  "major-minor": "m(maj7)",
  // Ninths
  "dominant-ninth": "9",
  "major-ninth": "maj9",
  "minor-ninth": "m9",
  // Elevenths
  "dominant-11th": "11",
  "major-11th": "maj11",
  "minor-11th": "m11",
  // Thirteenths
  "dominant-13th": "13",
  "major-13th": "maj13",
  "minor-13th": "m13",
  // Other
  power: "5",
  pedal: "ped",
};

export function getDefaultConvertOptions(): ConvertOptions {
  return {
    barsPerLine: 4,
    barlineStyle: "pipes",
    wrapPolicy: "bars-per-line",
    chordBracketStyle: "separate",
    formatMode: "auto",
    repeatStrategy: "none",
    annotateUnexpandedRepeats: true,
    metadataPolicy: "emit",
    keyPolicy: "emit-if-known",
    timePolicy: "emit-if-known",
    normalizeWhitespace: true,
    enharmonicStyle: "auto",
    jazzSymbols: false,
  };
}

export async function extractMusicXmlTextFromFile(file: File): Promise<{
  filename: string;
  xmlText: string;
  isMxl: boolean;
}> {
  const filename = file.name;
  const isMxl = filename.toLowerCase().endsWith(".mxl");

  if (!isMxl) {
    return { filename, xmlText: await file.text(), isMxl: false };
  }

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const containerEntry = zip.file("META-INF/container.xml");
  if (!containerEntry) {
    throw new Error("Invalid MXL: META-INF/container.xml was not found.");
  }

  const containerText = await containerEntry.async("text");
  const containerDoc = new DOMParser().parseFromString(containerText, "application/xml");
  const parserError = containerDoc.querySelector("parsererror");
  if (parserError) {
    throw new Error("Invalid MXL: container.xml could not be parsed.");
  }

  const rootfile = containerDoc.querySelector("rootfile");
  const rootPath = rootfile?.getAttribute("full-path")?.trim();
  if (!rootPath) {
    throw new Error("Invalid MXL: rootfile full-path not found in container.xml.");
  }

  const scoreEntry = zip.file(rootPath);
  if (!scoreEntry) {
    throw new Error(`Invalid MXL: score file '${rootPath}' not found.`);
  }

  return {
    filename,
    xmlText: await scoreEntry.async("text"),
    isMxl: true,
  };
}

export function convertMusicXmlToChordPro(
  input: ConvertInput,
  options?: Partial<ConvertOptions>
): ConvertOutput {
  const mergedOptions = { ...getDefaultConvertOptions(), ...(options ?? {}) };
  const warnings: string[] = [];

  const xmlDoc = new DOMParser().parseFromString(input.xmlText, "application/xml");
  const parseIssue = xmlDoc.querySelector("parsererror");

  const diagnostics: ConverterDiagnostics = {
    filename: input.filename,
    timestampIso: new Date().toISOString(),
    isMxl: Boolean(input.filename?.toLowerCase().endsWith(".mxl")),
    partsCount: xmlDoc.querySelectorAll("score-partwise > part").length,
    measuresCount: 0,
    versesDetected: [],
    hasAnyLyrics: false,
    hasAnyHarmony: false,
    repeatMarkersFound: 0,
    endingsFound: 0,
    barsPerLine: mergedOptions.barsPerLine,
    formatModeResolved: "grid-only",
  };

  if (parseIssue) {
    return {
      chordPro: "{title: Untitled}\n% Failed to parse MusicXML.",
      warnings,
      error: "MusicXML parser error",
      diagnostics,
    };
  }

  try {
    // ── score-timewise → score-partwise transposition ──────────────────────
    const { doc: resolvedDoc, scoreFormat } = convertTimewiseToPartwise(xmlDoc);
    diagnostics.scoreFormat = scoreFormat;
    if (scoreFormat === "timewise-converted") {
      warnings.push("score-timewise format detected — converted to score-partwise for processing");
    }

    const metadata = parseMetadata(resolvedDoc);
    diagnostics.title = metadata.title;
    diagnostics.composer = metadata.composer;
    diagnostics.key = metadata.key;
    diagnostics.time = metadata.time;
    diagnostics.keyFifths = metadata.fifths;

    // ── Per-part info ──────────────────────────────────────────────────────
    diagnostics.partsInfo = collectPartsInfo(resolvedDoc);
    diagnostics.directionWordsFound = countDirectionChordHints(resolvedDoc);

    const selectedLyricPartId = selectLyricPart(resolvedDoc);
    diagnostics.selectedLyricPartId = selectedLyricPartId;

    // Use direction/words inference when the file has no <harmony> elements
    // but does have chord-like direction/words (e.g. Finale-exported XML).
    const totalDocHarmonies = resolvedDoc.querySelectorAll("harmony").length;
    const inferFromDirectionWords =
      totalDocHarmonies === 0 && (diagnostics.directionWordsFound ?? 0) > 0;

    const measures = buildMeasureData(resolvedDoc, selectedLyricPartId, warnings, inferFromDirectionWords);
    diagnostics.measuresCount = measures.length;
    diagnostics.harmoniesCollected = measures.reduce((s, m) => s + m.harmonies.length, 0);
    if (inferFromDirectionWords) {
      diagnostics.inferredHarmoniesCount = diagnostics.harmoniesCollected;
    }

    const verseSet = new Set<string>();
    let hasAnyLyrics = false;
    let hasAnyHarmony = false;
    let repeatMarkersFound = 0;
    let endingsFound = 0;

    for (const measure of measures) {
      if (measure.repeatStart || measure.repeatEnd) {
        repeatMarkersFound += 1;
      }
      if (measure.endings && measure.endings.length > 0) {
        endingsFound += measure.endings.length;
      }
      if (measure.harmonies.length > 0) {
        hasAnyHarmony = true;
      }
      for (const [verseKey, events] of Object.entries(measure.lyricsByVerse)) {
        if (events.length > 0) {
          hasAnyLyrics = true;
          verseSet.add(verseKey);
        }
      }
    }

    diagnostics.versesDetected = [...verseSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    diagnostics.hasAnyLyrics = hasAnyLyrics;
    diagnostics.hasAnyHarmony = hasAnyHarmony;
    diagnostics.repeatMarkersFound = repeatMarkersFound;
    diagnostics.endingsFound = endingsFound;

    const measureOrder = resolveMeasureOrder(measures, mergedOptions, warnings, diagnostics);
    const orderedMeasures = measureOrder.map((i) => measures[i]).filter((m): m is MeasureData => Boolean(m));

    const formatModeResolved = mergedOptions.formatMode === "auto"
      ? (hasAnyLyrics ? "lyrics-inline" : "grid-only")
      : mergedOptions.formatMode;
    diagnostics.formatModeResolved = formatModeResolved;

    if (!hasAnyHarmony) {
      const inferred = diagnostics.inferredHarmoniesCount ?? 0;
      if (inferred > 0) {
        // Direction/words inference ran and found chords — not a failure, just informational
        warnings.push(
          `${inferred} chord${inferred === 1 ? "" : "s"} inferred from direction/words elements ` +
          `(Finale-style encoding). Re-export from MuseScore for more reliable results.`,
        );
      } else {
        warnings.push("no harmony found");
        const dirWords = diagnostics.directionWordsFound ?? 0;
        if (dirWords > 0) {
          warnings.push(
            `${dirWords} direction/words element${dirWords === 1 ? "" : "s"} found that ` +
            `resemble chord symbols but could not be parsed. ` +
            `Re-export from MuseScore or Sibelius to get <harmony> elements.`,
          );
        }
      }
    }
    if (!hasAnyLyrics && formatModeResolved !== "grid-only" && formatModeResolved !== "fakebook") {
      warnings.push("no lyrics found");
    }

    const lines: string[] = [];
    if (mergedOptions.metadataPolicy === "emit" && formatModeResolved !== "fakebook") {
      if (metadata.title) {
        lines.push(`{title: ${metadata.title}}`);
      }
      if (metadata.composer) {
        lines.push(`{composer: ${metadata.composer}}`);
      }
      if (mergedOptions.keyPolicy === "emit-if-known" && metadata.key) {
        lines.push(`{key: ${metadata.key}}`);
      }
      if (mergedOptions.timePolicy === "emit-if-known" && metadata.time) {
        lines.push(`{time: ${metadata.time}}`);
      }
    }

    if (formatModeResolved === "lyrics-inline") {
      const verseKeys = diagnostics.versesDetected.length > 0 ? diagnostics.versesDetected : ["1"];
      const rendered = renderLyricsInline(orderedMeasures, verseKeys, mergedOptions);
      if (lines.length > 0 && rendered.length > 0) {
        lines.push("");
      }
      lines.push(...rendered);
    } else if (formatModeResolved === "fakebook") {
      const { lines: fbLines, stats: fbStats, enharmonicStyleApplied } =
        renderFakebook(orderedMeasures, metadata, mergedOptions);
      lines.push(...fbLines);
      diagnostics.fakebookStats = fbStats;
      diagnostics.enharmonicStyleApplied = enharmonicStyleApplied;
    } else {
      const rendered = renderGrid(orderedMeasures, mergedOptions, warnings, metadata.time);
      if (lines.length > 0 && rendered.length > 0) {
        lines.push("");
      }
      lines.push(...rendered);
    }

    if (
      mergedOptions.repeatStrategy === "none" &&
      repeatMarkersFound > 0 &&
      mergedOptions.annotateUnexpandedRepeats
    ) {
      warnings.push("repeats present but not expanded");
      lines.push("% Repeats in the original score are not expanded.");
    }

    if (lines.length === 0) {
      lines.push("{title: Untitled}");
    }

    return {
      chordPro: lines.join("\n"),
      warnings,
      diagnostics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown conversion failure";
    return {
      chordPro: "{title: Untitled}\n% Failed to convert MusicXML.",
      warnings,
      error: message,
      diagnostics,
    };
  }
}

// ─── Compatibility helpers ────────────────────────────────────────────────────

/**
 * If the document root is <score-timewise>, transpose it in-memory to
 * <score-partwise> so the rest of the parser can operate normally.
 *
 * score-timewise: <measure number="1"><part id="P1">…</part></measure>
 * score-partwise: <part id="P1"><measure number="1">…</measure></part>
 */
function convertTimewiseToPartwise(
  xmlDoc: Document
): { doc: Document; scoreFormat: "partwise" | "timewise-converted" } {
  if (xmlDoc.documentElement.nodeName !== "score-timewise") {
    return { doc: xmlDoc, scoreFormat: "partwise" };
  }

  const root = xmlDoc.documentElement;
  const allTimeMeasures = [...root.querySelectorAll(":scope > measure")];
  if (allTimeMeasures.length === 0) {
    return { doc: xmlDoc, scoreFormat: "partwise" };
  }

  // Collect part IDs from the first measure
  const partIds = [...allTimeMeasures[0].querySelectorAll(":scope > part")]
    .map((p) => p.getAttribute("id") ?? "")
    .filter(Boolean);
  if (partIds.length === 0) {
    return { doc: xmlDoc, scoreFormat: "partwise" };
  }

  const serializer = new XMLSerializer();
  const version = root.getAttribute("version") ?? "4.0";

  // Serialize header elements (everything before the first <measure>)
  const headerXml: string[] = [];
  for (const child of [...root.children]) {
    if (child.tagName === "measure") break;
    headerXml.push(serializer.serializeToString(child));
  }

  // Build one <part> per part ID, containing all its measures in order
  const partsXml = partIds.map((partId) => {
    const escapedId = partId.replace(/"/g, "&quot;");
    const measureXmls = allTimeMeasures.map((timeMeasure) => {
      const partEl = [...timeMeasure.querySelectorAll(":scope > part")]
        .find((p) => p.getAttribute("id") === partId);
      if (!partEl) return "";
      const attrs = [...timeMeasure.attributes]
        .map((a) => ` ${a.name}="${a.value.replace(/"/g, "&quot;")}"`)
        .join("");
      const innerXml = [...partEl.children]
        .map((c) => serializer.serializeToString(c))
        .join("");
      return `<measure${attrs}>${innerXml}</measure>`;
    });
    return `<part id="${escapedId}">${measureXmls.join("")}</part>`;
  });

  const partwiseXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<score-partwise version="${version}">` +
    headerXml.join("") +
    partsXml.join("") +
    `</score-partwise>`;

  const newDoc = new DOMParser().parseFromString(partwiseXml, "application/xml");
  if (newDoc.querySelector("parsererror")) {
    // Conversion failed; fall back to original (will produce empty output but no crash)
    return { doc: xmlDoc, scoreFormat: "partwise" };
  }
  return { doc: newDoc, scoreFormat: "timewise-converted" };
}

/** Collect harmony and lyric counts per part for diagnostic purposes. */
function collectPartsInfo(xmlDoc: Document): PartInfo[] {
  const partNameMap = new Map<string, string>();
  for (const scorePartEl of xmlDoc.querySelectorAll("part-list > score-part")) {
    const id = scorePartEl.getAttribute("id") ?? "";
    const name = scorePartEl.querySelector("part-name")?.textContent?.trim() || id;
    partNameMap.set(id, name);
  }
  return [...xmlDoc.querySelectorAll("score-partwise > part")].map((part) => {
    const id = part.getAttribute("id") ?? "";
    return {
      id,
      name: partNameMap.get(id) ?? id,
      harmonyCount: part.querySelectorAll("harmony").length,
      lyricCount: part.querySelectorAll("lyric text").length,
    };
  });
}

/**
 * Count <direction-type><words> elements whose text matches a chord-symbol
 * pattern. Useful for detecting Finale-style files that encode chords as
 * direction/words rather than <harmony> elements.
 */
const CHORD_WORDS_RE = /^[A-G][#b]?(?:m|M|maj|min|dim|aug|sus|add|\d|[+°ø]){0,12}(?:\/[A-G][#b]?)?$/;

function countDirectionChordHints(xmlDoc: Document): number {
  let count = 0;
  for (const el of xmlDoc.querySelectorAll("direction-type > words")) {
    const text = (el.textContent ?? "").trim();
    if (CHORD_WORDS_RE.test(text)) count++;
  }
  return count;
}

// ─── Metadata / part selection ────────────────────────────────────────────────

function parseMetadata(xmlDoc: Document): ParsedMetadata {
  const title = textAt(xmlDoc, "work > work-title") ?? textAt(xmlDoc, "movement-title");

  const composerNode = [...xmlDoc.querySelectorAll("identification > creator")]
    .find((creator) => (creator.getAttribute("type") ?? "").toLowerCase() === "composer");
  const composer = composerNode?.textContent?.trim() || undefined;

  const firstAttributes = xmlDoc.querySelector("part > measure > attributes") ?? xmlDoc.querySelector("attributes");
  const fifthsRaw = firstAttributes?.querySelector("key > fifths")?.textContent?.trim();
  const modeRaw = firstAttributes?.querySelector("key > mode")?.textContent?.trim();

  const key = buildKeySignature(fifthsRaw, modeRaw);
  const beats = firstAttributes?.querySelector("time > beats")?.textContent?.trim();
  const beatType = firstAttributes?.querySelector("time > beat-type")?.textContent?.trim();
  const time = beats && beatType ? `${beats}/${beatType}` : undefined;

  const fifthsParsed = fifthsRaw != null ? Number.parseInt(fifthsRaw, 10) : undefined;
  const fifths = fifthsParsed != null && Number.isFinite(fifthsParsed) ? fifthsParsed : undefined;

  return {
    title: title?.trim() || undefined,
    composer,
    key,
    time,
    fifths,
  };
}

function selectLyricPart(xmlDoc: Document): string | undefined {
  const parts = [...xmlDoc.querySelectorAll("score-partwise > part")];
  let bestId: string | undefined;
  let bestCount = -1;

  for (const part of parts) {
    const id = part.getAttribute("id") || undefined;
    const count = part.querySelectorAll("lyric > text").length;
    if (count > bestCount) {
      bestCount = count;
      bestId = id;
    }
  }

  return bestId;
}

function buildMeasureData(
  xmlDoc: Document,
  selectedLyricPartId: string | undefined,
  warnings: string[],
  inferFromDirectionWords = false,
): MeasureData[] {
  const parts = [...xmlDoc.querySelectorAll("score-partwise > part")];
  const lyricPart = parts.find((part) => part.getAttribute("id") === selectedLyricPartId) ?? parts[0];
  const lyricMeasures = lyricPart ? [...lyricPart.querySelectorAll(":scope > measure")] : [];

  const allPartsMeasures = parts.map((part) => [...part.querySelectorAll(":scope > measure")]);

  let divisions = 1;
  const result: MeasureData[] = [];

  lyricMeasures.forEach((measureEl, measureIndex) => {
    const divisionsText = measureEl.querySelector("attributes > divisions")?.textContent?.trim();
    if (divisionsText) {
      const parsed = Number.parseInt(divisionsText, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        divisions = parsed;
      }
    }

    let cursor = 0;
    let durationDivisions = 0;
    const lyricsByVerse: Record<string, LyricEvent[]> = {};

    for (const child of [...measureEl.children]) {
      if (child.tagName === "backup") {
        const shift = parseIntText(child.querySelector("duration")?.textContent, 0);
        cursor = Math.max(0, cursor - shift);
        continue;
      }
      if (child.tagName === "forward") {
        const shift = parseIntText(child.querySelector("duration")?.textContent, 0);
        cursor += shift;
        durationDivisions = Math.max(durationDivisions, cursor);
        continue;
      }
      if (child.tagName !== "note") {
        continue;
      }

      const noteStart = cursor;
      const duration = parseIntText(child.querySelector("duration")?.textContent, 0);
      cursor += duration;
      durationDivisions = Math.max(durationDivisions, cursor);

      const lyricNodes = [...child.querySelectorAll(":scope > lyric")];
      for (const lyricEl of lyricNodes) {
        const text = lyricEl.querySelector("text")?.textContent?.trim();
        if (!text) {
          continue;
        }

        const verse = lyricEl.getAttribute("number")?.trim() || "1";
        const syllabicText = lyricEl.querySelector("syllabic")?.textContent?.trim();
        const syllabic = normalizeSyllabic(syllabicText);
        const event: LyricEvent = {
          verse,
          measureIndex,
          offsetDivisions: noteStart,
          text,
          syllabic,
          extend: Boolean(lyricEl.querySelector("extend")),
        };
        (lyricsByVerse[verse] ??= []).push(event);
      }
    }

    Object.values(lyricsByVerse).forEach((events) => {
      events.sort((a, b) => a.offsetDivisions - b.offsetDivisions);
    });

    const harmonies = collectHarmoniesForMeasure(allPartsMeasures, measureIndex, divisions, warnings, inferFromDirectionWords);

    const repeatStart = [...measureEl.querySelectorAll("barline repeat")]
      .some((repeat) => (repeat.getAttribute("direction") ?? "") === "forward");
    const repeatEnd = [...measureEl.querySelectorAll("barline repeat")]
      .some((repeat) => (repeat.getAttribute("direction") ?? "") === "backward");

    const endings = parseEndings(measureEl);

    result.push({
      measureIndex,
      durationDivisions,
      harmonies,
      lyricsByVerse,
      repeatStart: repeatStart || undefined,
      repeatEnd: repeatEnd || undefined,
      endings: endings.length > 0 ? endings : undefined,
    });
  });

  return result;
}

// ─── Fake Book reduction helpers ─────────────────────────────────────────────

interface MeasureReduction {
  /** Canonical chord string used for repeat detection */
  chord: string;
  /** Number of chord tokens (0 = empty measure, 1 = single, 2 = split-bar) */
  chordCount: number;
  /** True when ≥1 harmony was suppressed by duration-weighting */
  wasDurationReduced: boolean;
}

interface FakebookBarToken {
  /** Display token — may be "%" */
  token: string;
  /** Actual chord (for carry-forward when row starts with %) */
  chord: string;
  repeatStart: boolean;
  repeatEnd: boolean;
}

/**
 * Reduce a measure's harmony events to at most 2 chord tokens.
 *
 * Strategy:
 *  1. Compute each harmony's duration as the distance to the next event
 *     (or to end-of-measure for the last event).
 *  2. Drop ornamental events that occupy < 15 % of the measure.
 *  3. From the remaining events, keep the top-2 by duration in original
 *     time order.
 *  4. If those 2 events share the measure roughly equally (25-75 % each),
 *     emit a split-bar token (X_Y). Otherwise emit only the dominant one.
 */
function reduceMeasureHarmonies(
  harmonies: HarmonyEvent[],
  measureDuration: number,
): MeasureReduction {
  if (harmonies.length === 0) {
    return { chord: "", chordCount: 0, wasDurationReduced: false };
  }
  if (harmonies.length === 1) {
    return { chord: harmonies[0].chordText, chordCount: 1, wasDurationReduced: false };
  }

  // Effective duration: prefer the declared measure duration; fall back to
  // the position just past the last harmony event.
  const effectiveDuration = Math.max(
    measureDuration > 0 ? measureDuration : 0,
    harmonies[harmonies.length - 1].offsetDivisions + 1,
  );

  const withDuration = harmonies.map((h, i) => ({
    chordText: h.chordText,
    offsetDivisions: h.offsetDivisions,
    duration: Math.max(
      1,
      (i + 1 < harmonies.length ? harmonies[i + 1].offsetDivisions : effectiveDuration)
        - h.offsetDivisions,
    ),
  }));

  // Drop ornamental events (< 15 % of measure)
  const MIN_WEIGHT = 0.15;
  const significant = withDuration.filter((h) => h.duration / effectiveDuration >= MIN_WEIGHT);
  const candidates = significant.length > 0 ? significant : withDuration;
  const dropped = harmonies.length > candidates.length;

  if (candidates.length === 1) {
    return { chord: candidates[0].chordText, chordCount: 1, wasDurationReduced: dropped || harmonies.length > 1 };
  }

  // Keep top-2 by duration, then restore chronological order
  const top2 = [...candidates]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 2)
    .sort((a, b) => a.offsetDivisions - b.offsetDivisions);

  const durA = top2[0].duration;
  const durB = top2[1].duration;
  const ratioA = durA / (durA + durB);
  const wasDurationReduced = dropped || candidates.length > 2;

  // Genuine split bar: each half occupies 25–75 % of the combined weight
  if (ratioA >= 0.25 && ratioA <= 0.75) {
    const chord = `${top2[0].chordText}_${top2[1].chordText}`;
    return { chord, chordCount: 2, wasDurationReduced };
  }

  // One clearly dominates — emit only the longer one
  const dominant = ratioA > 0.75 ? top2[0] : top2[1];
  return { chord: dominant.chordText, chordCount: 1, wasDurationReduced: true };
}

// ─── Chord token normalization ────────────────────────────────────────────────

/** Enharmonic equivalents used when preferring flat spellings (jazz default). */
const SHARP_TO_FLAT: Record<string, string> = {
  "A#": "Bb", "C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab",
};

/** Enharmonic equivalents used when preferring sharp spellings. */
const FLAT_TO_SHARP: Record<string, string> = {
  "Bb": "A#", "Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#",
};

/**
 * Determine whether flat or sharp spellings are preferred given the key's
 * circle-of-fifths position.  Jazz convention: prefer flats everywhere except
 * keys with ≥ 4 sharps (E, B, F#, C#).
 */
function resolveEnharmonicStyle(
  style: "auto" | "flats" | "sharps" | undefined,
  fifths: number | undefined,
): "flats" | "sharps" {
  if (style === "flats") return "flats";
  if (style === "sharps") return "sharps";
  // 'auto': flat-biased (jazz default); sharps only for very sharp keys
  return (fifths ?? 0) >= 4 ? "sharps" : "flats";
}

function normalizeNoteSpelling(note: string, style: "flats" | "sharps"): string {
  return style === "flats"
    ? (SHARP_TO_FLAT[note] ?? note)
    : (FLAT_TO_SHARP[note] ?? note);
}

/**
 * Rewrite the root and bass note of a chord token to the preferred spelling.
 * Handles both simple chords ("A#7") and split-bar pairs ("A#7_D#m7").
 */
function normalizeChordSpelling(token: string, style: "flats" | "sharps"): string {
  if (!token || token === "%") return token;

  // Handle split-bar tokens (e.g. "A#7_D#m7")
  if (token.includes("_")) {
    return token.split("_").map((part) => normalizeChordSpelling(part, style)).join("_");
  }

  const rootMatch = token.match(/^([A-G][#b]?)/);
  if (!rootMatch) return token;
  const root = rootMatch[1];
  let result = normalizeNoteSpelling(root, style) + token.slice(root.length);

  // Normalize bass note in slash chords
  const slashIdx = result.lastIndexOf("/");
  if (slashIdx >= 0) {
    const bassStr = result.slice(slashIdx + 1);
    const bassMatch = bassStr.match(/^([A-G][#b]?)/);
    if (bassMatch) {
      const normalizedBass = normalizeNoteSpelling(bassMatch[1], style);
      result =
        result.slice(0, slashIdx + 1) +
        normalizedBass +
        bassStr.slice(bassMatch[1].length);
    }
  }
  return result;
}

/**
 * Jazz symbol substitutions — applied in longest-match-first order so that
 * e.g. "maj7" is caught before a hypothetical bare "maj".
 * Only affects display: the intermediate chord text is still ASCII-safe
 * (Δ is U+0394, ø is U+00F8, ° is U+00B0).
 */
const JAZZ_SYMBOL_SUBS: [RegExp, string][] = [
  [/m\(maj7\)/g, "m(Δ7)"],  // minor-major 7th
  [/maj13/g,     "Δ13"],
  [/maj11/g,     "Δ11"],
  [/maj9/g,      "Δ9"],
  [/maj7/g,      "Δ7"],
  [/m7b5/g,      "ø7"],
  [/dim7/g,      "°7"],
  [/dim/g,       "°"],
];

function applyJazzSymbols(chord: string): string {
  if (!chord || chord === "%") return chord;
  // Apply to each half of a split-bar pair independently
  if (chord.includes("_")) {
    return chord.split("_").map(applyJazzSymbols).join("_");
  }
  let result = chord;
  for (const [pattern, replacement] of JAZZ_SYMBOL_SUBS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ─── Fake-book renderer ───────────────────────────────────────────────────────

function renderFakebook(
  measures: MeasureData[],
  metadata: ParsedMetadata,
  options: ConvertOptions,
): { lines: string[]; stats: FakebookStats; enharmonicStyleApplied: "flats" | "sharps" } {
  const lines: string[] = [];

  // Determine enharmonic and symbol style
  const enhStyle = resolveEnharmonicStyle(options.enharmonicStyle, metadata.fifths);
  const useJazzSymbols = options.jazzSymbols ?? false;

  /** Apply all post-processing to a raw chord string. */
  function finalizeChord(raw: string): string {
    let result = normalizeChordSpelling(raw, enhStyle);
    if (useJazzSymbols) result = applyJazzSymbols(result);
    return result;
  }

  // Header block
  if (metadata.title) lines.push(`Title: ${metadata.title}`);
  lines.push("Style:");
  if (metadata.time) lines.push(`Time: ${metadata.time}`);
  if (metadata.key) lines.push(`Key: ${metadata.key}`);
  lines.push("");

  const barsPerLine = Math.max(1, Math.floor(options.barsPerLine || 4));
  const stats: FakebookStats = {
    measuresTotal: measures.length,
    single: 0, split: 0, repeat: 0, empty: 0, durationReduced: 0,
  };

  let prevChord = "";
  const barTokens: FakebookBarToken[] = [];

  for (const measure of measures) {
    const sorted = [...measure.harmonies].sort((a, b) => a.offsetDivisions - b.offsetDivisions);
    const reduction = reduceMeasureHarmonies(sorted, measure.durationDivisions);

    if (reduction.chordCount === 0) {
      stats.empty++;
      barTokens.push({
        token: "%",
        chord: prevChord,
        repeatStart: measure.repeatStart ?? false,
        repeatEnd: measure.repeatEnd ?? false,
      });
      continue;
    }

    if (reduction.wasDurationReduced) stats.durationReduced++;
    if (reduction.chordCount === 1) stats.single++;
    else stats.split++;

    // Apply enharmonic + jazz-symbol normalization to the raw chord
    const chord = finalizeChord(reduction.chord);
    let displayToken: string;
    if (chord === prevChord) {
      displayToken = "%";
      stats.repeat++;
    } else {
      displayToken = chord;
      prevChord = chord;
    }

    barTokens.push({
      token: displayToken,
      chord,
      repeatStart: measure.repeatStart ?? false,
      repeatEnd: measure.repeatEnd ?? false,
    });
  }

  // ── Phrase-aware grouping ─────────────────────────────────────────────────
  // Insert a blank line between 8-bar phrase groups when the total measure
  // count is divisible by 8.  This reliably separates AABA / ABAC 32-bar
  // forms and 16-bar sections without needing explicit phrase detection.
  const phraseLen = 8; // bars per phrase group
  const totalBars = barTokens.length;
  const usePhraseSep = totalBars >= phraseLen && totalBars % phraseLen === 0;

  // ── Row emission ──────────────────────────────────────────────────────────
  // Never let a row open with %, as it references the previous row's last
  // bar which is off-screen on mobile / print.
  for (let i = 0; i < barTokens.length; i += barsPerLine) {
    const chunk = barTokens.slice(i, i + barsPerLine);

    // Replace a leading % with the actual chord so each row is self-contained
    if (chunk[0].token === "%" && chunk[0].chord) {
      chunk[0] = { ...chunk[0], token: chunk[0].chord };
    }

    const hasRepeatStart = chunk.some((b) => b.repeatStart);
    const hasRepeatEnd = chunk.some((b) => b.repeatEnd);
    let row = chunk.map((b) => b.token).join(" ");
    if (hasRepeatStart) row = "|: " + row;
    if (hasRepeatEnd) row = row + " :|";
    lines.push(row);

    // Add blank separator after every phraseLen bars (but not after the last row)
    const endBar = i + barsPerLine; // exclusive index into barTokens
    if (usePhraseSep && endBar < barTokens.length && endBar % phraseLen === 0) {
      lines.push("");
    }
  }

  console.log(
    `[fakebook] measures=${stats.measuresTotal} ` +
    `single=${stats.single} split=${stats.split} ` +
    `repeat=${stats.repeat} empty=${stats.empty} ` +
    `dur-reduced=${stats.durationReduced} ` +
    `enh=${enhStyle} jazz=${useJazzSymbols} phrase-sep=${usePhraseSep}`,
  );

  return { lines, stats, enharmonicStyleApplied: enhStyle };
}

function renderLyricsInline(
  measures: MeasureData[],
  verseKeys: string[],
  options: ConvertOptions
): string[] {
  const lines: string[] = [];

  verseKeys.forEach((verse, verseIdx) => {
    const measureTexts = measures.map((measure) => {
      const lyrics = measure.lyricsByVerse[verse] ?? [];
      return renderSingleMeasureLyrics(measure, lyrics, options);
    });

    if (verseKeys.length > 1) {
      lines.push("{start_of_verse}");
      lines.push(`{comment: Verse ${verse}}`);
    }

    lines.push(...emitWrappedBars(measureTexts, options));

    if (verseKeys.length > 1) {
      lines.push("{end_of_verse}");
      if (verseIdx < verseKeys.length - 1) {
        lines.push("");
      }
    }
  });

  return lines;
}

function renderGrid(
  measures: MeasureData[],
  options: ConvertOptions,
  warnings: string[],
  timeSignature?: string
): string[] {
  const slotsPerMeasure = resolveGridSlotsPerMeasure(options, timeSignature);
  let measuresWithMultipleChords = 0;
  let totalCollisions = 0;

  const measureTexts = measures.map((measure) => {
    const slots = Array(slotsPerMeasure).fill(".");
    const harmonies = [...measure.harmonies].sort((a, b) => a.offsetDivisions - b.offsetDivisions);
    if (harmonies.length > 1) {
      measuresWithMultipleChords += 1;
    }

    for (const harmony of harmonies) {
      const slotIndexRaw = measure.durationDivisions > 0
        ? Math.floor((harmony.offsetDivisions / Math.max(1, measure.durationDivisions)) * slotsPerMeasure)
        : 0;
      const slotIndex = Math.max(0, Math.min(slotsPerMeasure - 1, slotIndexRaw));
      if (slots[slotIndex] !== ".") {
        totalCollisions += 1;
        continue;
      }
      slots[slotIndex] = `[${harmony.chordText}]`;
    }

    return slots.join(" ");
  });

  if (measuresWithMultipleChords > 0) {
    warnings.push(
      `Grid quantized to ${slotsPerMeasure} slots/measure; ${measuresWithMultipleChords} measures contain multiple chord changes.`
    );
  }
  if (totalCollisions > 0) {
    warnings.push(
      `Chord collisions within same slot: ${totalCollisions}. Consider higher grid resolution.`
    );
  }

  return [
    "{start_of_grid}",
    ...emitWrappedBars(measureTexts, options),
    "{end_of_grid}",
  ];
}

function resolveGridSlotsPerMeasure(options: ConvertOptions, timeSignature?: string): number {
  const configuredSlots = options.gridSlotsPerMeasure;
  if (Number.isFinite(configuredSlots) && configuredSlots != null && configuredSlots > 0) {
    return Math.floor(configuredSlots);
  }

  if (!timeSignature) {
    return 4;
  }

  const [beatsText] = timeSignature.split("/");
  const beats = Number.parseInt(beatsText, 10);
  if (!Number.isFinite(beats) || beats <= 0) {
    return 4;
  }

  // MVP: use the top number directly (e.g., 6/8 => 6 slots).
  return beats;
}

function emitWrappedBars(measureTexts: string[], options: ConvertOptions): string[] {
  if (measureTexts.length === 0) {
    return [];
  }

  const barsPerLine = Math.max(1, Math.floor(options.barsPerLine || 4));
  const usePipes = options.barlineStyle === "pipes";
  const chunkSize = options.wrapPolicy === "no-wrap" ? measureTexts.length : barsPerLine;
  const lines: string[] = [];

  for (let idx = 0; idx < measureTexts.length; idx += chunkSize) {
    const chunk = measureTexts.slice(idx, idx + chunkSize);
    if (usePipes) {
      lines.push(`| ${chunk.join(" | ")} |`);
    } else {
      lines.push(chunk.join("  "));
    }
  }

  return lines;
}

function renderSingleMeasureLyrics(
  measure: MeasureData,
  lyricEvents: LyricEvent[],
  options: ConvertOptions
): string {
  if (lyricEvents.length === 0) {
    const fallbackChord = measure.harmonies[0]?.chordText;
    return fallbackChord ? `[${fallbackChord}]` : "";
  }

  const sortedLyrics = [...lyricEvents].sort((a, b) => a.offsetDivisions - b.offsetDivisions);
  const sortedHarmonies = [...measure.harmonies].sort((a, b) => a.offsetDivisions - b.offsetDivisions);

  const chordBucket = new Map<number, string[]>();
  let carryIndex = 0;

  for (const harmony of sortedHarmonies) {
    while (
      carryIndex < sortedLyrics.length - 1 &&
      sortedLyrics[carryIndex].offsetDivisions < harmony.offsetDivisions
    ) {
      carryIndex += 1;
    }
    const list = chordBucket.get(carryIndex) ?? [];
    list.push(harmony.chordText);
    chordBucket.set(carryIndex, list);
  }

  const tokens: string[] = [];
  sortedLyrics.forEach((lyric, lyricIdx) => {
    const attached = chordBucket.get(lyricIdx) ?? [];
    const prefix = attached.length === 0 ? "" : formatChordPrefix(attached, options.chordBracketStyle);
    const suffix = lyric.syllabic === "begin" || lyric.syllabic === "middle" ? "-" : "";
    const token = `${prefix}${lyric.text}${suffix}`;
    tokens.push(token);
  });

  const joined = tokens.join(" ");
  return options.normalizeWhitespace ? joined.replace(/\s+/g, " ").trim() : joined;
}

function collectHarmoniesForMeasure(
  allPartsMeasures: Element[][],
  measureIndex: number,
  divisions: number,
  warnings: string[],
  inferFromDirectionWords = false,
): HarmonyEvent[] {
  const dedupe = new Map<string, HarmonyEvent>();

  for (const partMeasures of allPartsMeasures) {
    const measure = partMeasures[measureIndex];
    if (!measure) {
      continue;
    }

    let cursor = 0;
    for (const child of [...measure.children]) {
      if (child.tagName === "backup") {
        const shift = parseIntText(child.querySelector("duration")?.textContent, 0);
        cursor = Math.max(0, cursor - shift);
      } else if (child.tagName === "forward") {
        const shift = parseIntText(child.querySelector("duration")?.textContent, 0);
        cursor += shift;
      } else if (child.tagName === "note") {
        cursor += parseIntText(child.querySelector("duration")?.textContent, 0);
      } else if (child.tagName === "harmony") {
        const offsetRaw = child.querySelector(":scope > offset")?.textContent;
        const offset = offsetRaw != null
          ? Math.max(0, Math.round(parseFloat(offsetRaw) * divisions))
          : cursor;
        const chordText = harmonyToChordText(child, warnings);
        if (!chordText) {
          continue;
        }
        const key = `${offset}__${chordText}`;
        if (!dedupe.has(key)) {
          dedupe.set(key, {
            measureIndex,
            offsetDivisions: offset,
            chordText,
          });
        }
      } else if (inferFromDirectionWords && child.tagName === "direction") {
        // Fallback: parse <direction-type><words> as chord symbols when the file
        // has no <harmony> elements (e.g. Finale-exported files).
        const wordsEl = child.querySelector("direction-type > words");
        const text = (wordsEl?.textContent ?? "").trim();
        if (!text) continue;
        const parsed = parseChordSymbol(text);
        if (!parsed) continue;
        const offsetEl = child.querySelector(":scope > offset");
        const offset = offsetEl
          ? Math.max(0, Math.round(parseFloat(offsetEl.textContent ?? "0") * divisions))
          : cursor;
        const chordText = parsedChordToText(parsed);
        const key = `${offset}__${chordText}`;
        if (!dedupe.has(key)) {
          dedupe.set(key, { measureIndex, offsetDivisions: offset, chordText });
        }
      }
    }
  }

  return [...dedupe.values()].sort((a, b) => a.offsetDivisions - b.offsetDivisions);
}

function harmonyToChordText(harmonyEl: Element, warnings: string[]): string {
  const rootStep = harmonyEl.querySelector(":scope > root > root-step")?.textContent?.trim() ?? "";
  if (!rootStep) {
    const w = "harmony element dropped: missing <root><root-step>";
    if (!warnings.includes(w)) warnings.push(w);
    return "";
  }
  const rootAlter = parseIntText(harmonyEl.querySelector(":scope > root > root-alter")?.textContent, 0);
  const root = `${rootStep}${accidentalFromAlter(rootAlter)}`;

  const kindEl = harmonyEl.querySelector(":scope > kind");
  const kindText = kindEl?.getAttribute("text")?.trim();
  const kindValue = kindEl?.textContent?.trim() ?? "major";
  const normalizedKind = kindValue.toLowerCase();
  let suffix = "";

  if (kindText && kindText.length > 0) {
    suffix = kindText;
  } else if (Object.prototype.hasOwnProperty.call(KIND_SUFFIX_MAP, normalizedKind)) {
    suffix = KIND_SUFFIX_MAP[normalizedKind];
  } else {
    const warning = `unknown chord kind '${kindValue}' defaulted to major`;
    if (!warnings.includes(warning)) {
      warnings.push(warning);
    }
    console.warn(`[musicXMLtochordpro] ${warning}`);
  }

  const bassStep = harmonyEl.querySelector(":scope > bass > bass-step")?.textContent?.trim();
  const bassAlter = parseIntText(harmonyEl.querySelector(":scope > bass > bass-alter")?.textContent, 0);
  const bass = bassStep ? `${bassStep}${accidentalFromAlter(bassAlter)}` : "";

  return `${root}${suffix}${bass ? `/${bass}` : ""}`;
}

function resolveMeasureOrder(
  measures: MeasureData[],
  options: ConvertOptions,
  warnings: string[],
  diagnostics: ConverterDiagnostics
): number[] {
  const baseOrder = measures.map((measure) => measure.measureIndex);
  if (options.repeatStrategy !== "simple-unroll") {
    return baseOrder;
  }

  if (diagnostics.endingsFound > 0) {
    warnings.push("unsupported endings");
    return baseOrder;
  }

  const startIdx = measures.findIndex((measure) => measure.repeatStart);
  if (startIdx < 0) {
    return baseOrder;
  }
  const endIdx = measures.findIndex((measure, index) => index > startIdx && measure.repeatEnd);
  if (endIdx < 0) {
    return baseOrder;
  }

  const duplicatedRange = baseOrder.slice(startIdx, endIdx + 1);
  return [
    ...baseOrder.slice(0, endIdx + 1),
    ...duplicatedRange,
    ...baseOrder.slice(endIdx + 1),
  ];
}

function parseEndings(measureEl: Element): number[] {
  const endings = new Set<number>();
  const endingNodes = [...measureEl.querySelectorAll("barline ending")];

  for (const endingEl of endingNodes) {
    const numberText = endingEl.getAttribute("number")?.trim();
    if (!numberText) {
      continue;
    }
    const parts = numberText.split(",").map((token) => Number.parseInt(token.trim(), 10));
    for (const value of parts) {
      if (Number.isFinite(value)) {
        endings.add(value);
      }
    }
  }

  return [...endings].sort((a, b) => a - b);
}

function normalizeSyllabic(input: string | undefined): LyricEvent["syllabic"] | undefined {
  if (!input) {
    return undefined;
  }
  if (input === "single" || input === "begin" || input === "middle" || input === "end") {
    return input;
  }
  return undefined;
}

function buildKeySignature(fifthsRaw: string | undefined, modeRaw: string | undefined): string | undefined {
  if (fifthsRaw == null) {
    return undefined;
  }
  const fifths = Number.parseInt(fifthsRaw, 10);
  if (!Number.isFinite(fifths)) {
    return undefined;
  }

  const majorByFifths = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
  const idx = fifths + 7;
  if (idx < 0 || idx >= majorByFifths.length) {
    return undefined;
  }
  const major = majorByFifths[idx];
  const mode = (modeRaw ?? "major").toLowerCase();

  if (mode === "minor") {
    const notes = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
    const majorSemitone = noteToSemitone(major);
    if (majorSemitone === undefined) {
      return `${major}m`;
    }
    const minorSemitone = (majorSemitone + 9) % 12;
    const minorNote = notes[minorSemitone] ?? `${major}m`;
    return `${minorNote}m`;
  }

  return major;
}

function noteToSemitone(note: string): number | undefined {
  const table: Record<string, number> = {
    C: 0,
    "B#": 0,
    "C#": 1,
    Db: 1,
    D: 2,
    "D#": 3,
    Eb: 3,
    E: 4,
    Fb: 4,
    "E#": 5,
    F: 5,
    "F#": 6,
    Gb: 6,
    G: 7,
    "G#": 8,
    Ab: 8,
    A: 9,
    "A#": 10,
    Bb: 10,
    B: 11,
    Cb: 11,
  };
  return table[note];
}

function formatChordPrefix(chords: string[], style: ChordBracketStyle): string {
  if (chords.length === 0) {
    return "";
  }
  if (style === "combined") {
    return `[${chords.join(" ")}]`;
  }
  return chords.map((chord) => `[${chord}]`).join("");
}

function accidentalFromAlter(alter: number): string {
  if (alter > 0) {
    return "#".repeat(alter);
  }
  if (alter < 0) {
    return "b".repeat(Math.abs(alter));
  }
  return "";
}

function parseIntText(text: string | null | undefined, fallback: number): number {
  if (!text) {
    return fallback;
  }
  const value = Number.parseInt(text.trim(), 10);
  return Number.isFinite(value) ? value : fallback;
}

function textAt(root: ParentNode, selector: string): string | undefined {
  return root.querySelector(selector)?.textContent?.trim() || undefined;
}
