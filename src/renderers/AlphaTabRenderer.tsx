// AlphaTab rendering component.
//
// Renders standard notation + guitar tablature using the AlphaTab engine.
// Accepts either a MusicXML string (xmlText) or raw binary file bytes
// (fileBytes) for Guitar Pro 3/4/5/X files — ScoreLoader auto-detects format.
//
// Worker setup: alphaTab.worker.min.mjs is served from public/ alongside
// alphaTab.core.mjs (copied there by the Vite buildStart hook). scriptFile is
// set explicitly so AlphaTab uses the static worker instead of trying to load
// the Vite-bundled chunk as a module worker (which fails silently).
// readyRef is set immediately — api.load() queues to the worker internally
// if the worker thread hasn't finished loading yet.

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
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  const onApiReadyRef = useRef(onApiReady);
  useEffect(() => { onApiReadyRef.current = onApiReady; }, [onApiReady]);

  const baseUrl = new URL('./', document.baseURI).href;
  const fontDir = `${baseUrl}font/`;

  const buildSettings = useCallback((): alphaTab.Settings => {
    const s = new alphaTab.Settings();
    s.core.fontDirectory = fontDir;
    // Point to the pre-built worker in public/ so layout/rendering runs off the
    // main thread. Auto-detection would use import.meta.url → the Vite chunk,
    // which cannot be loaded as a module worker.
    s.core.scriptFile = `${baseUrl}alphaTab.worker.min.mjs`;
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
  }, [baseUrl, fontDir, uiSettings]);

  const loadData = useCallback((api: alphaTab.AlphaTabApi, data: string | Uint8Array, partIdx: number) => {
    console.log('[AlphaTab] loadData called, byteLength:', typeof data === 'string' ? data.length : data.byteLength);
    try {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, api.settings);
      console.log('[AlphaTab] ScoreLoader parsed ok, tracks:', score.tracks.length);
      onScoreLoadedRef.current?.(score);

      // If the file has no guitar string data (e.g. piano MusicXML), AlphaTab will
      // crash with "l.staves" when trying to lay out a tab stave. Detect this and
      // silently fall back to notation-only so the score still renders.
      const trackIdx = partIdx >= 0 && partIdx < score.tracks.length ? partIdx : 0;
      const track = score.tracks[trackIdx];
      const hasTabData = track?.staves?.some(
        (s: alphaTab.model.Staff) => (s.stringTuning?.tunings?.length ?? 0) > 0,
      );
      if (!hasTabData) {
        const disp = api.settings.display as alphaTab.DisplaySettings;
        if (disp.staveProfile !== alphaTab.StaveProfile.Score) {
          disp.staveProfile = alphaTab.StaveProfile.Score;
        }
      }

      const tracks = partIdx >= 0 && partIdx < score.tracks.length ? [partIdx] : undefined;
      // Pass a copy of the ArrayBuffer so postMessage can transfer it to the worker
      // without detaching the original gpFileBytes (memoized) Uint8Array.
      const bufferCopy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const accepted = api.load(bufferCopy, tracks);
      console.log('[AlphaTab] api.load() returned:', accepted, '| tracks:', tracks);
      if (!accepted) {
        const msg = 'AlphaTab rejected the file data (api.load returned false)';
        setStatus('error');
        setErrorMsg(msg);
        onErrorRef.current?.(msg);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[AlphaTab] loadData error:', msg);
      setStatus('error');
      setErrorMsg(msg);
      onErrorRef.current?.(msg);
    }
  }, []);

  // Derive the active file data; fileBytes wins over xmlText.
  const fileData: string | Uint8Array = fileBytes ?? (xmlText ?? '');

  // Initialize once on mount.
  useEffect(() => {
    if (!containerRef.current) return;
    if (apiRef.current) return;

    const settings = buildSettings();
    const api = new alphaTab.AlphaTabApi(containerRef.current, settings);
    apiRef.current = api;
    // renderScore() queues to the worker internally — safe to call immediately.
    readyRef.current = true;

    api.renderStarted.on(() => { console.log('[AlphaTab] renderStarted'); setStatus('loading'); });

    let notifiedReady = false;
    api.renderFinished.on(() => {
      console.log('[AlphaTab] renderFinished');
      setStatus('ready');
      if (!notifiedReady) {
        notifiedReady = true;
        onApiReadyRef.current?.(api);
      }
    });

    (api as unknown as {
      scoreLoaded: { on: (fn: (score: alphaTab.model.Score) => void) => void };
      error: { on: (fn: (e: { message?: string }) => void) => void };
    }).scoreLoaded.on((score) => {
      console.log('[AlphaTab] scoreLoaded (worker) tracks:', score?.tracks?.length);
    });

    (api as unknown as { error: { on: (fn: (e: { message?: string }) => void) => void } })
      .error.on((e) => {
        const msg = e?.message ?? 'AlphaTab error';
        console.error('[AlphaTab] error event:', msg);
        setStatus('error');
        setErrorMsg(msg);
        onErrorRef.current?.(msg);
      });

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
    if (!apiRef.current || !readyRef.current) {
      pendingDataRef.current = fileData;
      return;
    }
    loadData(apiRef.current, fileData, uiSettings.partIndex);
  }, [fileData, uiSettings.partIndex, loadData]);

  // Re-render when layout-affecting settings change (stave profile, layout mode, bars per row, scale).
  // Scale is included here rather than a separate updateSettings() call because updateSettings()
  // alone does not visually re-render the score.
  const prevStaveRef = useRef(uiSettings.display.staveProfile);
  const prevLayoutRef = useRef(uiSettings.display.layoutMode);
  const prevBarsRef = useRef(uiSettings.display.barsPerRow);
  const prevScaleRef = useRef(uiSettings.display.scale);
  useEffect(() => {
    const staveChanged = prevStaveRef.current !== uiSettings.display.staveProfile;
    const layoutChanged = prevLayoutRef.current !== uiSettings.display.layoutMode;
    const barsChanged = prevBarsRef.current !== uiSettings.display.barsPerRow;
    const scaleChanged = prevScaleRef.current !== uiSettings.display.scale;
    prevStaveRef.current = uiSettings.display.staveProfile;
    prevLayoutRef.current = uiSettings.display.layoutMode;
    prevBarsRef.current = uiSettings.display.barsPerRow;
    prevScaleRef.current = uiSettings.display.scale;

    if (!(staveChanged || layoutChanged || barsChanged || scaleChanged)) return;
    if (!apiRef.current || !containerRef.current) return;

    apiRef.current.destroy();
    apiRef.current = null;
    readyRef.current = false;
    setStatus('loading');

    const settings = buildSettings();
    const api = new alphaTab.AlphaTabApi(containerRef.current, settings);
    apiRef.current = api;
    readyRef.current = true;

    api.renderStarted.on(() => setStatus('loading'));
    let notifiedReady2 = false;
    api.renderFinished.on(() => {
      setStatus('ready');
      if (!notifiedReady2) {
        notifiedReady2 = true;
        onApiReadyRef.current?.(api);
      }
    });

    (api as unknown as { error: { on: (fn: (e: { message?: string }) => void) => void } })
      .error.on((e) => {
        const msg = e?.message ?? 'AlphaTab error';
        setStatus('error');
        setErrorMsg(msg);
        onErrorRef.current?.(msg);
      });

    if (fileData) {
      loadData(api, fileData, uiSettings.partIndex);
    }
  }, [uiSettings.display.staveProfile, uiSettings.display.layoutMode, uiSettings.display.barsPerRow,
      uiSettings.display.scale, fileData, uiSettings.partIndex, buildSettings, loadData]);

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
