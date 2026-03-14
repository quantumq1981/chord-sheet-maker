from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Settings:
    data_root: Path
    max_upload_mb: int
    oemer_timeout_seconds: int
    cors_origins: list[str]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


def load_settings() -> Settings:
    data_root = Path(os.getenv("OMR_DATA_ROOT", "/work/jobs"))
    data_root.mkdir(parents=True, exist_ok=True)

    # CORS_ORIGINS accepts a comma-separated list of allowed origins.
    # Defaults to "*" for local / personal-use deployments.
    raw_origins = os.getenv("CORS_ORIGINS", "*")
    origins = [o.strip() for o in raw_origins.split(",") if o.strip()]

    return Settings(
        data_root=data_root,
        max_upload_mb=int(os.getenv("MAX_UPLOAD_MB", "50")),
        oemer_timeout_seconds=int(os.getenv("OEMER_TIMEOUT_SECONDS", "120")),
        cors_origins=origins,
    )
