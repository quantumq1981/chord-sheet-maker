import JSZip from "jszip";

export type PageSize = "letter" | "a4";

export type ChordProFormatMode =
  | "lyrics-inline"
  | "grid-only"
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
  formatModeResolved: "lyrics-inline" | "grid-only";
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
}

const KIND_SUFFIX_MAP: Record<string, string> = {
  major: "",
  minor: "m",
  dominant: "7",
  "major-seventh": "maj7",
  "minor-seventh": "m7",
  diminished: "dim",
  augmented: "aug",
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

export async function convertMusicXmlToChordPro(
  input: ConvertInput,
  options?: Partial<ConvertOptions>
): Promise<ConvertOutput> {
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
    const metadata = parseMetadata(xmlDoc);
    diagnostics.title = metadata.title;
    diagnostics.composer = metadata.composer;
    diagnostics.key = metadata.key;
    diagnostics.time = metadata.time;

    const selectedLyricPartId = selectLyricPart(xmlDoc);
    diagnostics.selectedLyricPartId = selectedLyricPartId;

    const measures = buildMeasureData(xmlDoc, selectedLyricPartId, mergedOptions, warnings);
    diagnostics.measuresCount = measures.length;

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
      warnings.push("no harmony found");
    }
    if (!hasAnyLyrics && formatModeResolved !== "grid-only") {
      warnings.push("no lyrics found");
    }

    const lines: string[] = [];
    if (mergedOptions.metadataPolicy === "emit") {
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

  return {
    title: title?.trim() || undefined,
    composer,
    key,
    time,
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
  options: ConvertOptions,
  warnings: string[]
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

    const harmonies = collectHarmoniesForMeasure(allPartsMeasures, measureIndex, divisions);

    const repeatStart = [...measureEl.querySelectorAll("barline repeat")]
      .some((repeat) => (repeat.getAttribute("direction") ?? "") === "forward");
    const repeatEnd = [...measureEl.querySelectorAll("barline repeat")]
      .some((repeat) => (repeat.getAttribute("direction") ?? "") === "backward");

    const endings = parseEndings(measureEl);
    if (endings.length > 0 && options.repeatStrategy === "simple-unroll") {
      warnings.push("unsupported endings");
    }

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
  divisions: number
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
        const chordText = harmonyToChordText(child);
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
      }
    }
  }

  return [...dedupe.values()].sort((a, b) => a.offsetDivisions - b.offsetDivisions);
}

function harmonyToChordText(harmonyEl: Element): string {
  const rootStep = harmonyEl.querySelector(":scope > root > root-step")?.textContent?.trim() ?? "";
  if (!rootStep) {
    return "";
  }
  const rootAlter = parseIntText(harmonyEl.querySelector(":scope > root > root-alter")?.textContent, 0);
  const root = `${rootStep}${accidentalFromAlter(rootAlter)}`;

  const kindEl = harmonyEl.querySelector(":scope > kind");
  const kindText = kindEl?.getAttribute("text")?.trim();
  const kindValue = kindEl?.textContent?.trim() ?? "major";
  const suffix = kindText && kindText.length > 0 ? kindText : (KIND_SUFFIX_MAP[kindValue] ?? kindValue);

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
