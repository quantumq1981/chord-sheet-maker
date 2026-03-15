/**
 * xmlIntakeAnalyzer.test.ts
 *
 * Unit tests for analyzeXmlIntake and getReductionStrategy.
 */
import { describe, it, expect } from "vitest";
import {
  analyzeXmlIntake,
  getReductionStrategy,
  KNOWN_GOOD_PROFILE,
  type IntakeAnalysisParams,
} from "../xmlIntakeAnalyzer";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDoc(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

/** Build a minimal score-partwise XML with n measures, each with harmonyCount harmonies */
function partwiseXml(
  measures: number,
  options: {
    harmoniesPerMeasure?: number;
    hasDivisions?: boolean;
    hasTimeSig?: boolean;
    hasKey?: boolean;
    hasMode?: boolean;
    title?: string;
    composer?: string;
  } = {},
): string {
  const {
    harmoniesPerMeasure = 1,
    hasDivisions = true,
    hasTimeSig = true,
    hasKey = true,
    hasMode = true,
    title,
    composer,
  } = options;

  const work = title ? `<work><work-title>${title}</work-title></work>` : "";
  const creator = composer
    ? `<identification><creator type="composer">${composer}</creator></identification>`
    : "";

  const attrs = `<attributes>
    ${hasDivisions ? "<divisions>4</divisions>" : ""}
    ${hasKey ? `<key><fifths>-2</fifths>${hasMode ? "<mode>major</mode>" : ""}</key>` : ""}
    ${hasTimeSig ? "<time><beats>4</beats><beat-type>4</beat-type></time>" : ""}
    <clef><sign>G</sign><line>2</line></clef>
  </attributes>`;

  const harmony = `<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>`;
  const note = `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>`;

  const measureBodies = Array.from({ length: measures }, (_, i) => {
    const harmonies = Array(harmoniesPerMeasure).fill(harmony).join("\n");
    return `<measure number="${i + 1}">${i === 0 ? attrs : ""}${harmonies}${note}</measure>`;
  });

  return `<?xml version="1.0"?><score-partwise version="3.1">
    ${work}${creator}
    <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
    <part id="P1">${measureBodies.join("")}</part>
  </score-partwise>`;
}

function defaultParams(overrides: Partial<IntakeAnalysisParams> = {}): IntakeAnalysisParams {
  return {
    xmlDoc: makeDoc(partwiseXml(12)),
    hadParseError: false,
    scoreFormat: "partwise",
    measureSummaries: Array.from({ length: 12 }, () => ({
      harmonyCount: 1,
      inferredHarmonyCount: 0,
      durationDivisions: 16,
    })),
    malformedHarmonyCount: 0,
    repeatMarkersFound: 0,
    endingsFound: 0,
    title: "Test",
    composer: "Composer",
    keyFifths: -2,
    mode: "major",
    ...overrides,
  };
}

// ─── Layer 1: Schema ──────────────────────────────────────────────────────────

describe("layer 1 — schema / parse", () => {
  it("parseOk true when no parse error", () => {
    const result = analyzeXmlIntake(defaultParams());
    expect(result.parseOk).toBe(true);
  });

  it("parseOk false when hadParseError is true", () => {
    const result = analyzeXmlIntake(defaultParams({ hadParseError: true }));
    expect(result.parseOk).toBe(false);
  });

  it("partsCount reflects score-partwise > part elements", () => {
    const result = analyzeXmlIntake(defaultParams());
    expect(result.partsCount).toBe(1);
  });

  it("measuresCount from measureSummaries length", () => {
    const result = analyzeXmlIntake(defaultParams());
    expect(result.measuresCount).toBe(12);
  });

  it("scoreFormat 'partwise' preserved", () => {
    const result = analyzeXmlIntake(defaultParams({ scoreFormat: "partwise" }));
    expect(result.scoreFormat).toBe("partwise");
  });

  it("scoreFormat 'timewise' when timewise-converted", () => {
    const result = analyzeXmlIntake(defaultParams({ scoreFormat: "timewise-converted" }));
    expect(result.scoreFormat).toBe("timewise");
  });
});

// ─── Layer 2: Timing ─────────────────────────────────────────────────────────

describe("layer 2 — timing confidence", () => {
  it("full timing confidence = 1.0 when all signals present", () => {
    const result = analyzeXmlIntake(defaultParams());
    expect(result.timingConfidence).toBeCloseTo(1.0, 5);
    expect(result.divisionsFound).toBe(true);
    expect(result.timeSignatureFound).toBe(true);
    expect(result.measureNumberingClean).toBe(true);
  });

  it("reduces confidence when divisions absent", () => {
    const doc = makeDoc(partwiseXml(4, { hasDivisions: false }));
    const result = analyzeXmlIntake(defaultParams({
      xmlDoc: doc,
      measureSummaries: Array.from({ length: 4 }, () => ({ harmonyCount: 1, inferredHarmonyCount: 0, durationDivisions: 0 })),
    }));
    expect(result.divisionsFound).toBe(false);
    expect(result.timingConfidence).toBeLessThan(0.8);
  });

  it("reduces confidence when time signature absent", () => {
    const doc = makeDoc(partwiseXml(4, { hasTimeSig: false }));
    const result = analyzeXmlIntake(defaultParams({
      xmlDoc: doc,
      measureSummaries: Array.from({ length: 4 }, () => ({ harmonyCount: 1, inferredHarmonyCount: 0, durationDivisions: 16 })),
    }));
    expect(result.timeSignatureFound).toBe(false);
    expect(result.timingConfidence).toBeLessThan(0.9);
  });

  it("measureNumberingClean false when numbers are gapped", () => {
    const xml = `<?xml version="1.0"?><score-partwise version="3.1">
      <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
      <part id="P1">
        <measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure>
        <measure number="3">
          <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note></measure>
      </part>
    </score-partwise>`;
    const result = analyzeXmlIntake(defaultParams({
      xmlDoc: makeDoc(xml),
      measureSummaries: [
        { harmonyCount: 0, inferredHarmonyCount: 0, durationDivisions: 16 },
        { harmonyCount: 0, inferredHarmonyCount: 0, durationDivisions: 16 },
      ],
    }));
    expect(result.measureNumberingClean).toBe(false);
  });
});

// ─── Layer 3: Harmony ────────────────────────────────────────────────────────

describe("layer 3 — harmony confidence", () => {
  it("full coverage → high harmony confidence", () => {
    const result = analyzeXmlIntake(defaultParams());
    expect(result.harmonyConfidence).toBeGreaterThan(0.7);
    expect(result.measuresWithHarmony).toBe(12);
    expect(result.measuresWithoutHarmony).toBe(0);
  });

  it("zero harmony → near-zero confidence", () => {
    const result = analyzeXmlIntake(defaultParams({
      measureSummaries: Array.from({ length: 8 }, () => ({
        harmonyCount: 0,
        inferredHarmonyCount: 0,
        durationDivisions: 16,
      })),
    }));
    expect(result.harmonyConfidence).toBeLessThan(0.2);
    expect(result.harmoniesCollected).toBe(0);
    expect(result.measuresWithoutHarmony).toBe(8);
  });

  it("inferred harmonies contribute to measuresWithInferredHarmony", () => {
    const summaries = [
      { harmonyCount: 0, inferredHarmonyCount: 1, durationDivisions: 16 },
      { harmonyCount: 1, inferredHarmonyCount: 0, durationDivisions: 16 },
    ];
    const result = analyzeXmlIntake(defaultParams({ measureSummaries: summaries }));
    expect(result.measuresWithInferredHarmony).toBe(1);
    expect(result.measuresWithHarmony).toBe(1);
  });

  it("ambiguous measures (≥3 harmonies) tracked separately", () => {
    const summaries = Array.from({ length: 4 }, (_, i) => ({
      harmonyCount: i < 2 ? 1 : 3,
      inferredHarmonyCount: 0,
      durationDivisions: 16,
    }));
    const result = analyzeXmlIntake(defaultParams({ measureSummaries: summaries }));
    expect(result.measuresAmbiguousHarmony).toBe(2);
  });

  it("split-bar candidates (exactly 2 harmonies) tracked", () => {
    const summaries = Array.from({ length: 4 }, () => ({
      harmonyCount: 2,
      inferredHarmonyCount: 0,
      durationDivisions: 16,
    }));
    const result = analyzeXmlIntake(defaultParams({ measureSummaries: summaries }));
    expect(result.measuresSplitHarmonyCandidate).toBe(4);
  });

  it("malformed harmony count penalises confidence", () => {
    const good = analyzeXmlIntake(defaultParams({ malformedHarmonyCount: 0 }));
    const bad = analyzeXmlIntake(defaultParams({ malformedHarmonyCount: 5 }));
    expect(bad.harmonyConfidence).toBeLessThan(good.harmonyConfidence);
  });

  it("avgHarmonyEventsPerMeasure computed correctly", () => {
    const result = analyzeXmlIntake(defaultParams());
    expect(result.avgHarmonyEventsPerMeasure).toBeCloseTo(1.0, 5);
  });
});

// ─── Layer 4: Tonal context ───────────────────────────────────────────────────

describe("layer 4 — tonal context confidence", () => {
  it("all metadata → 1.0 confidence", () => {
    const result = analyzeXmlIntake(defaultParams());
    expect(result.tonalContextConfidence).toBeCloseTo(1.0, 5);
    expect(result.titleFound).toBe(true);
    expect(result.composerFound).toBe(true);
    expect(result.keyFound).toBe(true);
    expect(result.modeFound).toBe(true);
  });

  it("no key → 0.5 penalty", () => {
    const result = analyzeXmlIntake(defaultParams({ keyFifths: undefined }));
    expect(result.keyFound).toBe(false);
    expect(result.tonalContextConfidence).toBeCloseTo(0.5, 5);
  });

  it("no metadata at all → near-zero confidence", () => {
    const result = analyzeXmlIntake(defaultParams({
      title: undefined,
      composer: undefined,
      keyFifths: undefined,
      mode: undefined,
    }));
    expect(result.tonalContextConfidence).toBeCloseTo(0, 5);
  });
});

// ─── Layer 5: Reducibility scoring ───────────────────────────────────────────

describe("layer 5 — reducibility scoring and classification", () => {
  it("high-quality 12-bar fixture → HIGH class", () => {
    const result = analyzeXmlIntake(defaultParams());
    expect(result.reducibilityClass).toBe("high");
    expect(result.reducibilityScore).toBeGreaterThanOrEqual(72);
    expect(result.reducibilityLabel).toBe("High confidence");
  });

  it("zero harmony → LOW class", () => {
    const result = analyzeXmlIntake(defaultParams({
      measureSummaries: Array.from({ length: 8 }, () => ({
        harmonyCount: 0,
        inferredHarmonyCount: 0,
        durationDivisions: 16,
      })),
      title: undefined,
      composer: undefined,
      keyFifths: undefined,
      mode: undefined,
    }));
    expect(result.reducibilityClass).toBe("low");
    expect(result.reducibilityScore).toBeLessThan(45);
    expect(result.reducibilityLabel).toBe("Low confidence");
  });

  it("medium coverage → MEDIUM class", () => {
    // 4/8 measures have harmony (~50%), no key, no composer, no mode — score ~63
    const summaries = [
      ...Array.from({ length: 4 }, () => ({ harmonyCount: 1, inferredHarmonyCount: 0, durationDivisions: 16 })),
      ...Array.from({ length: 4 }, () => ({ harmonyCount: 0, inferredHarmonyCount: 0, durationDivisions: 16 })),
    ];
    const result = analyzeXmlIntake(defaultParams({
      measureSummaries: summaries,
      composer: undefined,
      keyFifths: undefined,
      mode: undefined,
    }));
    expect(result.reducibilityClass).toBe("medium");
    expect(result.reducibilityScore).toBeGreaterThanOrEqual(45);
    expect(result.reducibilityScore).toBeLessThan(72);
  });

  it("score is integer 0–100", () => {
    const result = analyzeXmlIntake(defaultParams());
    expect(Number.isInteger(result.reducibilityScore)).toBe(true);
    expect(result.reducibilityScore).toBeGreaterThanOrEqual(0);
    expect(result.reducibilityScore).toBeLessThanOrEqual(100);
  });

  it("reasons array populated for low confidence", () => {
    const result = analyzeXmlIntake(defaultParams({
      measureSummaries: Array.from({ length: 8 }, () => ({
        harmonyCount: 0,
        inferredHarmonyCount: 0,
        durationDivisions: 16,
      })),
      keyFifths: undefined,
    }));
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.some((r) => r.includes("harmony"))).toBe(true);
  });

  it("timewise-converted adds reason", () => {
    const result = analyzeXmlIntake(defaultParams({ scoreFormat: "timewise-converted" }));
    expect(result.reasons.some((r) => r.includes("timewise"))).toBe(true);
  });
});

