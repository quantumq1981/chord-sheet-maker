# Codebase Audit — chord-sheet-maker

**Date:** 2026-04-21  
**Scope:** All TypeScript/TSX in `src/`, config files, optional FastAPI backend  
**Branch audited:** `claude/codebase-audit-report-X9KkY` (merged → `main` as PR #119)

---

## Executive Summary

The codebase is in good overall shape. TypeScript strict mode is fully enabled,
there is no use of `eval`, `dangerouslySetInnerHTML`, or hardcoded secrets, all
event listeners are cleaned up, and every async operation is wrapped in
try/catch. No critical vulnerabilities were found.

**Top issues (all fixed in PR #119):**

| ID | Severity | Summary | Status |
|---|---|---|---|
| BUG-01 | High | OMR polling timer silently killed by wrong `useCallback` deps | ✅ Fixed |
| BUG-04 | Medium | No zip-bomb size guard on MXL decompression | ✅ Fixed |
| BUG-03 | Medium | `console.log` leaks internal stats in production bundle | ✅ Fixed |
| BUG-02 | Medium | Stale `transposeEnharmonic` in `loadFile` closure | ✅ Fixed |
| ARCH-01 | Low | `App.tsx` at 2,445 lines — coupling risk accumulating | Roadmap |

---

## Part 1 — Security & Vulnerability Analysis

### SEC-01 · XML External Entity (XXE) — No Risk ✅

**Location:** `musicXMLtochordpro.ts:290`, `transposeMusicXML.ts:204`,
`rehearsalMarkLayout.ts:10`, `App.tsx:302`

All XML parsing uses the browser's built-in `DOMParser` with MIME type
`"application/xml"`. Browser DOMParser implementations do not load external
entities or DTDs — external entity expansion is unconditionally disabled by
the HTML specification. No custom XML resolvers are used anywhere in the
codebase.

No action required. If a server-side Node.js parser is ever introduced,
revisit this.

---

### SEC-02 · ReDoS (Catastrophic Regex Backtracking) — No Risk ✅

**Location:** `sniffFormat.ts:33`, `chordProParser.ts:74`,
`chordSymbolParser.ts:163`, `musicXMLtochordpro.ts:607`

Every regex in the hot path was reviewed against the ReDoS criterion (nested
quantifiers over overlapping character classes). All patterns are safe:

```typescript
// sniffFormat.ts + chordProParser.ts — same pattern, no nesting
/^[A-G][#b]?(?:m(?:aj)?|M|maj|min|dim|aug|sus[24]?|add\d*)?(?:\d+)?(?:\/[A-G][#b]?)?$/

// chordSymbolParser.ts — single character class, no nested groups
/^[A-G][#b]?[a-zA-Z\d+°øØ△Δ\-\^#]*(?:\/[A-G][#b]?)?$/u

// musicXMLtochordpro.ts — bounded quantifier prevents runaway
/^[A-G][#b]?(?:m|M|maj|...){0,12}(?:\/[A-G][#b]?)?$/
```

---

### SEC-03 · XSS — No Risk ✅

**Location:** All TSX render methods

React's JSX auto-escapes all string values. The codebase has **zero** uses of
`dangerouslySetInnerHTML`. SVG post-processing in `rehearsalMarkLayout.ts`
sets only `y` attribute values (numeric) derived from OSMD's internal graphical
model — not from user-supplied text.

---

### SEC-04 · Zip Bomb — Fixed in PR #119 ✅

**Location:** `musicXMLtochordpro.ts` — `extractMusicXmlTextFromFile`

Previously: `JSZip.loadAsync` was called with no size check. A malformed
`.mxl` file with a 1000:1 compression ratio could expand 100 KB on disk into
100 MB in memory, stalling or crashing the browser tab.

**Fix applied:**

```typescript
const MXL_MAX_COMPRESSED_BYTES  = 50 * 1024 * 1024; // 50 MB
const MXL_MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024; // 20 MB

if (file.size > MXL_MAX_COMPRESSED_BYTES) throw new Error(…);
// … after extraction:
if (xmlText.length > MXL_MAX_UNCOMPRESSED_BYTES) throw new Error(…);
```

Both thresholds are well above any real-world MusicXML score.

---

### SEC-05 · OMR API URL Validation ✅

**Location:** `omrApi.ts:8–21`

API base URLs are read from `import.meta.env.VITE_OMR_*` environment variables
(not hardcoded), properly trimmed, and validated with a protocol check before
use:

```typescript
if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
```

No secrets are present in the codebase.

---

### SEC-06 · Content Security Policy — Recommendation (Low)

**Location:** `index.html`

No CSP headers are set. GitHub Pages does not support custom HTTP headers, so
CSP must be delivered via `<meta http-equiv>` tags. A minimal effective CSP:

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval';
           style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
           worker-src blob:;">
```

- `'wasm-unsafe-eval'` required by AlphaTab's WebAssembly audio engine.
- `'unsafe-inline'` for styles required by OSMD's inline SVG styling.

---

## Part 2 — Code Integrity & Data Safety

### BUG-01 · HIGH — OMR Polling Timer Killed by Wrong Hook Dependencies — Fixed ✅

**Location:** `App.tsx:827–840`, `App.tsx:858–891`

Three hooks had incorrect dependency arrays:

**a) Cleanup `useEffect`:**

```typescript
// BEFORE — cleanup ran on every chordProUi/transposeSemitones change,
// silently killing the active polling timer mid-OMR-job
}, [chordProUi, transposeSemitones]);

