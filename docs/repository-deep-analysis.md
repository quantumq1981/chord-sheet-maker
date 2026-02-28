# Chord Sheet Maker Deep Repository + Ecosystem Analysis

## 1) Current application architecture (as implemented)

### Stack
- **Vite + React + TypeScript** front-end application.
- Primary rendering engine: **OpenSheetMusicDisplay (OSMD)**.
- Conversion utility: custom `musicXMLtochordpro.ts` pipeline.
- Export utilities include XML, diagnostics JSON, SVG, PNG, and PDF.

### Core source layout
- `src/App.tsx`: upload, render orchestration, converter controls, and export UX.
- `src/converters/musicXMLtochordpro.ts`: MXL extraction + MusicXML→ChordPro conversion.
- `README.md`: user-facing support matrix and export behavior.

## 2) Format-support reality check (current state vs target ecosystem)

### A. Music-notation XML family

#### Currently implemented
- ✅ MusicXML text (`.xml`, `.musicxml`) ingestion.
- ✅ Compressed MusicXML (`.mxl`) ingestion by:
  1. ZIP load,
  2. read `META-INF/container.xml`,
  3. resolve `rootfile full-path`,
  4. load score XML.

#### Not implemented yet (from target ecosystem)
- ⚠️ MuseScore native (`.mscx`, `.mscz`) parsing.
- ⚠️ OpenSong XML ingestion pathway.
- ⚠️ OpenLyrics ingestion pathway.

**Assessment:** The current design already aligns with the recommended hub model (MusicXML/MXL as canonical ingest). This is a good strategic baseline.

### B. ChordPro / chord-chart dialects

#### Currently implemented
- ✅ MusicXML-derived ChordPro generation with options for:
  - lyrics-inline vs grid-only,
  - bars-per-line wrapping,
  - bracket style,
  - simple repeat unroll,
  - optional metadata/key/time directives.

#### Missing from target ecosystem
- ⚠️ Direct import parser stack for real-world text dialects:
  - canonical ChordPro,
  - bracket-only ChordPro-lite,
  - UG text format,
  - ASCII chords-over-lyrics,
  - OnSong-text variants,
  - SongBook aliases,
  - OpenSong plain-text export variants.

**Assessment:** Current pipeline is strong for **MusicXML → ChordPro export**, but not yet a general **multi-dialect text ingestion** system.

## 3) Converter quality analysis (`musicXMLtochordpro.ts`)

### Strengths
- Well-factored option model (`ConvertOptions`) with sensible defaults.
- Useful diagnostics payload (`ConverterDiagnostics`) for debug/export provenance.
- Reasonable harmony extraction across parts with deduping by offset/chord text.
- Auto format mode fallback (`lyrics-inline` when lyrics exist, otherwise `grid-only`).
- Repeat-awareness and warnings for unexpanded repeats/endings.

### Technical risks / edge cases
1. **Lyrics-part selection heuristic** uses max lyric count only.
   - Risk: wrong part if sparse lead vocal vs dense backing lyric data.
2. **Harmony offset interpretation** assumes offset in current divisions context.
   - Some files with unusual duration/offset semantics may quantize poorly.
3. **Grid quantization collisions** are only warned, not resolved.
   - Dense harmonic rhythm can lose chord changes in low slot counts.
4. **Repeat handling is MVP-level** (`simple-unroll` single region).
   - Complex roadmap needed for endings, D.C./D.S., codas, nested structures.
5. **Chord kind mapping** is broad but not exhaustive.
   - Non-standard `kind` values can leak through directly as suffix text.

## 4) Alignment to the provided ecosystem reference

### What already matches your reference
- MusicXML/MXL focus is exactly right.
- ZIP-container based MXL parsing is in place.
- Hub-and-spoke philosophy is compatible with current architecture.
- ChordPro export includes key directives and structural controls that can become normalization anchors.

### What should be added to fully match your reference
1. **Introduce ChordSheetJS-based import normalization layer**
   - Detect directives / bracket chords / ASCII patterns.
   - Parse to normalized chord-chart AST.
   - Re-export to preferred ChordPro dialect presets.
2. **Add ingest adapters for OpenSong/OpenLyrics XML**
   - Convert to internal normalized model (and optionally to MusicXML where practical).
3. **Define two explicit internal models**
   - `ScoreGraph` for notation-first workflows.
   - `ChordChartModel` for text chart workflows.
4. **Strengthen format sniffing**
   - Magic bytes + XML root detection + directive heuristics.

## 5) Suggested near-term implementation plan (pragmatic)

### Phase 1 (highest ROI)
- Add `docs/format-support-matrix.md` and codify canonical support tiers.
- Add format sniffer utility (`src/ingest/sniffFormat.ts`) for:
  - ZIP/MXL,
  - XML roots,
  - ChordPro directives,
  - bracket-only patterns,
  - chords-over-lyrics line pairs.
- Integrate ChordSheetJS for text imports only (no rendering change yet).

### Phase 2
- Introduce normalized `ChordChartModel` and conversion adapters:
  - ChordPro classic
  - UG text
  - ASCII over-lyrics
  - OnSong header/body variants
- Add round-trip preservation (`sourceOriginal` + `normalized`).

### Phase 3
- Add OpenSong/OpenLyrics XML adapter transforms.
- Expand repeat engine beyond simple unroll.
- Add optional dialect-specific export profiles.

## 6) Testing strategy gaps

### Current gap
- No automated test suite in repository for converter regressions.

### Recommended tests
- Golden-file fixtures for MusicXML→ChordPro output.
- MXL container traversal tests.
- Property-ish tests for quantization behavior with varying time signatures.
- Snapshot tests for diagnostics object schema stability.

## 7) Setlist/CSV context integration note

Given your custom environment objective around setlists/CSV integration, this repository currently has **no setlist CSV import/export module**. The best integration point would be:
- new `src/setlist/` module with CSV parser/serializer,
- mapping between setlist rows and score/chart assets,
- UI-side validation for malformed CSV columns.

This can remain decoupled from the MusicXML/ChordPro converter while sharing a common normalized metadata schema (`title`, `key`, `tempo`, `duration`, `fileRef`).

## 8) Executive conclusion

The project is already a strong Vite/React baseline for **MusicXML/MXL rendering + MusicXML→ChordPro conversion**. To fully realize the ecosystem target you provided, the next major capability should be **multi-dialect ChordPro/text ingestion with normalization**, followed by **OpenSong/OpenLyrics adapters** and richer repeat semantics.

