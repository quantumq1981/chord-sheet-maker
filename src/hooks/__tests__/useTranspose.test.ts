import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTranspose } from '../useTranspose';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <note><pitch><step>C</step><octave>4</octave></pitch></note>
  </measure></part>
</score-partwise>`;

describe('useTranspose', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('defaults to 0 semitones / auto / no warnings', () => {
    const setLoadedXmlText = vi.fn();
    const { result } = renderHook(() => useTranspose({ pristineXmlText: XML, setLoadedXmlText }));
    expect(result.current.transposeSemitones).toBe(0);
    expect(result.current.transposeEnharmonic).toBe('auto');
    expect(result.current.transposeWarnings).toEqual([]);
  });

  it('adjustTranspose clamps to the ±12 range', () => {
    const setLoadedXmlText = vi.fn();
    const { result } = renderHook(() => useTranspose({ pristineXmlText: XML, setLoadedXmlText }));
    act(() => { for (let i = 0; i < 20; i++) result.current.adjustTranspose(1); });
    expect(result.current.transposeSemitones).toBe(12);
    act(() => { for (let i = 0; i < 40; i++) result.current.adjustTranspose(-1); });
    expect(result.current.transposeSemitones).toBe(-12);
  });

  it('debounces, then writes the transposed XML to setLoadedXmlText', () => {
    const setLoadedXmlText = vi.fn();
    const { result } = renderHook(() => useTranspose({ pristineXmlText: XML, setLoadedXmlText }));
    // flush the mount effect (0-shift) timer, then watch only the next change
    act(() => { vi.advanceTimersByTime(100); });
    setLoadedXmlText.mockClear();

    act(() => { result.current.setTransposeSemitones(2); });
    // nothing applied until the debounce window elapses
    expect(setLoadedXmlText).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(100); });
    expect(setLoadedXmlText).toHaveBeenCalledTimes(1);
    expect(setLoadedXmlText.mock.calls[0][0] as string).toContain('<step>D</step>'); // C +2 → D
  });

  it('coalesces rapid changes into a single debounced transpose', () => {
    const setLoadedXmlText = vi.fn();
    const { result } = renderHook(() => useTranspose({ pristineXmlText: XML, setLoadedXmlText }));
    act(() => { vi.advanceTimersByTime(100); });
    setLoadedXmlText.mockClear();

    act(() => {
      result.current.setTransposeSemitones(1);
      result.current.setTransposeSemitones(2);
      result.current.setTransposeSemitones(3);
    });
    act(() => { vi.advanceTimersByTime(100); });

    // Only the settled value is applied — intermediate steps are cancelled.
    expect(setLoadedXmlText).toHaveBeenCalledTimes(1);
  });

  it('does not run the pipeline when there is no pristine source', () => {
    const setLoadedXmlText = vi.fn();
    renderHook(() => useTranspose({ pristineXmlText: '', setLoadedXmlText }));
    act(() => { vi.advanceTimersByTime(200); });
    expect(setLoadedXmlText).not.toHaveBeenCalled();
  });
});