// AFTER — fires only on unmount
}, []);
```

**b) `stopOmrPolling`:**

```typescript
// BEFORE — new function identity on every chordProUi change,
// breaking the polling chain
}, [chordProUi]);

// AFTER — only uses omrPollingTimerRef (a ref, not state)
}, []);
```

**c) `loadOmrResultIntoNotation`:**

```typescript
// BEFORE — chordProUi and transposeSemitones in the dep array
// but neither is read inside the callback body
}, [chordProUi, transposeSemitones]);

// AFTER
}, []);
```

**Impact:** If a user adjusted the enharmonic preference or transpose value
while an async OMR job was running, the polling timer would be destroyed. The
UI would show a permanently "running" job with no further status updates.

---

### BUG-02 · MEDIUM — Stale `transposeEnharmonic` in `loadFile` — Fixed ✅

**Location:** `App.tsx:1071`

```typescript
// BEFORE — transposeEnharmonic used at line 1041 but missing from deps
}, [chordProUi, transposeSemitones]);

// AFTER
}, [chordProUi, transposeSemitones, transposeEnharmonic]);
```

**Impact:** Initial ChordPro export on file load used stale accidental spelling
until the next reactive re-render corrected it.

---

### DATA-01 · Error Handling — Good ✅

All major async operations are wrapped in try/catch with typed error messages
(`error instanceof Error ? error.message : String(error)`). OSMD load/render
rejections are caught and surfaced to the UI. XML parse errors are detected via
`doc.querySelector('parsererror')` before any traversal proceeds.

---

### DATA-02 · TypeScript Strictness — Excellent ✅

`tsconfig.app.json`: `strict: true`, `noUnusedLocals: true`,
`noUnusedParameters: true`, `noFallthroughCasesInSwitch: true`. No `@ts-ignore`
or bare `as any` casts in application code. The single `as any` in
`rehearsalMarkLayout.ts:34` is correctly annotated and accesses OSMD's untyped
internal `GraphicSheet` property — no public typed API exists for this.

---

### DATA-03 · MXL Path Traversal — No Risk ✅

The `rootPath` value from `container.xml` is passed to `zip.file(rootPath)`.
JSZip normalises all paths internally and does not allow traversal outside the
archive root. A `../../` path would return `null`, hitting the existing
`if (!scoreEntry)` guard.

---

## Part 3 — Architectural Cleanliness & Coupling

### ARCH-01 · App.tsx Size (2,445 lines) — Medium Priority

The component manages 30+ state variables and 25+ callbacks across 5 distinct
mode subsystems. Recommended decomposition (in priority order):

1. **`useOmrPipeline` hook** — extract all `omr*` state + `submitOmrJob`,
   `pollOmrJob`, `loadOmrResultIntoNotation`, `resetOmrState` into
   `src/hooks/useOmrPipeline.ts`. Removes ~250 lines and prevents a recurrence
   of the BUG-01 dep-array bug class.
2. **`useExportPipeline` hook** — `exportPdf`, `exportSvg`, `exportPng`,
   `printScore` and their helpers into `src/hooks/useExportPipeline.ts`.
3. **`useTransposeState` hook** — `transposeSemitones`, `transposeEnharmonic`,
   `adjustTranspose`, and the `transposeMusicXML` effect are a tight cluster.

All pure extractions — zero behaviour change.

---

### ARCH-02 · Duplicate Directive Expansion Logic

**Location:** `App.tsx:434–488`

The `directive` variable is computed twice with identical ternary logic to emit
`{start_of_*}` and `{end_of_*}`. Extract into a
`sectionDirectiveName(type: SectionType): string` helper.

---

### ARCH-03 · Redundant `tabScoreData` State Mirror

**Location:** `App.tsx:719`, `App.tsx:763`

```typescript
const tabScore = useMemo<VexTabScore | null>(…);        // computed
useEffect(() => { setTabScoreData(tabScore); }, [tabScore]); // mirrored
```

`tabScoreData` always equals `tabScore`. Removing the state variable and the
sync effect eliminates a redundant render cycle on every XML/tuning change.

---

### ARCH-04 · `await` on Synchronous Converter

**Location:** `App.tsx:1510`, `App.tsx:1528`

`convertMusicXmlToChordPro` returns `ConvertOutput` (not a `Promise`). The
`await` is harmless but misleading — it implies async work that doesn't exist.

---

## Part 4 — Best Practices & Maintainability

### BP-01 · Production Console Output — Fixed ✅

The `[fakebook]` debug log is now gated behind `import.meta.env.DEV`, which
Vite tree-shakes from production builds.

---

### BP-02 · `document.execCommand('copy')` Deprecated

**Location:** `App.tsx:1553`

The fallback is deprecated but still functional. Primary path
(`navigator.clipboard.writeText`) is modern and correct. Not urgent.

---

### BP-03 · Test Coverage Gap

`rehearsalMarkLayout.ts` has no unit tests because it requires a live OSMD
render context. A mock-based test using a synthetic SVG DOM would be achievable
with jsdom.

---

### BP-04 · Accessibility

- Tab tuning inputs have correct `aria-label` ✅
- `<select>` elements associated with `<label>` via `id`/`htmlFor` ✅
- All interactive elements use native HTML controls (no missing `role`) ✅

---

## Part 5 — Client-Side Specific Risks

### CLIENT-01 · Memory Leaks — Clean ✅

| Resource | Cleanup |
|---|---|
| `window.addEventListener('keydown')` | `removeEventListener` in effect return |
| `ResizeObserver` (VexFlow) | `ro.disconnect()` in effect return |
| AlphaTab API | `api.destroy()` via `disposeApi` callback |
| OMR polling timer | `clearTimeout` on unmount + explicit stop |
| Blob URLs | `URL.revokeObjectURL` via 15 s timeout + effect cleanup |

---

### CLIENT-02 · `localStorage` / `IndexedDB` — Not Used ✅

No user data is persisted between sessions. No privacy concerns.

---

### CLIENT-03 · Large Score Canvas Size Limit

**Location:** `App.tsx:276–285` (`svgToCanvas`)

Browser canvas limits vary (Safari: ~16 M px; Chrome: ~268 M px). If a very
large score at 2× scale exceeds the limit, `canvas.getContext('2d')` returns
`null`. The existing guard surfaces a generic error — improving it to detect
the specific dimension overflow would give users a clearer message.

---

### CLIENT-04 · npm Audit

3 moderate-severity advisories in the Vite dev-toolchain (transitive deps).
No advisories in any production dependency (`opensheetmusicdisplay`, `vexflow`,
`jszip`, `jspdf`, `@coderline/alphatab`). Run `npm audit fix` to resolve the
dev toolchain advisories.

---

## Full Findings Table

| ID | Severity | Status | Location | Summary |
|---|---|---|---|---|
| BUG-01 | **High** | ✅ Fixed | App.tsx:827–891 | OMR polling timer killed by wrong hook deps |
| BUG-02 | Medium | ✅ Fixed | App.tsx:1071 | Stale `transposeEnharmonic` in `loadFile` |
| BUG-03 | Medium | ✅ Fixed | musicXMLtochordpro.ts:1064 | `console.log` in production bundle |
| BUG-04 | Medium | ✅ Fixed | musicXMLtochordpro.ts:252 | No zip-bomb size guard on MXL |
| ARCH-01 | Medium | Roadmap | App.tsx | 2,445-line component — extract custom hooks |
| ARCH-03 | Low | Roadmap | App.tsx:719 | Redundant `tabScoreData` state mirror |
| ARCH-04 | Low | Roadmap | App.tsx:1510 | `await` on synchronous converter |
| ARCH-02 | Low | Roadmap | App.tsx:434 | Duplicate directive expansion logic |
| SEC-06 | Low | Recommended | index.html | No Content-Security-Policy meta tag |
| CLIENT-03 | Low | Roadmap | App.tsx:276 | Generic error on Safari canvas size limit |
| BP-02 | Low | Monitor | App.tsx:1553 | Deprecated `execCommand` clipboard fallback |
| BP-03 | Low | Roadmap | rehearsalMarkLayout.ts | No unit tests for SVG repositioning |

---

## Roadmap: Next 5 Features

Priority-ordered by impact × feasibility.

### 1 · Extract Custom Hooks (ARCH-01)

**Why first:** A prerequisite for safe feature development. Extracting
`useOmrPipeline`, `useExportPipeline`, and `useTransposeState` cuts `App.tsx`
from 2,445 → ~1,400 lines, makes each pipeline independently unit-testable,
and directly prevents a recurrence of the BUG-01 dep-array bug class.

**Effort:** Medium (2–3 days). Pure refactor — zero behaviour change.

---

### 2 · Repeat Expansion in ChordPro Output

**Why:** The highest-impact user-facing gap. The current `simple-unroll`
strategy emits a `% Repeat` comment instead of unrolling `||:…:||` sections.
Every real fake-book user expects the full expanded form.

**Approach:** Implement `expandRepeats(measures: MeasureData[]): MeasureData[]`
in `musicXMLtochordpro.ts`. The data already exists — `repeatStart`,
`repeatEnd`, and `endings` are collected in `MeasureData`. Add as
`repeatStrategy: 'expand'` alongside the existing `'none'` and
`'simple-unroll'` options.

**Effort:** Medium.

---

### 3 · Vector PDF Export

**Why:** Current rasterised JPEG-in-PDF output is readable but not
print-quality. Text and noteheads are blurry when zoomed. Vector PDF is a
significant quality leap for the core gig-chart use case.

**Approach:** `pdfkit` + `svg-to-pdfkit`. OSMD SVG uses embedded font glyphs
(paths), so text-as-paths is the reliable approach. Start with a
single-page proof-of-concept before handling multi-page OSMD output.

**Effort:** High.

---

### 4 · Unified Semi-Structured Text Parser

**Why:** The current parser handles clean ChordPro, UG, and COW well.
Real-world input includes PDF-extracted text, chord dump sheets, and plain web
copy-pastes. A classifier-first approach (classify each line role:
metadata / section-header / chord-line / lyric-line / comment / blank) handles
all of these gracefully and feeds the same normalised `ChordChartDocument`.

**Approach:** Build `parseChordChartRobust()` as a deterministic line-role
scorer alongside the existing `parseChordChart()` — no ML required, no
breaking changes to the existing pipeline.

**Effort:** Medium.

---

### 5 · Per-Part / Instrument Filtering for Multi-Part Scores

**Why:** When a full band score is loaded, all parts render simultaneously.
The OSMD `setInstrumentVisible` API already exists. Part selection is already
half-implemented for VexFlow tab (`tabPartIndex`). The work is making it
consistent across OSMD notation, ChordPro conversion, and AlphaTab.

**Effort:** Low–Medium.
