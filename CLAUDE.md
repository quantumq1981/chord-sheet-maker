# CLAUDE.md — chord-sheet-maker

Last updated: 2026-05-01

## Project Role

This repo is the **MusicXML normalizer / converter workbench**. It ingests structured notation formats (MusicXML, MXL, Guitar Pro GP3/GP4/GP5/GPX, ChordPro, Ultimate Guitar, chords-over-words), renders scores in-browser via OpenSheetMusicDisplay (OSMD) and AlphaTab, and converts notation to ChordPro/CSMPN output. It is the safe place to develop and mature parsing/conversion logic before it feeds the Pro finishing app.

---

## Tech Stack

| Layer | Library / Version |
|---|---|
| Framework | React 18 + Vite + TypeScript 5.6 |
| Score rendering | OpenSheetMusicDisplay (OSMD) v1.8.9 |
| Alternate notation/tab rendering | AlphaTab (`@coderline/alphatab`) |
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
│   ├── VexFlowTabRenderer.tsx   Guitar tab renderer using VexFlow v5 SVG backend
│   └── AlphaTabRenderer.tsx     AlphaTab renderer for notation + tablature
├── converters/
│   ├── musicXMLtochordpro.ts    Core MusicXML→ChordPro engine (~1000 lines)
│   ├── musicXMLtoVexFlow.ts     MusicXML→VexFlow tab data converter
│   ├── transposeMusicXML.ts     Global semitone transposition for MusicXML pitch/key/harmony
│   ├── chordSymbolParser.ts     Free-text chord inference (Finale-style direction/words)
│   ├── xmlIntakeAnalyzer.ts     XML complexity analysis + reducibility scoring
│   ├── guitarProConverter.ts    Guitar Pro → ChordPro + note position extraction from AlphaTab Score model
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
│   ├── OmrLogsPanel.tsx
│   └── AlphaTabControls.tsx
├── types/
│   ├── omr.ts
│   └── alphatab.ts
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

The app has five top-level states (`AppMode`):

- **`empty`** — no file loaded, shows upload drop zone
- **`notation`** — MusicXML/MXL loaded, OSMD renders the score in SVG; full export panel available
- **`chord-chart`** — text chord chart loaded (ChordPro/UG/COW); ChordChart component renders
- **`tablature`** — MusicXML/MXL loaded, VexFlow renders guitar tab; accessible via "Tab View" button from notation mode
- **`alphatab`** — MusicXML/MXL **or Guitar Pro (.gp3/.gp4/.gp5/.gpx)** loaded; AlphaTab renders notation + tablature with page/horizontal layout options and dedicated exports. Guitar Pro files go directly to this mode.

### Guitar Pro sub-state (within `alphatab` mode)
When a GP file is loaded, `gpFileBuffer: ArrayBuffer` is set and controls how `AlphaTabRenderer` is invoked:
- Raw `Uint8Array` bytes are passed directly to `ScoreLoader.loadScoreFromBytes()` (AlphaTab auto-detects format)
- `onScoreLoaded(score)` fires synchronously after parsing, before rendering
- Track names are extracted via `gpScoreTrackNames(score)` and populate the track selector
- ChordPro text is extracted via `gpScoreToChordPro(score, trackIndex)` from beat.text / beat.chordId annotations
- Note positions (string, fret pairs) are extracted via `gpScoreNotePositions(score, trackIndex)` for the fretboard panel
- Notation/Tab View mode switches are hidden (only AlphaTab renders GP files)

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

After every `osmd.render()` — including display renders, export renders, and restore renders — `repositionRehearsalMarksBetweenSystems()` runs:

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
2. **Guitar Pro binary magic**: byte[0] = Pascal string length (5–35), bytes[1..len] starts with `"FICHIER GUITAR PRO v"` → `guitarpro` with `version` field (e.g. `"3.00"`, `"4.06"`). Falls through to extension check (`.gp`, `.gp3`, `.gp4`, `.gp5`, `.gpx`, `.gp6`, `.gp7`) for GPX/GP6/GP7 which have a different container.
3. XML prolog + `score-partwise`/`timewise` root → `musicxml`
4. ChordPro directives regex → `chordpro`
5. UG section headers → `ultimateguitar`
6. Inline bracket chords → `chordpro`
7. COW heuristic (≥70% chord tokens) → `chords-over-words`
8. Extension fallback (.cho, .pro, .crd) → `chordpro`
9. Default → `unknown`

### Guitar Pro pipeline
`loadFile()` calls `isGuitarProFormat(detected)` → stores raw `ArrayBuffer` in `gpFileBuffer` state → switches to `alphatab` mode. `AlphaTabRenderer` receives `fileBytes: Uint8Array` (no `xmlText`). `ScoreLoader.loadScoreFromBytes()` auto-detects GP3/4/5/X format from the bytes. The `onScoreLoaded` callback fires after parsing, extracts track names, ChordPro text, and note positions via `guitarProConverter.ts`.

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

