import type { AlphaTabUiSettings } from '../types/alphatab';

interface Part {
  id: string;
  name: string;
}

interface Props {
  settings: AlphaTabUiSettings;
  parts: Part[];
  onSettingsChange: (next: AlphaTabUiSettings) => void;
}

export default function AlphaTabControls({ settings, parts, onSettingsChange }: Props) {
  const set = <K extends keyof AlphaTabUiSettings>(key: K, value: AlphaTabUiSettings[K]) =>
    onSettingsChange({ ...settings, [key]: value });

  const setDisplay = <K extends keyof AlphaTabUiSettings['display']>(
    key: K, value: AlphaTabUiSettings['display'][K],
  ) => onSettingsChange({ ...settings, display: { ...settings.display, [key]: value } });

  return (
    <>
      <h2>AlphaTab Settings</h2>

      <label className="export-label" htmlFor="at-stave">Stave profile</label>
      <select
        id="at-stave"
        value={settings.display.staveProfile}
        onChange={(e) => setDisplay('staveProfile', e.target.value as AlphaTabUiSettings['display']['staveProfile'])}
      >
        <option value="scoreTab">Notation + Tab (both)</option>
        <option value="score">Notation only</option>
        <option value="tab">Tab only</option>
        <option value="default">Default (from file)</option>
      </select>

      <label className="export-label" htmlFor="at-layout">Layout</label>
      <select
        id="at-layout"
        value={settings.display.layoutMode}
        onChange={(e) => setDisplay('layoutMode', e.target.value as AlphaTabUiSettings['display']['layoutMode'])}
      >
        <option value="page">Page</option>
        <option value="horizontal">Horizontal scroll</option>
      </select>

      <label className="export-label" htmlFor="at-bars">
        Bars per row ({settings.display.barsPerRow < 1 ? 'auto' : settings.display.barsPerRow})
      </label>
      <input
        id="at-bars"
        type="range"
        min={-1}
        max={8}
        value={settings.display.barsPerRow}
        onChange={(e) => setDisplay('barsPerRow', Number(e.target.value))}
        className="tab-range"
      />

      {parts.length > 1 && (
        <>
          <label className="export-label" htmlFor="at-part">Part / instrument</label>
          <select
            id="at-part"
            value={settings.partIndex}
            onChange={(e) => set('partIndex', Number(e.target.value))}
          >
            {parts.map((p, i) => (
              <option key={p.id} value={i}>{p.name}</option>
            ))}
          </select>
        </>
      )}
    </>
  );
}
