"""oemer_worker.py

Lightweight OMR runner using Oemer (https://github.com/BreezeWhite/oemer).

Oemer is a neural-network-based OMR system installable via ``pip install oemer``.
It runs entirely on CPU (no JVM required) and produces a ``.musicxml`` file from
a single-page image.  For PDF input, the first page is rasterised to PNG via
``pdf2image`` (which wraps the ``poppler`` system library) before being passed
to Oemer.

This module replaces the previous ``worker.py`` / Audiveris subprocess call with
a direct invocation of the ``oemer`` CLI entry-point that is placed on PATH by
``pip install oemer``.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from .models import OMRException


def run_oemer(
    input_path: Path,
    output_dir: Path,
    log_path: Path,
    timeout: int = 120,
) -> None:
    """Run Oemer OMR on *input_path* and write artefacts to *output_dir*.

    If *input_path* is a PDF the first page is converted to a PNG at 300 DPI
    inside *output_dir* before being forwarded to Oemer.  All combined stdout /
    stderr from Oemer is written to *log_path*.

    Raises :class:`~app.models.OMRException` on any failure so that the caller
    can persist a structured error without catching broad exceptions.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    # ── PDF → PNG (first page only) ──────────────────────────────────────────
    img_path = input_path
    if input_path.suffix.lower() == ".pdf":
        img_path = _pdf_first_page_to_png(input_path, output_dir)

    # ── Locate the oemer executable ──────────────────────────────────────────
    # Prefer a system-installed ``oemer`` binary; fall back to running via the
    # current Python interpreter so that venv installations work without
    # modifying PATH.
    oemer_bin = shutil.which("oemer")
    if oemer_bin:
        cmd: list[str] = [oemer_bin, str(img_path), "--output-dir", str(output_dir)]
    else:
        cmd = [sys.executable, "-m", "oemer", str(img_path), "--output-dir", str(output_dir)]

    # ── Run Oemer ─────────────────────────────────────────────────────────────
    try:
        with log_path.open("w", encoding="utf-8") as log_f:
            completed = subprocess.run(
                cmd,
                stdout=log_f,
                stderr=subprocess.STDOUT,   # merge stderr into the single log
                check=False,
                timeout=timeout,
                cwd=output_dir.parent,
            )
    except subprocess.TimeoutExpired as exc:
        raise OMRException(
            "OMR_ENGINE_TIMEOUT",
            f"Oemer did not finish within {timeout} seconds",
            "running_omr",
            500,
        ) from exc
    except FileNotFoundError as exc:
        raise OMRException(
            "OMR_ENGINE_NOT_FOUND",
            "Oemer executable not found. Install with: pip install oemer",
            "running_omr",
            500,
        ) from exc

    if completed.returncode != 0:
        log_snippet = log_path.read_text(encoding="utf-8", errors="ignore")[:4000]
        raise OMRException(
            "OMR_ENGINE_FAILED",
            "Oemer failed while transcribing score",
            "running_omr",
            500,
            extra={"exitCode": completed.returncode, "stderrSnippet": log_snippet},
        )


# ── PDF helper ────────────────────────────────────────────────────────────────


def _pdf_first_page_to_png(pdf_path: Path, work_dir: Path) -> Path:
    """Rasterise the first page of *pdf_path* to a 300-DPI PNG in *work_dir*.

    Requires ``pip install pdf2image`` and the ``poppler`` system library
    (``apt install poppler-utils`` / ``brew install poppler``).
    """
    try:
        from pdf2image import convert_from_path  # type: ignore[import-untyped]
    except ImportError as exc:
        raise OMRException(
            "PDF2IMAGE_NOT_INSTALLED",
            "pdf2image is not installed. Run: pip install pdf2image",
            "preprocessing",
            500,
        ) from exc

    try:
        pages = convert_from_path(str(pdf_path), first_page=1, last_page=1, dpi=300)
    except Exception as exc:  # pragma: no cover
        raise OMRException(
            "PDF_CONVERT_FAILED",
            f"Could not convert PDF to image: {exc}",
            "preprocessing",
            500,
        ) from exc

    if not pages:
        raise OMRException(
            "PDF_CONVERT_FAILED",
            "No pages found in PDF",
            "preprocessing",
            500,
        )

    img_path = work_dir / "page_001.png"
    pages[0].save(str(img_path), "PNG")
    return img_path
