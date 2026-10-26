# → Pro Handoff Contract (v1)

Lets a sender app push the current chart to **`chord-sheet-maker-pro`** with one tap, using the fact that all three apps are served from the **same origin** (`https://quantumq1981.github.io`) and therefore share `localStorage`. No backend, no file download.

- **Senders (both implemented):**
  - `chord-sheet-maker` — the **Open in Pro ↗** button (`openInPro()` in `src/App.tsx`). `source: "chord-sheet-maker"`.
  - `tab-translator-pro` — the **→ Chord Sheet Maker Pro** button in the Chart panel (`sendToPro()` in `TabDecoderPro.tsx`). `source: "tab-translator-pro"`. Tab Translator turns a tab/PDF/Guitar Pro/MusicXML/Power Tab file into a chord chart, exports it as Pro's native **CSMPN** (`scoreToCSMPN()`), and hands it over.
- **Receiver:** `chord-sheet-maker-pro` — *implemented* (PR #288, in `index.html`'s boot path; status message is `source`-aware). Purely additive; runs only when explicitly invoked, so it cannot affect any existing Pro feature (PowerTab/.ptb, slash notation, hybrid, fake‑book, etc.).

> **Channels (all same-origin `localStorage`, one-shot):** `csm:handoff:v1` chart → Pro (`?import=handoff`, optional `parts[]`) · `ttp:decode:v1` raw file → Tab Translator Pro (`?import=decode`) · `csm:lyrics:v1` lyrics → Pro Perform Lyrics (`?import=lyrics`). CSMPN may carry a `Tempo Map:` header.

> The `source` field is informational only — the receiver keys off `formats` (priority `csmpn → chordpro → musicxml`), so **any** app that writes a valid v1 envelope and opens Pro with `?import=handoff` is interoperable. New senders just pick a unique `source` string.

---

## The contract

- **Storage key:** `localStorage["csm:handoff:v1"]`
- **Trigger param:** Pro is opened at `…/chord-sheet-maker-pro/?import=handoff`
- **Envelope (JSON):**
  ```json
  {
    "v": 1,
    "source": "chord-sheet-maker",
    "createdAt": "<ISO-8601>",
    "title": "Song Title",
    "transposeSemitones": 0,
    "enharmonic": "auto",
    "formats": {
      "csmpn":   "…CSMPN fake-book source…",
      "chordpro":"…ChordPro…",
      "musicxml":"…raw MusicXML…"
    }
  }
  ```
- **Format priority for the receiver:** `csmpn` → `chordpro` → `musicxml`. CSMPN is Pro's native source, so prefer it. `musicxml` is omitted by the sender when the score is large (> ~1.5 MB) to stay within the localStorage quota; CSMPN/ChordPro always go through.
- The chart is handed off **already transposed** (the prepared key); `transposeSemitones`/`enharmonic` are informational.

---

## Sender (this app) — already implemented
`openInPro()` in `src/App.tsx`:
1. Builds `formats` from the current mode (chord‑chart → `serializeChordProFromDocument` + `buildCsmpnFromChartDocument`; notation/tab → `convertMusicXmlToChordPro` in default + `fakebook` modes → `buildCsmpnFakeBookSource`; GP/AlphaTab → `gpChordProText`).
2. `localStorage.setItem("csm:handoff:v1", JSON.stringify(envelope))`.
3. `window.location.assign(`${origin}/chord-sheet-maker-pro/?import=handoff`)` (same‑tab nav, mobile‑safe).

---

## Receiver (Pro) — drop‑in for `index.html`
Add this **once**, early in Pro's boot (after `parseCSMPN` / the import pipeline and the source `<textarea>` exist). It is inert on every normal load — it only acts when `?import=handoff` is present, and it clears the key immediately so a refresh won't re‑import.

```js
// CSM → Pro handoff receiver (additive; safe no-op unless ?import=handoff present)
(function consumeCsmHandoff() {
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.get('import') !== 'handoff') return;

    var raw = localStorage.getItem('csm:handoff:v1');
    localStorage.removeItem('csm:handoff:v1'); // one-shot
    if (!raw) return;

    var env = JSON.parse(raw);
    if (!env || env.v !== 1 || !env.formats) return;
    var f = env.formats;

    // Prefer CSMPN (native), then ChordPro, then MusicXML.
    // Pro's importers don't populate the editor themselves, so funnel every
    // path through a CSMPN string and load it the way Pro's file-import
    // handlers do (set source value → extractHeaderFromText → updatePreview).
    var csmpn = null;
    if (f.csmpn) {
      csmpn = f.csmpn;                                   // CSMPN is Pro's source language
    } else if (f.chordpro && typeof importChordPro === 'function') {
      csmpn = importChordPro(f.chordpro);               // importChordPro() RETURNS CSMPN text
    } else if (f.musicxml && typeof importMusicXML === 'function') {
      var song = importMusicXML(f.musicxml);            // importMusicXML() RETURNS a SongModel
      if (song && typeof song.toCSMPN === 'function') {
        csmpn = song.toCSMPN({ barsPerRow: (typeof fbSettings === 'object' && fbSettings && fbSettings.barsPerRow) || 4 });
      }
    }
    if (csmpn) {
      var srcEl = document.getElementById('source');    // Pro's source textarea id
      if (srcEl) { srcEl.value = csmpn; }               // full source; the preview hides lyrics itself
      if (typeof extractHeaderFromText === 'function') extractHeaderFromText(srcEl ? srcEl.value : csmpn);
      if (typeof updatePreview === 'function') updatePreview();  // re-render
    }

    // Optional: strip the query param so a manual refresh is clean.
    history.replaceState(null, '', window.location.pathname);
  } catch (e) {
    /* never let the handoff break a normal load */
    console.warn('CSM handoff skipped:', e);
  }
})();
```

**Wire‑up notes — confirmed against Pro (PR #288):**
- **Source textarea id:** `source` — `document.getElementById('source')`.
- **Preview refresh:** `updatePreview()` (`renderer.js`).
- **ChordPro import:** `importChordPro(text)` (`importPipeline.js`) — **returns a CSMPN string**; set it as the source value.
- **MusicXML import:** `importMusicXML(xml)` (`importPipeline.js`) — **returns a `SongModel`**, not editor text. Call `song.toCSMPN({ barsPerRow })` to get the CSMPN string. (Do **not** rely on `importMusicXML()` populating the editor — it doesn't.)
- Pro's file-import handlers load CSMPN via `source.value` → `extractHeaderFromText()` → `updatePreview()`; the receiver mirrors that flow for every format. (Since 2026-08-18 Pro stores the **unfiltered** CSMPN, so `; lyric` lines survive for Lyrics / Perform Lyrics; `updatePreview()` hides them when *Include lyrics* is off. Earlier versions of this snippet ran `filterLyricsLines()` first, which threw the lyrics away.)
- If the CSMPN path should also run `expandCSMPNRepeats` or seed Fake Book settings, do that here — but keep it inside this isolated IIFE.
- This adds an entry point and modifies **no** existing trigger, so PowerTab and every other feature are unaffected.

---

## Optional `parts[]` — one chart per instrument (2026-10-25)

An additive field on the **same** `v:1` envelope. A sender charting several instruments from one
recording (Tab Translator Pro's stems panel → **→ Chord Sheet Maker Pro (all parts)**) adds:

```json
{
  "v": 1,
  "source": "tab-translator-pro",
  "title": "Song Title",
  "formats": { "csmpn": "…the band chart…" },
  "parts": [
    { "name": "Guitar", "role": "other", "formats": { "csmpn": "Title: Song Title — Guitar\n…" } },
    { "name": "Bass",   "role": "bass",  "formats": { "csmpn": "Title: Song Title — Bass\n…" } }
  ]
}
```

- **`formats` stays the primary chart** (the band chart). A receiver that doesn't know `parts`
  loads that chart and ignores the rest, so the envelope version does **not** change.
- Each part: `name` (display), `role` (informational — `other`/`guitar`/`bass`/`vocals`/`piano`…),
  `formats.csmpn` (required; a part without it is skipped). At most **16** parts are read.
- Every part is charted on the **same beat grid and tempo**, so bar numbers line up across parts.
- **Receiver (implemented):** `chord-sheet-maker-pro` `handoffParts.js` (`window.HandoffParts`,
  pure): `normalizeParts(env)` validates; `mergePartsIntoLibrary(library, parts)` upserts each part
  into the song library by its CSMPN `Title:` line (else `"<title> — <name>"`), replacing an entry
  with the same title. `consumeCsmHandoff` runs it only **after** the primary chart has loaded and
  lists the saved parts in the status line. There is no part switcher yet: parts are separate
  library songs, one **Load** away.

---

## CSMPN `Tempo Map:` header (2026-10-25)

Charts made from a recording may carry a tempo that moves. The sender writes the usual `Tempo:`
line (the opening tempo) **plus** a map:

```
Tempo: 117.6
Tempo Map: 1=117.6 9=119.2 17=118.4
```

- `bar=bpm` pairs (♩ per minute, floats allowed), space-separated, in bar order; each change takes
  effect at the **start** of that bar (changes sit on bar lines). Bar 1 is the first bar of the chart.
- It is a header line, never a bar. Readers that don't know it should ignore it like any unknown
  `Key: value` header.
- **Writer:** Tab Translator Pro (`scoreToCSMPN`), only when the performance tempo actually changes.
- **Reader:** Chord Sheet Maker Pro — `parseTempoMap` (`csmpnParser.js` + `src/parsers/csmpnParser.ts`)
  → `doc.tempoMap`; playback (`audioPlayback.js`) and MusicXML export (`renderer.js`, `<sound tempo>`)
  follow it bar by bar.
- **chord-sheet-maker** writes CSMPN (`buildCsmpnFakeBookSource`, `buildCsmpnFromChartDocument`) but
  never reads it, so it needs no change; its own charts carry a single `Tempo:`.

---

## Lyrics handoff — `csm:lyrics:v1` (→ Pro Perform Lyrics, 2026-09-16)

A third same-origin channel: a clean **lyrics-only** sheet for Pro's auto-scrolling stage view.

- **Storage key:** `localStorage["csm:lyrics:v1"]`
- **Trigger param:** Pro is opened at `…/chord-sheet-maker-pro/?import=lyrics`
- **Envelope (JSON):**
  ```json
  {
    "v": 1,
    "source": "tab-translator-pro",
    "createdAt": "<ISO-8601>",
    "title": "Song Title",
    "artist": "Artist",
    "lyrics": "VERSE 1\nfirst line\nsecond line\n\nCHORUS\n…"
  }
  ```
- `lyrics` holds section headers (UPPERCASE) and stanzas only, blank line between stanzas and
  sections, **no title line** — `title` / `artist` ride as their own fields.
- **Sender (implemented):** `tab-translator-pro` Lyrics → Import → **🎤 Perform on Chord Sheet Maker
  Pro** (`sendToPerform` in `LyricsImport`, after it strips the chords from a chords-over-lyrics or
  ChordPro sheet).
- **Receiver (implemented):** `chord-sheet-maker-pro` `consumeLyricsHandoff` in `index.html`: reads
  and clears the key once, strips the query param, opens Perform Lyrics seeded with the words, title
  and artist. Wrapped in try/catch.

---

## Testing
- Works on the **deployed Pages sites** (same origin). Two local dev servers are *different* origins, so end‑to‑end testing should be done against the deployed builds (or a single combined dev server).
- Quick check: in `chord-sheet-maker`, load a chart → **Open in Pro ↗** → Pro should open with the chart already in its editor/preview.

---

## Reverse direction — "Decode this tab" (→ Tab Translator Pro)

The handoff is **bidirectional**. A finishing app can hand a *raw tab file* (not a chart)
**back** to **`tab-translator-pro`** for recognition with its fret→chord + key engine.

- **Storage key:** `localStorage["ttp:decode:v1"]`
- **Trigger param:** Tab Translator is opened at `…/Tab-Translator-Pro/?import=decode`
- **Envelope (JSON):**
  ```json
  {
    "v": 1,
    "source": "chord-sheet-maker-pro",
    "createdAt": "<ISO-8601>",
    "filename": "song.gp",
    "b64": "<base64 of the raw file bytes>"
  }
  ```
- **No `format` field** — Tab Translator detects GP3-8 / GPX / Power Tab / MusicXML by magic
  bytes (and `%PDF` for the PDF pipeline), exactly as its file-upload path does.
- **Sender (implemented):** `chord-sheet-maker-pro` `index.html` — the
  **Decode tab → Tab Translator Pro ↗** import-menu item (`fileInputDecode`): chunked-base64
  the bytes (call-stack-safe), ~3 MB quota guard, write the envelope, same-tab navigate.
- **Receiver (implemented):** `tab-translator-pro` `TabDecoderPro.tsx` — two on-mount effects
  read+clear the key one-shot, `atob`→`Uint8Array`, and route to `parseGuitarProOrXML`
  (xml/GP mode) or the PDF pipeline (gated on PDF.js load). Lands on part 0; the user
  switches parts. Wrapped in try/catch; strips the query param.
- Same versioning rule (`:v1` / `v:1`).

---

## Versioning
The key is suffixed `:v1` and the envelope carries `v: 1`. Any breaking change to the schema bumps both (`csm:handoff:v2` / `ttp:decode:v2` / `csm:lyrics:v2`), so an old sender and new receiver never silently misinterpret a payload. **Additive, optional fields** that an old receiver can safely ignore (`parts[]`, the `Tempo Map:` header) do **not** bump the version.
