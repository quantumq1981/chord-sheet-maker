/**
 * stageBatch.ts — turn a batch of uploaded files into Stage Mode lyric sheets.
 *
 * Accepts ChordPro/UG/COW text files and selectable-text PDF chord charts,
 * sniffs each one, extracts (and for PDFs, OCR-free text-extracts) the raw
 * source, then strips chords via `extractStageSheet`. Files that can't be
 * recognised as chord charts are reported as failures rather than throwing,
 * so one bad file never aborts a 20-song batch.
 */

import {
  sniffFormatFromBytes,
  isChordChartFormat,
  isPdfFormat,
  asSourceFormat,
} from '../ingest/sniffFormat';
import { extractStageSheet, type StageExtractOptions, type StageZipEntry } from './stageMode';

export interface StageBatchResult {
  entries: StageZipEntry[];
  failures: { filename: string; reason: string }[];
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[\\/]/g, '_').trim() || 'song';
}

/** Read a single File into a Stage entry, or throw with a human-readable reason. */
async function fileToEntry(file: File, opts: StageExtractOptions): Promise<StageZipEntry> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const detected = sniffFormatFromBytes(bytes, file.name);

  let rawText: string;
  let sourceFormat: ReturnType<typeof asSourceFormat>;

  if (isPdfFormat(detected)) {
    const { extractPdfText } = await import('../utils/extractPdfText');
    rawText = (await extractPdfText(buffer)).trim();
    if (rawText.length < 20) {
      throw new Error('No selectable text found (scanned PDF?).');
    }
    // Re-sniff the extracted text to pick the right text dialect.
    const redetected = sniffFormatFromBytes(new TextEncoder().encode(rawText), 'x.txt');
    sourceFormat = asSourceFormat(redetected) ?? 'chordpro';
  } else if (isChordChartFormat(detected)) {
    rawText = new TextDecoder('utf-8').decode(bytes);
    sourceFormat = asSourceFormat(detected) ?? 'chordpro'; // ascii_tab → chordpro
  } else {
    throw new Error(`Unsupported format (${detected.format}).`);
  }

  const sheet = extractStageSheet(rawText, sourceFormat, opts);
  return { name: baseName(file.name), sheet };
}

/** Process many files, collecting successes and per-file failures. */
export async function filesToStageEntries(
  files: File[],
  opts: StageExtractOptions = {},
): Promise<StageBatchResult> {
  const settled = await Promise.all(
    files.map(async (file): Promise<{ ok: true; entry: StageZipEntry } | { ok: false; filename: string; reason: string }> => {
      try {
        return { ok: true, entry: await fileToEntry(file, opts) };
      } catch (err) {
        return { ok: false, filename: file.name, reason: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  const entries: StageZipEntry[] = [];
  const failures: { filename: string; reason: string }[] = [];
  for (const r of settled) {
    if (r.ok) entries.push(r.entry);
    else failures.push({ filename: r.filename, reason: r.reason });
  }
  return { entries, failures };
}
