// useOsmd.ts
//
// Encapsulates the OpenSheetMusicDisplay (OSMD) notation lifecycle that used to
// live inline in App.tsx:
//   • creating the OSMD instance bound to a container <div>,
//   • (re)rendering whenever the loaded MusicXML, zoom, diagnostics, or
//     rehearsal-mark set change,
//   • repositioning rehearsal marks after each render,
//   • zoom state plus the fit-to-width / step-zoom controls.
//
// Behaviour is identical to the previous inline implementation. The hook returns
// its refs/state/handlers so the rest of App.tsx can keep referencing them under
// the same names (refs are shared, so the existing scattered load/reset sites
// that poke xmlLoadedRef / didAutoFitRef / the setters continue to work).

import { useCallback, useEffect, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { getRenderedSvgs } from '../utils/svgRaster';
import { repositionRehearsalMarksBetweenSystems } from '../utils/rehearsalMarkLayout';

export interface UseOsmdArgs {
  /** Current (possibly transposed) MusicXML fed to OSMD. */
  loadedXmlText: string;
  /** Only the validity flags are needed to gate rendering. */
  diagnostics: { isValidXml: boolean; isMusicXml: boolean } | null;
  /** Rehearsal-mark labels to reposition after each render. */
  rehearsalTexts: Set<string>;
}

export function useOsmd({ loadedXmlText, diagnostics, rehearsalTexts }: UseOsmdArgs) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const didAutoFitRef = useRef(false);
  const xmlLoadedRef = useRef('');

  const [zoom, setZoom] = useState(1);
  const [renderError, setRenderError] = useState('');
  const [renderedPageCount, setRenderedPageCount] = useState(0);

  // ── Notation controls ──
  const adjustZoom = useCallback((delta: number) => {
    setZoom((prev) => Math.max(0.4, Math.min(2.5, Number((prev + delta).toFixed(2)))));
  }, []);

  const fitWidth = useCallback(() => {
    const container = containerRef.current;
    const osmd = osmdRef.current;
    if (!container || !osmd) return;
    const firstPage = container.querySelector('.osmd-page') as HTMLElement | null;
    const containerWidth = container.clientWidth;
    if (firstPage && firstPage.offsetWidth > 0) {
      const ratio = containerWidth / firstPage.offsetWidth;
      const target = osmd.Zoom * ratio;
      setZoom(Math.max(0.4, Math.min(2.5, Number(target.toFixed(2)))));
      return;
    }
    setZoom(containerWidth < 600 ? 0.6 : containerWidth < 900 ? 0.8 : 1.0);
  }, []);

  // ── OSMD initialisation ──
  useEffect(() => {
    if (!containerRef.current || osmdRef.current) return;
    osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: true,
      drawingParameters: 'default',
    });
    return () => { osmdRef.current = null; };
  }, []);

  // ── OSMD render on XML / zoom change ──
  useEffect(() => {
    const render = async () => {
      const osmd = osmdRef.current;
      if (!osmd || !loadedXmlText) return;
      if (!diagnostics?.isValidXml || !diagnostics.isMusicXml) {
        if (containerRef.current) containerRef.current.innerHTML = '';
        xmlLoadedRef.current = '';
        setRenderedPageCount(0);
        return;
      }
      try {
        setRenderError('');
        if (xmlLoadedRef.current !== loadedXmlText) {
          await osmd.load(loadedXmlText);
          xmlLoadedRef.current = loadedXmlText;
        }
        osmd.Zoom = zoom;
        osmd.render();
        // Move rehearsal-mark boxes (section labels) into the vertical gap between
        // the preceding system and the system they head, centred in that whitespace.
        if (containerRef.current) {
          repositionRehearsalMarksBetweenSystems(containerRef.current, osmd, rehearsalTexts);
        }
        setRenderedPageCount(getRenderedSvgs(containerRef.current).length);
        if (!didAutoFitRef.current) {
          didAutoFitRef.current = true;
          requestAnimationFrame(fitWidth);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRenderError(message);
        xmlLoadedRef.current = '';
        setRenderedPageCount(0);
      }
    };
    void render();
  }, [loadedXmlText, zoom, diagnostics, rehearsalTexts, fitWidth]);

  return {
    containerRef,
    osmdRef,
    didAutoFitRef,
    xmlLoadedRef,
    zoom,
    setZoom,
    adjustZoom,
    fitWidth,
    renderError,
    setRenderError,
    renderedPageCount,
    setRenderedPageCount,
  };
}
