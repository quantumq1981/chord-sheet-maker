/**
 * guitarProConverter.ts
 *
 * Utilities that operate on an AlphaTab Score model parsed from a Guitar Pro
 * file (GP3, GP4, GP5, GPX).  Three public exports:
 *
 *   gpScoreToChordPro()     — Convert chord/lyric data to ChordPro text.
 *   gpScoreTrackNames()     — Extract display names for the track selector.
 *   gpScoreNotePositions()  — Extract every (string, fret) played position for
 *                             each unique pitch in a track, for the fretboard
 *                             positions panel.
 */

import type * as alphaTabNS from '@coderline/alphatab';
import type { NotePositionMap, VexTabPosition } from './musicXMLtoVexFlow';

// ─── ChordPro output ─────────────────────────────────────────────────────────

export interface GpChordProResult {
  text: string;
  warnings: string[];
}

// Matches strings that look like chord names: start with A–G, followed by
// optional accidentals and standard suffix tokens, no spaces.
// Examples: C, Dm, G7, F#m7, Bb13, Cmaj7, EØ, F#m7b5, C/E, AB9, D7M
const CHORD_TEXT_RE = /^[A-G][#b]?(?:maj|min|dim|aug|sus[24]?|add|[°ø+ΔmM]|[0-9]+|[#b][0-9]*|\/[A-G][#b]?|[()])*$/;

function looksLikeChordName(text: string): boolean {
  const t = text.trim();
  return t.length >= 1 && t.length <= 14 && CHORD_TEXT_RE.test(t);
}

/**
 * Scan all tracks and return the index of the one most likely to carry chord
 * symbol data, together with the primary data source type.
 *
 * Scoring heuristic (higher = better chord source):
 *  +3 per beat that references a chord diagram (beat.chordId)
 *  +1 per beat whose text annotation looks like a chord name
 *  +30 if the track name contains "chord" (case-insensitive)
 *
 * Ties are broken in favour of a lower track index.
 */
export function findChordSourceTrack(
  score: alphaTabNS.model.Score,
  primaryTrackIndex: number,
): { trackIdx: number; hasDiagrams: boolean } {
  let bestIdx = primaryTrackIndex;
  let bestScore = -1;

  for (let ti = 0; ti < score.tracks.length; ti++) {
    const track = score.tracks[ti];
    const staff = track?.staves?.[0];
    if (!staff) continue;

    let s = 0;
    for (const bar of staff.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          if (beat.chordId) s += 3;
          else if (beat.text && looksLikeChordName(beat.text)) s += 1;
        }
      }
    }
    if (track.name?.toLowerCase().includes('chord')) s += 30;

    if (s > bestScore) {
      bestScore = s;
      bestIdx = ti;
    }
  }

  if (bestScore <= 0) return { trackIdx: primaryTrackIndex, hasDiagrams: false };

  // Determine whether winning track is diagram-based or text-based.
  const wStaff = score.tracks[bestIdx]?.staves?.[0];
  let diagCount = 0;
  if (wStaff) {
    for (const bar of wStaff.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          if (beat.chordId) diagCount++;
        }
      }
    }
  }

  return { trackIdx: bestIdx, hasDiagrams: diagCount > 0 };
}

/**
 * Extract chord names and lyrics from the score and emit ChordPro text.
 *
 * Strategy:
 *  1. Find the "chord source" track — the track with the most chord-diagram
 *     references (beat.chordId). If no diagram data exists, fall back to beats
 *     whose text annotations look like chord names. This means chords are often
 *     taken from a different track than the one the user is viewing (e.g. a
 *     dedicated "Chords" track in Confirmation.gp, or the guitar track in a
 *     multi-track GP4 file).
 *
 *  2. Walk the chord source track bar by bar, parallel to score.masterBars so
 *     that section markers (masterBar.section.text) are emitted as {comment:}.
 *
 *  3. Within each bar, deduplicate consecutive identical chord names so a bar
 *     where all 4 beats share the same chord emits just one symbol.
 *
 *  4. Chord name resolution order per beat:
 *       a. beat.chord?.name   (chord diagram name — always trust this)
 *       b. beat.text          (if it passes the chord-name regex)
 *
 *  5. If the melody track (trackIndex) has lyrics, emit inline [Chord]lyric
 *     format using lyrics from that track. Otherwise emit a pipe-grid row.
 */
