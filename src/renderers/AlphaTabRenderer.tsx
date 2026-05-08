// AlphaTab rendering component.
//
// Renders standard notation + guitar tablature using the AlphaTab engine.
// Accepts either a MusicXML string (xmlText) or raw binary file bytes
// (fileBytes) for Guitar Pro 3/4/5/X files — ScoreLoader auto-detects format.
//
// Worker setup: alphaTab.worker.min.mjs is served from public/ alongside
// alphaTab.core.mjs (copied there by the Vite buildStart hook). scriptFile is
// set explicitly so AlphaTab uses the static worker instead of trying to load
// the Vite-bundled chunk as a module worker (which fails silently). If Safari
// or iOS WebKit fails to complete a worker render, the component retries once
// with worker rendering disabled instead of leaving the UI stuck forever.

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

type AlphaTabEvent<T> = { on?: (fn: (arg: T) => void) => void };
type AlphaTabApiWithOptionalEvents = alphaTab.AlphaTabApi & {
  scoreLoaded?: AlphaTabEvent<alphaTab.model.Score>;
  error?: AlphaTabEvent<{ message?: string }>;
};

const WORKER_RENDER_TIMEOUT_MS = 20_000;
const FALLBACK_RENDER_TIMEOUT_MS = 30_000;

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
  const renderTimerRef = useRef<number | null>(null);
  const renderAttemptRef = useRef(0);
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

  const clearRenderTimer = useCallback(() => {
    if (renderTimerRef.current) {
      window.clearTimeout(renderTimerRef.current);
      renderTimerRef.current = null;
    }
  }, []);

  const buildSettings = useCallback((useWorkers = true): alphaTab.Settings => {
    const s = new alphaTab.Settings();
    s.core.fontDirectory = fontDir;
    // Point to the pre-built worker in public/ so layout/rendering runs off the
    // main thread. Auto-detection would use import.meta.url → the Vite chunk,
    // which cannot be loaded as a module worker.
    s.core.scriptFile = `${baseUrl}alphaTab.worker.min.mjs`;
    s.core.useWorkers = useWorkers;
    // Mobile Safari sometimes never appends lazy chunks inside nested scrolling
    // containers. Render all SVG chunks once the score is laid out so exporting
    // PDF/PNG/SVG sees the same content the user sees.
    s.core.enableLazyLoading = false;
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

  const attachApiEvents = useCallback((api: alphaTab.AlphaTabApi) => {
    api.renderStarted.on(() => {
      console.log('[AlphaTab] renderStarted');
      setStatus('loading');
    });

    let notifiedReady = false;
    api.renderFinished.on(() => {
      console.log('[AlphaTab] renderFinished');
      clearRenderTimer();
      setStatus('ready');
      setErrorMsg('');
      if (!notifiedReady) {
        notifiedReady = true;
        onApiReadyRef.current?.(api);
      }
    });

    const apiWithEvents = api as AlphaTabApiWithOptionalEvents;
    apiWithEvents.scoreLoaded?.on?.((score) => {
      console.log('[AlphaTab] scoreLoaded (worker) tracks:', score?.tracks?.length);
    });

    apiWithEvents.error?.on?.((e) => {
      const msg = e?.message ?? 'AlphaTab error';
      console.error('[AlphaTab] error event:', msg);
      clearRenderTimer();
      setStatus('error');
      setErrorMsg(msg);
      onErrorRef.current?.(msg);
    });
  }, [clearRenderTimer]);

  const createApi = useCallback((useWorkers = true): alphaTab.AlphaTabApi | null => {
    if (!containerRef.current) return null;
    const settings = buildSettings(useWorkers);
    const api = new alphaTab.AlphaTabApi(containerRef.current, settings);
    attachApiEvents(api);
    apiRef.current = api;
    readyRef.current = true;
    return api;
  }, [attachApiEvents, buildSettings]);

  const renderParsedScore = useCallback((
    api: alphaTab.AlphaTabApi,
    score: alphaTab.model.Score,
    tracks: number[] | undefined,
    attempt: number,
  ) => {
    clearRenderTimer();
    setStatus('loading');
    setErrorMsg('');

    const useWorkers = api.settings.core.useWorkers !== false;
    const timeoutMs = useWorkers ? WORKER_RENDER_TIMEOUT_MS : FALLBACK_RENDER_TIMEOUT_MS;
    renderTimerRef.current = window.setTimeout(() => {
      if (attempt !== renderAttemptRef.current || apiRef.current !== api) return;

      if (useWorkers && containerRef.current) {
        console.warn('[AlphaTab] worker render timed out; retrying without workers');
        clearRenderTimer();
        api.destroy();
        const fallbackApi = createApi(false);
        if (fallbackApi) {
          renderParsedScore(fallbackApi, score, tracks, attempt);
          return;
        }
      }

      const msg = useWorkers
        ? 'AlphaTab rendering timed out before the worker responded. Try a different track or Tab-only view.'
        : 'AlphaTab rendering timed out in the Safari/iOS fallback renderer. Try a different track or Tab-only view.';
      setStatus('error');
      setErrorMsg(msg);
      onErrorRef.current?.(msg);
    }, timeoutMs);

    try {
      api.renderScore(score, tracks);
    } catch (e: unknown) {
      clearRenderTimer();
      const msg = e instanceof Error ? e.message : String(e);
      setStatus('error');
      setErrorMsg(msg);
      onErrorRef.current?.(msg);
    }
  }, [clearRenderTimer, createApi]);

  const loadData = useCallback((api: alphaTab.AlphaTabApi, data: string | Uint8Array, partIdx: number) => {
    console.log('[AlphaTab] loadData called, byteLength:', typeof data === 'string' ? data.length : data.byteLength);
    const attempt = renderAttemptRef.current + 1;
    renderAttemptRef.current = attempt;
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
      renderParsedScore(api, score, tracks, attempt);
    } catch (e: unknown) {
      clearRenderTimer();
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[AlphaTab] loadData error:', msg);
      setStatus('error');
      setErrorMsg(msg);
      onErrorRef.current?.(msg);
    }
  }, [clearRenderTimer, renderParsedScore]);

  // Derive the active file data; fileBytes wins over xmlText.
  const fileData: string | Uint8Array = fileBytes ?? (xmlText ?? '');

  // Initialize once on mount.
  useEffect(() => {
    if (!containerRef.current) return;
    if (apiRef.current) return;

    createApi(true);

    return () => {
      clearRenderTimer();
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
    if (!containerRef.current) return;

    clearRenderTimer();
    apiRef.current?.destroy();
    apiRef.current = null;
    readyRef.current = false;
    setStatus('loading');

    const api = createApi(true);
    if (api && fileData) {
      loadData(api, fileData, uiSettings.partIndex);
    }
  }, [uiSettings.display.staveProfile, uiSettings.display.layoutMode, uiSettings.display.barsPerRow,
      uiSettings.display.scale, fileData, uiSettings.partIndex, createApi, loadData, clearRenderTimer]);

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
