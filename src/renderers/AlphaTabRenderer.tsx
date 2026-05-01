// AlphaTab rendering component.
//
// Renders standard notation + guitar tablature using the AlphaTab engine.
// Accepts either a MusicXML string (xmlText) or raw binary file bytes
// (fileBytes) for Guitar Pro 3/4/5/X files — ScoreLoader auto-detects format.
//
// Blank-screen root causes (and fixes applied here):
//   1. Container has no height → fixed by enforcing min-height via CSS class.
//   2. fontDirectory points nowhere → fixed by computing absolute URL from
//      document.baseURI so it works in dev and GitHub Pages production.
//   3. Worker URL unresolved → static asset served from public/.
//   4. renderScore called before API ready → called only inside renderFinished.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as alphaTab from '@coderline/alphatab';
import type { AlphaTabUiSettings } from '../types/alphatab';

interface Props {
  /** MusicXML text — used when fileBytes is not provided. */
  xmlText?: string;
  /** Raw binary file bytes (GP3/4/5/X). Takes precedence over xmlText. */
  fileBytes?: Uint8Array;
  uiSettings: AlphaTabUiSettings;
  onApiReady?: (api: alphaTab.AlphaTabApi) => void;
  /** Called synchronously after ScoreLoader parses the file, before rendering starts. */
  onScoreLoaded?: (score: alphaTab.model.Score) => void;
  onError?: (msg: string) => void;
}

