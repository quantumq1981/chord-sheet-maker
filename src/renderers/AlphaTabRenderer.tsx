import { useCallback, useEffect, useRef } from 'react';
import * as alphaTab from '@coderline/alphatab';
import type { AlphaTabSettings } from '../types/alphatab';

interface AlphaTabRendererProps {
  xmlText: string;
  settings: AlphaTabSettings;
  partIndex: number;
  onApiReady?: (api: alphaTab.AlphaTabApi | null) => void;
  onTracksChanged?: (tracks: Array<{ name?: string }>) => void;
  onError?: (error: string) => void;
}

export default function AlphaTabRenderer({
  xmlText,
  settings,
  partIndex,
  onApiReady,
  onTracksChanged,
  onError,
}: AlphaTabRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);

  const disposeApi = useCallback(() => {
    if (!apiRef.current) return;
    apiRef.current.destroy();
    apiRef.current = null;
    onApiReady?.(null);
  }, [onApiReady]);

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      const api = new alphaTab.AlphaTabApi(containerRef.current, settings as unknown as alphaTab.Settings);
      apiRef.current = api;
      onApiReady?.(api);

      api.scoreLoaded.on((score) => {
        onTracksChanged?.(score.tracks);
      });

      api.error.on((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        onError?.(msg);
      });
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    }

    return disposeApi;
  }, [disposeApi, onApiReady, onError, onTracksChanged, settings]);

  useEffect(() => {
    if (!apiRef.current || !xmlText) return;
    try {
      const bytes = new TextEncoder().encode(xmlText);
      const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, apiRef.current.settings);
      const selectedTracks = partIndex >= 0 ? [partIndex] : undefined;
      apiRef.current.renderScore(score, selectedTracks);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    }
  }, [xmlText, partIndex, onError]);

  useEffect(() => {
    if (!apiRef.current) return;

    const api = apiRef.current;
    api.settings.display.layoutMode = settings.display.layoutMode as unknown as alphaTab.LayoutMode;
    api.settings.display.barsPerRow = settings.display.barsPerRow;
    api.settings.display.startBar = settings.display.startBar;
    api.settings.display.barCount = settings.display.barCount;
    api.settings.display.scale = settings.display.scale;
    api.settings.notation.smallGraceTabNotes = settings.notation.smallGraceTabNotes;
    api.settings.player.enablePlayer = settings.player.enablePlayer;
    api.settings.player.soundFont = settings.player.soundFont;
    api.updateSettings();
  }, [settings]);

  useEffect(() => {
    const onResize = () => apiRef.current?.updateSettings();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return <div ref={containerRef} className="alphatab-container" />;
}
