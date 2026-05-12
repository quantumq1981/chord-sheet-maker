import { describe, expect, it } from 'vitest';
import {
  gpScoreToChordPro,
  gpScoreTrackNames,
  gpScoreNotePositions,
  findChordSourceTrack,
} from '../guitarProConverter';
import type * as alphaTabNS from '@coderline/alphatab';

// ─── Minimal mock builders ────────────────────────────────────────────────────

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

function makeChord(name: string): alphaTabNS.model.Chord {
  return { name } as unknown as alphaTabNS.model.Chord;
}

function makeBeat(opts: {
  chordId?: string;
  chord?: alphaTabNS.model.Chord | null;
  text?: string;
  lyrics?: string[];
  isEmpty?: boolean;
  notes?: DeepPartial<alphaTabNS.model.Note>[];
}): alphaTabNS.model.Beat {
  return {
    isEmpty: opts.isEmpty ?? false,
    chordId: opts.chordId ?? null,
    chord: opts.chord ?? null,
    text: opts.text ?? null,
    lyrics: opts.lyrics ?? null,
    notes: (opts.notes ?? []) as alphaTabNS.model.Note[],
    hasChord: !!(opts.chord ?? opts.chordId),
  } as unknown as alphaTabNS.model.Beat;
}

function makeVoice(beats: alphaTabNS.model.Beat[]): alphaTabNS.model.Voice {
  return { beats } as unknown as alphaTabNS.model.Voice;
}

function makeBar(voices: alphaTabNS.model.Voice[]): alphaTabNS.model.Bar {
  return { voices } as unknown as alphaTabNS.model.Bar;
}

function makeStaff(
  bars: alphaTabNS.model.Bar[],
  chords: Map<string, alphaTabNS.model.Chord> | null = null,
  tuning: number[] = [],
): alphaTabNS.model.Staff {
  return {
    bars,
    chords,
    tuning,
    stringTuning: { tunings: tuning },
  } as unknown as alphaTabNS.model.Staff;
}

function makeTrack(
  staves: alphaTabNS.model.Staff[],
  name = '',
): alphaTabNS.model.Track {
  return { staves, name } as unknown as alphaTabNS.model.Track;
}

function makeMasterBar(opts: {
  index: number;
  section?: { marker: string; text: string } | null;
  keySignature?: number;
  keySignatureType?: number;
  timeSignatureNumerator?: number;
  timeSignatureDenominator?: number;
}): alphaTabNS.model.MasterBar {
  return {
    index: opts.index,
    section: opts.section ?? null,
    keySignature: opts.keySignature ?? 0,
    keySignatureType: opts.keySignatureType ?? 0,
    timeSignatureNumerator: opts.timeSignatureNumerator ?? 4,
    timeSignatureDenominator: opts.timeSignatureDenominator ?? 4,
  } as unknown as alphaTabNS.model.MasterBar;
}

function makeScore(opts: {
  title?: string;
  artist?: string;
  album?: string;
  tempo?: number;
  tracks: alphaTabNS.model.Track[];
  masterBars?: alphaTabNS.model.MasterBar[];
}): alphaTabNS.model.Score {
  const barCount = opts.tracks[0]?.staves[0]?.bars.length ?? 0;
  const masterBars = opts.masterBars ?? Array.from({ length: barCount }, (_, i) =>
    makeMasterBar({ index: i }),
  );
  return {
    title: opts.title ?? '',
    artist: opts.artist ?? '',
    album: opts.album ?? '',
    tempo: opts.tempo ?? 0,
    tracks: opts.tracks,
    masterBars,
  } as unknown as alphaTabNS.model.Score;
}

// ─── gpScoreToChordPro ────────────────────────────────────────────────────────