export function gpScoreToChordPro(
  score: alphaTabNS.model.Score,
  trackIndex = 0,
): GpChordProResult {
  const warnings: string[] = [];
  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  if (score.title)   lines.push(`{title: ${score.title}}`);
  if (score.artist)  lines.push(`{artist: ${score.artist}}`);
  if (score.album)   lines.push(`{album: ${score.album}}`);
  if (score.tempo > 0) lines.push(`{tempo: ${score.tempo}}`);
  lines.push('');

  const melodyTrack = score.tracks[trackIndex];
  if (!melodyTrack) {
    warnings.push(`Track index ${trackIndex} not found in score.`);
    return { text: lines.join('\n'), warnings };
  }

  const melodyStaff = melodyTrack.staves[0];
  if (!melodyStaff?.bars.length) {
    warnings.push('No bars found in selected track.');
    return { text: lines.join('\n'), warnings };
  }

  // ── Find best chord source ───────────────────────────────────────────────
  const { trackIdx: chordTrackIdx } = findChordSourceTrack(score, trackIndex);
  const chordTrack = score.tracks[chordTrackIdx];
  const chordStaff = chordTrack?.staves?.[0];

  if (!chordStaff?.bars.length) {
    warnings.push('No chord symbols found in this file.');
    return { text: lines.join('\n'), warnings };
  }

  if (chordTrackIdx !== trackIndex) {
    const srcName = chordTrack.name?.trim() || `Track ${chordTrackIdx + 1}`;
    warnings.push(`Chord symbols taken from "${srcName}".`);
  }

  // ── Lyrics check (on melody track) ──────────────────────────────────────
  let hasAnyLyrics = false;
  outerLyrics: for (const bar of melodyStaff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        if (beat.lyrics?.some((l) => l?.trim())) {
          hasAnyLyrics = true;
          break outerLyrics;
        }
      }
    }
  }

  // ── Section marker index (masterBar index → section text) ───────────────
  const sectionAtBar = new Map<number, string>();
  for (const mb of score.masterBars) {
    if (mb.section) sectionAtBar.set(mb.index, mb.section.text);
  }

  // ── Bar walk ─────────────────────────────────────────────────────────────
  let pendingSection: string | null = null;

  const barCount = chordStaff.bars.length;

  for (let barIdx = 0; barIdx < barCount; barIdx++) {
    // Queue section marker (emitted lazily before the first non-empty bar).
    if (sectionAtBar.has(barIdx)) {
      pendingSection = sectionAtBar.get(barIdx)!;
    }

    const chordBar = chordStaff.bars[barIdx];
    const chordVoice = chordBar?.voices[0];
    if (!chordVoice) continue;

    // ── Build (chord, lyric) pairs for this bar ──────────────────────────
    const pairs: Array<{ chord: string; lyric: string }> = [];

    for (const beat of chordVoice.beats) {
      if (beat.isEmpty) continue;

      // Chord name: diagram name takes priority; chord-like text is fallback.
      let chord = '';
      const diagName = beat.chord?.name?.trim() ?? '';
      if (diagName) {
        chord = diagName;
      } else if (beat.text && looksLikeChordName(beat.text)) {
        chord = beat.text.trim();
      }

      // Lyric: from the melody track at the same beat position, when lyrics
      // mode is active. Beat index alignment works because all tracks in a GP
      // file share the same bar/beat structure within each bar.
      let lyric = '';
      if (hasAnyLyrics) {
        const melodyBeat = melodyStaff.bars[barIdx]?.voices[0]?.beats[
          chordVoice.beats.indexOf(beat)
        ];
        lyric = melodyBeat?.lyrics?.[0]?.trim() ?? '';
      }

      pairs.push({ chord, lyric });
    }

    // Deduplicate consecutive identical chords within the bar so that a bar
    // where all beats carry the same chord symbol emits it only once.
    const dedupedPairs: typeof pairs = [];
    let lastChord = '';
    for (const p of pairs) {
      if (p.chord !== lastChord || p.lyric) {
        dedupedPairs.push(p);
        if (p.chord) lastChord = p.chord;
      }
    }

    const hasChords = dedupedPairs.some((p) => p.chord);
    const hasLyrics = dedupedPairs.some((p) => p.lyric);
    if (!hasChords && !hasLyrics) continue;

    // Emit pending section marker before the first chord-bearing bar of each
    // section so that empty instrumental intro bars don't push the comment
    // away from the chords it annotates.
    if (pendingSection !== null) {
      lines.push('');
      lines.push(`{comment: ${pendingSection}}`);
      pendingSection = null;
    }

    if (hasAnyLyrics) {
      // Inline format: [Chord]lyric syllable
      let line = '';
      for (const { chord, lyric } of dedupedPairs) {
        if (chord) line += `[${chord}]`;
        line += lyric;
      }
      if (line.trim()) lines.push(line);
    } else {
      // Grid format: | C | Am | F | G |
      const chords = dedupedPairs.map((p) => p.chord).filter(Boolean);
      if (chords.length) lines.push('| ' + chords.join(' | ') + ' |');
    }
  }

  // Warn if the output body ended up empty (header-only).
  const bodyLines = lines.filter((l) => l && !l.startsWith('{'));
  if (!bodyLines.length) {
    warnings.push('No chord symbols found in this file.');
  }

  return { text: lines.join('\n'), warnings };
}

