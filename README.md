# Chord Sheet Maker

A Vite + React + TypeScript app for rendering MusicXML (`.xml`, `.musicxml`) and compressed MusicXML (`.mxl`) directly in the browser using OpenSheetMusicDisplay.

## Development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

## Export features

After loading a file, use the **Export** section in the side panel to:

- Download raw XML (`<base>.xml`)
- Download diagnostics JSON (`<base>.diagnostics.json`) with filename, diagnostics, warnings, render error (if any), and timestamp
- Export first rendered page as SVG (`<base>.page1.svg`)
- Export first rendered page as PNG (`<base>.png`)
- Export rendered pages to PDF (`<base>.pdf`) with selectable page size:
  - Letter (Portrait): 8.5" × 11" with 0.5" margins
  - A4 (Portrait): 210 × 297 mm with 12 mm margins

PDF export scales each page to fit available printable area while preserving aspect ratio to avoid cutoffs. Multi-page scores are exported as multi-page PDFs.

For iOS Safari, exports use a best-effort fallback by opening the generated blob URL in a new tab when direct download behavior is restricted.


## ChordPro Export

After loading MusicXML/MXL, use **ChordPro Export** in the side panel to generate and export ChordPro from the same in-memory XML used for rendering.

Supported options:
- 4 bars per line by default (configurable)
- Mode: Auto, Lyrics Inline, or Grid Only
- Chord bracket style: Separate (`[C][G7]`) or Combined (`[C G7]`)
- Repeat strategy: None or Simple Unroll (MVP)
- Grid-only mode quantizes chord changes per measure into beat slots (derived from time signature top number, default 4). Optional API override: `gridSlotsPerMeasure`.

Actions:
- Generate ChordPro
- Copy to clipboard
- Download `.pro`
- Share (best effort on browsers that support `navigator.share`, including iOS Safari)

Limitations:
- Complex repeats/endings are not fully expanded; simple unroll is best-effort.

## GitHub Pages deployment

This repo is configured to deploy via GitHub Actions.

1. Push to `main`.
2. In GitHub, open **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.

The site is built with Vite base path set to `/chord-sheet-maker/` for correct asset loading on Pages.
