// useTranspose.ts
//
// Owns the transpose UI state and the debounced MusicXML transpose pipeline that
// used to live inline in App.tsx:
//   • transposeSemitones / transposeEnharmonic / transposeWarnings state,
//   • the adjustTranspose step control (clamped to ±12 semitones),
//   • a debounced effect that recomputes the transposed MusicXML from the
//     pristine source and writes it back via setLoadedXmlText.
//
// Behaviour is identical to the previous inline implementation. State and the
// setters are returned under the same names App.tsx already used so the many
// consumers (exports, key-display, ChordChart, load/reset sites, JSX controls)
// keep working unchanged via destructuring.

import { useCallback, useEffect, useState } from 'react';
import { transposeMusicXMLCached } from '../converters/transposeMusicXML';
import type { EnharmonicPreference } from '../renderers/ChordChart';

export interface UseTransposeArgs {
  /** Unmodified MusicXML source; transposition is always derived from this. */
  pristineXmlText: string;
  /** Sink for the transposed MusicXML fed to OSMD / exports. */
  setLoadedXmlText: (xml: string) => void;
}

export function useTranspose({ pristineXmlText, setLoadedXmlText }: UseTransposeArgs) {
  const [transposeSemitones, setTransposeSemitones] = useState(0);
  const [transposeEnharmonic, setTransposeEnharmonic] = useState<EnharmonicPreference>('auto');
  const [transposeWarnings, setTransposeWarnings] = useState<string[]>([]);

  const adjustTranspose = useCallback((delta: number) => {
    setTransposeSemitones((prev) => Math.max(-12, Math.min(12, prev + delta)));
  }, []);

  useEffect(() => {
    if (!pristineXmlText) return;
    // Debounce so holding +/- (or a fast slider sweep) coalesces into a single
    // transpose + relayout instead of one full Θ(N) parse/render per intermediate
    // step. transposeMusicXMLCached additionally makes re-visiting any previously
    // computed transposition O(1).
    const timer = window.setTimeout(() => {
      const { xml, warnings } = transposeMusicXMLCached(pristineXmlText, transposeSemitones, transposeEnharmonic);
      setLoadedXmlText(xml);
      setTransposeWarnings(warnings);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [pristineXmlText, transposeSemitones, transposeEnharmonic, setLoadedXmlText]);

  return {
    transposeSemitones,
    setTransposeSemitones,
    transposeEnharmonic,
    setTransposeEnharmonic,
    transposeWarnings,
    setTransposeWarnings,
    adjustTranspose,
  };
}
