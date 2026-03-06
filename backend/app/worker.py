from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .config import Settings
from .models import OMRException


def run_audiveris(
    settings: Settings,
    input_path: Path,
    output_dir: Path,
    stdout_path: Path,
    stderr_path: Path,
    force_reprocess: bool = False,
) -> None:
    audiveris_bin = shutil.which(settings.audiveris_bin) if "/" not in settings.audiveris_bin else settings.audiveris_bin
    if not audiveris_bin or not Path(audiveris_bin).exists():
        raise OMRException(
            "AUDIVERIS_EXECUTABLE_NOT_FOUND",
            f"Audiveris executable not found: {settings.audiveris_bin}",
            "running_audiveris",
            500,
        )

    cmd = [
        audiveris_bin,
        "-batch",
        "-transcribe",
        "-export",
        "-output",
        str(output_dir),
    ]
    if force_reprocess or settings.audiveris_force_reprocess:
        cmd.append("-force")

    cmd += ["--", str(input_path)]

    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    with stdout_path.open("w", encoding="utf-8") as out_f, stderr_path.open("w", encoding="utf-8") as err_f:
        completed = subprocess.run(
            cmd,
            stdout=out_f,
            stderr=err_f,
            check=False,
            timeout=settings.audiveris_timeout_seconds,
            cwd=output_dir.parent,
        )

    if completed.returncode != 0:
        stderr_snippet = stderr_path.read_text(encoding="utf-8", errors="ignore")[:4000]
        raise OMRException(
            "AUDIVERIS_EXIT_NONZERO",
            "Audiveris failed while transcribing score",
            "running_audiveris",
            500,
            extra={"exitCode": completed.returncode, "stderrSnippet": stderr_snippet},
        )
