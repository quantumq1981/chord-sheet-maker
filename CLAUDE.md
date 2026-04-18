# CLAUDE.md — chord-sheet-maker

Last updated: 2026-04-18

## Project Role

This repo is the **MusicXML normalizer / converter workbench**. It ingests structured notation formats (MusicXML, MXL, ChordPro, Ultimate Guitar, chords-over-words), renders scores in-browser via OpenSheetMusicDisplay (OSMD), and converts notation to ChordPro/CSMPN output. It is the safe place to develop and mature parsing/conversion logic before it feeds the Pro finishing app.

---

## Tech Stack

| Layer | Library / Version |
|---|---|
| Framework | React 18 + Vite + TypeScript 5.6 |
| Score rendering | OpenSheetMusicDisplay (OSMD) v1.8.9 |
| Tab rendering | VexFlow v5.0 |
| PDF export | jsPDF v2.5.2 |
| ZIP handling | JSZip v3.10.1 |
| Backend (optional) | FastAPI + Audiveris CLI |
| Hosting | GitHub Pages (`quantumq1981.github.io/chord-sheet-maker`) |

---

## Directory Map

```
src/
├── main.tsx                     Entry point
├── App.tsx                      All app state, render orchestration, export logic (~2100 lines)
├── styles.css                   UI + print media styles
├── models/
│   └── ChordChartModel.ts       Token/Line/Section/Document data types
├── renderers/
│   ├── ChordChart.tsx           React component for chord chart display + transpose
│   └── VexFlowTabRenderer.tsx   Guitar tab renderer using VexFlow v5 SVG backend
├── converters/
│   ├── musicXMLtochordpro.ts    Core MusicXML→ChordPro engine (~1000 lines)
│   ├── musicXMLtoVexFlow.ts     MusicXML→VexFlow tab data converter
│   ├── transposeMusicXML.ts     Global semitone transposition for MusicXML pitch/key/harmony
│   ├── chordSymbolParser.ts     Free-text chord inference (Finale-style direction/words)
│   ├── xmlIntakeAnalyzer.ts     XML complexity analysis + reducibility scoring
│   └── __tests__/
├── parsers/
│   ├── chordProParser.ts        ChordPro, UG, and chords-over-words parser
│   └── __tests__/
├── ingest/
│   └── sniffFormat.ts           Format detection (MXL, MusicXML, ChordPro, UG, COW)
├── services/
│   └── omrApi.ts                OMR backend API client
├── components/
│   ├── OmrImportPanel.tsx
│   ├── OmrStatusCard.tsx
│   ├── OmrSummaryPanel.tsx
│   └── OmrLogsPanel.tsx
├── types/
│   └── omr.ts
└── utils/
    ├── loadMusicXmlFromString.ts
    └── rehearsalMarkLayout.ts   Rehearsal-mark SVG post-processing (extract labels, reposition between systems)

backend/
├── app/
│   ├── main.py                  FastAPI: sync /process + async job endpoints
│   ├── models.py                Pydantic schemas
│   └── audiveris.py             Audiveris CLI orchestration
└── Dockerfile.worker
```

---

## App Modes

The app has four top-level states (`AppMode`):

- **`empty`** — no file loaded, shows upload drop zone
- **`notation`** — MusicXML/MXL loaded, OSMD renders the score in SVG; full export panel available
- **`chord-chart`** — text chord chart loaded (ChordPro/UG/COW); ChordChart component renders
- **`tablature`** — MusicXML/MXL loaded, VexFlow renders guitar tab; accessible via "Tab View" button from notation mode

---

## Rendering Pipeline

### MusicXML/MXL (notation mode)

1. File dropped/selected → `sniffFormat` detects format
2. If MXL: JSZip unpacks, reads META-INF/container.xml, extracts rootfile
3. MusicXML text → `osmd.load(xmlText)` → `osmd.render()`
4. OSMD renders multiple `<svg>` pages into `containerRef.current`
5. Zoom control adjusts `osmd.Zoom` and re-renders
6. On first load, `fitWidth()` auto-fits score to container width

### Chord chart (text mode)

1. `sniffFormat` → `parseChordChart` → `ChordChartDocument`
2. `ChordChart` React component renders token pairs (chord + lyric)
3. Transpose applied in-place via `transposeChord()` with `EnharmonicPreference`

### Post-render: rehearsal mark repositioning

After every `osmd.render()`, `repositionRehearsalMarksBetweenSystems()` runs:

