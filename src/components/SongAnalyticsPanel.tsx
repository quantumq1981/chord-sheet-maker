/**
 * SongAnalyticsPanel.tsx
 *
 * Displays analytics data from a UnifiedSongModel: semantic tier, detected
 * key/capo/tempo, genre guess with confidence, harmonic fingerprint rates,
 * and any loss-map warnings.
 *
 * Rendered in the chord-chart side panel whenever a USM is available.
 */

import type { UnifiedSongModel, GenrePrimary } from '../types/unifiedSongModel';

interface Props {
  model: UnifiedSongModel;
}

const TIER_LABELS: Record<string, string> = {
  tier_4_structured: 'Structured score',
  tier_3_fretted:    'Fretted notation',
  tier_2_leadsheet:  'Lead sheet',
  tier_1_ascii:      'ASCII text',
};

const GENRE_LABELS: Record<GenrePrimary, string> = {
  jazz:            'Jazz',
  rock_blues:      'Rock / Blues',
  folk_pop:        'Folk / Pop',
  orchestral_score:'Orchestral',
  unknown:         'Unknown',
};

const GENRE_COLOR: Record<GenrePrimary, string> = {
  jazz:             'var(--brand)',
  rock_blues:       'var(--error)',
  folk_pop:         'var(--success)',
  orchestral_score: 'var(--accent)',
  unknown:          'var(--text-subtle)',
};

function RateBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="analytics-rate-row">
      <span className="analytics-rate-label">{label}</span>
      <div className="analytics-rate-track">
        <div className="analytics-rate-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="analytics-rate-value">{pct}%</span>
    </div>
  );
}

export default function SongAnalyticsPanel({ model }: Props) {
  const { analytics, metadata, lossMap, source } = model;
  const { genreGuess, harmonicFingerprint: hf, density } = analytics;
  const { capo, key, tempo } = metadata;

  const tierLabel = TIER_LABELS[source.semanticTier] ?? source.semanticTier;
  const genreLabel = GENRE_LABELS[genreGuess.primary] ?? genreGuess.primary;
  const genreColor = GENRE_COLOR[genreGuess.primary] ?? 'var(--text-subtle)';
  const confidencePct = Math.round(genreGuess.confidence * 100);

  const hasHarmony = Object.values(hf).some((v) => (v as number) > 0);

  return (
    <div className="analytics-panel">

      {/* ── Tier + format badge ── */}
      <div className="analytics-badges">
        <span className="analytics-badge analytics-badge--tier">{tierLabel}</span>
        <span className="analytics-badge analytics-badge--format">{source.format.replace('_', ' ')}</span>
      </div>

      {/* ── Detected metadata ── */}
      {(key.detected || capo.sourceDeclared || tempo.bpm > 0) && (
        <ul className="analytics-meta-list">
          {key.detected    && <li><strong>Key:</strong> {key.display}</li>}
          {capo.sourceDeclared && capo.fret !== null && (
            <li><strong>Capo:</strong> {capo.fret}</li>
          )}
          {tempo.bpm > 0   && <li><strong>Tempo:</strong> {tempo.bpm} BPM</li>}
        </ul>
      )}

      {/* ── Genre guess ── */}
      <div className="analytics-genre">
        <div className="analytics-genre__header">
          <span className="analytics-genre__label" style={{ color: genreColor }}>
            {genreLabel}
          </span>
          <span className="analytics-genre__confidence">{confidencePct}% confidence</span>
        </div>
        <div className="analytics-rate-track analytics-genre__bar">
          <div
            className="analytics-rate-fill"
            style={{ width: `${confidencePct}%`, background: genreColor }}
          />
        </div>
      </div>

      {/* ── Harmonic fingerprint ── */}
      {hasHarmony && (
        <div className="analytics-fingerprint">
          <h3 className="analytics-sub-label">Harmonic fingerprint</h3>
          <RateBar label="Cowboy chords"  value={hf.cowboyChordShare} />
          <RateBar label="Simple maj/min" value={hf.simpleMajMinRate} />
          <RateBar label="Dominant 7th"   value={hf.dom7Rate} />
          <RateBar label="Major 7th"      value={hf.maj7Rate} />
          <RateBar label="Half-dim (ø7)"  value={hf.min7b5Rate} />
          <RateBar label="Altered"        value={hf.altRate} />
          <RateBar label="Power chords"   value={hf.powerChordRate} />
          <RateBar label="ii–V motion"    value={hf.iiVRate} />
        </div>
      )}

      {/* ── Density signals ── */}
      <div className="analytics-fingerprint">
        <h3 className="analytics-sub-label">Content density</h3>
        <RateBar label="Lyrics"    value={density.lyricDensity} />
        <RateBar label="Tab lines" value={density.tabDensity} />
        <RateBar label="Chords"    value={density.chordDensity / Math.max(1, density.chordDensity + 0.05)} />
        <RateBar label="Sections"  value={density.sectionDensity} />
      </div>

      {/* ── Loss-map warnings ── */}
      {lossMap.warnings.length > 0 && (
        <div className="analytics-warnings">
          {lossMap.warnings.map((w, i) => (
            <div key={i} className="analytics-warning-item">{w}</div>
          ))}
        </div>
      )}

      {/* ── Loss indicators ── */}
      <div className="analytics-loss-flags">
        <LossFlag label="Rhythm"   ok={lossMap.rhythmExplicit} />
        <LossFlag label="Voicing"  ok={lossMap.voicingExplicit} />
        <LossFlag label="Layout"   ok={lossMap.layoutExplicit} />
        <LossFlag label="Aligned"  ok={lossMap.lyricsAligned} />
      </div>

    </div>
  );
}

function LossFlag({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`analytics-loss-flag ${ok ? 'analytics-loss-flag--ok' : 'analytics-loss-flag--missing'}`}>
      {ok ? '✓' : '–'} {label}
    </span>
  );
}