// ─── KNOWN_GOOD_PROFILE constants ────────────────────────────────────────────

describe("KNOWN_GOOD_PROFILE constants", () => {
  it("harmonyCoverageMin >= 0.8", () => {
    expect(KNOWN_GOOD_PROFILE.harmonyCoverageMin).toBeGreaterThanOrEqual(0.8);
  });

  it("malformedHarmonyMax is small", () => {
    expect(KNOWN_GOOD_PROFILE.malformedHarmonyMax).toBeLessThanOrEqual(5);
  });
});

// ─── getReductionStrategy ─────────────────────────────────────────────────────

describe("getReductionStrategy", () => {
  it("high strategy has tight thresholds", () => {
    const s = getReductionStrategy("high");
    expect(s.minHarmonyWeight).toBe(0.15);
    expect(s.splitBarMinRatio).toBe(0.25);
    expect(s.splitBarMaxRatio).toBe(0.75);
    expect(s.aggressiveRepeat).toBe(true);
  });

  it("medium strategy is slightly relaxed", () => {
    const s = getReductionStrategy("medium");
    expect(s.minHarmonyWeight).toBeGreaterThan(getReductionStrategy("high").minHarmonyWeight);
    expect(s.aggressiveRepeat).toBe(true);
  });

  it("low strategy has wide thresholds and no aggressive repeat", () => {
    const s = getReductionStrategy("low");
    expect(s.minHarmonyWeight).toBeGreaterThan(getReductionStrategy("medium").minHarmonyWeight);
    expect(s.aggressiveRepeat).toBe(false);
  });

  it("returns a copy (mutations do not affect source)", () => {
    const s1 = getReductionStrategy("high");
    const s2 = getReductionStrategy("high");
    s1.minHarmonyWeight = 99;
    expect(s2.minHarmonyWeight).toBe(0.15);
  });
});
