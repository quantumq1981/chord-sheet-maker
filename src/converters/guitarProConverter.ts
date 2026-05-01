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

/**
 * Extract chord names and lyrics from a single track and emit ChordPro text.
 *
 * Strategy:
 *  - Walk voice 0 of staff 0 of the selected track, bar by bar.
 *  - Prefer chord-diagram names (beat.chordId → staff.chords) for chord
 *    symbols; fall back to beat.text annotations.
 *  - If lyrics exist, emit inline `[Chord]lyric` format.
 *  - If no lyrics exist, emit a pipe-grid line per measure.
 */
export function gpScoreToChordPro(score: alphaTabNS.model.Score, trackIndex = 0): GpChordProResult {
  const warnings: string[] = [];
  const lines: string[] = [];

  // Header
  if (score.title)  lines.push(`{title: ${score.title}}`);
  if (score.artist) lines.push(`{artist: ${score.artist}}`);
  if (score.album)  lines.push(`{album: ${score.album}}`);
  if (score.tempo > 0) lines.push(`{tempo: ${score.tempo}}`);
  lines.push('');

  const track = score.tracks[trackIndex];
  if (!track) {
    warnings.push(`Track index ${trackIndex} not found in score.`);
    return { text: lines.join('\n'), warnings };
  }

  const staff = track.staves[0];
  if (!staff || !staff.bars.length) {
    warnings.push('No bars found in selected track.');
    return { text: lines.join('\n'), warnings };
  }

  // Determine whether any beat across the track has lyrics.
  let hasAnyLyrics = false;
  outer: for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        if (beat.lyrics?.some(l => l?.trim())) { hasAnyLyrics = true; break outer; }
      }
    }
  }

  for (const bar of staff.bars) {
    const voice = bar.voices[0];
    if (!voice) continue;

    // Collect (chord, lyric) pairs per beat.
    const pairs: Array<{ chord: string; lyric: string }> = [];
    for (const beat of voice.beats) {
      if (beat.isEmpty) continue;

      // Chord name: prefer diagram name, fall back to beat.text
      let chord = '';
      if (beat.chordId && staff.chords?.has(beat.chordId)) {
        chord = staff.chords.get(beat.chordId)!.name ?? '';
      } else if (beat.text) {
        chord = beat.text;
      }

      const lyric = beat.lyrics?.[0]?.trim() ?? '';
      pairs.push({ chord, lyric });
    }

    const hasChords = pairs.some(p => p.chord);
    const hasLyrics = pairs.some(p => p.lyric);
    if (!hasChords && !hasLyrics) continue;

    if (hasAnyLyrics) {
      // Inline format: build a single line with [Chord]lyric tokens.
      let line = '';
      for (const { chord, lyric } of pairs) {
        if (chord) line += `[${chord}]`;
        line += lyric;
      }
      if (line.trim()) lines.push(line);
    } else {
      // Grid-only format: | C | Am | F | G |
      const chords = pairs.map(p => p.chord).filter(Boolean);
      if (chords.length) lines.push('| ' + chords.join(' | ') + ' |');
    }
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
export function gpScoreNotePositions(score: alphaTabNS.model.Score, trackIndex = 0): NotePositionMap[] {
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
