import type { OmrJobStatus } from '../types/omr';

const STAGES: OmrJobStatus[] = ['queued', 'preprocessing', 'running_audiveris', 'parsing_output', 'completed', 'failed'];

type Props = {
  jobId: string;
  status: OmrJobStatus | null;
  progressMessage: string;
};

export default function OmrStatusCard({ jobId, status, progressMessage }: Props) {
  return (
    <div className="omr-status-card">
      <p><strong>Job ID:</strong> {jobId}</p>
      <p><strong>Status:</strong> {status ?? 'n/a'}</p>
      {progressMessage && <p><strong>Progress:</strong> {progressMessage}</p>}
      <ul className="omr-stage-list">
        {STAGES.map((stage) => (
          <li key={stage} className={status === stage ? 'active' : ''}>{stage}</li>
        ))}
      </ul>
    </div>
  );
}
