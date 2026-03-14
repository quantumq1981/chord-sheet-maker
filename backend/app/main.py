from __future__ import annotations

import uuid
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .config import Settings, load_settings
from .job_store import JobStore
from .models import (
    ArtifactFlags,
    CreateJobResponse,
    ErrorPayload,
    JobErrorResponse,
    JobRecord,
    JobResultResponse,
    JobStatus,
    JobStatusResponse,
    OMRException,
    Progress,
    utc_now,
)
from .oemer_worker import run_oemer
from .xml_summary import parse_musicxml_summary

ALLOWED_EXTENSIONS = {".pdf": "pdf", ".png": "image", ".jpg": "image", ".jpeg": "image"}
ARTIFACT_NAME_MAP = {
    "musicxml": "musicxml",
    "mxl": "mxl",
    "omr": "omr",
    "log": "stdout",
    "stderr": "stderr",
    "summary": "summary",
}

app = FastAPI(title="CSMPN OMR Backend", version="2.0.0")
settings: Settings = load_settings()
store = JobStore(settings.data_root)

# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(OMRException)
async def omr_exception_handler(_: Request, exc: OMRException) -> JSONResponse:
    payload = {"error": {"code": exc.code, "message": exc.message, "stage": exc.stage, **exc.extra}}
    return JSONResponse(status_code=exc.status_code, content=payload)


def _make_job_id() -> str:
    # Use the full UUID hex (32 chars) for sufficient entropy.
    return f"omr_{utc_now().strftime('%Y%m%d')}_{uuid.uuid4().hex}"


async def _read_upload_with_limit(file: UploadFile, max_upload_bytes: int, request: Request | None = None) -> bytes:
    # Fast-path: reject immediately if Content-Length header already exceeds limit.
    if request:
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit() and int(content_length) > max_upload_bytes:
            raise OMRException("UPLOAD_TOO_LARGE", "Upload exceeds size limit", "preprocessing", 413)

    data = await file.read(max_upload_bytes + 1)
    if len(data) > max_upload_bytes:
        raise OMRException("UPLOAD_TOO_LARGE", "Upload exceeds size limit", "preprocessing", 413)
    return data


def _progress_for(status: JobStatus) -> Progress:
    messages = {
        JobStatus.queued:         ("Queued for processing", 5),
        JobStatus.preprocessing:  ("Validating and storing upload", 20),
        JobStatus.running_omr:    ("Oemer is transcribing score", 65),
        JobStatus.parsing_output: ("Parsing exported artefacts", 85),
        JobStatus.completed:      ("Completed", 100),
        JobStatus.failed:         ("Failed", 100),
    }
    message, percent = messages[status]
    return Progress(stage=status, message=message, percent=percent)


def _artifact_flags(record: JobRecord) -> ArtifactFlags:
    return ArtifactFlags(
        inputStored=bool(record.artifacts.get("input")),
        musicxmlReady=bool(record.artifacts.get("musicxml") or record.artifacts.get("mxl")),
        logReady=bool(record.artifacts.get("stdout") or record.artifacts.get("stderr")),
    )


def _process_job(job_id: str, force_reprocess: bool) -> None:  # noqa: ARG001
    record = store.load(job_id)
    try:
        record.status = JobStatus.running_omr
        store.save(record)

        job_dir = store.job_dir(job_id)
        input_path = job_dir / record.artifacts["input"]
        output_dir = job_dir / "output"
        log_path = job_dir / "logs" / "oemer.log"

        run_oemer(input_path, output_dir, log_path, timeout=settings.oemer_timeout_seconds)

        record.status = JobStatus.parsing_output
        store.save(record)

        detected = store.find_outputs(job_id)
        if "musicxml" not in detected and "mxl" not in detected:
            raise OMRException(
                "NO_MUSICXML_OUTPUT",
                "Oemer completed but no MusicXML artefact was found",
                "parsing_output",
                500,
            )

        summary: dict = {}
        if "musicxml" in detected:
            summary = parse_musicxml_summary(store.resolve_artifact_path(job_id, detected["musicxml"]))

        summary_rel = store.write_summary(job_id, summary)
        detected["summary"] = summary_rel

        record.artifacts.update(detected)
        record.result = summary
        record.status = JobStatus.completed
        store.save(record)
    except OMRException as exc:
        record.status = JobStatus.failed
        record.error = ErrorPayload(
            code=exc.code,
            message=exc.message,
            stage=exc.stage,
            exitCode=exc.extra.get("exitCode"),
            stderrSnippet=exc.extra.get("stderrSnippet"),
            logUrl=f"/api/omr/jobs/{job_id}/artifacts/log",
        )
        record.artifacts.update(store.find_outputs(job_id))
        store.save(record)
    except Exception as exc:  # pragma: no cover
        record.status = JobStatus.failed
        record.error = ErrorPayload(code="INTERNAL_SERVER_ERROR", message=str(exc), stage="internal")
        store.save(record)


