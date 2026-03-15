/**
 * xmlIntakeAnalyzer.ts
 *
 * XML Intake Intelligence Layer.
 *
 * Analyzes any MusicXML document across five dimensions and produces a
 * reducibility score + classification that drives adaptive reduction strategy
 * selection.
 *
 * Scoring formula:
 *   reducibilityScore = round(60 * harmonyConfidence
 *                           + 25 * timingConfidence
 *                           + 15 * tonalContextConfidence)
 *
 * Classification:
 *   High   ≥ 72  — full reduction pipeline, tight thresholds
 *   Medium ≥ 45  — relaxed thresholds, warn on low coverage
 *   Low    < 45  — minimal reduction, surface strong warning
 */

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface XmlIntakeAnalysis {
  // ── Layer 1: Schema / parse ──────────────────────────────────────────────
  parseOk: boolean;
  scoreFormat: "partwise" | "timewise" | "unknown";
  partsCount: number;
  measuresCount: number;

  // ── Layer 2: Timing structure ─────────────────────────────────────────────
  divisionsFound: boolean;
  timeSignatureFound: boolean;
  measureNumberingClean: boolean;
  timingConfidence: number;           // 0–1

  // ── Layer 3: Harmony ──────────────────────────────────────────────────────
  harmoniesCollected: number;
  measuresWithHarmony: number;
  measuresWithInferredHarmony: number;
  measuresWithoutHarmony: number;
  avgHarmonyEventsPerMeasure: number;
  measuresSingleHarmony: number;
  measuresSplitHarmonyCandidate: number;
  measuresAmbiguousHarmony: number;
  malformedHarmonyCount: number;
  repeatMarkersFound: number;
  endingsFound: number;
  harmonyConfidence: number;          // 0–1

  // ── Layer 4: Metadata / tonal context ────────────────────────────────────
  titleFound: boolean;
  composerFound: boolean;
  keyFound: boolean;
  modeFound: boolean;
  tonalContextConfidence: number;     // 0–1

  // ── Layer 5: Reducibility verdict ────────────────────────────────────────
  reducibilityScore: number;          // 0–100 integer
  reducibilityClass: "high" | "medium" | "low";
  reducibilityLabel: string;
  reasons: string[];
}

export interface ReductionStrategy {
  /** Ornamental-event threshold: events shorter than this fraction are dropped */
  minHarmonyWeight: number;
  /** Lower ratio bound for genuine split-bar detection */
  splitBarMinRatio: number;
  /** Upper ratio bound for genuine split-bar detection */
  splitBarMaxRatio: number;
  /** When true, consecutive identical chords are collapsed into one */
  aggressiveRepeat: boolean;
}

// ─── Known-Good Profile (derived from Parker/Omnibook reference family) ───────
// These constants define what "great" MusicXML harmony data looks like.

export const KNOWN_GOOD_PROFILE = {
  /** Expected fraction of measures that carry at least one harmony event */
  harmonyCoverageMin: 0.85,
  /** Typical average harmony events per measure in jazz lead sheets */
  avgHarmonyEventsTarget: 1.5,
  /** Measures with ≥ 3 events are considered "ambiguous" — real Parker has < 10% */
  ambiguousMeasureRateMax: 0.10,
  /** Malformed harmony elements should be near-zero */
  malformedHarmonyMax: 2,
  /** High-quality files always have divisions and time-signature */
  requiresDivisionsAndTimeSig: true,
} as const;

// ─── Strategy table ───────────────────────────────────────────────────────────

const STRATEGIES: Record<"high" | "medium" | "low", ReductionStrategy> = {
  high: {
    minHarmonyWeight: 0.15,
    splitBarMinRatio: 0.25,
    splitBarMaxRatio: 0.75,
    aggressiveRepeat: true,
  },
  medium: {
    minHarmonyWeight: 0.20,
    splitBarMinRatio: 0.30,
    splitBarMaxRatio: 0.70,
    aggressiveRepeat: true,
  },
  low: {
    minHarmonyWeight: 0.30,
    splitBarMinRatio: 0.40,
    splitBarMaxRatio: 0.60,
    aggressiveRepeat: false,
  },
};

// ─── Analyzer input ───────────────────────────────────────────────────────────

