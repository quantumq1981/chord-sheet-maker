
# Unified Song Model Technical Specification

## Corpus basis and design stance

A workable “global music schema” needs two different kinds of evidence at once: authoritative format specifications for what each file *can* mean, and large corpus priors for what songs *usually* contain. For the first layer, the stable references are the official docs for urlMusicXML 4.0turn1search14, urlLilyPondturn7search12, urlChordProturn10search5, urlABC standard v2.1turn12search1, urlalphaTabturn14search0, and the official support/docs surfaces for Guitar Pro and Ultimate Guitar. Those sources make one architectural fact impossible to ignore: the formats sit on a fidelity ladder, from deeply semantic score encodings down to “good luck, it’s plain text.” citeturn1search14turn9view0turn9view1turn9view2turn11view1turn13view1turn13view2turn13view3turn64view0turn20view0

For the harmonic classifier, a practical seed corpus already exists. The published urlChoCo repositoryturn23view3 reports 20,080 JAMS files, 20,530 Harte chord annotations, and symbolic partitions that include 6,500+ Wikifonia items, 5,000+ Band-in-a-Box items, 2,486 Real Book charts, 2,000+ iReal Pro items, and 1,000+ Nottingham ABC tunes. Its published notebook also reports that an annotation uses 14.92 ± 11.10 unique chord classes on average, and its most common bigrams include dominant-to-tonic motions such as G7→C and C7→F, plus jazz-defining ii–V fragments such as Dm7→G7 and Gm7→C7. A second, noisier but very large weak-supervision layer is the urlChordonomicon dataset cardturn58view0, which exposes 679,807 rows of chord-progressions plus section labels, genre tags, and release metadata. That is more than enough to bootstrap a production genre guesser, while still treating score-native formats as the source of truth. citeturn26view0turn37view0turn50view0turn31view1turn58view0turn57view0

## Structural comparison across the target formats

The canonical intake order should be **semantic score first, fretted-performance notation second, chord-lyric text third, loose ASCII last**. In practice that means: trust MusicXML and LilyPond most for rhythm, meter, and authored layout; trust Guitar Pro and alphaTab most for playable voicing and fingerboard truth; trust ChordPro and ABC for harmony, lyrics, and lead-sheet structure; and treat non-official Ultimate Guitar ASCII/text as a high-variance surface representation that often needs inference before rendering. citeturn6view0turn6view1turn9view0turn9view1turn9view2turn16view3turn17view3turn11view1turn13view4turn20view0

- **MusicXML** stores key and time semantically in score attributes, and tempo either as playback tempo in `<sound tempo>` or as notated tempo markings via direction/metronome elements. It also preserves authored system breaks through `<print new-system="yes">`, which is gold for keeping a chart’s intended line breaks. Signal-loss risk is therefore low unless an importer ignores print/layout tags. citeturn4view0turn4view1turn6view0turn6view1

- **LilyPond** encodes key, time, and tempo explicitly with `\key`, `\time`, and `\tempo`, while page and system layout can be constrained through paper/layout variables such as `systems-per-page` and `system-count`. Because LilyPond is text syntax that compiles into engraving, it is semantically rich, but some layout intent is procedural rather than a simple stored page map; preserve explicit breaks and layout settings if present, and otherwise reflow from bar structure. Signal-loss risk is still low, but literal layout recovery can be a notch less direct than MusicXML. citeturn9view0turn9view1turn9view2turn9view3

- **Guitar Pro / alphaTab** are the best source for playable guitar truth. alphaTab’s model defines fretted notes as the combination of staff string tuning and a fret on a particular string; its note model stores both `fret` and `string`, and staff metadata stores tunings, capo, and chord-diagram definitions. alphaTex also stores key signature, time signature, tempo changes, sections, and pickup bars directly. For file formats, GP3–GP5 are proprietary binary files that alphaTab describes as partly reverse-engineered, GP6/GPX uses a proprietary container with XML `score.gpif`, and GP7+ uses a zip archive with `score.gpif` plus auxiliary config. Signal-loss risk is moderate: musically strong, but older binary formats depend on importer quality, and even alphaTab’s own MusicXML support table is partial rather than complete. citeturn17view3turn17view1turn17view0turn16view3turn64view0turn15search0turn15search7turn16view1turn15search9

