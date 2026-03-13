from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Settings:
    data_root: Path
    max_upload_mb: int
    audiveris_bin: str
    audiveris_timeout_seconds: int
    audiveris_force_reprocess: bool
    cors_allow_origins: tuple[str, ...]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def load_settings() -> Settings:
    data_root = Path(os.getenv("OMR_DATA_ROOT", "/work/jobs"))
    data_root.mkdir(parents=True, exist_ok=True)
    return Settings(
        data_root=data_root,
        max_upload_mb=int(os.getenv("MAX_UPLOAD_MB", "50")),
        audiveris_bin=os.getenv("AUDIVERIS_BIN", "audiveris"),
        audiveris_timeout_seconds=int(os.getenv("AUDIVERIS_TIMEOUT_SECONDS", "300")),
        audiveris_force_reprocess=_env_bool("AUDIVERIS_FORCE_REPROCESS", False),
        cors_allow_origins=tuple(
            origin.strip()
            for origin in os.getenv("CORS_ALLOW_ORIGINS", "https://yourusername.github.io").split(",")
            if origin.strip()
        ),
    )
