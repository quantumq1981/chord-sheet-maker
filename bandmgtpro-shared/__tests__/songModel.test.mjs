import { describe, it, expect } from 'vitest';
import {
  validateSongModel,
  assertSongModel,
  createEmptySongModel,
  SONG_MODEL_VERSION,
  SEMANTIC_TIERS,
  SOURCE_FORMATS,
} from '../songModel.mjs';
import schema from '../bandmgtpro-song-model.schema.json';
import uga from '../../ug_ascii_parser.js';

const { parseUltimateGuitarAscii } = uga;

describe('BandMgtPro Unified Song Model — validator', () => {
  it('createEmptySongModel() produces a schema-valid base', () => {
    const r = validateSongModel(createEmptySongModel());
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it('shallow overrides keep the model valid', () => {
    const m = createEmptySongModel({ title: 'Blue Sky', source: { format: 'gp5', semanticTier: 'tier_3_fretted' } });
    expect(validateSongModel(m).valid).toBe(true);
  });

  it('assertSongModel returns the model when valid and throws when not', () => {
    const m = createEmptySongModel();
    expect(assertSongModel(m)).toBe(m);
    expect(() => assertSongModel({})).toThrow(/Invalid BandMgtPro song model/);
  });

  // --- invariant enforcement ------------------------------------------------

  it('rejects a missing/garbage schemaVersion', () => {
    const m = createEmptySongModel();
    delete m.schemaVersion;
    expect(validateSongModel(m).errors.some((e) => e.startsWith('schemaVersion'))).toBe(true);
  });

  it('rejects an incompatible major version', () => {
    const m = createEmptySongModel({ schemaVersion: '2.0.0' });
    const r = validateSongModel(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /incompatible major/.test(e))).toBe(true);
  });

  it('rejects an unknown source.format / semanticTier', () => {
    expect(validateSongModel(createEmptySongModel({ source: { format: 'flac', semanticTier: 'tier_1_ascii' } })).valid).toBe(false);
    expect(validateSongModel(createEmptySongModel({ source: { format: 'gp5', semanticTier: 'tier_9' } })).valid).toBe(false);
  });

  it('lossMap is mandatory (no silent fake precision)', () => {
    const m = createEmptySongModel();
    delete m.lossMap;
    const r = validateSongModel(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.startsWith('lossMap'))).toBe(true);
  });

  it('every harmony event must carry BOTH symbol and normalized.root', () => {
    const missingNormalized = createEmptySongModel();
    missingNormalized.harmony.events = [{ measure: 1, beat: 1, symbol: 'G7' }];
    expect(validateSongModel(missingNormalized).valid).toBe(false);

    const missingSymbol = createEmptySongModel();
    missingSymbol.harmony.events = [{ measure: 1, beat: 1, normalized: { root: 'G' } }];
    expect(validateSongModel(missingSymbol).valid).toBe(false);

    const ok = createEmptySongModel();
    ok.harmony.events = [{ measure: 1, beat: 1, symbol: 'G7', normalized: { root: 'G', qualityFamily: 'dom7' } }];
    expect(validateSongModel(ok).valid).toBe(true);
  });

  it('allows normalized.root === null for non-chord / N.C. tokens', () => {
    const m = createEmptySongModel();
    m.harmony.events = [{ symbol: 'N.C.', normalized: { root: null } }];
    expect(validateSongModel(m).valid).toBe(true);
  });

  // --- schema/validator drift guard ----------------------------------------

  it('JSON Schema enums stay in lock-step with the validator constants', () => {
    expect(schema.properties.source.properties.format.enum).toEqual([...SOURCE_FORMATS]);
    expect(schema.properties.source.properties.semanticTier.enum).toEqual([...SEMANTIC_TIERS]);
    expect(schema.required).toContain('lossMap');
    expect(schema.required).toContain('source');
  });

  it('schema version string is the published SONG_MODEL_VERSION', () => {
    expect(SONG_MODEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // --- real importer output validates ---------------------------------------

  it('the existing ug_ascii_parser output conforms to the model', () => {
    const sample = ['[Verse]', '       C        G', 'Hello there my old friend', '       Am       F', 'How have you been today'].join('\n');
    const song = parseUltimateGuitarAscii(sample, { title: 'Old Friend', composer: ['Test'] });
    const r = validateSongModel(song);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    // sanity: it actually recognised some harmony to validate against
    expect(song.harmony.events.length).toBeGreaterThan(0);
  });
});
