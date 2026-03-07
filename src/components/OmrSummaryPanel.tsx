import type { OmrSummary } from '../types/omr';

type Props = {
  summary: OmrSummary;
  onCopySummary?: () => void;
};

export default function OmrSummaryPanel({ summary, onCopySummary }: Props) {
  return (
    <div className="omr-status-card">
      <div className="omr-summary-heading">
        <strong>Summary</strong>
        {onCopySummary && <button type="button" onClick={onCopySummary}>Copy JSON</button>}
      </div>
      <ul className="omr-summary-list">
        <li><strong>Title:</strong> {String(summary.title ?? 'n/a')}</li>
        <li><strong>Composer:</strong> {String(summary.composer ?? 'n/a')}</li>
        <li><strong>Pages:</strong> {String(summary.pages ?? 'n/a')}</li>
        <li><strong>Parts:</strong> {String(summary.parts ?? 'n/a')}</li>
        <li><strong>Measures:</strong> {String(summary.measures ?? 'n/a')}</li>
        <li><strong>Harmony tags:</strong> {summary.hasHarmonyTags ? 'Yes' : 'No'}</li>
        <li><strong>Time signature:</strong> {String(summary.timeSignature ?? 'n/a')}</li>
        <li><strong>Key signature:</strong> {String(summary.keySignature ?? 'n/a')}</li>
      </ul>
      <details>
        <summary>Raw summary JSON</summary>
        <pre>{JSON.stringify(summary, null, 2)}</pre>
      </details>
    </div>
  );
}
