import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as alphaTab from '@coderline/alphatab';
import { isGuitarProFormat, sniffFormatFromBytes } from '../sniffFormat';

const srcDir = resolve(__dirname, '..', '..');
const guitarProFiles = readdirSync(srcDir)
  .filter((name) => /\.gp\d?$|\.gpx$/i.test(name))
  .sort((a, b) => a.localeCompare(b));

describe('checked-in Guitar Pro examples', () => {
  it('keeps every src/*.gp, *.gp3, *.gp4, *.gp5, and *.gpx sample on the Guitar Pro path', () => {
    expect(guitarProFiles.length).toBeGreaterThan(0);
    for (const filename of guitarProFiles) {
      const bytes = new Uint8Array(readFileSync(resolve(srcDir, filename)));
      expect(isGuitarProFormat(sniffFormatFromBytes(bytes, filename)), filename).toBe(true);
    }
  });

  it('parses every checked-in Guitar Pro sample with AlphaTab ScoreLoader', () => {
    const settings = new alphaTab.Settings();
    for (const filename of guitarProFiles) {
      const bytes = new Uint8Array(readFileSync(resolve(srcDir, filename)));
      const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
      expect(score.tracks.length, filename).toBeGreaterThan(0);
    }
  });
});
