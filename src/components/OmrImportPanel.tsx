import type { ChangeEvent, DragEvent } from 'react';
import type { OMRProcessingMode, OmrApiError, OmrArtifactLinks, OmrJobStatus, OmrLogs, OmrSummary } from '../types/omr';
import OmrStatusCard from './OmrStatusCard';
import OmrSummaryPanel from './OmrSummaryPanel';
import OmrLogsPanel from './OmrLogsPanel';

type Props = {
  accept: string;
  file: File | null;
  mode: OMRProcessingMode;
  isSubmitting: boolean;
  validationMessage: string;
  uiError: string;
  jobId: string;
  jobStatus: OmrJobStatus | null;
  progressMessage: string;
  summary: OmrSummary | null;
  logs: OmrLogs | null;
  artifacts: OmrArtifactLinks;
  failure: OmrApiError | null;
  onModeChange: (mode: OMRProcessingMode) => void;
  onFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onSubmit: () => void;
  resolveUrl: (pathOrUrl: string) => string;
  onCopySummary: () => void;
  hasInlineMusicXml: boolean;
  onDownloadInlineMusicXml: () => void;
};

export default function OmrImportPanel(props: Props) {
  const {
    accept, file, mode, isSubmitting, validationMessage, uiError, jobId, jobStatus,
    progressMessage, summary, logs, artifacts, failure, onModeChange,
    onFileInput, onDrop, onSubmit, resolveUrl, onCopySummary, hasInlineMusicXml, onDownloadInlineMusicXml,
  } = props;

  return (
    <section className="omr-panel" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <h2>OMR Import</h2>
      <p className="hint-text">Import PDF/image and run Audiveris via quick sync mode or background jobs.</p>

      <div className="omr-mode-toggle" role="radiogroup" aria-label="OMR processing mode">
        <button type="button" className={mode === 'sync' ? 'active' : ''} onClick={() => onModeChange('sync')}>Quick Process</button>
        <button type="button" className={mode === 'async' ? 'active' : ''} onClick={() => onModeChange('async')}>Background Job</button>
      </div>

      <label className="upload-btn omr-upload-btn">
        Select PDF / PNG / JPG
        <input type="file" accept={accept} onChange={onFileInput} />
      </label>
      <button type="button" onClick={onSubmit} disabled={isSubmitting || !file}>
        {isSubmitting ? 'Processing...' : mode === 'sync' ? 'Run Quick Process' : 'Start Background Job'}
      </button>

      <p className="hint-text">Selected: {file ? file.name : 'None'}</p>
      {validationMessage && <p className="error-text">{validationMessage}</p>}
      {uiError && <p className="error-text">{uiError}</p>}

      {jobId && <OmrStatusCard jobId={jobId} status={jobStatus} progressMessage={progressMessage} />}
      {summary && <OmrSummaryPanel summary={summary} onCopySummary={onCopySummary} />}
      {logs && <OmrLogsPanel logs={logs} />}

      {(artifacts.musicxmlUrl || artifacts.mxlUrl || artifacts.logUrl || artifacts.summaryUrl || (mode === 'sync' && hasInlineMusicXml)) && (
        <div className="omr-status-card">
          <strong>Artifacts</strong>
          <ul>
            {artifacts.musicxmlUrl && <li><a href={resolveUrl(artifacts.musicxmlUrl)} target="_blank" rel="noopener noreferrer">Download MusicXML</a></li>}
            {artifacts.mxlUrl && <li><a href={resolveUrl(artifacts.mxlUrl)} target="_blank" rel="noopener noreferrer">Download MXL</a></li>}
            {artifacts.logUrl && <li><a href={resolveUrl(artifacts.logUrl)} target="_blank" rel="noopener noreferrer">View logs</a></li>}
            {artifacts.summaryUrl && <li><a href={resolveUrl(artifacts.summaryUrl)} target="_blank" rel="noopener noreferrer">View summary JSON</a></li>}
          </ul>
          {mode === 'sync' && hasInlineMusicXml && <button type="button" onClick={onDownloadInlineMusicXml}>Download generated MusicXML</button>}
        </div>
      )}

      {failure && (
        <div className="error-banner omr-failure">
          <strong>OMR failed</strong>
          <pre>{JSON.stringify(failure, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}
