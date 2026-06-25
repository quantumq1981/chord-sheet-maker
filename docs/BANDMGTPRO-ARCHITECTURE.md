# BandMgtPro — Family Unification Architecture & Migration Plan

_Status: living document. Created 2026-06-25. Canonical home: `chord-sheet-maker/docs/` (same home as `HANDOFF-CONTRACT.md`)._

This is the **pre-coding deliverable** the BandMgtPro directive asked for: a dependency
graph, a shared-state map, and a phased migration plan, produced **before** writing
integration code.

Every decision below cites the thinking framework it came from
(`tjboudreaux/cc-thinking-skills`: `thinking-systems`, `thinking-archetypes`). Those
skill repos are **not loaded in this environment** — the citations record the *pattern
applied and why*, for traceability, not a literal skill invocation.

---

## 0. Scope (as confirmed with the owner, 2026-06-25)

The grand directive ("merge four apps into a subscription SaaS, React+Tailwind+Python
serverless, monorepo") was deliberately **narrowed to what is buildable now without
disrupting the live sites**:

- **In scope: the three-app chord/tab family** — `Tab-Translator-Pro` (recognize),
  `chord-sheet-maker` (normalize), `chord-sheet-maker-pro` (finish).
- **Out of scope for now:** the `Setlist-Generator-v3.0.1-bandmgtpro` repo (left
  untouched) and creating a new `bandmgtpro` monorepo (not built).
- **Hosting is frozen on GitHub Pages.** No move to Vercel/Netlify. No Python
  serverless backend — it would force a hosting move or separate infra, i.e. exactly
  the disruption the owner ruled out.
- **Every change is additive and client-side.** A new artifact must change *nothing*
  about how each site deploys today until it is explicitly imported.

> `thinking-systems` — **constraint-first framing.** The binding constraints
> (static Pages, offline-first, four validated test corpora, zero-server) are not
> obstacles to route around; they are the load-bearing walls. The plan is shaped to
> them, not against them. A custom Python backend was cut because it violates two of
> them at once.

---

## 1. Current-state map (verified by audit, not assumed)

| Repo | Family role | Build system | Key reuse units |
|------|-------------|--------------|-----------------|
| **Tab-Translator-Pro** | Recognize | **Zero-build**, Babel-in-browser; 2 files: `engine.tsx` (pure, React-free) + `TabDecoderPro.tsx` (UI) | `engine.tsx` — chord DB, parsers A–G, exporters (CSMPN/CSML/ABC/MusicXML/MIDI), key/transpose, DSP |
| **chord-sheet-maker** | Normalize | **Vite + TS + React + vitest** (the only real build) | `src/converters/*`, `src/parsers/*`, OSMD/AlphaTab/VexFlow renderers |
| **chord-sheet-maker-pro** | Finish | **Zero-build** monolith `index.html` + ~15 root JS modules | `chordProcessing.js`, `renderer.js`, `importPipeline.js`, `musicXmlCore.js`, `chordTheory.js`, `abcSuite.js`, `audioPlayback.js` |

### Build-system split is the central fact
Three apps transpile React **in the browser** (CDN UMD + `@babel/standalone`); one is a
real Vite/TS workspace. **You cannot share a JS module, a state store, or a typed
component across that boundary without first unifying the build** — or by choosing
artifacts that are build-agnostic. This plan does the latter first (CSS tokens, JSON
schema, pure ES modules) and defers the build unification.

### What already binds the family (the existing seam)
- **Same GitHub Pages origin** (`quantumq1981.github.io`) ⇒ shared `localStorage`.
- **CSMPN** is the lingua franca interchange text.
- **Versioned handoff contracts** (`docs/HANDOFF-CONTRACT.md`): forward
  `csm:handoff:v1` (→ Pro, `?import=handoff`) and reverse `ttp:decode:v1`
  (→ Tab Translator, `?import=decode`).
- A **Unified Song Model spec already exists**
  (`Unified-Song-Model+Ug-Ascii-JSparser-Techspec.md`, `schemaVersion 1.0.0`, with
  `semanticTier` / `lossMap` / `sourceNative`). The data-model task is **extend**, not
  invent.

> `thinking-systems` — **map shared state before touching anything.** The family is
> already a loosely-coupled distributed system with a working contract bus. The correct
> unification is to *strengthen the existing bus*, not bulldoze it.

---

## 2. Dependency graph

```
                          ┌─────────────────────────────────────────┐
                          │   SHARED CONTRACTS (build-agnostic)      │
                          │                                          │
                          │  • CSMPN  (interchange text)             │
                          │  • Unified Song Model JSON (v1.0.0+)     │
                          │  • Handoff envelopes  csm:handoff:v1 /   │
                          │      ttp:decode:v1   (localStorage)      │
                          │  • bandmgtpro-theme.css (stage tokens)   │  ◀── NEW (Phase 1)
                          └───────────────┬──────────────────────────┘
                                          │ consumed by all three (additive)
        ┌─────────────────────────────────┼─────────────────────────────────┐
        ▼                                 ▼                                 ▼
┌───────────────────┐           ┌───────────────────┐           ┌───────────────────┐
│ Tab-Translator-Pro│           │ chord-sheet-maker │           │chord-sheet-maker- │
│   (Recognize)     │           │   (Normalize)     │           │   pro (Finish)    │
│                   │           │                   │           │                   │
│ engine.tsx (pure) │           │ Vite/TS/React     │           │ index.html + JS   │
│ exports CSMPN ───────────────▶│ parsers/convert   │──CSMPN───▶│ renderer/audio/   │
│                   │  ttp:decode│                   │ csm:handoff│ slash-rhythm      │
│ ◀─────────────────────────────────────────────────────────────│ (receiver)        │
└───────────────────┘           └───────────────────┘           └───────────────────┘

Data-flow legend:
  ─── CSMPN ───▶   synchronous export → handoff → re-parse (lossy at tier boundaries)
  ttp:decode       reverse async handoff (Pro/CSM → Tab Translator for recognition)

Coupling hot-spots (thinking-systems — feedback loops to watch):
  • transpose / enharmonic spelling  ↔  every exporter + the stage view
      (family default Bb·C#·Eb·F#·Ab is ALREADY unified across all three — keep it)
  • semanticTier / lossMap           ↔  what a downstream app is allowed to infer
  • build system                     ↔  whether a shared *store* is even possible
```

There are **no circular code dependencies** today (the apps talk only through the
contract bus, never by importing each other). **Preserving that acyclicity is a hard
rule** — the directive's "refuse any code that introduces circular dependencies"
maps directly onto "never let one app `import` another; only the contract bus connects
them."

---

## 3. The five architectural decisions (with citations)

1. **Backbone = existing CSMPN + handoff contracts + Unified Song Model. Extend, never
   reinvent.** _(`thinking-systems`: re-deriving a schema would orphan four working
   importer/exporter pipelines and four validated test corpora — a destructive ripple
   for zero gain.)_
2. **Wrap the engines; do not rewrite them.** The reuse units are the *pure* modules
   (`engine.tsx`, CSM-Pro's root JS, CSM's `src/parsers`). Integration risk lives in
   boot/glue, not in the validated logic. _(`thinking-systems`: isolate the change
   surface to the seams.)_
3. **Route by the gig workflow, not by legacy tool names:** Library → Prepare →
   Setlist → Perform (stage). _(`thinking-archetypes`: the real journey is soundcheck →
   on-the-fly transpose → setlist reorder; the component hierarchy must mirror it.)_
4. **Unify the build system before any shared store.** A single source of truth for
   song state is impossible across the Babel/Vite divide; until then, only
   build-agnostic artifacts (CSS vars, JSON, pure ES) may be shared. _(`thinking-systems`:
   the transpose↔setlist↔stage feedback loop needs one store, which needs one build.)_
5. **Strangler-fig, never big-bang.** Each app keeps shipping on Pages behind the
   existing handoff while it is absorbed. _(`thinking-archetypes` + hard constraints:
   protects offline-first, the <100 ms render budget, and the test corpora from a
   flag-day rewrite.)_

---

## 4. Phased migration plan

Each phase is **independently shippable**, **additive**, and **does not change any
existing deploy** until its artifact is wired in. Phases are ordered by dependency, not
by glamour.

### Phase 1 — Shared, build-agnostic primitives _(start here; no build change)_
- **1a. Stage design tokens** — `bandmgtpro-theme.css`: one set of CSS custom
  properties for the three stage lighting modes (day-stage / dark-venue / red-light-safe),
  touch-target sizes, and glanceable type scale. Works *identically* in the Vite app and
  the CDN monoliths because it is just CSS variables. **First artifact.**
  _(`anthropics/skills` → `theme-factory` intent: one token source, many surfaces.)_
- **1b. Canonical Unified Song Model** — promote the existing techspec JSON to a single
  versioned `bandmgtpro-song-model.schema.json` + a tiny pure-ES validator usable from
  Node (vitest) and the browser. No new dependencies.
- **1c. Contract conformance tests** — a shared fixture set proving CSMPN round-trips
  and handoff envelopes validate across all three apps.

### Phase 2 — Design-system component parity _(per-app, additive)_
- Re-skin existing buttons/cards/modals/chord-diagrams in each app to consume the Phase-1
  tokens, so a user moving between tools perceives no seam. No behavior change; guarded
  by each app's existing tests + visual smoke on iOS.
  _(`anthropics/skills` → `web-artifacts-builder` intent: one design system, rendered
  the same everywhere.)_

### Phase 3 — Build unification (the enabling, higher-risk step)
- Stand up a Vite/TS workspace (CSM is the beachhead) and bring the two monoliths in as
  pre-compiled-at-deploy entries, **preserving the zero-build deploy as a fallback** so
  Pages never breaks mid-migration. This unlocks a shared store later.
  _(`VoltAgent/awesome-agent-skills` → state-management patterns: do not introduce a
  global store until one build can host it.)_

### Phase 4 — Unified shell + routing (only after Phase 3)
- A single SPA with the workflow routes from Decision 3, loading the absorbed tools as
  feature modules. Auth/sync, **if** ever needed, enters here via a managed BaaS JS SDK
  that runs from the static site — no hosting move.

> Phases 3–4 are **deliberately deferred** and gated on owner sign-off. Phases 1–2
> deliver visible family unification with near-zero risk and are where work proceeds now.

---

## 5. Hard-constraint ledger

| Constraint | How this plan honors it |
|---|---|
| Performance <100 ms render | Engines unchanged; tokens are CSS-only; no new runtime cost |
| Offline-first / static | Everything client-side; Pages deploy untouched; no serverless |
| React + Tailwind only | Tokens are framework-neutral CSS vars (Tailwind can `@theme` them later); no new CSS framework |
| Single codebase (eventual) | Deferred to Phase 3 behind a fallback; not forced now |
| No circular deps | Apps connect only via the contract bus; never import each other |
| Cite a skill per decision | Every decision + phase above carries its citation |

---

## 6. Status / next action

- [x] Audit + current-state map
- [x] Dependency graph + shared-state map
- [x] Phased plan + decision log (this document)
- [ ] **Phase 1a:** `bandmgtpro-theme.css` stage tokens (in progress)
- [ ] Phase 1b/1c, then Phase 2 per-app adoption
