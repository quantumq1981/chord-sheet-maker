import type {
  OMRJobCreateResponse,
  OMRJobErrorResponse,
  OMRJobResultResponse,
  OMRJobStatusResponse,
  OmrApiError,
  SyncProcessResponse,
} from '../types/omr';

const OMR_API_BASE = (import.meta.env.VITE_OMR_API_BASE as string | undefined)?.trim() || '';
const OMR_SYNC_ENDPOINT = (import.meta.env.VITE_OMR_SYNC_ENDPOINT as string | undefined)?.trim() || '/process';
const OMR_ASYNC_BASE = (import.meta.env.VITE_OMR_ASYNC_BASE as string | undefined)?.trim() || '/api/omr';

export function resolveOmrUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (!OMR_API_BASE) return pathOrUrl;
  return `${OMR_API_BASE.replace(/\/$/, '')}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

export async function parseOmrError(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`;
  try {
    const data = (await response.json()) as { error?: OmrApiError; detail?: { error?: OmrApiError } };
    const err = data?.error ?? data?.detail?.error;
    if (!err) return fallback;
    const parts = [err.code, err.message, err.stage].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : fallback;
  } catch {
    return fallback;
  }
}

export async function postSyncProcess(file: File): Promise<SyncProcessResponse> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(resolveOmrUrl(OMR_SYNC_ENDPOINT), { method: 'POST', body });
  if (!response.ok) {
    throw new Error(`OMR sync request failed: ${await parseOmrError(response)}`);
  }
  return (await response.json()) as SyncProcessResponse;
}

export async function createOmrJob(file: File, sourceType: 'pdf' | 'image'): Promise<OMRJobCreateResponse> {
  const body = new FormData();
  body.append('file', file);
  body.append('sourceType', sourceType);
  const response = await fetch(resolveOmrUrl(`${OMR_ASYNC_BASE}/jobs`), { method: 'POST', body });
  if (!response.ok) {
    throw new Error(`OMR job creation failed: ${await parseOmrError(response)}`);
  }
  return (await response.json()) as OMRJobCreateResponse;
}

export async function getOmrJobStatus(jobId: string): Promise<OMRJobStatusResponse> {
  const response = await fetch(resolveOmrUrl(`${OMR_ASYNC_BASE}/jobs/${jobId}`));
  if (!response.ok) {
    throw new Error(`OMR status request failed: ${await parseOmrError(response)}`);
  }
  return (await response.json()) as OMRJobStatusResponse;
}

export async function getOmrJobResult(jobId: string): Promise<OMRJobResultResponse> {
  const response = await fetch(resolveOmrUrl(`${OMR_ASYNC_BASE}/jobs/${jobId}/result`));
  if (!response.ok) {
    throw new Error(`OMR result request failed: ${await parseOmrError(response)}`);
  }
  return (await response.json()) as OMRJobResultResponse;
}

export async function getOmrJobError(jobId: string): Promise<OMRJobErrorResponse | null> {
  const response = await fetch(resolveOmrUrl(`${OMR_ASYNC_BASE}/jobs/${jobId}/error`));
  if (!response.ok) return null;
  return (await response.json()) as OMRJobErrorResponse;
}

export function getOmrArtifactPath(jobId: string, artifactName: string): string {
  return `${OMR_ASYNC_BASE}/jobs/${jobId}/artifacts/${artifactName}`;
}
