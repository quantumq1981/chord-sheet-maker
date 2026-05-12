import { render, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import AlphaTabRenderer from '../AlphaTabRenderer';
import type { AlphaTabUiSettings } from '../../types/alphatab';

const destroyMock = vi.fn();
const renderScoreMock = vi.fn();
const loadMock = vi.fn(() => true);

// vi.hoisted ensures these are initialised before the vi.mock factory runs
// (the factory is hoisted to the top of the file by Vitest's transform).
const loadScoreFromBytesMock = vi.hoisted(() => vi.fn(() => ({
  tracks: [{ name: 'Guitar', staves: [{ stringTuning: { tunings: [64, 59, 55, 50, 45, 40] } }] }],
  stylesheet: {},
})));

// Captures every (settings) argument passed to the AlphaTabApi constructor so
// tests can inspect what buildSettings() produced.
const constructorMock = vi.hoisted(() => vi.fn());

let renderFinishedCallbacks: Array<() => void> = [];

vi.mock('@coderline/alphatab', () => {
  class Settings {
    core: Record<string, unknown> = {
      fontDirectory: '/font/',
      scriptFile: '/alphaTab.worker.min.mjs',
      useWorkers: true,
      enableLazyLoading: false,
    };
    display = { layoutMode: 0, staveProfile: 1, barsPerRow: -1, scale: 1 };
    player = { enablePlayer: false };
    // notation must exist so buildSettings() can write transpositionPitches
    notation: { transpositionPitches: number[] } = { transpositionPitches: [] };
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
      constructorMock(settings);  // record every construction + its settings
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

afterEach(() => {
  vi.useRealTimers();
});

describe('AlphaTabRenderer', () => {

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  it('mounts and destroys the API on unmount', () => {
    const { unmount } = render(
      <AlphaTabRenderer xmlText="<score-partwise />" uiSettings={defaultSettings} />,
    );
    unmount();
    expect(destroyMock).toHaveBeenCalled();
  });

  // ── Render paths ──────────────────────────────────────────────────────────

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

  it('reports errors via onError when api.load returns false', () => {
    const onError = vi.fn();
    loadMock.mockReturnValueOnce(false);

    render(
      <AlphaTabRenderer xmlText="<score-partwise />" uiSettings={defaultSettings} onError={onError} />,
    );
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('api.load returned false'),
    );
  });

  // ── buildSettings: transpose ───────────────────────────────────────────────

  it('sets notation.transpositionPitches when transposeSemitones is non-zero', () => {
    render(
      <AlphaTabRenderer
        xmlText="<score-partwise />"
        uiSettings={{ ...defaultSettings, transposeSemitones: 3 }}
      />,
    );
    // constructorMock.calls[0][0] is the Settings object passed on first construction.
    const settings = constructorMock.mock.calls[0][0];
    expect(settings.notation.transpositionPitches).toHaveLength(128);
    expect(settings.notation.transpositionPitches.every((v: number) => v === 3)).toBe(true);
  });

  it('leaves notation.transpositionPitches empty when transposeSemitones is 0 or absent', () => {
    render(
      <AlphaTabRenderer xmlText="<score-partwise />" uiSettings={defaultSettings} />,
    );
    const settings = constructorMock.mock.calls[0][0];
    // Default mock Settings initialises transpositionPitches to []; buildSettings
    // must not overwrite it when semitones === 0.
    expect(settings.notation.transpositionPitches).toHaveLength(0);
  });

  // ── Settings-change effect: transpose triggers re-render ──────────────────

  it('destroys and recreates the API when transposeSemitones changes', () => {
    const { rerender } = render(
      <AlphaTabRenderer xmlText="<score-partwise />" uiSettings={defaultSettings} />,
    );

    // Initial render: one construction, one load call.
    expect(constructorMock).toHaveBeenCalledTimes(1);
    expect(loadMock).toHaveBeenCalledTimes(1);

    rerender(
      <AlphaTabRenderer
        xmlText="<score-partwise />"
        uiSettings={{ ...defaultSettings, transposeSemitones: 5 }}
      />,
    );

    // Settings change must destroy the old API and create a fresh one.
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(constructorMock).toHaveBeenCalledTimes(2);
    expect(loadMock).toHaveBeenCalledTimes(2);

    // The second construction must carry the new pitch offset.
    const newSettings = constructorMock.mock.calls[1][0];
    expect(newSettings.notation.transpositionPitches.every((v: number) => v === 5)).toBe(true);
  });

  it('destroys and recreates the API when stave profile changes', () => {
    const { rerender } = render(
      <AlphaTabRenderer xmlText="<score-partwise />" uiSettings={defaultSettings} />,
    );

    rerender(
      <AlphaTabRenderer
        xmlText="<score-partwise />"
        uiSettings={{ ...defaultSettings, display: { ...defaultSettings.display, staveProfile: 'tab' } }}
      />,
    );

    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(constructorMock).toHaveBeenCalledTimes(2);
  });

  // ── Worker timeout → no-worker fallback ───────────────────────────────────

  it('destroys the worker API and falls back to renderScore after timeout', () => {
    vi.useFakeTimers();

    render(
      <AlphaTabRenderer xmlText="<score-partwise />" uiSettings={defaultSettings} />,
    );

    // First API created with workers enabled; load() called but renderFinished
    // never fires (worker is mocked and never responds).
    expect(constructorMock).toHaveBeenCalledTimes(1);
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(renderScoreMock).not.toHaveBeenCalled();

    // Advance past WORKER_RENDER_TIMEOUT_MS (20 000 ms).
    act(() => { vi.advanceTimersByTime(20_000); });

    // Timeout handler must:
    //  1. destroy the original worker-mode API
    //  2. create a new API with useWorkers = false
    //  3. call renderScore (the no-worker path) on the fallback API
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(constructorMock).toHaveBeenCalledTimes(2);

    const fallbackSettings = constructorMock.mock.calls[1][0];
    expect(fallbackSettings.core.useWorkers).toBe(false);
    expect(renderScoreMock).toHaveBeenCalledTimes(1);
  });

  // ── onRenderFinished ──────────────────────────────────────────────────────

  it('calls onRenderFinished when the renderFinished event fires', () => {
    const onRenderFinished = vi.fn();
    render(
      <AlphaTabRenderer
        xmlText="<score-partwise />"
        uiSettings={defaultSettings}
        onRenderFinished={onRenderFinished}
      />,
    );

    // Simulate AlphaTab firing renderFinished (e.g. after worker completes).
    act(() => { renderFinishedCallbacks.forEach((cb) => cb()); });

    expect(onRenderFinished).toHaveBeenCalledTimes(1);
  });

  it('calls onApiReady exactly once on first renderFinished', () => {
    const onApiReady = vi.fn();
    render(
      <AlphaTabRenderer
        xmlText="<score-partwise />"
        uiSettings={defaultSettings}
        onApiReady={onApiReady}
      />,
    );

    // Fire renderFinished twice (e.g. settings change triggers a second render).
    act(() => {
      renderFinishedCallbacks.forEach((cb) => cb());
      renderFinishedCallbacks.forEach((cb) => cb());
    });

    // onApiReady is guarded by notifiedReady — must fire only once per API instance.
    expect(onApiReady).toHaveBeenCalledTimes(1);
  });
});
