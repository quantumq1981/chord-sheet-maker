import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

type Diagnostics = {
  isValidXml: boolean;
  isMusicXml: boolean;
  parseError?: string;
  rootName: string;
  version: string;
  parts: number;
  measures: number;
  notes: number;
  harmonies: number;
  hasKey: boolean;
  hasTime: boolean;
  hasDivisions: boolean;
};

const ACCEPTED_EXTENSIONS = ['.xml', '.musicxml', '.mxl'];

type PdfPageSize = 'letter' | 'a4';

type ExportFeedback = {
  type: 'success' | 'error';
  message: string;
};

const IOS_USER_AGENT = /iPad|iPhone|iPod/;

function getBaseFilename(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) {
    return 'score';
  }

  const parts = cleaned.split('.');
  if (parts.length === 1) {
    return cleaned;
  }
  parts.pop();
  return parts.join('.') || 'score';
}

function getRenderedSvgs(container: HTMLDivElement | null): SVGSVGElement[] {
  if (!container) {
    return [];
  }
  return Array.from(container.querySelectorAll('svg'));
}

function isIOSBrowser(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return IOS_USER_AGENT.test(navigator.userAgent);
}

function triggerBlobDownload(blob: Blob, filename: string, iOSFallbackToTab = false): void {
  const url = URL.createObjectURL(blob);
  if (iOSFallbackToTab && isIOSBrowser()) {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      throw new Error('Popup blocked. Please allow popups and try export again.');
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

function serializeSvg(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svg);
}

async function svgToCanvas(svg: SVGSVGElement, scale: number): Promise<HTMLCanvasElement> {
  const serialized = serializeSvg(svg);
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode rendered SVG image.'));
      img.src = svgUrl;
    });

    const svgWidth = svg.viewBox.baseVal?.width || svg.clientWidth || image.naturalWidth;
    const svgHeight = svg.viewBox.baseVal?.height || svg.clientHeight || image.naturalHeight;

    if (svgWidth <= 0 || svgHeight <= 0) {
      throw new Error('Rendered score has invalid dimensions.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(svgWidth * scale));
    canvas.height = Math.max(1, Math.round(svgHeight * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas context is unavailable in this browser.');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error(`Failed to create ${type} blob.`));
        return;
      }
      resolve(blob);
    }, type);
  });
}

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

const EMPTY_DIAGNOSTICS: Diagnostics = {
  isValidXml: false,
  isMusicXml: false,
  parseError: undefined,
  rootName: 'invalid',
  version: 'n/a',
  parts: 0,
  measures: 0,
  notes: 0,
  harmonies: 0,
  hasKey: false,
  hasTime: false,
  hasDivisions: false,
};

function parseXmlWithDiagnostics(xmlText: string): { doc: Document; diagnostics: Diagnostics } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const parserErrorNode =
    doc.querySelector('parsererror') ?? doc.getElementsByTagName('parsererror').item(0);

  if (parserErrorNode) {
    const errorText = parserErrorNode.textContent?.trim();
    const snippet = errorText ? errorText.slice(0, 300) : 'Invalid XML';
    return {
      doc,
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        parseError: snippet,
      },
    };
  }

  const root = doc.documentElement;
  const rootName = root?.nodeName ?? 'unknown';
  const isMusicXml = rootName === 'score-partwise' || rootName === 'score-timewise';

  if (!isMusicXml) {
    return {
      doc,
      diagnostics: {
        isValidXml: true,
        isMusicXml: false,
        rootName,
        version: 'n/a',
        parts: 0,
        measures: 0,
        notes: 0,
        harmonies: 0,
        hasKey: false,
        hasTime: false,
        hasDivisions: false,
      },
    };
  }

  const queryCount = (selector: string) => doc.querySelectorAll(selector).length;

  return {
    doc,
    diagnostics: {
      isValidXml: true,
      isMusicXml: true,
      parseError: undefined,
      rootName,
      version: root?.getAttribute('version') ?? 'n/a',
      parts: queryCount('part'),
      measures: queryCount('measure'),
      notes: queryCount('note'),
      harmonies: queryCount('harmony'),
      hasKey: doc.querySelector('attributes > key') !== null,
      hasTime: doc.querySelector('attributes > time') !== null,
      hasDivisions: doc.querySelector('attributes > divisions') !== null,
    },
  };
}

