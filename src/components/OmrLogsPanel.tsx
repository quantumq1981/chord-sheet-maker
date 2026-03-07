import type { OmrLogs } from '../types/omr';

type Props = {
  logs: OmrLogs;
};

export default function OmrLogsPanel({ logs }: Props) {
  return (
    <div className="omr-status-card">
      <strong>Diagnostics & Logs</strong>
      <details>
        <summary>stdout</summary>
        <pre>{String(logs.stdout ?? 'No stdout logs')}</pre>
      </details>
      <details>
        <summary>stderr</summary>
        <pre>{String(logs.stderr ?? 'No stderr logs')}</pre>
      </details>
      {Array.isArray(logs.warnings) && logs.warnings.length > 0 && (
        <details>
          <summary>warnings</summary>
          <pre>{logs.warnings.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}