1. `extractRehearsalMarkTexts(xmlText)` parses the MusicXML to collect all `<rehearsal>` label strings
2. For each matching `<text>` element in the SVG, `getBBox()` gives its current Y center
3. `getSystemBands(osmd)` reads `osmd.GraphicSheet.MusicPages[].MusicSystems[].PositionAndShape` (×10 to convert OSMD units → SVG coordinate space) to get the top/bottom pixel extent of each rendered system
4. The mark's Y center is matched to a system band; if it belongs to system N (N>0), its target is the vertical center of the gap between system N−1 bottom and system N top
5. `dy` is applied by directly modifying the `y` attribute on the `<text>` element and searching backward through siblings (up to 4 steps) for the associated `<rect>` (the box outline)

**Critical implementation detail — OSMD/VexFlow SVG structure**: OSMD uses its own bundled VexFlow 1.2.93 (not the top-level `node_modules/vexflow` v5.0). VexFlow 1.2.93's `StaveSection.draw()` emits three flat sibling elements with no wrapper `<g>`:
- `<rect>` — the box outline (from `ctx.rect()`)
- `<path d="">` — empty artefact from `ctx.stroke()` after `ctx.beginPath()` with no path commands
- `<text>` — the label (from `ctx.fillText()`)

Do **not** try to find a `<g>` ancestor wrapping the rehearsal mark — none exists at that granularity. Walking up to find any `<g>` with a `<rect>` child will match a large system/measure container and incorrectly transform all its contents.

---

## Export Pipeline

### PDF Export (`exportPdf`)

Strategy: OSMD SVG → Canvas (1.5× scale) → JPEG → jsPDF

1. **Apply print profile**: `osmd.setPageFormat('Letter_P' | 'A4_P')`
   - ⚠️ Do NOT manually override `PageWidth`/`PageHeight`/margins after this call.
     OSMD's internal units are not inches or mm; setting them to inch values (8.5, 11)
     makes pages ~20× too narrow and produces dozens of near-empty pages.
2. Set `osmd.Zoom = 1.0` and call `osmd.render()`
3. For each SVG page: `svgToCanvas(svg, 1.5)` → JPEG → `pdf.addImage()`
4. Restore display mode: `osmd.setPageFormat('Endless')` + restore original zoom + re-render
5. Output: blob URL shown in UI; user taps "Open PDF"

**Output**: rasterized JPEG pages (not vector — see NOTES.md for rationale)

### Print Dialog (`printScore`)

1. Same `applyPrintProfile` + `osmd.render()` as PDF
2. `window.print()` — browser native print dialog
3. CSS `@media print` hides UI, sets `break-after: page` between OSMD SVGs
4. Restore via `afterprint` event (+ 1s fallback timeout)

### Guitar Tablature (`tablature` mode)

File: `src/converters/musicXMLtoVexFlow.ts` + `src/renderers/VexFlowTabRenderer.tsx`

1. "Tab View" button appears in top bar when MusicXML is loaded in notation mode
2. `musicXMLToVexTabScore(xmlText, tuning, partIndex)` converts MusicXML to `VexTabScore`
   - Parses notes, pitches, durations, harmonies, repeat markers
   - Maps MIDI pitches to string/fret positions using tuning array (lowest-fret heuristic)
   - Out-of-range notes shown as muted (×) with a warning
3. `VexFlowTabRenderer` renders the `VexTabScore` via VexFlow SVG backend
   - ResizeObserver auto-fits to container width
   - Measures laid out in rows (configurable measures-per-row)
   - Chord symbols shown above notes via VexFlow Annotation modifiers
   - Repeat barlines rendered via VexFlow BarlineType.REPEAT_BEGIN/END
4. Tab-specific exports: SVG, PNG (2× raster), PDF (jsPDF raster pipeline)
5. Settings panel: tuning presets + custom strings, font size, measures/row, part selector

**Tuning presets**: Standard EADGBe, Drop D, Open G, Open D, Open E, DADGAD, Half Step Down, Bass EADG

**Pitch→fret algorithm**: sort notes by pitch descending; for each note pick the string with the
lowest valid fret (0–22) not already occupied by another note in the chord group.

### SVG Export (`exportSvg`)

- All OSMD SVG pages stitched into one tall SVG via `stitchSvgsToSingle()`
- Inner content of each page SVG wrapped in `<g transform="translate(0,y)">` groups
- Downloaded as single `.svg` file

### PNG Export (`exportPng`)

- All OSMD SVG pages converted to canvases (2× scale) via `stitchCanvases()`
- Canvases stacked vertically into one composite canvas
- Downloaded as single `.png` file (iOS: opens in new tab)

---

## Transpose & Enharmonic Preference

All transpose paths share `EnharmonicPreference = 'auto' | 'flats' | 'sharps'`, controlled by a `<select>` in the transpose bar UI.