export interface IntakeAnalysisParams {
  /** Already-parsed XML document (may be the timewise-converted form) */
  xmlDoc: Document;
  /** True when the original file had a parse error node */
  hadParseError: boolean;
  /** Score format determined by the converter (after any transposition) */
  scoreFormat: "partwise" | "timewise-converted";
  /** Measure summaries collected by the converter */
  measureSummaries: Array<{
    harmonyCount: number;
    inferredHarmonyCount: number;
    durationDivisions: number;
  }>;
  /** Total malformed harmony events detected by the converter */
  malformedHarmonyCount: number;
  /** Repeat and ending counts */
  repeatMarkersFound: number;
  endingsFound: number;
  /** Metadata (may be partial) */
  title?: string;
  composer?: string;
  keyFifths?: number;
  mode?: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyse a parsed MusicXML document and produce a full XmlIntakeAnalysis.
 */
export function analyzeXmlIntake(params: IntakeAnalysisParams): XmlIntakeAnalysis {
  const {
    xmlDoc,
    hadParseError,
    scoreFormat,
    measureSummaries,
    malformedHarmonyCount,
    repeatMarkersFound,
    endingsFound,
    title,
    composer,
    keyFifths,
    mode,
  } = params;

  const reasons: string[] = [];

  // ── Layer 1: Schema ───────────────────────────────────────────────────────

  const parseOk = !hadParseError;
  const partsCount = xmlDoc.querySelectorAll("score-partwise > part").length;
  const measuresCount = measureSummaries.length;

  let intakeScoreFormat: "partwise" | "timewise" | "unknown";
  if (scoreFormat === "partwise") {
    intakeScoreFormat = "partwise";
  } else if (scoreFormat === "timewise-converted") {
    intakeScoreFormat = "timewise";
    reasons.push("score-timewise format (converted in-memory)");
  } else {
    intakeScoreFormat = "unknown";
    reasons.push("unknown score format");
  }

  // ── Layer 2: Timing ───────────────────────────────────────────────────────

  const divisionsFound = xmlDoc.querySelector("divisions") !== null;
  const timeSignatureFound = xmlDoc.querySelector("time > beats") !== null;

  // Check for clean 1-based measure numbering
  const measureNumbers = Array.from(xmlDoc.querySelectorAll("measure[number]"))
    .map((m) => parseInt(m.getAttribute("number") ?? "0", 10))
    .filter((n) => !isNaN(n));
  const measureNumberingClean =
    measureNumbers.length > 0 &&
    measureNumbers[0] === 1 &&
    measureNumbers.every((n, i) => i === 0 || n === measureNumbers[i - 1] + 1);

  // Timing confidence: 0.50 divisions + 0.30 timeSig + 0.20 cleanNumbering
  const timingConfidence =
    0.50 * (divisionsFound ? 1 : 0) +
    0.30 * (timeSignatureFound ? 1 : 0) +
    0.20 * (measureNumberingClean ? 1 : 0);

  if (!divisionsFound) reasons.push("no <divisions> found — timing unreliable");
  if (!timeSignatureFound) reasons.push("no time signature found");

  // ── Layer 3: Harmony ──────────────────────────────────────────────────────

  let harmoniesCollected = 0;
  let measuresWithHarmony = 0;
  let measuresWithInferredHarmony = 0;
  let measuresWithoutHarmony = 0;
  let measuresSingleHarmony = 0;
  let measuresSplitHarmonyCandidate = 0;
  let measuresAmbiguousHarmony = 0;

  for (const s of measureSummaries) {
    const total = s.harmonyCount + s.inferredHarmonyCount;
    harmoniesCollected += total;

    if (total === 0) {
      measuresWithoutHarmony += 1;
    } else {
      measuresWithHarmony += s.harmonyCount > 0 ? 1 : 0;
      if (s.inferredHarmonyCount > 0) {
        measuresWithInferredHarmony += 1;
      }
      if (total === 1) {
        measuresSingleHarmony += 1;
      } else if (total === 2) {
        measuresSplitHarmonyCandidate += 1;
      } else {
        measuresAmbiguousHarmony += 1;
      }
    }
  }

  const avgHarmonyEventsPerMeasure =
    measuresCount > 0 ? harmoniesCollected / measuresCount : 0;

  // Harmony confidence
  // 0.70 * coverage + 0.20 * density score + 0.10 * (1 - ambiguityRate)
  const coverageRaw =
    measuresCount > 0
      ? (measuresWithHarmony + measuresWithInferredHarmony) / measuresCount
      : 0;
  // Saturate at KNOWN_GOOD_PROFILE target; anything ≥ that = full coverage
  const adjustedCoverage = Math.min(1, coverageRaw / KNOWN_GOOD_PROFILE.harmonyCoverageMin);

  const densityScore = Math.min(
    1,
    avgHarmonyEventsPerMeasure / KNOWN_GOOD_PROFILE.avgHarmonyEventsTarget,
  );

  const ambiguityRate =
    measuresCount > 0 ? measuresAmbiguousHarmony / measuresCount : 0;
  const malformedPenalty = Math.min(
    1,
    malformedHarmonyCount / Math.max(1, KNOWN_GOOD_PROFILE.malformedHarmonyMax + 1),
  );

  const harmonyConfidence =
    0.70 * adjustedCoverage +
    0.20 * densityScore +
    0.10 * (1 - ambiguityRate) -
    0.05 * malformedPenalty;
  const harmonyConfidenceClamped = Math.min(1, Math.max(0, harmonyConfidence));

  if (coverageRaw < 0.5) reasons.push(`low harmony coverage: ${Math.round(coverageRaw * 100)}% of measures`);
  if (malformedHarmonyCount > 0) reasons.push(`${malformedHarmonyCount} malformed harmony element(s)`);
  if (harmoniesCollected === 0) reasons.push("no harmony elements detected");

  // ── Layer 4: Tonal context / metadata ─────────────────────────────────────

  const titleFound = Boolean(title && title.trim().length > 0);
  const composerFound = Boolean(composer && composer.trim().length > 0);
  const keyFound = keyFifths !== undefined;
  const modeFound = Boolean(mode && mode.trim().length > 0);

  // 0.50*key + 0.20*title + 0.20*composer + 0.10*mode
  const tonalContextConfidence =
    0.50 * (keyFound ? 1 : 0) +
    0.20 * (titleFound ? 1 : 0) +
    0.20 * (composerFound ? 1 : 0) +
    0.10 * (modeFound ? 1 : 0);

  if (!keyFound) reasons.push("no key signature found");

  // ── Layer 5: Reducibility verdict ─────────────────────────────────────────

  const reducibilityScore = Math.round(
    60 * harmonyConfidenceClamped +
    25 * timingConfidence +
    15 * tonalContextConfidence,
  );

  let reducibilityClass: "high" | "medium" | "low";
  let reducibilityLabel: string;

  if (reducibilityScore >= 72) {
    reducibilityClass = "high";
    reducibilityLabel = "High confidence";
  } else if (reducibilityScore >= 45) {
    reducibilityClass = "medium";
    reducibilityLabel = "Medium confidence";
    reasons.push("partial harmony coverage — reduction may be incomplete");
  } else {
    reducibilityClass = "low";
    reducibilityLabel = "Low confidence";
    reasons.push("insufficient harmony data for reliable fake-book reduction");
  }

  return {
    parseOk,
    scoreFormat: intakeScoreFormat,
    partsCount,
    measuresCount,

    divisionsFound,
    timeSignatureFound,
    measureNumberingClean,
    timingConfidence,

    harmoniesCollected,
    measuresWithHarmony,
    measuresWithInferredHarmony,
    measuresWithoutHarmony,
    avgHarmonyEventsPerMeasure,
    measuresSingleHarmony,
    measuresSplitHarmonyCandidate,
    measuresAmbiguousHarmony,
    malformedHarmonyCount,
    repeatMarkersFound,
    endingsFound,
    harmonyConfidence: harmonyConfidenceClamped,

    titleFound,
    composerFound,
    keyFound,
    modeFound,
    tonalContextConfidence,

    reducibilityScore,
    reducibilityClass,
    reducibilityLabel,
    reasons,
  };
}

/**
 * Return the ReductionStrategy for a given reducibility class.
 */
export function getReductionStrategy(cls: "high" | "medium" | "low"): ReductionStrategy {
  return { ...STRATEGIES[cls] };
}
