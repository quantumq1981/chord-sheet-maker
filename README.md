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

## GitHub Pages deployment

This repo is configured to deploy via GitHub Actions.

1. Push to `main`.
2. In GitHub, open **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.

The site is built with Vite base path set to `/chord-sheet-maker/` for correct asset loading on Pages.