// ─── Track names ─────────────────────────────────────────────────────────────

/**
 * Return display names for all tracks in the score.
 * Falls back to "Track N" when a track has no name.
 */
export function gpScoreTrackNames(score: alphaTabNS.model.Score): string[] {
  return score.tracks.map((t, i) => t.name?.trim() || `Track ${i + 1}`);
}

// ─── Fretboard note positions ─────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}

/**
 * Walk every note in voice 0 of staff 0 of the given track and collect all
 * unique (string, fret) positions grouped by MIDI pitch.
 *
 * The GP Note model provides explicit string/fret positions, so unlike the
 * heuristic algorithm used for MusicXML, these are exact fingerings from the
 * original arrangement.
 */
export function gpScoreNotePositions(
  score: alphaTabNS.model.Score,
  trackIndex = 0,
): NotePositionMap[] {
  const track = score.tracks[trackIndex];
  if (!track) return [];

  const staff = track.staves[0];
  if (!staff) return [];

  // staff.tuning: MIDI values of each open string, index = string - 1
  const openMidis: number[] = staff.tuning ?? [];

  // Map from MIDI pitch → Set of unique (string, fret) positions
  const byMidi = new Map<number, Set<string>>();
  const posMap = new Map<number, VexTabPosition[]>();

  for (const bar of staff.bars) {
    const voice = bar.voices[0];
    if (!voice) continue;
    for (const beat of voice.beats) {
      for (const note of beat.notes) {
        if (note.isTieDestination) continue; // skip tie continuations — same note

        const str = note.string;    // 1-based string number
        const fret = note.fret;     // fret number (0 = open)

        if (str < 1 || str > openMidis.length) continue;
        const midi = openMidis[str - 1] + fret;

        const key = `${str}:${fret}`;
        if (!byMidi.has(midi)) {
          byMidi.set(midi, new Set());
          posMap.set(midi, []);
        }
        if (!byMidi.get(midi)!.has(key)) {
          byMidi.get(midi)!.add(key);
          posMap.get(midi)!.push({ str, fret });
        }
      }
    }
  }

  return Array.from(posMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([midi, positions]) => ({
      midi,
      name: midiToName(midi),
      positions,
    }));
}