@app.post("/api/omr/jobs", response_model=CreateJobResponse, status_code=202)
async def create_job(
    request: Request,
    file: UploadFile = File(...),
    sourceType: str = Form(...),
    forceReprocess: bool = Form(False),
    notes: str | None = Form(None),
) -> CreateJobResponse:
    del notes

    ext = Path(file.filename or "").suffix.lower()
    inferred = ALLOWED_EXTENSIONS.get(ext)
    if not inferred:
        raise OMRException("UNSUPPORTED_FILE_TYPE", "Unsupported file type", "preprocessing", 400)
    if sourceType not in {"pdf", "image"}:
        raise OMRException("UNSUPPORTED_FILE_TYPE", "sourceType must be pdf or image", "preprocessing", 400)
    if inferred != sourceType:
        raise OMRException("UNSUPPORTED_FILE_TYPE", "sourceType does not match uploaded file", "preprocessing", 400)

    data = await _read_upload_with_limit(file, settings.max_upload_bytes, request)

    job_id = _make_job_id()
    safe_name = store.sanitize_filename(file.filename or "upload")
    record = store.create_job(job_id, safe_name, sourceType)
    record.status = JobStatus.preprocessing

    input_rel = f"input/{record.filenameStored}"
    input_path = store.resolve_artifact_path(job_id, input_rel)
    input_path.write_bytes(data)

    record.artifacts["input"] = input_rel
    store.save(record)

    thread = Thread(target=_process_job, args=(job_id, forceReprocess), daemon=True)
    thread.start()

    return CreateJobResponse(
        jobId=job_id,
        status=JobStatus.queued,
        createdAt=record.createdAt,
        filename=safe_name,
        sourceType=sourceType,
    )


@app.post("/process")
async def process_upload(request: Request, file: UploadFile = File(...)) -> dict:
    ext = Path(file.filename or "").suffix.lower()
    inferred = ALLOWED_EXTENSIONS.get(ext)
    if not inferred:
        raise OMRException("UNSUPPORTED_FILE_TYPE", "Unsupported file type", "preprocessing", 400)

    data = await _read_upload_with_limit(file, settings.max_upload_bytes, request)

    with TemporaryDirectory(prefix="oemer_process_") as tmp_dir:
        tmp_root = Path(tmp_dir)
        input_path = tmp_root / f"upload{ext}"
        output_dir = tmp_root / "output"
        log_path = tmp_root / "oemer.log"
        input_path.write_bytes(data)

        run_oemer(input_path, output_dir, log_path, timeout=settings.oemer_timeout_seconds)

        musicxml_path = next(output_dir.glob("*.musicxml"), None) or next(output_dir.glob("*.xml"), None)
        mxl_path = next(output_dir.glob("*.mxl"), None)
        if musicxml_path is None and mxl_path is None:
            raise OMRException(
                "NO_MUSICXML_OUTPUT",
                "Oemer completed but no MusicXML artefact was found",
                "parsing_output",
                500,
            )

        summary = parse_musicxml_summary(musicxml_path) if musicxml_path else {}
        return {
            "status": "completed",
            "filename": file.filename,
            "sourceType": inferred,
            "musicxml": musicxml_path.read_text(encoding="utf-8") if musicxml_path else None,
            "mxlGenerated": mxl_path is not None,
            "summary": summary,
            "logs": {
                "stdout": log_path.read_text(encoding="utf-8", errors="ignore"),
            },
        }


@app.get("/api/omr/jobs/{job_id}", response_model=JobStatusResponse)
def get_job_status(job_id: str) -> JobStatusResponse:
    record = store.load(job_id)
    return JobStatusResponse(
        jobId=record.jobId,
        status=record.status,
        createdAt=record.createdAt,
        updatedAt=record.updatedAt,
        progress=_progress_for(record.status),
        artifacts=_artifact_flags(record),
    )


@app.get("/api/omr/jobs/{job_id}/result", response_model=JobResultResponse)
def get_job_result(job_id: str) -> JobResultResponse:
    record = store.load(job_id)
    if record.status != JobStatus.completed:
        raise HTTPException(status_code=409, detail={"status": record.status})

    result = {
        "musicxmlUrl": f"/api/omr/jobs/{job_id}/artifacts/musicxml" if record.artifacts.get("musicxml") else None,
        "mxlUrl": f"/api/omr/jobs/{job_id}/artifacts/mxl" if record.artifacts.get("mxl") else None,
        "summary": record.result,
    }
    return JobResultResponse(jobId=job_id, status=record.status, result=result)


@app.get("/api/omr/jobs/{job_id}/artifacts/{artifact_name}")
def get_job_artifact(job_id: str, artifact_name: str) -> FileResponse:
    record = store.load(job_id)
    key = ARTIFACT_NAME_MAP.get(artifact_name)
    if not key:
        raise OMRException("INTERNAL_SERVER_ERROR", f"Unknown artifact name: {artifact_name}", "artifact", 404)
    rel_path = record.artifacts.get(key)
    if not rel_path:
        raise OMRException("JOB_NOT_FOUND", f"Artifact not found: {artifact_name}", "artifact", 404)

    path = store.resolve_artifact_path(job_id, rel_path)
    if not path.exists():
        raise OMRException("JOB_NOT_FOUND", f"Artifact not found: {artifact_name}", "artifact", 404)
    return FileResponse(path)


@app.get("/api/omr/jobs/{job_id}/error", response_model=JobErrorResponse)
def get_job_error(job_id: str) -> JobErrorResponse:
    record = store.load(job_id)
    if record.status != JobStatus.failed or not record.error:
        raise HTTPException(status_code=409, detail={"status": record.status})
    return JobErrorResponse(jobId=job_id, status=record.status, error=record.error)
