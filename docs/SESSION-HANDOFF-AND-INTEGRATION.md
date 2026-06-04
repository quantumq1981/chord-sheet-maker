# Session Handoff & Two‑App Integration Brief

**Repo:** `quantumq1981/chord-sheet-maker` (this app)
**Companion:** `quantumq1981/chord-sheet-maker-pro` (the "Pro" presentation app)
**Written:** end of the audit/refactor session, for a follow‑up **double‑repo session** that has *both* repos in scope.
**Purpose:** (1) capture everything done to this app in this session, and (2) record the two‑app integration analysis and the agreed plan, so the next session can execute the merge/handoff work with full context.

> Next session: read this top‑to‑bottom, then reconcile it against the **latest `CLAUDE.md` in `chord-sheet-maker-pro`** (the user will bring it in). This brief is the chord‑sheet‑maker side of the picture; Pro's CLAUDE.md is the other half.

---

## Part A — State of `chord-sheet-maker` after this session

Started from the performance/architecture audit in `docs/PERFORMANCE_AUDIT.md` (PR #215) and executed it. **10 PRs merged.** All green at each step: `tsc -b` clean, `vite build` clean.

| Area | PR(s) | Result |
|---|---|---|
| Audit (document) | #215 | `docs/PERFORMANCE_AUDIT.md` |
| Perf: transpose cache + debounce, rehearsal‑mark reflow batching, GP `O(beats²)→O(beats)` | #216 | 3 real bottlenecks fixed |
| Perf: parallelize OSMD PDF page rasterization (`Promise.all`) | #217 | faster multi‑page PDF |
| Extract pure SVG/canvas/PDF helpers → `src/utils/svgRaster.ts` | #218 | App.tsx −180 lines |
| Extract OSMD lifecycle → `src/hooks/useOsmd.ts` | #220 | render effect + zoom isolated |
| Extract transpose state+pipeline → `src/hooks/useTranspose.ts` | #222 | debounced transpose isolated |
| Extract shared PDF page‑assembly → `src/services/exportService.ts` (`fitContain`, `canvasesToPdfBlob`) | #223 | de‑duped 3 PDF paths |
| Tests for `useTranspose` + `svgRaster` | #224 | locked in extracted behavior |
| Opt‑in **Vector PDF (beta)** → `src/services/vectorPdf.ts` (pdfkit + svg‑to‑pdfkit, lazy‑loaded) | #225 | resolution‑independent export |
| Promote native **Print / Save as PDF** as the primary PDF path; fix A4 `@page` bug | #226 | best‑fidelity mobile export |

**Metrics now (on `main`):**
- `src/App.tsx`: **~2,896 lines** (down from ~3,129 at session start; core logic moved into hooks/services).
- **380 tests passing** (up from 358), 16 test files.
- New deps: `pdfkit`, `svg-to-pdfkit` (+ `@types/pdfkit`); they ship only in the lazily‑loaded `vectorPdf` chunk.

**New modules created this session (the extracted, testable core):**
```
src/utils/svgRaster.ts        SVG→canvas→PDF raster helpers (pure)
src/hooks/useOsmd.ts          OSMD instance + render effect + zoom/fitWidth
src/hooks/useTranspose.ts     transpose state + debounced MusicXML transpose
src/services/exportService.ts fitContain + canvasesToPdfBlob (raster PDF assembly)
src/services/vectorPdf.ts     svgsToVectorPdfBlob (opt-in vector PDF, lazy)
docs/PERFORMANCE_AUDIT.md     the original audit
```

**PDF export model now (notation mode):**
1. **Print / Save as PDF** — *primary/recommended.* Uses the browser's native print engine on the live OSMD SVG ⇒ true vector, correct fonts/glyphs, no JPEG loss. On iOS: Print → **Save to Files**. Highest fidelity; no extra pipeline.
2. **Quick PDF** — raster (canvas→JPEG→jsPDF) one‑tap download; reliable fallback, good on desktop.
3. **Vector PDF (beta)** — in‑app pdfkit/svg‑to‑pdfkit; crisp/selectable/small but fonts are substituted and clip‑paths/filters may differ.

**Open item (needs a human with a browser):** the Vector PDF (beta) visual fidelity on complex scores is unverified (no browser here). The jsdom smoke test only asserts a valid `%PDF-`. If native Print proves great on mobile, the beta is largely a desktop convenience — consider hiding it on mobile or registering OSMD's real fonts to improve it.

---

## Part B — Two‑App Diagnostic (chord-sheet-maker vs chord-sheet-maker-pro)

The Pro repo was cloned read‑only and compared. **The two apps are siblings from a common ancestor that have drifted** — both `package.json` files are still named `chord-sheet-maker`.

### Drift: every shared "core" file exists in both and has diverged
| Shared core file | this app | Pro | note |
|---|---|---|---|
| `ingest/sniffFormat.ts` | 270 | 363 | drifted |
| `parsers/chordProParser.ts` | 373 | 617 | drifted |
| `models/ChordChartModel.ts` | 75 | 110 | **two non‑matching chart models** |
| `renderers/ChordChart.tsx` | 266 | 435 | drifted |
| `converters/musicXMLtochordpro.ts` | **1645** | **3** | Pro stubbed it; took the `canonicalChart`/CSMPN route |

**Consequence:** double maintenance + correctness drift (a parser/model fix in one app is not in the other), and capability fragmentation (a user gets a different tool depending on which URL they open).

### Who owns what today (empirical)
**Only in `chord-sheet-maker` (this app):**
- AlphaTab **Guitar Pro** rendering + `guitarProConverter`; VexFlow guitar tab (`musicXMLtoVexFlow`).
- The mature **MusicXML→ChordPro** engine (1,645 lines) and the **optimized transpose engine** (`transposeMusicXML`, cached/debounced).
- Clean **hooks** (`useOsmd`, `useTranspose`) + `svgRaster` + `vectorPdf` + `rehearsalMarkLayout`; OMR client (`services/omrApi.ts`).
- The real **test coverage** (380 tests).

**Only in `chord-sheet-maker-pro`:**
- Much richer **ingestion**: UGPro PDF importer, SVG importer, OEMER image OMR, NotaGen bridge, ABC parser, PDF text extraction, `importQuality` / `batchImportDiagnostics`.
- A real **`canonicalChart`** model + `chordNormalizer` (canonical normalization layer).
- **CSMPN fake‑book** generation (`csmpnParser`, `musicXmlToCsmpnFakebook`, `serializeChordPro`).
- **Slash / LilyPond** notation (`chordSlashML*`, `SlashNotationView`).
- The actual fake‑book PDF **presentation** (reference PDFs live in `pro/src/`).

> Net: it is **not** a clean "this = front‑end, Pro = back‑end" split today — both apps independently re‑built ingest, convert, and render. Pro is broader on ingestion + presentation + canonical/CSMPN; this app is stronger on GP/AlphaTab/tab + transpose + code quality/tests.

### The key enabler
Both deploy under **`quantumq1981.github.io`** → **same browser origin** → they can share `localStorage`/IndexedDB and hand off via a link with **no file download and no backend**.

---

## Part C — Integration Strategy & Recommendation

**Anoint a canonical interchange format = CSMPN** (both apps already speak it; it's Pro's specialty), with ChordPro/MusicXML as fallbacks.

Three packaging shapes:

- **A. Shared core package (monorepo), two thin apps.** Extract the common `sniffFormat` / parsers / `ChordChartModel` / converters / transpose into one `@csm/core`; both apps import it. *Permanently kills the drift.* Medium–Large; spans both repos.
- **B. Canonical contract + same‑origin handoff (keep both apps).** This app = normalize/transpose/format → emits canonical; Pro = canonical → fake‑book/perform. Add a one‑tap **"Open in Pro"** handoff via shared `localStorage`. Fast, low‑risk; fixes the *workflow* now, not the duplication.
- **C. Merge into one app, two modes** (Import/Format ↔ Perform/Library). Best UX, biggest lift; merge target is likely **Pro** (it owns presentation), folding in this app's GP/AlphaTab + transpose + hooks/tests.

**Recommended sequence: B → A**, with **C** as the eventual destination only if a single product is desired. B delivers "one‑sitting" efficiency immediately; A stops the maintenance bleed.

### Proposed runtime handoff contract (the "Open in Pro" feature)
- **Storage key:** `csm:handoff:v1` in `localStorage` (shared origin).
- **Deep link:** open `/chord-sheet-maker-pro/?import=handoff`.
- **Payload envelope:**
  ```json
  {
    "v": 1,
    "source": "chord-sheet-maker",
    "createdAt": "<ISO-8601>",
    "title": "...", "artist": "...",
    "transposeSemitones": 0, "enharmonic": "auto",
    "formats": { "csmpn": "...", "chordpro": "...", "musicxml": "..." }
  }
  ```
- **Default:** hand off the **current, transposed** chart (the prepared key), CSMPN primary.
- **Sender (this app):** serialize current chart → write key → navigate to the deep link. *(In scope for this repo.)*
- **Receiver (Pro):** on load, if `?import=handoff` or the key is present → read envelope → ingest best available format → **delete the key**. *(Needs the double‑repo session.)*
- **Testing note:** works on the deployed Pages sites (same origin). Two local dev servers are *different* origins, so verify against deployed builds or a combined dev server.

---

## Part D — Next steps for the double‑repo session

1. **Reconcile this brief with `chord-sheet-maker-pro/CLAUDE.md`** (the user will provide the latest). Confirm Pro's current ingest/canonical/CSMPN reality matches Part B.
2. **Lock the canonical format** (CSMPN schema/version) and the handoff envelope above; write it as a shared `HANDOFF-CONTRACT.md` referenced by both repos.
3. **Build the handoff (Option B) end‑to‑end:** sender in this app, receiver in Pro; verify the round trip on the deployed origin.
4. **Then start Option A:** extract `@csm/core` (sniffFormat, parsers, `ChordChartModel`, converters, transpose) to kill the drift. Decide canonical owners for each drifted file (e.g., this app's transpose engine and MusicXML→ChordPro engine; Pro's canonicalChart/CSMPN/ingest).
5. **Backport opportunities to flag:** this app's optimized transpose + AlphaTab GP rendering + vector/print work → Pro; Pro's UGPro/OMR/CSMPN/slash ingest → shared core.
6. **Mobile/stage roadmap (separate track, mostly Pro's domain):** offline PWA + `useWakeLock`, IndexedDB song library + setlists, full‑screen Performance Mode (dark, tap‑zones, Bluetooth pedal via the existing `keydown` handler). See the session chat for detail.

---

## Appendix — where things live in this app
- Entry/orchestration: `src/App.tsx` (still large; further slices possible but not required).
- Hooks: `src/hooks/useOsmd.ts`, `src/hooks/useTranspose.ts`.
- Services: `src/services/exportService.ts` (raster PDF assembly), `src/services/vectorPdf.ts` (vector, lazy), `src/services/omrApi.ts`.
- Converters: `src/converters/{musicXMLtochordpro,transposeMusicXML,guitarProConverter,musicXMLtoVexFlow,chordSymbolParser,xmlIntakeAnalyzer}.ts`.
- Parsers/ingest: `src/parsers/chordProParser.ts`, `src/ingest/sniffFormat.ts`.
- Renderers: `src/renderers/{ChordChart,VexFlowTabRenderer,AlphaTabRenderer}.tsx`.
- Utils: `src/utils/{svgRaster,rehearsalMarkLayout,...}.ts`.
- Tests: `src/**/__tests__/` (380 tests).
- Audit: `docs/PERFORMANCE_AUDIT.md`. This brief: `docs/SESSION-HANDOFF-AND-INTEGRATION.md`.