### Golden-rule auto mode
- Bb, Eb, Ab → always flat
- F# preferred over Gb
- At semitone 1 (the Db/C# toss-up): Db for major chord roots, C# for minor/diminished roots

### Files
| File | Role |
|---|---|
| `src/converters/transposeMusicXML.ts` | Transposes MusicXML pitch nodes, key signatures, harmony roots/bass. Three lookup tables: `SEMITONE_MAP_SHARPS`, `SEMITONE_MAP_FLATS`, `SEMITONE_MAP_AUTO`. Reads `<kind>` to determine minor context for auto mode. |
| `src/renderers/ChordChart.tsx` | Exports `transposeChord(chord, steps, pref)` and `EnharmonicPreference`. Detects minor context from chord suffix regex `/^m(?!a)/i` or `/^dim/i`. |
| `src/App.tsx` | `transposeEnharmonic` state wired to select; passed to both `transposeMusicXML` and `transposeChord`. |

### State (`App.tsx`)
```
transposeEnharmonic: EnharmonicPreference  — 'auto' | 'flats' | 'sharps', default 'auto'
```

---

## MusicXML → ChordPro Conversion Engine

File: `src/converters/musicXMLtochordpro.ts`

### Key stages

1. Parse XML → DOM → detect partwise/timewise (convert timewise if needed)
2. Extract metadata: title, composer, key, time signature, tempo
3. `buildMeasureData`: collect harmony events + lyric events per measure
4. Harmony extraction priority:
   - Primary: `<harmony><root>` + `<kind>` + `<bass>` elements
   - Fallback: `<direction><words>` → `chordSymbolParser` (Finale-style)
5. Enharmonic normalization (auto/flats/sharps) based on key signature
6. Output rendering by format mode:
   - **`lyrics-inline`**: `[Chord]lyric` pairs (default when lyrics present)
   - **`grid-only`**: pipe-separated bar grid (default when no lyrics)
   - **`fakebook`**: compact chord-per-measure with duration weighting

### Format auto-detection

`auto` → if has lyrics → `lyrics-inline`, else → `grid-only`

### Jazz symbols (opt-in)

maj7→Δ7, m7b5→ø7, dim7→°7, dim→°

---

## Text Chart Parsing

File: `src/parsers/chordProParser.ts`

Supports three dialects, all normalize to `ChordChartDocument`:

| Format | Detection |
|---|---|
| ChordPro | `{title:}` / `{start_of_verse}` / `[Chord]lyric` |
| Ultimate Guitar | `[Verse 1]` / `[Chorus]` section headers |
| Chords-over-words | Chord-only line immediately above lyric line (≥70% chord tokens) |

---

## Format Detection (`sniffFormat.ts`)

Order (first match wins):
1. ZIP magic bytes → `mxl`
2. XML prolog + `score-partwise`/`timewise` root → `musicxml`
3. ChordPro directives regex → `chordpro`
4. UG section headers → `ultimateguitar`
5. Inline bracket chords → `chordpro`
6. COW heuristic (≥70% chord tokens) → `chords-over-words`
7. Extension fallback (.cho, .pro, .crd) → `chordpro`
8. Default → `unknown`

---

## OMR Integration (Optional Backend)

Frontend: `OmrImportPanel` + `src/services/omrApi.ts`
Backend: FastAPI at `backend/app/main.py` + Audiveris CLI

### Flow

1. User uploads PDF/PNG/JPG
2. Mode selection:
   - **Quick (sync)**: `POST /process` → inline MusicXML
   - **Background (async)**: `POST /api/omr/jobs` → poll until complete
3. Polling: fast (2s) → slow (4.5s) after 30s
4. On success: fetch MusicXML result → load through same OSMD pipeline

---

## Key Architectural Constraints

- **Client-side only** for all notation features (GitHub Pages, no server required)
- **OSMD page format**: always use `setPageFormat(id)` for page mode; never override `PageWidth`/`PageHeight` with physical units (see export pipeline notes above)
- **Restore display mode** after any print/export: call `setPageFormat('Endless')` to return to continuous scroll
- **Rasterized PDF** (not vector) — intentional for reliability. See NOTES.md for the vector PDF upgrade path.
- **No repeat expansion** in ChordPro output (simple unroll MVP only)
- **Timewise→Partwise conversion** happens in-memory; flagged in diagnostics

---

## State Architecture (`App.tsx`)

```
AppMode: 'empty' | 'notation' | 'chord-chart' | 'tablature'

Notation state:
  loadedXmlText, loadedFilename, isMxl, zoom, pdfPageSize
  chordProText, chordProWarnings, chordProDiagnostics
  csmpnFakeBookText, csmpnWarnings
  renderedPageCount, renderError, xmlLoadedRef, didAutoFitRef
  osmdRef (OSMD instance), containerRef (DOM div)

Chart state:
  chartDocument, transposeSemitones, detectedFormatLabel, chartChordProText

Global transpose:
  transposeSemitones              — shared by notation + chord-chart render/export paths
  transposeEnharmonic             — 'auto' | 'flats' | 'sharps'; controls accidental spelling
  pristineXmlText                 — unmodified MusicXML source used as transpose base
  loadedXmlText                   — current transposed MusicXML fed to OSMD/export/tab converters

Tablature state:
  tabScoreData (VexTabScore | null)  — computed by useMemo from loadedXmlText+tuning+partIndex
  tabTuning (string[])               — open-string note names high→low, e.g. ['E4','B3','G3','D3','A2','E2']
  tabTuningPreset (string)           — name of the active preset or 'Custom'
  tabFontSize (number)               — px, controls VexFlow font size
  tabMeasuresPerRow (number)         — how many measures to lay out per system row
  tabPartIndex (number)              — index into score.parts for multi-part files
  tabRenderError (string)            — last VexFlow render error, cleared on success

OMR state:
  omrFile, omrJobId, omrJobStatus, omrSummary, omrPollingTimerRef

UI state:
  zoom, pdfPageSize, pdfBlobUrl, pdfFilename, exportFeedback
  chordProUi (barsPerLine, mode, chordBracketStyle, repeatStrategy,
              enharmonicStyle, jazzSymbols)
```

---

## Running / Building

```bash
npm install
npm run dev          # Vite dev server
npm run build        # tsc -b && vite build
npm test             # vitest run
npm run test:watch   # vitest watch
npm run test:coverage
```

---

## Testing

Test files live in `src/**/__tests__/`:

| File | Covers |
|---|---|
| `chordProParser.test.ts` | ChordPro/UG/COW parsing |
| `musicXMLtochordpro.test.ts` | Converter regression |
| `realFileRegression.test.ts` | Real MusicXML files (Confirmation.xml, etc.) |
| `xmlIntakeAnalyzer.test.ts` | Complexity analysis |
| `chordSymbolParser.test.ts` | Chord symbol inference |
| `transposeMusicXML.test.ts` | MusicXML transposition: pitch nodes, key signatures, harmony roots/bass, all three enharmonic modes, auto minor/major context |

---

## Strategic Role & Roadmap

### This repo is for

- MusicXML / MXL parsing and normalization
- Converter / parser experimentation
- Diagnostics and quality analysis
- Prototyping unified text parsing before feeding Pro

### chord-sheet-maker-pro handles

- Final fake-book presentation and layout
- Power Mode adjustments
- Gig-ready print/PDF/PNG polish

### High-value future work

1. **Vector PDF export** — see NOTES.md for the upgrade path (pdfkit + svg-to-pdfkit)
2. **Unified semi-structured text parser** — handle UG text, chord-over-lyrics, chord dumps, plain web text, PDF-extracted text. Classify line roles, infer measure grouping, emit normalized output.
3. **Repeat expansion** in ChordPro output (currently MVP "simple unroll")
4. **Per-part / instrument filtering** for multi-part scores
5. **Timewise→Partwise** — make this transparent in diagnostics, not just flagged

### Guardrails

- Keep converter responsibilities clear; avoid duplicating Pro's presentation layer
- Favor reusable parser components over ad hoc per-format logic
- Build normalization primitives that can be shared with Pro
- Mobile-first validation: success must be visible in exports, not just test output

---

## Known Issues / Limitations (as of 2026-04-18)

| Issue | Status |
|---|---|
| PDF is rasterized (no vector text) | Intentional — see NOTES.md |
| Print dialog formatting relies on correct OSMD page format | Fixed 2026-04-17 |
| SVG/PNG previously only exported first page | Fixed 2026-04-17 (all-page stitch) |
| VexFlow tab added for guitar tablature | Added 2026-04-17 |
| Tab dotted notes render as undotted duration | Known MVP limitation |
| Tab only renders first selected part | By design (part selector in UI) |
| No repeat expansion in ChordPro | MVP — future work |
| Timewise MusicXML requires in-memory conversion | Logged in diagnostics |
| OMR requires optional backend (not on GitHub Pages) | By design |
| Enharmonic preference UI added to transpose bar | Added 2026-04-18 |
| Rehearsal marks overlapping chord symbols | Fixed 2026-04-18 (SVG post-processing) |
| Rehearsal mark repositioning not applied on PDF/print export re-render | Known limitation — only display render is post-processed |
| First-system rehearsal marks not repositioned (no gap above) | By design — only inter-system gaps are centred |