- **ChordPro** explicitly standardizes `key`, `time`, `tempo`, and `capo` as metadata/directives, and also has dedicated environments for chord grids and tabs. That makes it strong for harmony, lyrics, sectioning, and singer-songwriter workflows, but weak for exact note durations unless the author also supplies a grid or tab block. Signal-loss risk is medium-high for detailed rhythm, low for chords/lyrics/capo. citeturn11view0turn11view1turn11view2turn11view3

- **ABC** remains text-based but surprisingly semantic: `M:` for meter, `Q:` for tempo, `K:` for key, and `I:linebreak` or code line breaks for score line breaks. It is especially good for monophonic melody-plus-chords and folk/trad material, with substantially less guesswork than raw ASCII. Signal-loss risk is medium-low for lead sheets, but rises when the target display expects dense polyphonic engraving or detailed guitar-specific fingering. citeturn13view1turn13view2turn13view3turn13view4turn12search1

- **Ultimate Guitar ASCII / text tabs** split into two very different worlds. The platform’s own docs say official/pro tabs provide full sheet music and interactive notation, while non-official tabs are user-submitted and “often found in text format,” sometimes as uploaded Guitar Pro files. Their support docs also describe the text-tab surface directly: lines represent strings, numbers represent frets, and stacked positions indicate simultaneity. Therefore the real signal-loss risk is not “Ultimate Guitar” per se; it is **non-official text uploads**. Those are high risk for exact rhythm, medium risk for harmony, and often still very good for riffs and guitar-centric voicings. citeturn20view0turn20view2turn21search7

## Signal-loss map and extraction logic

The importer should assign a `semanticTier` and `lossMap` during parse. A good default is: `tier_4_structured` for MusicXML and LilyPond, `tier_3_fretted` for Guitar Pro and alphaTab, `tier_2_leadsheet` for ChordPro and ABC, and `tier_1_ascii` for non-official text tabs and crude chord-over-lyrics text. The rule is simple: **never infer something at a higher tier if a lower-tier source did not actually encode it**. A chord/lyric sheet may justify harmony and structure inference, but not precise beat-level onset data unless bar symbols, repeated grid spacing, or explicit rhythmic notation survived import. citeturn6view0turn6view1turn64view0turn11view1turn13view4turn20view0

For **measure-break preservation**, use authored breaks whenever they exist. In MusicXML, preserve `<print new-system="yes">` and any measure-layout information. In LilyPond, preserve explicit engraver/layout instructions and page/system constraints if present; if they are absent, derive line breaks from bar count and phrase boundaries instead of blindly copying code lines. The jazz default should be: 4 bars per line, except when a pickup bar, first/second ending, rehearsal mark, repeat boundary, or explicit authored system break would make the line uglier than the rule is helpful. That “Real Book” look is not present in the spec itself; it is a rendering policy layered on top of the measure system that both formats already expose. citeturn6view1turn9view3turn7search17

For **ASCII and crude text detection**, use a three-pass scanner. First, detect **tab blocks** with a regex family like `^(e|B|G|D|A|E)\|[-0-9hpbtrx/\\~().]+$` across at least four adjacent lines; that inference is grounded in the platform’s own description that lines are strings and numbers are frets. Second, detect **chord lines** with a permissive chord token regex such as `\b([A-G](#|b)?(maj|min|m|dim|aug|sus|add|alt)?[0-9]*(\/[A-G](#|b)?)?)\b`, but require a high ratio of valid chord tokens to ordinary words and strong alignment with a lyric line directly below. Third, detect **grid lines** by the rectangular use of bars, dots, repeats, and chord tokens, because ChordPro’s grid environment formalizes exactly that visual pattern. citeturn20view2turn20view0turn11view3

