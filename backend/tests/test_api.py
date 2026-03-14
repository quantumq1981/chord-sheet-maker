from __future__ import annotations

import io
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app, settings, store


client = TestClient(app)


def _wait_for_terminal(job_id: str, timeout: float = 5.0) -> dict:
    start = time.time()
    while time.time() - start < timeout:
        resp = client.get(f"/api/omr/jobs/{job_id}")
        status = resp.json()["status"]
        if status in {"completed", "failed"}:
            return resp.json()  # type: ignore[return-value]
        time.sleep(0.05)
    raise AssertionError("job did not complete in time")


def setup_module() -> None:
    test_root = Path("/tmp/omr-test-data")
    if test_root.exists():
        import shutil
        for child in test_root.glob("*"):
            if child.is_dir():
                shutil.rmtree(child)
    test_root.mkdir(parents=True, exist_ok=True)
    settings.data_root = test_root  # type: ignore[misc]
    store.data_root = test_root
    # Point the worker at the fake oemer script so tests run without a real
    # Oemer installation.
    import os
    os.environ["PATH"] = str(Path(__file__).parent) + ":" + os.environ.get("PATH", "")
    # Rename fake_oemer.sh to "oemer" on PATH so shutil.which("oemer") finds it.
    fake_bin = Path(__file__).parent / "oemer"
    real_fake = Path(__file__).parent / "fake_oemer.sh"
    if not fake_bin.exists():
        import shutil
        shutil.copy(real_fake, fake_bin)
        fake_bin.chmod(0o755)


def test_pdf_success_flow() -> None:
    files = {"file": ("chart.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")}
    data = {"sourceType": "pdf", "forceReprocess": "false"}
    create = client.post("/api/omr/jobs", files=files, data=data)
    assert create.status_code == 202
    payload = create.json()
    job_id = payload["jobId"]

    state = _wait_for_terminal(job_id)
    assert state["status"] == "completed"

    result = client.get(f"/api/omr/jobs/{job_id}/result")
    assert result.status_code == 200
    summary = result.json()["result"]["summary"]
    assert summary["hasHarmonyTags"] is True


def test_image_success_flow() -> None:
    files = {"file": ("score.png", io.BytesIO(b"\x89PNG"), "image/png")}
    data = {"sourceType": "image"}
    create = client.post("/api/omr/jobs", files=files, data=data)
    job_id = create.json()["jobId"]
    state = _wait_for_terminal(job_id)
    assert state["status"] == "completed"


def test_invalid_file_type() -> None:
    files = {"file": ("bad.txt", io.BytesIO(b"abc"), "text/plain")}
    data = {"sourceType": "pdf"}
    resp = client.post("/api/omr/jobs", files=files, data=data)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "UNSUPPORTED_FILE_TYPE"


def test_failure_flow(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("FAKE_OEMER_FAIL", "true")
    files = {"file": ("bad.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")}
    data = {"sourceType": "pdf"}
    create = client.post("/api/omr/jobs", files=files, data=data)
    job_id = create.json()["jobId"]
    state = _wait_for_terminal(job_id)
    assert state["status"] == "failed"

    error_resp = client.get(f"/api/omr/jobs/{job_id}/error")
    assert error_resp.status_code == 200
    assert error_resp.json()["error"]["code"] == "OMR_ENGINE_FAILED"


def test_direct_process_endpoint() -> None:
    files = {"file": ("score.png", io.BytesIO(b"\x89PNG"), "image/png")}
    resp = client.post("/process", files=files)
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "completed"
    assert payload["summary"]["hasHarmonyTags"] is True
    assert "<score-partwise" in payload["musicxml"]


def test_job_id_has_full_uuid_entropy() -> None:
    """Job IDs must use a full UUID hex (32 hex chars) for adequate entropy."""
    files = {"file": ("score.png", io.BytesIO(b"\x89PNG"), "image/png")}
    data = {"sourceType": "image"}
    create = client.post("/api/omr/jobs", files=files, data=data)
    job_id = create.json()["jobId"]
    # Format: omr_YYYYMMDD_<32 hex chars>
    parts = job_id.split("_")
    assert len(parts) == 3
    hex_part = parts[2]
    assert len(hex_part) == 32, f"Expected 32-char UUID hex, got {len(hex_part)}: {hex_part}"


def test_running_omr_status_label() -> None:
    """The in-progress status must be 'running_omr', not 'running_audiveris'."""
    # The progress map in main.py should not reference the old Audiveris label.
    from app.models import JobStatus
    assert hasattr(JobStatus, "running_omr")
    assert not hasattr(JobStatus, "running_audiveris")
    assert JobStatus.running_omr.value == "running_omr"
