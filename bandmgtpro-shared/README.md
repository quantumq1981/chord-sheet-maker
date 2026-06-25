# bandmgtpro-shared

Build-agnostic artifacts shared across the BandMgtPro three-app family
(Tab-Translator-Pro · chord-sheet-maker · chord-sheet-maker-pro).

Everything here is **pure** (CSS variables / JSON / pure ES) so the same file works in
the Vite/TS app **and** the zero-build CDN monoliths with no build step. Adding a file
here changes nothing about any site's deploy until an app explicitly references it.

See `../docs/BANDMGTPRO-ARCHITECTURE.md` for the full plan and the per-decision
skill citations.

## Contents

| File | What | Phase |
|------|------|-------|
| `bandmgtpro-theme.css` | Stage design tokens — `dark-venue` / `day-stage` / `red-light-safe` lighting modes, glanceable type scale, iOS touch targets | 1a |
| `bandmgtpro-song-model.schema.json` | Canonical Unified Song Model JSON Schema (draft-07), v1.0.0 — the documented interchange contract | 1b |
| `songModel.mjs` | Zero-dep runtime guard for the schema: `validateSongModel` / `assertSongModel` / `createEmptySongModel` + `SONG_MODEL_VERSION` / `SEMANTIC_TIERS` / `SOURCE_FORMATS`. Pure ES — runs in the browser and under vitest/Node | 1b |
| `__tests__/songModel.test.mjs` | 12 vitest specs: invariants, drift guard (schema↔validator enums), and real `ug_ascii_parser` output conforms | 1b |

## Using the song model

```js
import { createEmptySongModel, validateSongModel, assertSongModel } from './songModel.mjs';

const song = createEmptySongModel({ title: 'Blue Sky', source: { format: 'gp5', semanticTier: 'tier_3_fretted' } });
const { valid, errors } = validateSongModel(song);   // never throws
assertSongModel(song);                                // throws on the first contract breach
```

Enforced invariants (from the techspec): `schemaVersion` major-compatible; `source.format`/`semanticTier`
in the known enums; `metadata` present; **`lossMap` mandatory** (no silent fake precision); every
harmony event carries **both** its authored `symbol` and `normalized.root`. Extra/`sourceNative` fields
are allowed for future round-tripping.

## Adopting the theme (Phase 2, per app — all additive)

**1. Set the active lighting mode** on the root element (default = `dark-venue` if unset):

```html
<html data-stage-theme="dark-venue">   <!-- or day-stage | red-light-safe -->
```

**2a. chord-sheet-maker (Vite/TS):** copy/symlink `bandmgtpro-theme.css` into `public/`
and `import` it, or map the tokens into Tailwind:

```css
/* index.css */
@import "bandmgtpro-theme.css";
@theme { --color-accent: var(--bmp-accent); --color-bg: var(--bmp-bg); }
```

**2b. Tab-Translator-Pro & chord-sheet-maker-pro (zero-build):** drop a plain
`<link>` in `index.html` — no transpile, no CDN:

```html
<link rel="stylesheet" href="bandmgtpro-theme.css">
```

**3. Read tokens** in components (or use the tiny `.bmp-*` helper classes):

```css
.chord  { color: var(--bmp-chord); font-size: var(--bmp-font-chord); font-weight: var(--bmp-font-weight-chord); }
.toolbtn{ min-height: var(--bmp-touch-min); background: var(--bmp-accent); color: var(--bmp-accent-text); }
```

## Rules

- **Tokens are the contract.** Components read `--bmp-*` variables; they must not
  hard-code the family orange or any mode color.
- **No new dependencies.** Anything added here stays pure/portable.
- **Mode is a single attribute.** A lighting-mode switcher only sets
  `data-stage-theme` — never restyles components.