The **density scanner** should not merely count characters; it should compute style signals:

```text
lyric_density = lyric_word_lines / total_body_lines
tab_density = ascii_tab_lines / total_body_lines
chord_density = chord_token_count / total_body_lines
grid_density = bar_or_repeat_symbols / total_body_lines
section_density = section_markers / total_body_lines
```

Then apply layout heuristics: high `lyric_density` + moderate `chord_density` suggests a singer-songwriter or pop chart; high `tab_density` + low lyric density suggests riff-first rock or metal; high `grid_density` + high seventh/extension density suggests a jazz or rehearsal chart; low lyric density + many named sections often indicates an instrumental or teaching chart. The exact thresholds are implementation choices, but the evidence for the feature families comes directly from how ChordPro distinguishes lyrics, tabs, and grids, and how Ultimate Guitar distinguishes interactive notation from text tabs. citeturn11view1turn11view3turn20view0turn20view2

For **fingerboard logic**, compute pitch from `stringTuning + fret`, exactly as alphaTab’s model does, then classify voicings by physical plausibility and known tuning families. If the stored tuning matches known families such as standard, drop D, DADGAD, open G, open D, or common seven-string variants, mark it `tuningKnown=true`; otherwise classify it as alternate/custom. A voicing is “standard/open-shape leaning” if it centers on frets 0–4, uses several open strings, and roughly fits known CAGED/open-shape templates; it is “moveable/closed” if all fretted notes shift as a block; and it is “alternate-tuning dependent” if the chord only makes musical sense under the stored non-standard tuning or capo. This lets the renderer prefer a fretboard-first layout when the file truly contains performable string/fret semantics, rather than just named chords. citeturn17view3turn17view1turn17view0turn16view3turn16view4

## Harmonic fingerprinting and genre detection

The harmonic miner should normalize every parsed chord symbol into a canonical tuple:

`root, qualityFamily, extensions[], alterations[], suspension, bass, source_native`

A Harte-like internal normalization is ideal because it can absorb MusicXML harmony, ChordPro chord text, ABC inline chord names, Guitar Pro chord diagrams, and text-sheet chord tokens into one comparable representation. On the corpus side, ChoCo already standardizes multiple original notations into Harte and Roman families, and its published notebook shows the expected tonal center-of-gravity: among the most frequent bigrams are G7→C, G→C, D→G, D7→G, C7→F, C→G, C→F, and also Dm7→G7 and Gm7→C7. That is exactly the right starting point for a weighted genre prior: common-practice and pop harmony dominate overall volume, while ii–V material sharply raises jazz probability. citeturn23view3turn50view0

A good bootstrapped classifier is not a single genre labeler; it is a **signal combiner**. The weights below are deliberately asymmetric: rare but high-precision chords like `m7b5` or `alt` should contribute more than frequent but low-precision chords like plain `maj` or `min`; format features like capo, tab blocks, and lyric density then break ties between genres that share similar harmony. The constants below are a practical starting point, not sacred scripture carved into Mount MIDI. citeturn26view0turn50view0turn20view0turn11view0turn16view3

```text
Let rate(X) = occurrences of token family X / total parsed chords
Let present(X) = 1 if feature exists, else 0
Let z(X) = corpus-normalized z-score against training priors

jazz_score =
  6*z(rate(m7b5)) +
  6*z(rate(alt)) +
  5*z(rate(13)) +
  4*z(rate(maj7)) +
  3*z(rate(min7)) +
  4*z(rate(ii_V_bigrams)) +
  3*z(rate(turnaround_bigrams)) +
  2*present(chord_grid) +
  2*(1 - lyric_density)

rock_blues_score =
  5*z(rate(power_chord_5)) +
  4*z(rate(dom7)) +
  3*z(rate(sus2_sus4)) +
  3*z(rate(blues_I_IV_V_cycles)) +
  3*tab_density +
  2*riff_repeat_density +
  1*triplet_or_shuffle_feel

folk_pop_score =
  5*z(cowboy_chord_share) +
  4*present(capo) +
  3*lyric_density +
  3*z(rate(I_V_vi_IV_and_variants)) +
  2*z(rate(simple_major_minor_triads)) +
  1*(meter in {4/4, 3/4, 6/8})
```

