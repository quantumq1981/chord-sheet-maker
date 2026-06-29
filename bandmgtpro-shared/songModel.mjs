/*
 * songModel.mjs — BandMgtPro Unified Song Model: canonical version, enums,
 * a zero-dependency runtime validator, and an empty-model factory.
 * ---------------------------------------------------------------------------
 * Pure ES module — no imports, no DOM, no Node built-ins — so the SAME file runs
 * in the browser (the three zero-build/Vite apps) AND under vitest/Node. This is
 * the runtime guard for the JSON contract in bandmgtpro-song-model.schema.json;
 * we hand-roll validation rather than pull in ajv to honor the family's zero-dep
 * ethos (a beautiful renderer built on fake precision is just a liar in a tuxedo
 * — so lossMap is mandatory, and every harmony event must carry BOTH its authored
 * symbol and its normalized form).
 *
 * Promoted from Unified-Song-Model+Ug-Ascii-JSparser-Techspec.md (schema v1.0.0).
 * ---------------------------------------------------------------------------
 */

export const SONG_MODEL_VERSION = '1.0.0';

export const SEMANTIC_TIERS = Object.freeze([
  'tier_4_structured', // MusicXML, LilyPond
  'tier_3_fretted', // Guitar Pro, alphaTab
  'tier_2_leadsheet', // ChordPro, ABC, CSMPN, CSML
  'tier_1_ascii', // UG text, ascii tab, plain text
]);

export const SOURCE_FORMATS = Object.freeze([
  'musicxml', 'lilypond', 'gp3', 'gp4', 'gp5', 'gpx', 'gp', 'alphatex',
  'chordpro', 'abc', 'ug_text', 'ascii_tab', 'plain_text', 'csmpn', 'csml',
  'midi', 'powertab', 'pdf',
]);

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function majorOf(semver) {
  return typeof semver === 'string' && SEMVER_RE.test(semver)
    ? parseInt(semver.split('.')[0], 10)
    : NaN;
}

/**
 * Validate a Unified Song Model object against the v1 contract invariants.
 * Returns { valid, errors } — never throws. `errors` are human-readable paths.
 *
 * Enforced invariants (from the techspec):
 *  1. schemaVersion present and major-compatible with SONG_MODEL_VERSION.
 *  2. source.format ∈ SOURCE_FORMATS and source.semanticTier ∈ SEMANTIC_TIERS.
 *  3. metadata present.
 *  4. lossMap MANDATORY (with a warnings array) — no silent fake precision.
 *  5. every harmony event carries BOTH `symbol` (authored) and `normalized.root`.
 *  Types are checked only where present; unknown/extra fields are allowed
 *  (sourceNative is intentionally open for future round-tripping).
 */
export function validateSongModel(model) {
  const errors = [];
  const fail = (msg) => errors.push(msg);

  if (!isObject(model)) {
    return { valid: false, errors: ['root: expected an object'] };
  }

  // 1. schemaVersion
  if (typeof model.schemaVersion !== 'string' || !SEMVER_RE.test(model.schemaVersion)) {
    fail('schemaVersion: required semver string (e.g. "1.0.0")');
  } else if (majorOf(model.schemaVersion) !== majorOf(SONG_MODEL_VERSION)) {
    fail(`schemaVersion: incompatible major (${model.schemaVersion} vs ${SONG_MODEL_VERSION})`);
  }

  if ('title' in model && typeof model.title !== 'string') fail('title: must be a string');

  // 2. source
  if (!isObject(model.source)) {
    fail('source: required object');
  } else {
    if (!SOURCE_FORMATS.includes(model.source.format)) {
      fail(`source.format: must be one of ${SOURCE_FORMATS.join('|')}`);
    }
    if (!SEMANTIC_TIERS.includes(model.source.semanticTier)) {
      fail(`source.semanticTier: must be one of ${SEMANTIC_TIERS.join('|')}`);
    }
  }

  // 3. metadata
  if (!isObject(model.metadata)) fail('metadata: required object');

  // 4. lossMap (mandatory)
  if (!isObject(model.lossMap)) {
    fail('lossMap: required object (mandatory — never omit)');
  } else if (!Array.isArray(model.lossMap.warnings)) {
    fail('lossMap.warnings: required array');
  }

  // 5. harmony events: symbol + normalized.root
  if ('harmony' in model && model.harmony !== undefined) {
    if (!isObject(model.harmony)) {
      fail('harmony: must be an object when present');
    } else if ('events' in model.harmony) {
      if (!Array.isArray(model.harmony.events)) {
        fail('harmony.events: must be an array');
      } else {
        model.harmony.events.forEach((ev, i) => {
          if (!isObject(ev)) {
            fail(`harmony.events[${i}]: expected object`);
            return;
          }
          if (typeof ev.symbol !== 'string') fail(`harmony.events[${i}].symbol: required string (authored spelling)`);
          if (!isObject(ev.normalized)) {
            fail(`harmony.events[${i}].normalized: required object`);
          } else if (!('root' in ev.normalized)) {
            fail(`harmony.events[${i}].normalized.root: required (null allowed for N.C.)`);
          }
        });
      }
    }
  }

  if ('parts' in model && model.parts !== undefined && !Array.isArray(model.parts)) {
    fail('parts: must be an array when present');
  }

  return { valid: errors.length === 0, errors };
}

/** Throwing wrapper for call sites that prefer an exception. */
export function assertSongModel(model) {
  const { valid, errors } = validateSongModel(model);
  if (!valid) throw new Error(`Invalid BandMgtPro song model:\n - ${errors.join('\n - ')}`);
  return model;
}

/**
 * Build a minimal, schema-valid empty model. `overrides` are shallow-merged at
 * the top level (callers typically pass title/source). The result always passes
 * validateSongModel so importers can start from a known-good base.
 */
export function createEmptySongModel(overrides = {}) {
  const base = {
    schemaVersion: SONG_MODEL_VERSION,
    songId: '',
    title: '',
    creators: { composer: [], lyricist: [], arranger: [], artist: [] },
    source: {
      format: 'plain_text',
      semanticTier: 'tier_1_ascii',
      sourceNative: {},
      importer: { name: '', version: '', warnings: [] },
    },
    metadata: {
      key: { display: '', concert: '', detected: false, confidence: 1.0 },
      timeSignature: { numerator: 4, denominator: 4, pickupBeats: 0, changes: [] },
      tempo: { bpm: null, text: null, beatUnit: 'quarter', changes: [] },
      capo: { fret: null, sourceDeclared: false },
      tuning: [],
    },
    structure: { sections: [], repeats: [], endings: [], rehearsalMarks: [] },
    timeline: { divisionsPerQuarter: 480, measures: [] },
    parts: [],
    harmony: { globalProgression: [], events: [], grid: { present: false, cells: [] } },
    lyrics: { lines: [], syllableAligned: false, language: 'en' },
    analytics: {},
    lossMap: {
      rhythmExplicit: false,
      voicingExplicit: false,
      layoutExplicit: false,
      lyricsAligned: false,
      warnings: [],
    },
    renderHints: {},
  };
  return { ...base, ...overrides };
}
