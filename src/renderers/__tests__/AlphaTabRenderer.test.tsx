import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AlphaTabRenderer from '../AlphaTabRenderer';
import type { AlphaTabSettings } from '../../types/alphatab';

const destroyMock = vi.fn();
const renderScoreMock = vi.fn();
const updateSettingsMock = vi.fn();

const scoreLoadedOnMock = vi.fn();
const errorOnMock = vi.fn();

vi.mock('@coderline/alphatab', () => {
  class Settings {
    core = { engine: 'svg', fontDirectory: '/font/' };
    display = { layoutMode: 'page', barsPerRow: -1, startBar: 0, barCount: -1, scale: 1 };
    notation = { smallGraceTabNotes: false };
    player = { enablePlayer: true, soundFont: '/soundfont/sonivox/sonivox.sf2' };
  }

  class AlphaTabApi {
    public settings: Settings;
    public scoreLoaded = { on: scoreLoadedOnMock };
    public error = { on: errorOnMock };

    constructor(_container: HTMLDivElement, settings: Settings) {
      this.settings = settings;
    }

    destroy = destroyMock;
    renderScore = renderScoreMock;
    updateSettings = updateSettingsMock;
  }

  return {
    Settings,
    AlphaTabApi,
    importer: {
      ScoreLoader: {
        loadScoreFromBytes: vi.fn(() => ({ tracks: [{ name: 'Guitar' }] })),
      },
    },
  };
});

const defaultSettings: AlphaTabSettings = {
  core: { engine: 'svg', fontDirectory: '/font/' },
  display: { layoutMode: 'page', barsPerRow: -1, startBar: 0, barCount: -1, scale: 1 },
  notation: { smallGraceTabNotes: false },
  player: { enablePlayer: true, soundFont: '/soundfont/sonivox/sonivox.sf2' },
};

describe('AlphaTabRenderer', () => {
  it('initializes and destroys the API on mount/unmount', () => {
    const { unmount } = render(
      <AlphaTabRenderer xmlText="<score-partwise />" settings={defaultSettings} partIndex={0} />,
    );

    expect(renderScoreMock).toHaveBeenCalled();
    unmount();
    expect(destroyMock).toHaveBeenCalled();
  });

  it('reports parsing errors through onError', () => {
    const onError = vi.fn();
    vi.mocked(renderScoreMock).mockImplementationOnce(() => {
      throw new Error('bad xml');
    });

    render(
      <AlphaTabRenderer xmlText="<broken" settings={defaultSettings} partIndex={0} onError={onError} />,
    );

    expect(onError).toHaveBeenCalledWith('bad xml');
  });
});