Implementation details matter here. `cowboy_chord_share` should count open-position families such as G, C, D, Am, Em, E, A, F/Fmaj7 and their common slash/capo-transposed surface forms. `ii_V_bigrams` should count both literal and transposition-normalized ii–V motion. `power_chord_5` should only be trusted fully when the source also contains tab/fret evidence, because pure chord sheets sometimes simplify full sonorities as `5` for readability. `maj7` should help jazz, but modestly, because soft rock, R&B, and adult-contemporary ballads also love it. And `capo` is a strong folk/pop signal only when it coexists with lyric-heavy or chord/lyric formats; in alphaTab/Guitar Pro it can simply reflect a performance convenience rather than genre. citeturn11view0turn16view3turn17view3turn20view0turn58view0

Recommended decision policy:

- If one score exceeds the next-best by at least **2.0 standard units**, choose that genre/theme directly.  
- If the top two are close, use **format tie-breakers**: grids and sparse lyrics nudge toward jazz; tab density and repeated riff cells nudge toward rock/blues; capo + lyric density + simple triads nudge toward folk/pop. citeturn11view3turn20view0turn16view3
- If all three are weak, emit `genreGuess = unknown` and let rendering fall back to format-priority rather than pretend the system knows what it does not know. That is especially important for orchestral scores, modern classical charts, and hybrid educational materials. citeturn6view1turn9view3turn15search9

## Universal JSON song schema

The schema should preserve **three parallel truths**: what the source explicitly said, what the parser inferred, and how safe that inference is. The core mistake to avoid is flattening everything into “notes + chords + lyrics” and throwing away the source-native representation. MusicXML’s authored system breaks, alphaTab’s string/fret information, ChordPro’s capo metadata, ABC’s inline meter changes, and ASCII text-block geometry are all musically meaningful, just in different ways. citeturn6view1turn17view3turn16view3turn11view0turn13view4turn20view0

