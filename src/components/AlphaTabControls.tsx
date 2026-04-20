import type { ChangeEvent } from 'react';
import type { AlphaTabSettings } from '../types/alphatab';

interface AlphaTabControlsProps {
  settings: AlphaTabSettings;
  onSettingsChange: (settings: AlphaTabSettings) => void;
  tuningPreset: string;
  tuning: string[];
  tuningPresets: Record<string, string[]>;
  onTuningPresetChange: (preset: string) => void;
  onTuningChange: (next: string[]) => void;
  partIndex: number;
  partOptions: string[];
  onPartIndexChange: (index: number) => void;
  onExportSvg: () => void;
  onExportPng: () => Promise<void>;
  onExportPdf: () => Promise<void>;
  canExport: boolean;
}

export default function AlphaTabControls({
  settings,
  onSettingsChange,
  tuningPreset,
  tuning,
  tuningPresets,
  onTuningPresetChange,
  onTuningChange,
  partIndex,
  partOptions,
  onPartIndexChange,
  onExportSvg,
  onExportPng,
  onExportPdf,
  canExport,
}: AlphaTabControlsProps) {
  const update = (next: Partial<AlphaTabSettings>) => {
    onSettingsChange({ ...settings, ...next });
  };

  const onLayoutMode = (event: ChangeEvent<HTMLSelectElement>) => {
    update({ display: { ...settings.display, layoutMode: event.target.value as 'page' | 'horizontal' } });
  };

  const onBarsPerRow = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    update({ display: { ...settings.display, barsPerRow: Number.isFinite(value) ? Math.max(-1, Math.min(12, value)) : -1 } });
  };

  const onZoom = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    update({ display: { ...settings.display, scale: Number.isFinite(value) ? Math.max(0.5, Math.min(2, value)) : 1 } });
  };

  return (
    <>
      <h2>AlphaTab Settings</h2>

      <label className="export-label" htmlFor="alphatab-layout">Layout mode</label>
      <select id="alphatab-layout" value={settings.display.layoutMode} onChange={onLayoutMode}>
        <option value="page">Page</option>
        <option value="horizontal">Horizontal</option>
      </select>

      <label className="export-label" htmlFor="alphatab-bars">Bars per row (-1 auto)</label>
      <input
        id="alphatab-bars"
        type="number"
        min={-1}
        max={12}
        value={settings.display.barsPerRow}
        onChange={onBarsPerRow}
      />

      <div className="tab-settings-row">
        <label className="export-label" htmlFor="alphatab-zoom">Zoom: {settings.display.scale.toFixed(2)}x</label>
        <input
          id="alphatab-zoom"
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={settings.display.scale}
          onChange={onZoom}
          className="tab-range"
        />
      </div>

      <label className="export-label" htmlFor="alphatab-tuning-preset">Tuning preset</label>
      <select
        id="alphatab-tuning-preset"
        value={tuningPreset}
        onChange={(event) => {
          const preset = event.target.value;
          onTuningPresetChange(preset);
          if (tuningPresets[preset]) {
            onTuningChange(tuningPresets[preset]);
          }
        }}
      >
        {Object.keys(tuningPresets).map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
        <option value="Custom">Custom</option>
      </select>

      <label className="export-label">Custom tuning (high→low)</label>
      <div className="tab-tuning-grid">
        {tuning.map((note, idx) => (
          <input
            key={idx}
            className="tab-tuning-input"
            type="text"
            value={note}
            aria-label={`AlphaTab string ${idx + 1}`}
            onChange={(event) => {
              const next = [...tuning];
              next[idx] = event.target.value;
              onTuningPresetChange('Custom');
              onTuningChange(next);
            }}
          />
        ))}
      </div>

      {partOptions.length > 1 && (
        <>
          <label className="export-label" htmlFor="alphatab-part">Part</label>
          <select id="alphatab-part" value={partIndex} onChange={(event) => onPartIndexChange(Number(event.target.value))}>
            {partOptions.map((name, idx) => (
              <option key={`${name}-${idx}`} value={idx}>{name}</option>
            ))}
          </select>
        </>
      )}

      <h2>Export AlphaTab</h2>
      <div className="export-actions">
        <button type="button" onClick={onExportSvg} disabled={!canExport}>Export AlphaTab SVG</button>
        <button type="button" onClick={() => void onExportPng()} disabled={!canExport}>Export AlphaTab PNG</button>
        <button type="button" onClick={() => void onExportPdf()} disabled={!canExport}>Generate AlphaTab PDF</button>
      </div>
    </>
  );
}
