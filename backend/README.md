# OMR Backend (Audiveris Integration)

FastAPI backend that accepts PDF/image score uploads, runs Audiveris in headless mode, and exposes async job/result endpoints for the frontend.

## Features

- Synchronous endpoint for mobile clients:
  - `POST /process` (multipart upload, inline result JSON)

- Async job lifecycle with statuses:
  - `queued`
  - `preprocessing`
  - `running_audiveris`
  - `parsing_output`
  - `completed`
  - `failed`
- Upload validation:
  - allowed types: `.pdf`, `.png`, `.jpg`, `.jpeg`
  - max size via `MAX_UPLOAD_MB`
  - filename sanitization + per-job storage isolation
- Audiveris CLI contract:
  - `-batch -transcribe -export -output <dir> -- <input>`
- Artifacts persisted per job:
  - input file
  - `.musicxml` / `.xml` and optional `.mxl`
  - optional `.omr`
  - stdout/stderr logs
  - `summary.json`
  - `job.json`
- Structured error codes:
  - `UNSUPPORTED_FILE_TYPE`
  - `UPLOAD_TOO_LARGE`
  - `JOB_NOT_FOUND`
  - `AUDIVERIS_EXECUTABLE_NOT_FOUND`
  - `AUDIVERIS_EXIT_NONZERO`
  - `NO_MUSICXML_OUTPUT`
  - `OUTPUT_PARSE_FAILED`
  - `INTERNAL_SERVER_ERROR`

## Filesystem layout

```text
/work/jobs
  /omr_YYYYMMDD_xxxxxx
    /input/original.<ext>
    /output/*.musicxml|*.xml|*.mxl|*.omr
    /logs/stdout.log
    /logs/stderr.log
    summary.json
    job.json
```

## API endpoints

Base path: `/api/omr`

- `POST /jobs` — create upload job
- `GET /jobs/:jobId` — poll status
- `GET /jobs/:jobId/result` — completed result payload
- `GET /jobs/:jobId/artifacts/:artifactName` — raw artifacts (`musicxml|mxl|omr|log|stderr|summary`)
- `GET /jobs/:jobId/error` — structured failure payload

## Environment variables

- `AUDIVERIS_BIN` (default: `audiveris`)
- `OMR_DATA_ROOT` (default: `/work/jobs`)
- `MAX_UPLOAD_MB` (default: `50`)
- `JOB_RETENTION_HOURS` (reserved for later)
- `API_PORT` (default: `8080`)
- `AUDIVERIS_TIMEOUT_SECONDS` (default: `300`)
- `AUDIVERIS_FORCE_REPROCESS` (default: `false`)

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
OMR_DATA_ROOT=/tmp/omr-jobs AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8080
```

## Docker

```bash
docker compose -f docker-compose.omr.yml build
docker compose -f docker-compose.omr.yml up api
```

Worker image and script are in:
- `backend/Dockerfile.worker`
- `backend/worker/run-audiveris-job`

## Example curl usage

Create job:

```bash
curl -X POST http://localhost:8080/api/omr/jobs \
  -F "file=@/path/to/score.pdf" \
  -F "sourceType=pdf"
```

Poll status:

```bash
curl http://localhost:8080/api/omr/jobs/<jobId>
```

Fetch result:

```bash
curl http://localhost:8080/api/omr/jobs/<jobId>/result
```

Fetch artifacts:

```bash
curl http://localhost:8080/api/omr/jobs/<jobId>/artifacts/musicxml
curl http://localhost:8080/api/omr/jobs/<jobId>/artifacts/log
curl http://localhost:8080/api/omr/jobs/<jobId>/artifacts/summary
```

Fetch error report:

```bash
curl http://localhost:8080/api/omr/jobs/<jobId>/error
```

Synchronous processing:

```bash
curl -X POST http://localhost:8080/process \
  -F "file=@/path/to/score.pdf"
```


Sample payloads are provided in `backend/examples/sample-responses.json`.

## Acceptance test proof artifacts

Automated tests in `backend/tests/test_api.py` cover:

1. single PDF success
2. image success
3. invalid file rejection
4. Audiveris failure handling
5. result retrieval/summary

Run with:

```bash
PYTHONPATH=backend pytest backend/tests -q
```


Detailed server provisioning guide: `docs/audiveris-omr-backend-setup.md`.