```json
{
  "schemaVersion": "1.0.0",
  "songId": "uuid",
  "title": "",
  "creators": {
    "composer": [],
    "lyricist": [],
    "arranger": [],
    "artist": []
  },
  "source": {
    "format": "musicxml|lilypond|gp3|gp4|gp5|gpx|gp|alphatex|chordpro|abc|ug_text|ascii_tab|plain_text",
    "semanticTier": "tier_4_structured|tier_3_fretted|tier_2_leadsheet|tier_1_ascii",
    "sourceNative": {},
    "importer": {
      "name": "",
      "version": "",
      "warnings": []
    }
  },
  "metadata": {
    "key": {
      "display": "D major",
      "concert": "E major",
      "detected": false,
      "confidence": 1.0
    },
    "timeSignature": {
      "numerator": 4,
      "denominator": 4,
      "pickupBeats": 0.0,
      "changes": []
    },
    "tempo": {
      "bpm": 120,
      "text": "Moderato",
      "beatUnit": "quarter",
      "changes": []
    },
    "capo": {
      "fret": null,
      "sourceDeclared": false
    },
    "tuning": [
      {
        "staffId": "gtr1",
        "label": "standard",
        "pitches": ["E2", "A2", "D3", "G3", "B3", "E4"],
        "knownFamily": true
      }
    ]
  },
  "structure": {
    "sections": [
      {
        "id": "A",
        "label": "Verse",
        "startMeasure": 1,
        "endMeasure": 8,
        "sourceDeclared": true
      }
    ],
    "repeats": [],
    "endings": [],
    "rehearsalMarks": []
  },
  "timeline": {
    "divisionsPerQuarter": 480,
    "measures": [
      {
        "number": 1,
        "nominalBeats": 4.0,
        "actualBeats": 4.0,
        "systemBreakBefore": false,
        "pageBreakBefore": false,
        "layoutHints": {
          "preferredBarsPerLine": 4,
          "realBookEligible": true
        }
      }
    ]
  },
  "parts": [
    {
      "partId": "gtr1",
      "name": "Guitar",
      "family": "fretted|stringed|keyboard|voice|horn|drums|other",
      "staves": [
        {
          "staffId": "gtr1_staff1",
          "showStandardNotation": true,
          "showTablature": true,
          "voices": [
            {
              "voiceId": "v1",
              "events": [
                {
                  "type": "note|rest|chordSymbol|lyric|direction|barline",
                  "measure": 1,
                  "beat": 1.0,
                  "tick": 0,
                  "durationTicks": 480,
                  "pitch": "E4",
                  "fretted": {
                    "string": 1,
                    "fret": 0
                  },
                  "articulation": [],
                  "sourceNative": {},
                  "confidence": 1.0
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "harmony": {
    "globalProgression": [],
    "events": [
      {
        "measure": 1,
        "beat": 1.0,
        "symbol": "G7",
        "normalized": {
          "root": "G",
          "qualityFamily": "dom7",
          "extensions": [],
          "alterations": [],
          "suspension": null,
          "bass": null
        },
        "sourceNative": "G7",
        "confidence": 1.0
      }
    ],
    "grid": {
      "present": false,
      "cells": []
    }
  },
  "lyrics": {
    "lines": [],
    "syllableAligned": false,
    "language": "en"
  },
  "analytics": {
    "density": {
      "lyricDensity": 0.0,
      "tabDensity": 0.0,
      "chordDensity": 0.0,
      "gridDensity": 0.0
    },
    "harmonicFingerprint": {
      "cowboyChordShare": 0.0,
      "dom7Rate": 0.0,
      "maj7Rate": 0.0,
      "min7b5Rate": 0.0,
      "altRate": 0.0,
      "powerChordRate": 0.0,
      "iiVRate": 0.0
    },
    "genreGuess": {
      "primary": "jazz|rock_blues|folk_pop|orchestral_score|unknown",
      "scores": {
        "jazz": 0.0,
        "rock_blues": 0.0,
        "folk_pop": 0.0
      },
      "confidence": 0.0
    }
  },
  "lossMap": {
    "rhythmExplicit": true,
    "voicingExplicit": true,
    "layoutExplicit": true,
    "lyricsAligned": false,
    "warnings": []
  },
  "renderHints": {
    "preferredTheme": "score|real_book|chordpro|alphatab|ascii_tab|lyrics_sheet",
    "preferredBarsPerLine": null,
    "hideLyrics": false,
    "showChordDiagrams": false,
    "showTab": false,
    "showConcertKey": true
  }
}
```

The important invariants are these. First, every harmonic event stores both `symbol` and `normalized`; the former preserves authorial spelling, the latter powers search and genre detection. Second, `lossMap` is mandatory, because a beautiful renderer built on fake precision is just a liar in a tuxedo. Third, layout is split into **timeline facts** and **render hints** so that authored breaks survive import without hard-wiring a single visual theme. Fourth, `sourceNative` exists at multiple levels so future converters can round-trip more faithfully than the first parser did. citeturn6view1turn17view3turn11view1turn13view4turn20view0

## Rendering priority and auto-switching matrix

The renderer should choose its theme by **information richness first, genre second, cosmetics last**. In other words, do not force a text chord sheet into a faux orchestral score just because the user likes serif fonts, and do not flatten a fully voiced Guitar Pro file into chord-over-lyrics just because the chorus only has four chords. The format tells you what the song *can* safely display; the genre tells you what it will probably look best as. citeturn15search0turn16view1turn20view0turn11view1

Recommended priority list:

- **Full score / orchestral theme**  
  Use when the source is MusicXML or LilyPond and contains multiple pitched parts, independent voices, or stable authored system breaks. Show conventional notation first, preserve explicit layout where possible, and only apply genre styling lightly. This is the default for ensemble charts, piano-vocal reductions, and horn-heavy materials. citeturn6view1turn9view3turn1search14

- **alphaTab / fretboard-first theme**  
  Use when note events carry reliable `string` + `fret` + `tuning` semantics, or when the source is Guitar Pro/alphaTab. If both staff and tab are available from one staff model, render them as linked views. This is the highest-priority theme for guitar pedagogy, riffs, solos, alternate tunings, and voicing-dependent transcription. citeturn17view3turn17view1turn17view0turn16view3

- **Real Book theme**  
  Use when harmony is rich, lyrics are sparse or optional, and jazz signals dominate. Condense to four bars per line when possible, hide most lyrics by default, surface chord grids when present, and privilege measure clarity over decorative spacing. This is the right answer for ChordPro jazz grids, ABC lead sheets, and structured imports whose harmonic fingerprint is jazzy but whose users do not need a conductor’s score. citeturn11view3turn13view4turn50view0

- **ChordPro / singer-songwriter theme**  
  Use when the source is chord-lyric text, lyric density is high, capo is present, and cowboy-chord share is strong. Keep lyrics visible, show chord diagrams only when they are likely to help, and preserve section headers and metadata such as key, time, tempo, and capo. This is the default for pop, folk, worship, campfire, and “I promise it’s just four chords” material. citeturn11view0turn11view1turn11view2turn16view3

- **ASCII tab theme**  
  Use when a genuine tab block is detected but note durations are still implicit. Render in monospace, keep the original line geometry intact, and optionally add a derived chord summary above the block. Never over-normalize the block into re-spaced notation if doing so would destroy the player’s visual landmarks. citeturn20view2turn20view0

- **Unknown / hybrid fallback**  
  If confidence is low, prefer an honest hybrid: sectioned text + detected chords + optional tab pane + an explicit “rhythm inferred” warning. In a messy ecosystem, transparency beats false certainty every time. citeturn20view0turn15search9

The governing rule set can therefore be stated compactly:

```text
if explicit string/fret data exists:
    prefer alphaTab theme
elif structured multi-part notation exists:
    prefer full score theme
elif chord grid exists and jazz_score is highest:
    prefer Real Book theme
elif chords+lyrics exist and lyric_density is high:
    prefer ChordPro theme
elif ASCII tab block exists:
    prefer ASCII tab theme
else:
    prefer hybrid fallback
```

That priority order is the least lossy way to unify the target formats. It honors what the structured formats explicitly encode, uses fretted formats for what only they know, mines text formats for harmony and section clues, and keeps the renderer honest about where it is estimating rather than reading. citeturn6view1turn17view3turn11view1turn11view3turn20view0


 JavaScript parser for Ultimate Guitar ASCII format. 

The parser reads chord/lyric/tab text and produces a JSON object adhering to the Unified Song Model specification, including density metrics, harmonic fingerprint, and a rough genre guess. It also normalizes chord symbols and infers a minimal timeline for chord events while acknowledging rhythm and voicing loss. The file ready for use or to integrate into your app. Is located on the main branch under do the file name ug_ascii_parser.js

You can import and use the exported parseUltimateGuitarAscii function in Node.js:

const fs = require('fs');
const { parseUltimateGuitarAscii } = require('./ug_ascii_parser');

// Read raw ASCII from a file or other source
const input = fs.readFileSync('my_ug_tab.txt', 'utf8');

// Parse and obtain a JSON representation
const songJson = parseUltimateGuitarAscii(input, {
  title: 'My Song',
  composer: ['John Doe']
});

console.log(JSON.stringify(songJson, null, 2));

This shoild generate a JSON object populated with sensible defaults and populated fields where possible. please use best practices to review the data and make sure that his sound and structurally viable maintaining the integrity of the app as a whole so make sure that all work is checked so any errors or inconsistencies can be determined and then immediately resolved to ensure cleanest possible outcome.