async function readXmlFromMxl(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(data);
  const candidates = Object.values(zip.files).filter((entry) => {
    const filename = entry.name.toLowerCase();
    return !entry.dir && (filename.endsWith('.xml') || filename.endsWith('.musicxml'));
  });

  if (candidates.length === 0) {
    throw new Error('No embedded MusicXML file found in .mxl archive.');
  }

  let largest = candidates[0];
  let largestSize = 0;

  for (const candidate of candidates) {
    const buffer = await candidate.async('uint8array');
    if (buffer.byteLength > largestSize) {
      largestSize = buffer.byteLength;
      largest = candidate;
    }
  }

  return largest.async('text');
}

async function readInputFile(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.mxl')) {
    return readXmlFromMxl(file);
  }

  return file.text();
}

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [xmlText, setXmlText] = useState<string>('');
  const [zoom, setZoom] = useState<number>(1);
  const [renderError, setRenderError] = useState<string>('');
  const [exportFeedback, setExportFeedback] = useState<ExportFeedback | null>(null);
  const [pdfPageSize, setPdfPageSize] = useState<PdfPageSize>('letter');
  const [isDragging, setIsDragging] = useState(false);
  const [renderedPageCount, setRenderedPageCount] = useState(0);

  const parsedXml = useMemo(() => {
    if (!xmlText) {
      return null;
    }
    return parseXmlWithDiagnostics(xmlText);
  }, [xmlText]);

  const diagnostics = parsedXml?.diagnostics ?? null;

  const warnings = useMemo(() => {
    if (!diagnostics) {
      return [] as string[];
    }
    if (!diagnostics.isValidXml) {
      return ['Invalid MusicXML/XML (parse error).'];
    }
    if (!diagnostics.isMusicXml) {
      return ['XML is valid but not MusicXML.'];
    }

    const list: string[] = [];
    if (diagnostics.harmonies === 0) {
      list.push('No chord symbols (<harmony>) found — showing notation only.');
    }
    if (!diagnostics.hasKey) {
      list.push('No key signature found — key may be inferred.');
    }
    if (!diagnostics.hasTime) {
      list.push('No time signature found — time may be inferred.');
    }
    if (!diagnostics.hasDivisions) {
      list.push('No <divisions> found — rhythmic rendering may be unreliable.');
    }
    return list;
  }, [diagnostics]);

  useEffect(() => {
    if (!containerRef.current || osmdRef.current) {
      return;
    }

    osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: true,
      drawingParameters: 'default',
    });
  }, []);

  useEffect(() => {
    const render = async () => {
      const osmd = osmdRef.current;
      if (!osmd || !xmlText) {
        return;
      }

      if (!diagnostics?.isValidXml || !diagnostics.isMusicXml) {
        const container = containerRef.current;
        if (container) {
          container.innerHTML = '';
        }
        setRenderedPageCount(0);
        return;
      }

      try {
        setRenderError('');
        await osmd.load(xmlText);
        osmd.Zoom = zoom;
        osmd.render();
        setRenderedPageCount(getRenderedSvgs(containerRef.current).length);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRenderError(message);
        setRenderedPageCount(0);
      }
    };

    void render();
  }, [xmlText, zoom, diagnostics]);

  const clearAll = useCallback(() => {
    setFilename('');
    setXmlText('');
    setRenderError('');
    setExportFeedback(null);
    setZoom(1);
    setRenderedPageCount(0);
    const container = containerRef.current;
    if (container) {
      container.innerHTML = '';
    }
  }, []);

  const loadFile = useCallback(async (file: File) => {
    if (!hasAcceptedExtension(file.name)) {
      setRenderError('Unsupported file type. Use .xml, .musicxml, or .mxl');
      return;
    }

    try {
      const text = await readInputFile(file);
      setFilename(file.name);
      setXmlText(text);
      setRenderError('');
      setExportFeedback(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRenderError(`Failed to read file: ${message}`);
    }
  }, []);

  const onFileInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      await loadFile(file);
      event.target.value = '';
    },
    [loadFile],
  );

  const onDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (!file) {
        return;
      }
      await loadFile(file);
    },
    [loadFile],
  );

  const adjustZoom = useCallback((delta: number) => {
    setZoom((prev) => Math.max(0.4, Math.min(2.5, Number((prev + delta).toFixed(2)))));
  }, []);

  const fitWidth = useCallback(() => {
    const container = containerRef.current;
    const osmd = osmdRef.current;
    if (!container || !osmd) {
      return;
    }

    const firstPage = container.querySelector('.osmd-page') as HTMLElement | null;
    const containerWidth = container.clientWidth;

    if (firstPage && firstPage.offsetWidth > 0) {
      const target = (containerWidth / firstPage.offsetWidth) * zoom;
      setZoom(Math.max(0.4, Math.min(2.5, Number(target.toFixed(2)))));
      return;
    }

    const fallback = containerWidth > 1200 ? 1.3 : containerWidth > 900 ? 1.15 : 1;
    setZoom(fallback);
  }, [zoom]);

  const showExportError = useCallback((message: string) => {
    setExportFeedback({ type: 'error', message });
  }, []);

  const showExportSuccess = useCallback((message: string) => {
    setExportFeedback({ type: 'success', message });
  }, []);

  const canExportInputs = Boolean(xmlText);
  const baseName = getBaseFilename(filename);

  const downloadXml = useCallback(() => {
    if (!xmlText) {
      showExportError('Load a file before downloading XML.');
      return;
    }

    try {
      const blob = new Blob([xmlText], { type: 'application/xml;charset=utf-8' });
      triggerBlobDownload(blob, `${baseName}.xml`);
      showExportSuccess('Downloaded XML.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showExportError(`XML download failed: ${message}`);
    }
  }, [baseName, showExportError, showExportSuccess, xmlText]);

  const downloadDiagnostics = useCallback(() => {
    if (!xmlText) {
      showExportError('Load a file before downloading diagnostics.');
      return;
    }

    try {
      const payload = {
        filename: filename || `${baseName}.xml`,
        diagnostics,
        warnings,
        renderError: renderError || null,
        timestamp: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      triggerBlobDownload(blob, `${baseName}.diagnostics.json`);
      showExportSuccess('Downloaded diagnostics JSON.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showExportError(`Diagnostics export failed: ${message}`);
    }
  }, [baseName, diagnostics, filename, renderError, showExportError, showExportSuccess, warnings, xmlText]);

  const exportSvg = useCallback(() => {
    const svg = getRenderedSvgs(containerRef.current)[0];
    if (!svg) {
      showExportError('No rendered score found. Render the file before exporting SVG.');
      return;
    }

    try {
      const blob = new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' });
      triggerBlobDownload(blob, `${baseName}.page1.svg`);
      showExportSuccess('Exported first SVG page.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showExportError(`SVG export failed: ${message}`);
    }
  }, [baseName, showExportError, showExportSuccess]);

  const exportPng = useCallback(async () => {
    const svg = getRenderedSvgs(containerRef.current)[0];
    if (!svg) {
      showExportError('No rendered score found. Render the file before exporting PNG.');
      return;
    }

    try {
      const canvas = await svgToCanvas(svg, 2);
      const blob = await canvasToBlob(canvas, 'image/png');
      triggerBlobDownload(blob, `${baseName}.png`, true);
      showExportSuccess('Exported first page as PNG.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showExportError(`PNG export failed: ${message}`);
    }
  }, [baseName, showExportError, showExportSuccess]);

  const exportPdf = useCallback(async (maxPages?: number) => {
    const svgs = getRenderedSvgs(containerRef.current);
    if (svgs.length === 0) {
      showExportError('No rendered score found. Render the file before exporting PDF.');
      return;
    }

    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) {
      showExportError('Popup blocked. Allow popups and try again.');
      return;
    }
    popup.document.title = 'Generating PDF…';
    popup.document.body.innerHTML =
      '<p style="font-family:sans-serif;padding:16px">Generating PDF…</p>';

    const isLetter = pdfPageSize === 'letter';
    const unit = isLetter ? 'in' : 'mm';
    const format: [number, number] = isLetter ? [8.5, 11] : [210, 297];
    const margin = isLetter ? 0.5 : 12;

    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit, format });
      const pagesToExport = typeof maxPages === 'number' ? svgs.slice(0, maxPages) : svgs;

      for (let index = 0; index < pagesToExport.length; index += 1) {
        const canvas = await svgToCanvas(pagesToExport[index], 1.5);
        const jpegData = canvas.toDataURL('image/jpeg', 0.92);

        if (index > 0) {
          pdf.addPage(format, 'portrait');
        }

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const availableWidth = pageWidth - margin * 2;
        const availableHeight = pageHeight - margin * 2;
        const imgAspect = canvas.width / canvas.height;
        let w = availableWidth;
        let h = w / imgAspect;
        if (h > availableHeight) {
          h = availableHeight;
          w = h * imgAspect;
        }
        const x = (pageWidth - w) / 2;
        const y = (pageHeight - h) / 2;

        pdf.addImage(jpegData, 'JPEG', x, y, w, h, undefined, 'FAST');
      }

      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      popup.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      showExportSuccess(
        `Exported PDF (${pagesToExport.length} page${pagesToExport.length > 1 ? 's' : ''}).`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      popup.document.title = 'PDF export failed';
      popup.document.body.innerHTML = `<p style="font-family:sans-serif;padding:16px;color:#b00020">PDF export failed: ${message}</p>`;
      showExportError(`PDF export failed: ${message}`);
    }
  }, [baseName, pdfPageSize, showExportError, showExportSuccess]);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <label className="upload-btn">
          Upload
          <input type="file" accept=".xml,.musicxml,.mxl" onChange={onFileInput} />
        </label>
        <span className="hint">Drag and drop .xml / .musicxml / .mxl anywhere in the score area</span>
        <button type="button" onClick={() => adjustZoom(-0.1)}>
          Zoom -
        </button>
        <button type="button" onClick={() => adjustZoom(0.1)}>
          Zoom +
        </button>
        <button type="button" onClick={fitWidth}>
          Fit Width
        </button>
        <button type="button" onClick={clearAll}>
          Clear
        </button>
      </header>

      {xmlText && diagnostics && !diagnostics.isValidXml && (
        <div className="error-banner">XML parse error: {diagnostics.parseError ?? 'Invalid XML'}</div>
      )}
      {renderError && <div className="error-banner">Render error: {renderError}</div>}

      <main className="content-grid">
        <section
          className={`score-viewport ${isDragging ? 'dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
        >
          {!xmlText ? <p className="placeholder">Upload a MusicXML or MXL file to render notation.</p> : null}
          <div ref={containerRef} className="score-container" />
        </section>

        <aside className="side-panel">
          <h2>Diagnostics</h2>
          {xmlText && diagnostics ? (
            <ul>
              <li>
                <strong>File:</strong> {filename || 'n/a'}
              </li>
              <li>
                <strong>Root:</strong> {diagnostics.rootName}
              </li>
              <li>
                <strong>Version:</strong> {diagnostics.version}
              </li>
              {!diagnostics.isValidXml && diagnostics.parseError && (
                <li>
                  <strong>Parse error:</strong> {diagnostics.parseError}
                </li>
              )}
              <li>
                <strong>Parts:</strong> {diagnostics.parts}
              </li>
              <li>
                <strong>Measures:</strong> {diagnostics.measures}
              </li>
              <li>
                <strong>Notes:</strong> {diagnostics.notes}
              </li>
              <li>
                <strong>Harmonies:</strong> {diagnostics.harmonies}
              </li>
              <li>
                <strong>Has key:</strong> {diagnostics.hasKey ? 'yes' : 'no'}
              </li>
              <li>
                <strong>Has time:</strong> {diagnostics.hasTime ? 'yes' : 'no'}
              </li>
              <li>
                <strong>Has divisions:</strong> {diagnostics.hasDivisions ? 'yes' : 'no'}
              </li>
            </ul>
          ) : (
            <p>No file loaded.</p>
          )}

          <h2>Warnings</h2>
          {xmlText ? (
            warnings.length > 0 ? (
              <ul>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p>No warnings.</p>
            )
          ) : (
            <p>Load a file to view warnings.</p>
          )}

          <h2>Export</h2>
          <label className="export-label" htmlFor="pdf-page-size">
            PDF Page Size
          </label>
          <select
            id="pdf-page-size"
            value={pdfPageSize}
            onChange={(event) => setPdfPageSize(event.target.value as PdfPageSize)}
            disabled={!canExportInputs}
          >
            <option value="letter">Letter (Portrait)</option>
            <option value="a4">A4 (Portrait)</option>
          </select>

          <div className="export-actions">
            <button type="button" onClick={downloadXml} disabled={!canExportInputs}>
              Download XML
            </button>
            <button type="button" onClick={downloadDiagnostics} disabled={!canExportInputs}>
              Download Diagnostics JSON
            </button>
            <button type="button" onClick={exportSvg} disabled={!canExportInputs}>
              Export SVG (first page)
            </button>
            <button type="button" onClick={() => void exportPng()} disabled={!canExportInputs}>
              Export PNG (first page)
            </button>
            <button type="button" onClick={() => void exportPdf()} disabled={!canExportInputs}>
              Export PDF
            </button>
            {renderedPageCount > 6 && (
              <button type="button" onClick={() => void exportPdf(1)} disabled={!canExportInputs}>
                Export PDF (First Page)
              </button>
            )}
          </div>

          {exportFeedback && (
            <p className={`export-feedback ${exportFeedback.type}`}>{exportFeedback.message}</p>
          )}
        </aside>
      </main>
    </div>
  );
}
