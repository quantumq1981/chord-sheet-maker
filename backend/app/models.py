from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    queued = "queued"
    preprocessing = "preprocessing"
    running_audiveris = "running_audiveris"
    parsing_output = "parsing_output"
    completed = "completed"
    failed = "failed"


class OMRException(Exception):
    def __init__(self, code: str, message: str, stage: str, status_code: int = 400, extra: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.stage = stage
        self.status_code = status_code
        self.extra = extra or {}


class ErrorPayload(BaseModel):
    code: str
    message: str
    stage: str
    exitCode: int | None = None
    stderrSnippet: str | None = None
    logUrl: str | None = None


class Progress(BaseModel):
    stage: JobStatus
    message: str
    percent: int = Field(ge=0, le=100)


class ArtifactFlags(BaseModel):
    inputStored: bool
    musicxmlReady: bool
    logReady: bool


class JobRecord(BaseModel):
    jobId: str
    filenameOriginal: str
    filenameStored: str
    sourceType: str
    status: JobStatus
    createdAt: datetime
    updatedAt: datetime
    worker: dict[str, Any]
    artifacts: dict[str, str]
    result: dict[str, Any] = Field(default_factory=dict)
    error: ErrorPayload | None = None


class CreateJobResponse(BaseModel):
    jobId: str
    status: JobStatus
    createdAt: datetime
    filename: str
    sourceType: str


class JobStatusResponse(BaseModel):
    jobId: str
    status: JobStatus
    createdAt: datetime
    updatedAt: datetime
    progress: Progress
    artifacts: ArtifactFlags


class JobResultResponse(BaseModel):
    jobId: str
    status: JobStatus
    result: dict[str, Any]


class JobErrorResponse(BaseModel):
    jobId: str
    status: JobStatus
    error: ErrorPayload


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