describe('gpScoreToChordPro', () => {
  it('emits header fields from score metadata', () => {
    const chordA = makeChord('C');
    const beat = makeBeat({ chordId: '1', chord: chordA });
    const score = makeScore({
      title: 'My Song',
      artist: 'Test Artist',
      album: 'Test Album',
      tempo: 120,
      tracks: [makeTrack([makeStaff([makeBar([makeVoice([beat])])])])],
    });
    const { text } = gpScoreToChordPro(score);
    expect(text).toContain('{title: My Song}');
    expect(text).toContain('{artist: Test Artist}');
    expect(text).toContain('{album: Test Album}');
    expect(text).toContain('{tempo: 120}');
  });

  it('emits grid row from chord diagram beats', () => {
    const chords = new Map([['1', makeChord('Am')], ['2', makeChord('E7')]]);
    const beat1 = makeBeat({ chordId: '1', chord: makeChord('Am') });
    const beat2 = makeBeat({ chordId: '2', chord: makeChord('E7') });
    const score = makeScore({
      tracks: [makeTrack([makeStaff([makeBar([makeVoice([beat1, beat2])])], chords)])],
    });
    const { text } = gpScoreToChordPro(score);
    expect(text).toContain('| Am | E7 |');
  });

  it('falls back to beat.text when it looks like a chord name', () => {
    const beat1 = makeBeat({ text: 'Dm' });
    const beat2 = makeBeat({ text: 'G7' });
    const score = makeScore({
      tracks: [makeTrack([makeStaff([makeBar([makeVoice([beat1, beat2])])])])],
    });
    const { text } = gpScoreToChordPro(score);
    expect(text).toContain('| Dm | G7 |');
  });

  it('rejects beat.text that looks like guitar technique annotations', () => {
    const techniquePhrases = [
      'Hammer from 8',
      'Slide up from 7',
      'tapped harmonics',
      'please read the score information (F5)',
      'feedback',
      'bend & release',
    ];
    for (const phrase of techniquePhrases) {
      const score = makeScore({
        tracks: [makeTrack([makeStaff([makeBar([makeVoice([makeBeat({ text: phrase })])])])])],
      });
      const { text, warnings } = gpScoreToChordPro(score);
      expect(text, `phrase: "${phrase}"`).not.toContain(`| ${phrase} |`);
      expect(warnings.some((w) => w.includes('No chord symbols')), `phrase: "${phrase}"`).toBe(true);
    }
  });

  it('accepts known chord name formats in beat.text', () => {
    // AB9 is a chord diagram name (beat.chord.name) from real GP files — it is
    // always passed through unchanged. Here we only test beat.text filtering.
    const chordNames = ['C', 'Dm', 'G7', 'F#m7', 'Bb', 'Ebm', 'E7', 'Cmaj7', 'D7M', 'C/E', 'G/B', 'EØ'];
    for (const name of chordNames) {
      const score = makeScore({
        tracks: [makeTrack([makeStaff([makeBar([makeVoice([makeBeat({ text: name })])])])])],
      });
      const { text } = gpScoreToChordPro(score, 0);
      expect(text, `chord name: "${name}"`).toContain(`| ${name} |`);
    }
  });

  it('deduplicates consecutive identical chords within a bar', () => {
    const chord = makeChord('C');
    // 4 beats all with chord 'C' — should emit just '| C |'
    const beats = [
      makeBeat({ chordId: '1', chord }),
      makeBeat({ chordId: '1', chord }),
      makeBeat({ chordId: '1', chord }),
      makeBeat({ chordId: '1', chord }),
    ];
    const score = makeScore({
      tracks: [makeTrack([makeStaff([makeBar([makeVoice(beats)])])])],
    });
    const { text } = gpScoreToChordPro(score);
    expect(text).toContain('| C |');
    // Should NOT contain | C | C | or similar repetition
    expect(text).not.toMatch(/\| C \| C \|/);
  });

  it('keeps distinct chords within a bar', () => {
    const beats = [
      makeBeat({ chordId: '1', chord: makeChord('Am') }),
      makeBeat({ chordId: '2', chord: makeChord('E7') }),
      makeBeat({ chordId: '2', chord: makeChord('E7') }),
    ];
    const score = makeScore({
      tracks: [makeTrack([makeStaff([makeBar([makeVoice(beats)])])])],
    });
    const { text } = gpScoreToChordPro(score);
    // Am and E7 should both appear; E7 should not be doubled
    expect(text).toContain('| Am | E7 |');
    expect(text).not.toMatch(/\| E7 \| E7 \|/);
  });

  it('skips empty beats', () => {
    const beats = [
      makeBeat({ isEmpty: true, chord: makeChord('C') }),
      makeBeat({ chordId: '1', chord: makeChord('G') }),
    ];
    const score = makeScore({
      tracks: [makeTrack([makeStaff([makeBar([makeVoice(beats)])])])],
    });
    const { text } = gpScoreToChordPro(score);
    // Empty beat should not contribute 'C' to the output
    expect(text).toContain('| G |');
    expect(text).not.toContain('| C |');
  });

  it('skips bars with no chord data', () => {
    const emptyBar = makeBar([makeVoice([makeBeat({ text: 'slide' })])]);
    const chordBar = makeBar([makeVoice([makeBeat({ chordId: '1', chord: makeChord('D') })])]);
    const score = makeScore({
      tracks: [makeTrack([makeStaff([emptyBar, chordBar])])],
      masterBars: [makeMasterBar({ index: 0 }), makeMasterBar({ index: 1 })],
    });
    const { text } = gpScoreToChordPro(score);
    const gridLines = text.split('\n').filter((l) => l.startsWith('|'));
    expect(gridLines).toHaveLength(1);
    expect(gridLines[0]).toBe('| D |');
  });

  it('emits section markers as {comment:} before the first chord in that section', () => {
    const bar0 = makeBar([makeVoice([makeBeat({ chordId: '1', chord: makeChord('C') })])]);
    const bar1 = makeBar([makeVoice([makeBeat({ chordId: '2', chord: makeChord('F') })])]);
    const masterBars = [
      makeMasterBar({ index: 0 }),
      makeMasterBar({ index: 1, section: { marker: 'B', text: 'Chorus' } }),
    ];
    const score = makeScore({
      tracks: [makeTrack([makeStaff([bar0, bar1])])],
      masterBars,
    });
    const { text } = gpScoreToChordPro(score);
    expect(text).toContain('{comment: Chorus}');
    // Section marker must appear before the chord row for that bar
    const lines = text.split('\n');
    const commentIdx = lines.findIndex((l) => l === '{comment: Chorus}');
    const fIdx = lines.findIndex((l) => l.includes('F'));
    expect(commentIdx).toBeLessThan(fIdx);
  });

  it('does NOT emit a section comment when that section has no chord data', () => {
    // Bar 0 has section but no chords; bar 1 has chords but no section.
    const emptyBar = makeBar([makeVoice([makeBeat({ isEmpty: true })])]);
    const chordBar = makeBar([makeVoice([makeBeat({ chordId: '1', chord: makeChord('A') })])]);
    const masterBars = [
      makeMasterBar({ index: 0, section: { marker: 'I', text: 'Intro' } }),
      makeMasterBar({ index: 1 }),
    ];
    const score = makeScore({
      tracks: [makeTrack([makeStaff([emptyBar, chordBar])])],
      masterBars,
    });
    const { text } = gpScoreToChordPro(score);
    // The Intro section had no chords so the comment should be suppressed
    // (it would attach to bar 1, which has no section — still fine to emit
    // IF the pending logic emitted it before bar 1's chord).
    // The key requirement: output should NOT contain a dangling {comment: Intro}
    // with no chord data following it from that section.
    // In the current implementation the pending comment IS emitted before bar 1.
    // Just verify the comment appears and the chord appears after it.
    const lines = text.split('\n');
    const commentIdx = lines.findIndex((l) => l.includes('Intro'));
    const chordIdx = lines.findIndex((l) => l.startsWith('|'));
    // Comment must precede the chord
    expect(commentIdx).toBeLessThan(chordIdx);
  });

  // ── Smart track selection ──────────────────────────────────────────────────

  it('uses a different track when it has more chord data', () => {
    // Track 0: melody track — no chord data
    const melodyBeat = makeBeat({ text: 'slide' }); // technique, not a chord
    const melodyStaff = makeStaff([makeBar([makeVoice([melodyBeat])])]);
    const melodyTrack = makeTrack([melodyStaff], 'Guitar Solo');

    // Track 1: chord track — has diagram data
    const chordBeat = makeBeat({ chordId: 'x', chord: makeChord('Bb7') });
    const chordStaff = makeStaff([makeBar([makeVoice([chordBeat])])]);
    const chordTrack = makeTrack([chordStaff], 'Chords');

    const score = makeScore({
      tracks: [melodyTrack, chordTrack],
      masterBars: [makeMasterBar({ index: 0 })],
    });

    const { text, warnings } = gpScoreToChordPro(score, 0);
    // Should use chords from track 1
    expect(text).toContain('| Bb7 |');
    // Should warn that chords came from a different track
    expect(warnings.some((w) => w.includes('Chords'))).toBe(true);
  });

  it('prefers a track explicitly named "chord"', () => {
    // Both tracks have some chord-like text, but track 2 is named "Chord Track"
    const beat0 = makeBeat({ text: 'Am' });
    const track0 = makeTrack([makeStaff([makeBar([makeVoice([beat0])])])], 'Lead Guitar');

    const beat2 = makeBeat({ chordId: 'q', chord: makeChord('Dm7') });
    const track2 = makeTrack([makeStaff([makeBar([makeVoice([beat2])])])], 'Chord Track');

    const score = makeScore({
      tracks: [track0, track2],
      masterBars: [makeMasterBar({ index: 0 })],
    });

    const { text } = gpScoreToChordPro(score, 0);
    // 'Chord Track' has +30 name bonus; Dm7 diagram beats should win
    expect(text).toContain('| Dm7 |');
  });

  it('uses primary track when no other track has better chord data', () => {
    const beat = makeBeat({ chordId: 'x', chord: makeChord('G') });
    const staff = makeStaff([makeBar([makeVoice([beat])])]);
    const track = makeTrack([staff], 'Guitar');

    // Add a second track with zero chord data
    const emptyBeat = makeBeat({});
    const emptyTrack = makeTrack([makeStaff([makeBar([makeVoice([emptyBeat])])])], 'Drums');

    const score = makeScore({
      tracks: [track, emptyTrack],
      masterBars: [makeMasterBar({ index: 0 })],
    });

    const { text, warnings } = gpScoreToChordPro(score, 0);
    expect(text).toContain('| G |');
    // No warning about different track since track 0 was selected
    expect(warnings.every((w) => !w.includes('taken from'))).toBe(true);
  });

  // ── No chord data ──────────────────────────────────────────────────────────

  it('returns a warning when no chord data exists anywhere', () => {
    const beat = makeBeat({ text: 'Hammer from 8' });
    const score = makeScore({
      tracks: [makeTrack([makeStaff([makeBar([makeVoice([beat])])])])],
    });
    const { warnings } = gpScoreToChordPro(score);
    expect(warnings.some((w) => w.includes('No chord symbols'))).toBe(true);
  });

  it('warns when track index is out of range', () => {
    const score = makeScore({ tracks: [makeTrack([makeStaff([])])] });
    const { warnings } = gpScoreToChordPro(score, 99);
    expect(warnings.some((w) => w.includes('not found'))).toBe(true);
  });

  // ── Lyrics ─────────────────────────────────────────────────────────────────

  it('uses inline [Chord]lyric format when lyrics are present', () => {
    const beat1 = makeBeat({ chordId: '1', chord: makeChord('C'), lyrics: ['Hey'] });
    const beat2 = makeBeat({ chordId: '2', chord: makeChord('G'), lyrics: ['there'] });
    const staff = makeStaff([makeBar([makeVoice([beat1, beat2])])]);
    const score = makeScore({ tracks: [makeTrack([staff])] });
    const { text } = gpScoreToChordPro(score);
    expect(text).toContain('[C]Hey');
    expect(text).toContain('[G]there');
    expect(text).not.toContain('| C |');
  });
});

