import { describe, expect, it } from 'vitest';
import { fitContain } from '../exportService';

describe('fitContain', () => {
  it('scales to fill the available width when the result fits the height', () => {
    // 2:1 landscape source into a 10×10 box → width-bound: 10 wide, 5 tall.
    expect(fitContain(200, 100, 10, 10)).toEqual({ w: 10, h: 5 });
  });

  it('clamps to the available height when width-fitting would overflow', () => {
    // 1:2 portrait source into a 10×10 box → height-bound: 5 wide, 10 tall.
    expect(fitContain(100, 200, 10, 10)).toEqual({ w: 5, h: 10 });
  });

  it('returns the box for a matching aspect ratio', () => {
    expect(fitContain(50, 50, 8, 8)).toEqual({ w: 8, h: 8 });
  });

  it('never exceeds either available dimension', () => {
    const { w, h } = fitContain(1234, 77, 8.5 - 1, 11 - 1);
    expect(w).toBeLessThanOrEqual(8.5 - 1 + 1e-9);
    expect(h).toBeLessThanOrEqual(11 - 1 + 1e-9);
  });

  it('preserves the source aspect ratio', () => {
    const srcW = 640;
    const srcH = 360;
    const { w, h } = fitContain(srcW, srcH, 7.5, 10);
    expect(w / h).toBeCloseTo(srcW / srcH, 10);
  });
});
