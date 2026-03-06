# Chord Sheet Maker

A Vite + React + TypeScript app for rendering MusicXML (`.xml`, `.musicxml`) and compressed MusicXML (`.mxl`) directly in the browser using OpenSheetMusicDisplay.

## Supported uploads

- `.xml` (MusicXML text)
- `.musicxml` (MusicXML text)
- `.mxl` (compressed MusicXML container)

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


## OMR backend integration (Audiveris)

This frontend now supports **async OMR import** in addition to direct MusicXML/MXL upload.

### Configure API base URL

Create a local env file:

```bash
cp .env.example .env.local
```

Set the backend URL:

```bash
VITE_OMR_API_BASE=http://localhost:8080
```

If omitted, the app uses same-origin paths (e.g. `/api/omr/...`).

### OMR upload flow in the UI

Use the **OMR Import (Audiveris)** panel in the side panel:

1. Select a `.pdf`, `.png`, `.jpg`, or `.jpeg` file.
2. Start OMR job (`POST /api/omr/jobs`).
3. Watch status updates (`queued` → `preprocessing` → `running_audiveris` → `parsing_output` → `completed`/`failed`).
4. On completion, frontend fetches result (`GET /api/omr/jobs/:jobId/result`) and loads returned `.musicxml`/`.mxl` into the existing OSMD renderer.
5. Artifact links are shown (musicxml, mxl, log, summary) along with summary metadata when provided.
6. If failed, structured failure payload is shown from `GET /api/omr/jobs/:jobId/error`.

### Local development workflow

Run backend and frontend together:

```bash
# terminal 1
OMR_DATA_ROOT=/tmp/omr-jobs uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8080

# terminal 2
npm run dev
```

Then open the app, use OMR Import for PDF/image scoring, or continue using direct `.xml` / `.musicxml` / `.mxl` upload as before.