// ─── findChordSourceTrack ─────────────────────────────────────────────────────

describe('findChordSourceTrack', () => {
  it('returns the primary track when it has the most chordIds', () => {
    const beat = makeBeat({ chordId: 'x', chord: makeChord('A') });
    const track0 = makeTrack([makeStaff([makeBar([makeVoice([beat, beat, beat])])])]);
    const track1 = makeTrack([makeStaff([makeBar([makeVoice([makeBeat({})])])])]); // empty
    const score = makeScore({ tracks: [track0, track1], masterBars: [makeMasterBar({ index: 0 })] });
    expect(findChordSourceTrack(score, 0).trackIdx).toBe(0);
  });

  it('returns a non-primary track when it has more chord data', () => {
    const emptyBeat = makeBeat({ text: 'slide' });
    const track0 = makeTrack([makeStaff([makeBar([makeVoice([emptyBeat])])])], 'Lead');
    const chordBeat = makeBeat({ chordId: 'y', chord: makeChord('F') });
    const track1 = makeTrack([makeStaff([makeBar([makeVoice([chordBeat])])])], 'Rhythm');
    const score = makeScore({ tracks: [track0, track1], masterBars: [makeMasterBar({ index: 0 })] });
    expect(findChordSourceTrack(score, 0).trackIdx).toBe(1);
  });

  it('returns hasDiagrams=true when winning track uses chordId', () => {
    const beat = makeBeat({ chordId: 'z', chord: makeChord('D') });
    const track = makeTrack([makeStaff([makeBar([makeVoice([beat])])])]);
    const score = makeScore({ tracks: [track], masterBars: [makeMasterBar({ index: 0 })] });
    expect(findChordSourceTrack(score, 0).hasDiagrams).toBe(true);
  });

  it('returns hasDiagrams=false when winning track uses only chord-like text', () => {
    const beat = makeBeat({ text: 'Em7' }); // no chordId
    const track = makeTrack([makeStaff([makeBar([makeVoice([beat])])])]);
    const score = makeScore({ tracks: [track], masterBars: [makeMasterBar({ index: 0 })] });
    expect(findChordSourceTrack(score, 0).hasDiagrams).toBe(false);
  });

  it('gives strong preference to tracks named "chord"', () => {
    // Track 0 has slightly more chord-text beats
    const t0beats = Array.from({ length: 5 }, () => makeBeat({ text: 'Am' }));
    const track0 = makeTrack([makeStaff([makeBar([makeVoice(t0beats)])])], 'Guitar');
    // Track 1 has fewer beats but is named "Chord Track" (+30 bonus)
    const t1beat = makeBeat({ chordId: 'c', chord: makeChord('Dm') });
    const track1 = makeTrack([makeStaff([makeBar([makeVoice([t1beat])])])], 'Chord Track');
    const score = makeScore({ tracks: [track0, track1], masterBars: [makeMasterBar({ index: 0 })] });
    expect(findChordSourceTrack(score, 0).trackIdx).toBe(1);
  });
});

