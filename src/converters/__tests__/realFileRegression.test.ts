/**
 * realFileRegression.test.ts
 *
 * End-to-end regression tests using representative fixture XML files.
 * These tests verify that the full conversion pipeline (including the XML
 * intake analysis) behaves predictably for high-, medium-, and low-confidence
 * files without crashing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { convertMusicXmlToChordPro } from "../musicXMLtochordpro";

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, "fixtures", name), "utf-8");
}

// ─── High-confidence fixture (12-bar blues in Bb, 100% harmony coverage) ─────

describe("high-confidence.xml", () => {
  const xml = loadFixture("high-confidence.xml");
  const expectedFakebook = [
    "Title: High Confidence Blues",
    "Style:",
    "Time: 4/4",
    "Key: Bb",
    "",
    "Bb7 % % %",
    "Eb7 % Bb7 %",
    "F7 Eb7 Bb7 F7",
  ].join("\n");

  it("converts without fatal error", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.error).toBeUndefined();
  });

  it("produces non-empty fake-book output", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.chordPro.length).toBeGreaterThan(0);
    expect(result.chordPro).not.toBe("{title: Untitled}");
  });

  it("reports 12 measures", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.measuresCount).toBe(12);
  });

  it("classifies as HIGH reducibility", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake).toBeDefined();
    expect(result.diagnostics.xmlIntake!.reducibilityClass).toBe("high");
    expect(result.diagnostics.xmlIntake!.reducibilityScore).toBeGreaterThanOrEqual(72);
  });

  it("timingConfidence = 1.0 (divisions + time sig + clean numbering)", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.timingConfidence).toBeCloseTo(1.0, 5);
  });

  it("harmonyConfidence > 0.7 (full coverage)", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.harmonyConfidence).toBeGreaterThan(0.7);
  });

  it("tonalContextConfidence = 1.0 (key + mode + title + composer)", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.tonalContextConfidence).toBeCloseTo(1.0, 5);
  });

  it("xmlIntake.harmoniesCollected = 12", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.harmoniesCollected).toBe(12);
  });

  it("xmlIntake.measuresWithHarmony = 12", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.measuresWithHarmony).toBe(12);
  });

  it("xmlIntake.measuresWithoutHarmony = 0", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.measuresWithoutHarmony).toBe(0);
  });

  it("xmlIntake.titleFound = true", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.titleFound).toBe(true);
  });

  it("xmlIntake.composerFound = true", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.composerFound).toBe(true);
  });

  it("xmlIntake.keyFound = true", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.keyFound).toBe(true);
  });

  it("xmlIntake.modeFound = true", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.modeFound).toBe(true);
  });

  it("enharmonic style auto-resolves to flats (fifths = -2)", () => {
    const result = convertMusicXmlToChordPro(
      { xmlText: xml },
      { formatMode: "fakebook", enharmonicStyle: "auto" },
    );
    expect(result.diagnostics.enharmonicStyleApplied).toBe("flats");
  });

  it("output contains all three blues chords: Bb7, Eb7, F7", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.chordPro).toContain("Bb7");
    expect(result.chordPro).toContain("Eb7");
    expect(result.chordPro).toContain("F7");
  });

  it("output contains % repeat shorthand for consecutive identical bars", () => {
    // Bars 1-4 are all Bb7; bars 2-4 should render as %
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.chordPro).toContain("%");
  });

  it("matches the expected fakebook output exactly", () => {
    const result = convertMusicXmlToChordPro(
      { xmlText: xml },
      { formatMode: "fakebook", barsPerLine: 4 },
    );
    expect(result.chordPro).toBe(expectedFakebook);
  });

  it("fakebookStats.repeat > 0 (consecutive Bb7 / Eb7 runs)", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.fakebookStats!.repeat).toBeGreaterThan(0);
  });
});

// ─── Medium-confidence fixture (8 bars, 50% harmony + direction/words hints) ─

describe("medium-confidence.xml", () => {
  const xml = loadFixture("medium-confidence.xml");
  const expectedFakebook = [
    "Title: Medium Confidence Excerpt",
    "Style:",
    "Time: 4/4",
    "",
    "C % F %",
    "G7 % % C",
  ].join("\n");

  it("converts without fatal error", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.error).toBeUndefined();
  });

  it("produces non-empty output", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.chordPro.length).toBeGreaterThan(0);
  });

  it("reports 8 measures", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.measuresCount).toBe(8);
  });

  it("classifies as MEDIUM reducibility (50% coverage, no key)", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.reducibilityClass).toBe("medium");
    expect(result.diagnostics.xmlIntake!.reducibilityScore).toBeGreaterThanOrEqual(45);
    expect(result.diagnostics.xmlIntake!.reducibilityScore).toBeLessThan(72);
  });

  it("xmlIntake.measuresWithoutHarmony = 4 (direction/words not inferred)", () => {
    // inferFromDirectionWords = false because real <harmony> elements exist.
    // The 2 direction/words measures + 2 bare melody measures = 4 without harmony.
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.measuresWithoutHarmony).toBe(4);
  });

  it("directionWordsFound >= 2 (direction/words chord hints detected)", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.directionWordsFound).toBeGreaterThanOrEqual(2);
  });

  it("inferredHarmoniesCount undefined (direction/words not inferred)", () => {
    // Real harmonies exist, so inference did not run
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.inferredHarmoniesCount).toBeUndefined();
  });

  it("does not infer Am7 / Dm7 from direction/words when real harmony exists", () => {
    const result = convertMusicXmlToChordPro(
      { xmlText: xml },
      { formatMode: "fakebook", barsPerLine: 4 },
    );
    expect(result.chordPro).not.toContain("Am7");
    expect(result.chordPro).not.toContain("Dm7");
  });

  it("matches the expected fakebook output exactly", () => {
    const result = convertMusicXmlToChordPro(
      { xmlText: xml },
      { formatMode: "fakebook", barsPerLine: 4 },
    );
    expect(result.chordPro).toBe(expectedFakebook);
  });

  it("omits key header when key signature is absent", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.chordPro).not.toContain("Key:");
  });

  it("xmlIntake.keyFound = false (no key signature)", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.keyFound).toBe(false);
  });
});

// ─── Low-confidence fixture (pure melody, no harmony, no key, no composer) ───

describe("low-confidence.xml", () => {
  const xml = loadFixture("low-confidence.xml");

  it("converts without fatal error", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.error).toBeUndefined();
  });

  it("reports 8 measures", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.measuresCount).toBe(8);
  });

  it("classifies as LOW reducibility", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake).toBeDefined();
    expect(result.diagnostics.xmlIntake!.reducibilityClass).toBe("low");
    expect(result.diagnostics.xmlIntake!.reducibilityScore).toBeLessThan(45);
  });

  it("xmlIntake.harmoniesCollected = 0", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.harmoniesCollected).toBe(0);
  });

  it("xmlIntake.harmonyConfidence is near zero", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.harmonyConfidence).toBeLessThan(0.2);
  });

  it("xmlIntake.keyFound = false (no key signature)", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.keyFound).toBe(false);
  });

  it("xmlIntake.composerFound = false", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.composerFound).toBe(false);
  });

  it("xmlIntake.timingConfidence > 0 (divisions + time sig present)", () => {
    // File has valid timing structure even though harmony is absent
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.timingConfidence).toBeGreaterThan(0);
  });

  it("low-confidence reasons array is non-empty", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.reasons.length).toBeGreaterThan(0);
  });

  it("emits 'no harmony found' warning", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.warnings.some((w) => w.includes("no harmony"))).toBe(true);
  });
});

// ─── Adaptive strategy selection ─────────────────────────────────────────────

describe("adaptive strategy selection", () => {
  it("high-confidence file selects HIGH strategy (tight thresholds)", () => {
    const xml = loadFixture("high-confidence.xml");
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.reducibilityClass).toBe("high");
    expect(result.error).toBeUndefined();
  });

  it("medium-confidence file selects MEDIUM strategy", () => {
    const xml = loadFixture("medium-confidence.xml");
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.reducibilityClass).toBe("medium");
    expect(result.error).toBeUndefined();
  });

  it("low-confidence file selects LOW strategy", () => {
    const xml = loadFixture("low-confidence.xml");
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.reducibilityClass).toBe("low");
    expect(result.error).toBeUndefined();
  });
});
