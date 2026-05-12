import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import AlphaTabRenderer from '../AlphaTabRenderer';
import type { AlphaTabUiSettings } from '../../types/alphatab';

const destroyMock = vi.fn();
const renderScoreMock = vi.fn();
const loadMock = vi.fn(() => true);

// vi.hoisted ensures this is initialised before the vi.mock factory runs
// (the factory is hoisted to the top of the file by Vitest's transform).
const loadScoreFromBytesMock = vi.hoisted(() => vi.fn(() => ({
  tracks: [{ name: 'Guitar', staves: [{ stringTuning: { tunings: [64, 59, 55, 50, 45, 40] } }] }],
  stylesheet: {},
})));

let renderFinishedCallbacks: Array<() => void> = [];

vi.mock('@coderline/alphatab', () => {
  class Settings {
    core: Record<string, unknown> = { fontDirectory: '/font/', scriptFile: '/alphaTab.worker.min.mjs', useWorkers: true };
    display = { layoutMode: 0, staveProfile: 1, barsPerRow: -1, scale: 1 };
    player = { enablePlayer: false };
  }

  class AlphaTabApi {
    public settings: Settings;
    public renderFinished = {
      on: (fn: () => void) => { renderFinishedCallbacks.push(fn); },
    };
    public renderStarted = { on: vi.fn() };
    public error = { on: vi.fn() };
    public scoreLoaded = { on: vi.fn() };

    constructor(_container: HTMLDivElement, settings: Settings) {
      this.settings = settings;
    }

    destroy = destroyMock;
    renderScore = renderScoreMock;
    load = loadMock;
    updateSettings = vi.fn();
  }

  return {
    Settings,
    AlphaTabApi,
    LayoutMode: { Page: 0, Horizontal: 1 },
    StaveProfile: { Default: 0, ScoreTab: 1, Score: 2, Tab: 3 },
    DisplaySettings: Settings,
    importer: {
      ScoreLoader: {
        loadScoreFromBytes: loadScoreFromBytesMock,
      },
    },
  };
});

const defaultSettings: AlphaTabUiSettings = {
  display: { staveProfile: 'scoreTab', layoutMode: 'page', barsPerRow: -1, scale: 1 },
  enablePlayer: false,
  partIndex: 0,
};

beforeEach(() => {
  renderFinishedCallbacks = [];
  vi.clearAllMocks();
  // Restore default successful parse.
  loadScoreFromBytesMock.mockReturnValue({
    tracks: [{ name: 'Guitar', staves: [{ stringTuning: { tunings: [64, 59, 55, 50, 45, 40] } }] }],
    stylesheet: {},
  });
  loadMock.mockReturnValue(true);
});

describe('AlphaTabRenderer', () => {
  it('mounts and destroys the API on unmount', () => {
    const { unmount } = render(
      <AlphaTabRenderer xmlText="<score-partwise />" uiSettings={defaultSettings} />,
    );
    unmount();
    expect(destroyMock).toHaveBeenCalled();
  });

  it('calls api.load (not renderScore) in worker mode', () => {
    render(
      <AlphaTabRenderer xmlText="<score-partwise />" uiSettings={defaultSettings} />,
    );
    // Worker path: raw bytes go to the worker via api.load(), not renderScore().
    expect(loadMock).toHaveBeenCalled();
    expect(renderScoreMock).not.toHaveBeenCalled();
  });

  it('reports errors via onError when ScoreLoader throws', () => {
    const onError = vi.fn();
    loadScoreFromBytesMock.mockImplementationOnce(() => { throw new Error('bad xml'); });

    render(
      <AlphaTabRenderer xmlText="<broken" uiSettings={defaultSettings} onError={onError} />,
    );
    expect(onError).toHaveBeenCalledWith('bad xml');
  });
});