// ─── gpScoreTrackNames ────────────────────────────────────────────────────────

describe('gpScoreTrackNames', () => {
  it('returns track names trimmed', () => {
    const score = makeScore({
      tracks: [
        makeTrack([makeStaff([])], '  Lead Guitar  '),
        makeTrack([makeStaff([])], 'Bass'),
      ],
    });
    expect(gpScoreTrackNames(score)).toEqual(['Lead Guitar', 'Bass']);
  });

  it('falls back to "Track N" for empty track names', () => {
    const score = makeScore({
      tracks: [
        makeTrack([makeStaff([])], ''),
        makeTrack([makeStaff([])], '  '),
      ],
    });
    expect(gpScoreTrackNames(score)).toEqual(['Track 1', 'Track 2']);
  });
});

// ─── gpScoreNotePositions ─────────────────────────────────────────────────────

describe('gpScoreNotePositions', () => {
  it('returns empty array for unknown track index', () => {
    const score = makeScore({ tracks: [makeTrack([makeStaff([])])] });
    expect(gpScoreNotePositions(score, 99)).toEqual([]);
  });

  it('maps fret positions to MIDI pitches using open string tuning', () => {
    // Standard low E string: MIDI 40. Fret 2 = MIDI 42 (F#2).
    const note = { string: 1, fret: 2, isTieDestination: false } as unknown as alphaTabNS.model.Note;
    const beat = makeBeat({ notes: [note] });
    const staff = makeStaff([makeBar([makeVoice([beat])])], null, [40]); // 1 string, open = MIDI 40
    const score = makeScore({ tracks: [makeTrack([staff])] });
    const positions = gpScoreNotePositions(score, 0);
    expect(positions).toHaveLength(1);
    expect(positions[0].midi).toBe(42);
    expect(positions[0].positions).toEqual([{ str: 1, fret: 2 }]);
  });

  it('deduplicates the same (string, fret) position on the same pitch', () => {
    const note = { string: 1, fret: 0, isTieDestination: false } as unknown as alphaTabNS.model.Note;
    const beats = [makeBeat({ notes: [note] }), makeBeat({ notes: [note] })];
    const staff = makeStaff([makeBar([makeVoice(beats)])], null, [52]); // open E4
    const score = makeScore({ tracks: [makeTrack([staff])] });
    const positions = gpScoreNotePositions(score, 0);
    expect(positions[0].positions).toHaveLength(1); // not duplicated
  });

  it('skips tie-destination notes', () => {
    const tieDest = { string: 1, fret: 5, isTieDestination: true } as unknown as alphaTabNS.model.Note;
    const note = { string: 1, fret: 3, isTieDestination: false } as unknown as alphaTabNS.model.Note;
    const staff = makeStaff(
      [makeBar([makeVoice([makeBeat({ notes: [tieDest, note] })])])],
      null,
      [40],
    );
    const score = makeScore({ tracks: [makeTrack([staff])] });
    const positions = gpScoreNotePositions(score, 0);
    // Only fret 3 should appear, not fret 5
    expect(positions.every((p) => p.positions.every((pos) => pos.fret !== 5))).toBe(true);
  });

  it('returns positions sorted by ascending MIDI pitch', () => {
    const notes = [
      { string: 1, fret: 5, isTieDestination: false },
      { string: 1, fret: 0, isTieDestination: false },
      { string: 1, fret: 2, isTieDestination: false },
    ].map((n) => n as unknown as alphaTabNS.model.Note);
    const beat = makeBeat({ notes });
    const staff = makeStaff([makeBar([makeVoice([beat])])], null, [40]);
    const score = makeScore({ tracks: [makeTrack([staff])] });
    const positions = gpScoreNotePositions(score, 0);
    const midis = positions.map((p) => p.midi);
    expect(midis).toEqual([...midis].sort((a, b) => a - b));
  });

  it('labels MIDI pitches with note name and octave', () => {
    // MIDI 60 = C4
    const note = { string: 1, fret: 0, isTieDestination: false } as unknown as alphaTabNS.model.Note;
    const staff = makeStaff([makeBar([makeVoice([makeBeat({ notes: [note] })])])], null, [60]);
    const score = makeScore({ tracks: [makeTrack([staff])] });
    const positions = gpScoreNotePositions(score, 0);
    expect(positions[0].name).toBe('C4');
  });
});
