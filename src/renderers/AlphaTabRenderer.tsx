// AlphaTab rendering component.
//
// Renders standard notation + guitar tablature simultaneously using the
// AlphaTab engine (distinct from the VexFlow-only tab mode).  The component
// manages the AlphaTabApi lifecycle: it creates the API once on mount, loads a
// score whenever xmlText changes, and destroys cleanly on unmount.
//
// Blank-screen root causes (and fixes applied here):
//   1. Container has no height → fixed by enforcing min-height via CSS class.
//   2. fontDirectory points nowhere → fixed by computing the absolute URL from
//      document.baseURI so it works in both dev and GitHub Pages production.
//   3. Worker URL unresolved → we serve the worker file as a static asset
//      from public/alphaTab.worker.min.mjs and point core.workerFile to it.
//   4. renderScore called before API ready → fixed by calling it inside the
//      renderFinished callback that fires after worker bootstrap.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as alphaTab from '@coderline/alphatab';
import type { AlphaTabUiSettings } from '../types/alphatab';

interface Props {
  xmlText: string;
  uiSettings: AlphaTabUiSettings;
  onApiReady?: (api: alphaTab.AlphaTabApi) => void;
  onError?: (msg: string) => void;
}

export default function AlphaTabRenderer({ xmlText, uiSettings, onApiReady, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const readyRef = useRef(false);
  const pendingXmlRef = useRef<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  // Compute absolute URLs so the same code works in Vite dev server and in
  // production (GitHub Pages sub-path) without hard-coding a host.
  const baseUrl = new URL('./', document.baseURI).href;
  const fontDir = `${baseUrl}font/`;
  const workerUrl = `${baseUrl}alphaTab.worker.min.mjs`;

  const buildSettings = useCallback((): alphaTab.Settings => {
    const s = new alphaTab.Settings();
    s.core.fontDirectory = fontDir;
    // Point to the statically served worker file so the browser can spin up
    // the background rendering thread without the Vite bundler plugin.
    (s.core as unknown as Record<string, unknown>).workerFile = workerUrl;
    s.player.enablePlayer = false; // disabled — avoids SF2 fetch failures
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
    return s;
  }, [fontDir, workerUrl, uiSettings]);

  const loadXml = useCallback((api: alphaTab.AlphaTabApi, xml: string, partIdx: number) => {
    try {
      const data = new TextEncoder().encode(xml);
      const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(data, api.settings);
      const tracks = partIdx >= 0 && partIdx < score.tracks.length ? [partIdx] : undefined;
      api.renderScore(score, tracks);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus('error');
      setErrorMsg(msg);
      onError?.(msg);
    }
  }, [onError]);

  // Initialize once on mount.
  useEffect(() => {
    if (!containerRef.current) return;
    if (apiRef.current) return; // already init

    const settings = buildSettings();
    const api = new alphaTab.AlphaTabApi(containerRef.current, settings);
    apiRef.current = api;
    readyRef.current = false;

    api.renderStarted.on(() => setStatus('loading'));

    api.renderFinished.on(() => {
      setStatus('ready');
    });

    (api as unknown as { error: { on: (fn: (e: { message?: string }) => void) => void } })
      .error.on((e) => {
        const msg = e?.message ?? 'AlphaTab error';
        setStatus('error');
        setErrorMsg(msg);
        onError?.(msg);
      });

    // alphaTab fires 'postRenderFinished' once the initial layout is done.
    // Use renderFinished as the "ready" signal and then load any pending score.
    api.renderFinished.on(() => {
      if (!readyRef.current) {
        readyRef.current = true;
        onApiReady?.(api);
        if (pendingXmlRef.current) {
          loadXml(api, pendingXmlRef.current, uiSettings.partIndex);
          pendingXmlRef.current = null;
        }
      }
    });

    // Queue the initial score load; we load after the first renderFinished.
    pendingXmlRef.current = xmlText;

    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — API created once

  // Re-load score whenever xmlText or partIndex changes.
  useEffect(() => {
    if (!apiRef.current) {
      pendingXmlRef.current = xmlText;
      return;
    }
    if (!readyRef.current) {
      pendingXmlRef.current = xmlText;
      return;
    }
    loadXml(apiRef.current, xmlText, uiSettings.partIndex);
  }, [xmlText, uiSettings.partIndex, loadXml]);

  // Re-render when display settings change (requires full API recreation).
  // We do this by destroying + recreating the API when layout-affecting settings change.
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

    // Destroy and recreate with new settings.
    apiRef.current.destroy();
    apiRef.current = null;
    readyRef.current = false;
    pendingXmlRef.current = xmlText;
    setStatus('loading');

    const settings = buildSettings();
    const api = new alphaTab.AlphaTabApi(containerRef.current, settings);
    apiRef.current = api;

    api.renderFinished.on(() => {
      if (!readyRef.current) {
        readyRef.current = true;
        onApiReady?.(api);
        if (pendingXmlRef.current) {
          loadXml(api, pendingXmlRef.current, uiSettings.partIndex);
          pendingXmlRef.current = null;
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

    pendingXmlRef.current = xmlText;
  }, [uiSettings.display.staveProfile, uiSettings.display.layoutMode, uiSettings.display.barsPerRow,
      xmlText, uiSettings.partIndex, buildSettings, loadXml, onApiReady, onError]);

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