export default function AlphaTabRenderer({
  xmlText,
  fileBytes,
  uiSettings,
  onApiReady,
  onScoreLoaded,
  onError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const readyRef = useRef(false);
  const pendingDataRef = useRef<string | Uint8Array | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  // Keep callbacks in refs so loadData closure never goes stale.
  const onScoreLoadedRef = useRef(onScoreLoaded);
  useEffect(() => { onScoreLoadedRef.current = onScoreLoaded; }, [onScoreLoaded]);

  const baseUrl = new URL('./', document.baseURI).href;
  const fontDir = `${baseUrl}font/`;
  const workerUrl = `${baseUrl}alphaTab.worker.min.mjs`;

  const buildSettings = useCallback((): alphaTab.Settings => {
    const s = new alphaTab.Settings();
    s.core.fontDirectory = fontDir;
    (s.core as unknown as Record<string, unknown>).workerFile = workerUrl;
    s.player.enablePlayer = false;
    (s.display as alphaTab.DisplaySettings).layoutMode = alphaTab.LayoutMode.Page;
    switch (uiSettings.display.staveProfile) {
      case 'scoreTab': (s.display as alphaTab.DisplaySettings).staveProfile = alphaTab.StaveProfile.ScoreTab; break;
      case 'score':    (s.display as alphaTab.DisplaySettings).staveProfile = alphaTab.StaveProfile.Score; break;
      case 'tab':      (s.display as alphaTab.DisplaySettings).staveProfile = alphaTab.StaveProfile.Tab; break;
      default:         (s.display as alphaTab.DisplaySettings).staveProfile = alphaTab.StaveProfile.Default; break;
    }
    if (uiSettings.display.layoutMode === 'horizontal') {
      (s.display as alphaTab.DisplaySettings).layoutMode = alphaTab.LayoutMode.Horizontal;
    }
    if (uiSettings.display.barsPerRow > 0) {
      (s.display as alphaTab.DisplaySettings).barsPerRow = uiSettings.display.barsPerRow;
    }
    (s.display as alphaTab.DisplaySettings).scale = uiSettings.display.scale;
    return s;
  }, [fontDir, workerUrl, uiSettings]);

  const loadData = useCallback((api: alphaTab.AlphaTabApi, data: string | Uint8Array, partIdx: number) => {
    try {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, api.settings);
      onScoreLoadedRef.current?.(score);
      const tracks = partIdx >= 0 && partIdx < score.tracks.length ? [partIdx] : undefined;
      api.renderScore(score, tracks);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus('error');
      setErrorMsg(msg);
      onError?.(msg);
    }
  }, [onError]);

  // Derive the active file data; fileBytes wins over xmlText.
  const fileData: string | Uint8Array = fileBytes ?? (xmlText ?? '');

  // Initialize once on mount.
  useEffect(() => {
    if (!containerRef.current) return;
    if (apiRef.current) return;

    const settings = buildSettings();
    const api = new alphaTab.AlphaTabApi(containerRef.current, settings);
    apiRef.current = api;
    readyRef.current = false;

    api.renderStarted.on(() => setStatus('loading'));
    api.renderFinished.on(() => setStatus('ready'));

    (api as unknown as { error: { on: (fn: (e: { message?: string }) => void) => void } })
      .error.on((e) => {
        const msg = e?.message ?? 'AlphaTab error';
        setStatus('error');
        setErrorMsg(msg);
        onError?.(msg);
      });

    api.renderFinished.on(() => {
      if (!readyRef.current) {
        readyRef.current = true;
        onApiReady?.(api);
        if (pendingDataRef.current) {
          loadData(api, pendingDataRef.current, uiSettings.partIndex);
          pendingDataRef.current = null;
        }
      }
    });

    pendingDataRef.current = fileData || null;

    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — API created once

  // Re-load when file data or partIndex changes.
  useEffect(() => {
    if (!fileData) return;
    if (!apiRef.current) {
      pendingDataRef.current = fileData;
      return;
    }
    if (!readyRef.current) {
      pendingDataRef.current = fileData;
      return;
    }
    loadData(apiRef.current, fileData, uiSettings.partIndex);
  }, [fileData, uiSettings.partIndex, loadData]);

  // Apply scale changes live without full API recreation.
  const prevScaleRef = useRef(uiSettings.display.scale);
  useEffect(() => {
    if (prevScaleRef.current === uiSettings.display.scale) return;
    prevScaleRef.current = uiSettings.display.scale;
    if (!apiRef.current || !readyRef.current) return;
    (apiRef.current.settings.display as alphaTab.DisplaySettings).scale = uiSettings.display.scale;
    apiRef.current.updateSettings();
  }, [uiSettings.display.scale]);

  // Re-render when layout-affecting settings change (stave profile, layout mode, bars per row).
  const prevStaveRef = useRef(uiSettings.display.staveProfile);
  const prevLayoutRef = useRef(uiSettings.display.layoutMode);
  const prevBarsRef = useRef(uiSettings.display.barsPerRow);
  useEffect(() => {
    const staveChanged = prevStaveRef.current !== uiSettings.display.staveProfile;
    const layoutChanged = prevLayoutRef.current !== uiSettings.display.layoutMode;
    const barsChanged = prevBarsRef.current !== uiSettings.display.barsPerRow;
    prevStaveRef.current = uiSettings.display.staveProfile;
    prevLayoutRef.current = uiSettings.display.layoutMode;
    prevBarsRef.current = uiSettings.display.barsPerRow;

    if (!(staveChanged || layoutChanged || barsChanged)) return;
    if (!apiRef.current || !containerRef.current) return;

    apiRef.current.destroy();
    apiRef.current = null;
    readyRef.current = false;
    pendingDataRef.current = fileData || null;
    setStatus('loading');

    const settings = buildSettings();
    const api = new alphaTab.AlphaTabApi(containerRef.current, settings);
    apiRef.current = api;

    api.renderFinished.on(() => {
      if (!readyRef.current) {
        readyRef.current = true;
        onApiReady?.(api);
        if (pendingDataRef.current) {
          loadData(api, pendingDataRef.current, uiSettings.partIndex);
          pendingDataRef.current = null;
        }
      }
    });

    (api as unknown as { error: { on: (fn: (e: { message?: string }) => void) => void } })
      .error.on((e) => {
        const msg = e?.message ?? 'AlphaTab error';
        setStatus('error');
        setErrorMsg(msg);
        onError?.(msg);
      });
  }, [uiSettings.display.staveProfile, uiSettings.display.layoutMode, uiSettings.display.barsPerRow,
      fileData, uiSettings.partIndex, buildSettings, loadData, onApiReady, onError]);

  // Notify AlphaTab when the window resizes.
  useEffect(() => {
    const onResize = () => apiRef.current?.updateSettings();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="alphatab-wrapper">
      {status === 'loading' && (
        <div className="alphatab-loading">Rendering score…</div>
      )}
      {status === 'error' && (
        <div className="alphatab-error">{errorMsg}</div>
      )}
      <div
        ref={containerRef}
        className="alphatab-container"
      />
    </div>
  );
}
