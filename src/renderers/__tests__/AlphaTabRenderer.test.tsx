import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import AlphaTabRenderer from '../AlphaTabRenderer';
import type { AlphaTabUiSettings } from '../../types/alphatab';

const destroyMock = vi.fn();
const renderScoreMock = vi.fn();

let renderFinishedCallbacks: Array<() => void> = [];

vi.mock('@coderline/alphatab', () => {
  class Settings {
    core: Record<string, unknown> = { fontDirectory: '/font/', workerFile: '/alphaTab.worker.min.mjs' };
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

    constructor(_container: HTMLDivElement, settings: Settings) {
      this.settings = settings;
    }

    destroy = destroyMock;
    renderScore = renderScoreMock;
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
        loadScoreFromBytes: vi.fn(() => ({ tracks: [{ name: 'Guitar' }] })),
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
});

describe('AlphaTabRenderer', () => {
  it('mounts and destroys the API on unmount', () => {
    const { unmount } = render(
      <AlphaTabRenderer xmlText="<score-partwise />" uiSettings={defaultSettings} />,
    );
    unmount();
    expect(destroyMock).toHaveBeenCalled();
  });

  it('calls renderScore after ready signal fires', () => {
    render(
      <AlphaTabRenderer xmlText="<score-partwise />" uiSettings={defaultSettings} />,
    );
    // Simulate AlphaTab firing the ready signal (renderFinished).
    renderFinishedCallbacks.forEach((fn) => fn());
    expect(renderScoreMock).toHaveBeenCalled();
  });

  it('reports errors via onError when renderScore throws', () => {
    const onError = vi.fn();
    renderScoreMock.mockImplementationOnce(() => { throw new Error('bad xml'); });

    render(
      <AlphaTabRenderer xmlText="<broken" uiSettings={defaultSettings} onError={onError} />,
    );
    renderFinishedCallbacks.forEach((fn) => fn());
    expect(onError).toHaveBeenCalledWith('bad xml');
  });
});
