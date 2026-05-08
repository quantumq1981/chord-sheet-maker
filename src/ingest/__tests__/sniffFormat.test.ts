import { describe, expect, it } from 'vitest';
import { sniffFormatFromBytes } from '../sniffFormat';

describe('sniffFormatFromBytes', () => {
  it('treats GPX/modern Guitar Pro zip containers as Guitar Pro before MXL', () => {
    const zipLikeGpx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(sniffFormatFromBytes(zipLikeGpx, 'band-the_weight.gpx')).toEqual({
      format: 'guitarpro',
      version: 'gpx',
    });
  });

  it('still detects non-Guitar-Pro zip uploads as MXL', () => {
    const zipLikeMxl = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(sniffFormatFromBytes(zipLikeMxl, 'score.mxl')).toEqual({ format: 'mxl' });
  });
});
