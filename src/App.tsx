import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

type Diagnostics = {
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

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function parseDiagnostics(xmlText: string): Diagnostics {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const root = doc.documentElement;

  const queryCount = (selector: string) => doc.querySelectorAll(selector).length;

  return {
    rootName: root?.nodeName ?? 'unknown',
    version: root?.getAttribute('version') ?? 'n/a',
    parts: queryCount('part'),
    measures: queryCount('measure'),
    notes: queryCount('note'),
    harmonies: queryCount('harmony'),
    hasKey: doc.querySelector('attributes > key') !== null,
    hasTime: doc.querySelector('attributes > time') !== null,
    hasDivisions: doc.querySelector('attributes > divisions') !== null,
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
  const [isDragging, setIsDragging] = useState(false);

  const diagnostics = useMemo(() => {
    if (!xmlText) {
      return null;
    }
    return parseDiagnostics(xmlText);
  }, [xmlText]);

  const warnings = useMemo(() => {
    if (!diagnostics) {
      return [] as string[];
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

      try {
        setRenderError('');
        await osmd.load(xmlText);
        osmd.Zoom = zoom;
        osmd.render();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRenderError(message);
      }
    };

    void render();
  }, [xmlText, zoom]);

  const clearAll = useCallback(() => {
    setFilename('');
    setXmlText('');
    setRenderError('');
    setZoom(1);
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
        </aside>
      </main>
    </div>
  );
}
