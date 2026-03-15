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

  it("contains chord tokens in output (Bb7, Eb7, F7)", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    // At least one of the blues chords should appear
    const hasBluseChords =
      result.chordPro.includes("Bb7") ||
      result.chordPro.includes("Eb7") ||
      result.chordPro.includes("F7");
    expect(hasBluseChords).toBe(true);
  });

  it("xmlIntake.harmoniesCollected = 12", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.harmoniesCollected).toBe(12);
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
});

// ─── Medium-confidence fixture (8 bars, ~62% harmony coverage) ───────────────

describe("medium-confidence.xml", () => {
  const xml = loadFixture("medium-confidence.xml");

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

  it("xmlIntake.measuresWithoutHarmony = 4", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.measuresWithoutHarmony).toBe(4);
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

  it("xmlIntake.keyFound = false (no key signature)", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.keyFound).toBe(false);
  });

  it("xmlIntake.composerFound = false", () => {
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.composerFound).toBe(false);
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
  it("high-confidence file uses tight minHarmonyWeight (0.15) implicitly", () => {
    // Verify the strategy is reflected through the output — we can at least
    // confirm the reduction runs and the diagnostics store the class.
    const xml = loadFixture("high-confidence.xml");
    const result = convertMusicXmlToChordPro({ xmlText: xml }, { formatMode: "fakebook" });
    expect(result.diagnostics.xmlIntake!.reducibilityClass).toBe("high");
    // No crash or error is the core assertion; strategy internals are tested in
    // xmlIntakeAnalyzer.test.ts.
    expect(result.error).toBeUndefined();
  });
});
