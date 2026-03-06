from __future__ import annotations

import json
import re
from pathlib import Path
from threading import Lock
from typing import Iterable

from .models import JobRecord, JobStatus, OMRException, utc_now

SAFE_FILENAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")


class JobStore:
    def __init__(self, data_root: Path):
        self.data_root = data_root
        self._lock = Lock()

    def sanitize_filename(self, filename: str) -> str:
        cleaned = SAFE_FILENAME_RE.sub("_", filename).strip("._")
        return cleaned or "upload"

    def job_dir(self, job_id: str) -> Path:
        return self.data_root / job_id

    def create_job(self, job_id: str, filename_original: str, source_type: str) -> JobRecord:
        job_dir = self.job_dir(job_id)
        for sub in ("input", "output", "logs"):
            (job_dir / sub).mkdir(parents=True, exist_ok=True)

        now = utc_now()
        record = JobRecord(
            jobId=job_id,
            filenameOriginal=filename_original,
            filenameStored="original" + Path(filename_original).suffix.lower(),
            sourceType=source_type,
            status=JobStatus.queued,
            createdAt=now,
            updatedAt=now,
            worker={"engine": "audiveris", "version": "unknown"},
            artifacts={},
            result={},
        )
        self.save(record)
        return record

    def save(self, record: JobRecord) -> None:
        with self._lock:
            record.updatedAt = utc_now()
            path = self.job_dir(record.jobId) / "job.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(record.model_dump_json(indent=2), encoding="utf-8")

    def load(self, job_id: str) -> JobRecord:
        path = self.job_dir(job_id) / "job.json"
        if not path.exists():
            raise OMRException("JOB_NOT_FOUND", f"Job '{job_id}' not found", "lookup", 404)
        return JobRecord.model_validate(json.loads(path.read_text(encoding="utf-8")))

    def write_summary(self, job_id: str, summary: dict) -> str:
        rel = "summary.json"
        path = self.job_dir(job_id) / rel
        path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        return rel

    def resolve_artifact_path(self, job_id: str, artifact_rel_path: str) -> Path:
        path = (self.job_dir(job_id) / artifact_rel_path).resolve()
        job_root = self.job_dir(job_id).resolve()
        if not str(path).startswith(str(job_root)):
            raise OMRException("INTERNAL_SERVER_ERROR", "Artifact path escaped job directory", "artifact", 500)
        return path

    def find_outputs(self, job_id: str) -> dict[str, str]:
        output_dir = self.job_dir(job_id) / "output"
        found: dict[str, str] = {}

        candidates: Iterable[tuple[str, tuple[str, ...]]] = (
            ("musicxml", ("*.musicxml", "*.xml")),
            ("mxl", ("*.mxl",)),
            ("omr", ("*.omr",)),
        )

        for key, patterns in candidates:
            for pattern in patterns:
                match = next(iter(sorted(output_dir.glob(pattern))), None)
                if match:
                    found[key] = str(match.relative_to(self.job_dir(job_id)))
                    break

        logs_dir = self.job_dir(job_id) / "logs"
        for key, rel in {"stdout": "logs/stdout.log", "stderr": "logs/stderr.log"}.items():
            if (logs_dir / Path(rel).name).exists():
                found[key] = rel

        return found