AlphaTab / Guitar Pro state:
  alphaTabSettings (AlphaTabUiSettings)     — display settings for stave/layout/scale
  alphaTabRenderError (string)              — last AlphaTab render error
  alphaTabNotePositions (NotePositionMap[]) — fretboard positions (from XML heuristic OR GP exact)
  gpFileBuffer (ArrayBuffer | null)         — raw GP file bytes; non-null = GP file is loaded
  gpVersion (string)                        — GP version string, e.g. "4.06" or "3.00"
  gpTracks (string[])                       — track names extracted from AlphaTab Score model
  gpChordProText (string)                   — ChordPro extracted from GP beat text/chord diagrams
  gpChordProWarnings (string[])             — conversion warnings

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
| Rehearsal mark repositioning not applied on PDF/print export re-render | Fixed 2026-04-19 — repositioning now applied after every export/print render and after restore render |
| First-system rehearsal marks not repositioned (no gap above) | By design — only inter-system gaps are centred |
| Guitar Pro GP3/GP4/GP5/GPX support added | Added 2026-05-01 — AlphaTab renders notation+tab; ChordPro extracted from beat annotations; exact string/fret positions shown in fretboard panel |
| GP ChordPro extraction depends on beat.text / chord diagrams | GP3/4 often store chord names as beat text annotations; GP5/X may use diagram data instead — extraction quality varies by file |
| GP transpose not yet wired | GP files are rendered verbatim; the transpose bar has no effect on GP scores (AlphaTab handles transposition internally) |
| **GP files stuck at "Rendering score…" — never display** | **OPEN as of 2026-05-02 — see full investigation below** |

---

## AlphaTab / Guitar Pro Rendering — Open Investigation (2026-05-02)

### Symptom
MusicXML files render correctly in AlphaTab mode. GP3/GP4 files are stuck indefinitely at "Rendering score…" — `renderFinished` never fires, no error banner appears.

### Architecture summary
`AlphaTabRenderer.tsx` uses the AlphaTab web worker for off-thread rendering:
- `s.core.scriptFile = ${baseUrl}alphaTab.worker.min.mjs` (pre-built worker in `public/`)
- `public/alphaTab.worker.min.mjs` imports `./alphaTab.core.mjs` (copied from `dist/alphaTab.core.min.mjs` by Vite buildStart hook)
- On load: `ScoreLoader.loadScoreFromBytes(bytes, settings)` runs on the **main thread** to extract metadata (track names, hasTabData fallback), then `api.load(bytes, tracks)` sends a copy of the data to the worker thread for actual rendering

### Bugs found and fixed (all merged to main)

| PR | Bug | Root cause |
|---|---|---|
| #158 | `useWorkers=false` blocked main thread | Every re-render froze iOS; disabled workers because auto-detection via `import.meta.url` pointed to Vite chunk (wrong URL). Fixed by setting `s.core.scriptFile` explicitly. |
| #161 | `renderScore(preParsedScore)` silently fails in worker mode | Serialising a full AlphaTab `Score` object across the worker boundary is unreliable. Switched to `api.load(bytes)` which sends raw bytes (cleanly transferable). |
| #162 | `new Uint8Array(gpFileBuffer)` recreated on every App render | `fileBytes` prop changed reference on every render → `loadData` effect re-fired → cancelled the in-progress worker render in an infinite loop. Fixed with `useMemo([gpFileBuffer])`. |
| #165 | `onError` inline arrow recreated on every App render | Same loop — `onError` was in `loadData`'s dep array. Fixed by ref-forwarding `onError` and `onApiReady` (same pattern already used for `onScoreLoaded`). `loadData` dep array is now `[]`. |

### Current code path (post-fixes)
```
App.tsx renders:
  <AlphaTabRenderer
    fileBytes={gpFileBytes}               // useMemo — stable
    onScoreLoaded={handleGpScoreLoaded}   // useCallback — stable
    onError={setAlphaTabRenderError}      // React setter — stable
    uiSettings={alphaTabSettings}
  />

AlphaTabRenderer.loadData():
  bytes = fileBytes (Uint8Array)
  score = ScoreLoader.loadScoreFromBytes(bytes, api.settings)  // main thread, for metadata
  onScoreLoadedRef.current?.(score)          // extracts track names, ChordPro, positions
  api.load(bytes.buffer.slice(...), tracks)  // ArrayBuffer copy → worker
```

### Remaining hypotheses (in priority order)

