export type OMRProcessingMode = 'sync' | 'async';

export type OmrJobStatus =
  | 'queued'
  | 'preprocessing'
  | 'running_audiveris'
  | 'parsing_output'
  | 'completed'
  | 'failed';

export type OmrSummary = {
  title?: string;
  composer?: string;
  pages?: number;
  parts?: number;
  measures?: number;
  hasHarmonyTags?: boolean;
  timeSignature?: string;
  keySignature?: string;
  warnings?: string[];
  [key: string]: unknown;
};

export type OmrLogs = {
  stdout?: string;
  stderr?: string;
  warnings?: string[];
  [key: string]: unknown;
};

export type OmrApiError = {
  code?: string;
  message?: string;
  stage?: string;
  exitCode?: number;
  stderrSnippet?: string;
  logUrl?: string;
  [key: string]: unknown;
};

export type SyncProcessResponse = {
  status: 'completed' | 'failed' | string;
  musicxml?: string;
  summary?: OmrSummary;
  logs?: OmrLogs;
  error?: OmrApiError;
};

export type OMRJobCreateResponse = {
  jobId: string;
  status: OmrJobStatus;
};

export type OMRJobStatusResponse = {
  jobId: string;
  status: OmrJobStatus;
  progress?: {
    stage: OmrJobStatus;
    message: string;
    percent: number;
  };
};

export type OMRJobResultResponse = {
  jobId: string;
  status: OmrJobStatus;
  result?: {
    musicxmlUrl?: string | null;
    mxlUrl?: string | null;
    summary?: OmrSummary;
    logs?: OmrLogs;
    artifacts?: Record<string, string>;
  };
};

export type OMRJobErrorResponse = {
  jobId: string;
  status: OmrJobStatus;
  error?: OmrApiError;
};

export type OmrArtifactLinks = {
  musicxmlUrl?: string;
  mxlUrl?: string;
  logUrl?: string;
  summaryUrl?: string;
};