1. **Worker silently rejects the data** — `api.load()` returns `boolean`. If it returns `false`, the worker never starts. This could happen if AlphaTab's `load()` doesn't recognise a `Uint8Array` / `ArrayBuffer` in this version. **Check**: open DevTools Console → look for `[AlphaTab][load] false` log line added in `AlphaTabRenderer.tsx`.

2. **Worker parses but `scoreLoaded` / `renderFinished` never fires** — If the worker receives the bytes but fails internally (parse error, assertion, OOM), it might not fire the error event either. **Check**: look for `[AlphaTab][scoreLoaded]` log in DevTools Console. If it never appears, the worker isn't parsing.

3. **Worker file fails to load** — Network error loading `alphaTab.worker.min.mjs` or `alphaTab.core.mjs`. **Check**: DevTools → Network tab → filter `alphaTab` — both files should return HTTP 200. If 404, the `public/` deployment is broken.

4. **AlphaTab error event not wired correctly** — The error handler uses a type assertion to access `api.error`. If AlphaTab v1.8.2 changed the error event structure, errors fire silently. **Check**: add `console.error` directly inside the `.error.on()` handler.

5. **`ArrayBuffer` transferred then reused** — `api.load()` may TRANSFER `bytes.buffer` to the worker (detaching it). If any subsequent re-render passes the same (now-empty) buffer, it would fail. Current code passes `bytes.buffer.slice(...)` (a copy) to avoid this, but verify by checking `bytes.byteLength` after the `api.load()` call.

6. **GP format not supported in `alphaTab.core.min.mjs`** — The worker uses the 1.1 MB minified core. If GP3/GP4 importers were stripped, only MusicXML would work. **Check**: search `alphaTab.core.min.mjs` for `"FICHIER GUITAR PRO"` (the GP file signature). If absent, the importer is missing.

### How to debug in the browser (DevTools)

1. Open `https://quantumq1981.github.io/chord-sheet-maker/`
2. Open DevTools → **Console** tab
3. Load a GP file (e.g. `steely-dan-kid_charlemegne.gp3`)
4. Look for these log lines (added to `AlphaTabRenderer.tsx`):
   - `[AlphaTab] loadData called` — confirms `loadData` ran once (not in a loop)
   - `[AlphaTab] ScoreLoader parsed ok, tracks: N` — main-thread parse worked
   - `[AlphaTab] api.load() returned: true/false` — if `false`, worker rejected the data
   - `[AlphaTab] scoreLoaded (worker)` — if this never appears, worker isn't parsing
   - `[AlphaTab] renderFinished` — if this never appears but scoreLoaded did, rendering hangs
5. Open **Network** tab → filter by "alphaTab" → verify both `alphaTab.worker.min.mjs` and `alphaTab.core.mjs` return HTTP 200

### Test GP files (in `public/`)
All 12 files below parse successfully on the main thread via `ScoreLoader`:

| File | Format | Tracks |
|---|---|---|
| `carlton-larry-emotions_wound_us_so.gp4` | GP4 | 2 (Lead, rhythm) |
| `carlton-larry-her_favorite_song.gp4` | GP4 | 1 |
| `ford-robben-he_don_t_play_nothin_but_the_blues.gp3` | GP3 | 1 |
| `gaye-marvin-i_heard_it_through_the_grapevine.gp4` | GP4 | 5 (organ, guitar, bass, percussion) |
| `huey-lewis-and-the-news-i_want_a_new_drug.gp4` | GP4 | 8 |
| `huey-lewis-and-the-news-if_this_is_it.gp4` | GP4 | 9 |
| `parker-charlie-parker_s_mood.gp4` | GP4 | 3 |
| `steely-dan-hey_nineteen.gp3` | GP3 | 8 |
| `steely-dan-kid_charlemegne.gp3` | GP3 | 6 |
| `the-allman-brothers-band-blue_sky.gp3` | GP3 | 4 |
| `the-allman-brothers-band-in_memory_of_elizabeth_reed.gp3` | GP3 | 3 |
| `the-doobie-brothers-takin_it_to_the_streets.gp4` | GP4 | 12 |

### Key files
- `src/renderers/AlphaTabRenderer.tsx` — all AlphaTab rendering logic
- `src/App.tsx:735-749` — GP state + `gpFileBytes` useMemo
- `src/App.tsx:1747-1756` — `handleGpScoreLoaded` (extracts track names / ChordPro / note positions)
- `src/App.tsx:1970-1979` — AlphaTabRenderer JSX props
- `vite.config.ts` — `copy-alphatab-core` plugin (copies core.min.mjs → public/alphaTab.core.mjs at build time)
- `public/alphaTab.worker.min.mjs` — worker entry point (1.6 KB, imports alphaTab.core.mjs)
