from __future__ import annotations

import io
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app, settings, store


client = TestClient(app)


def _wait_for_terminal(job_id: str, timeout: float = 5.0):
    start = time.time()
    while time.time() - start < timeout:
        resp = client.get(f"/api/omr/jobs/{job_id}")
        status = resp.json()["status"]
        if status in {"completed", "failed"}:
            return resp.json()
        time.sleep(0.05)
    raise AssertionError("job did not complete in time")


def setup_module():
    test_root = Path("/tmp/omr-test-data")
    if test_root.exists():
        for child in test_root.glob("*"):
            if child.is_dir():
                import shutil

                shutil.rmtree(child)
    test_root.mkdir(parents=True, exist_ok=True)
    settings.data_root = test_root  # type: ignore[misc]
    store.data_root = test_root
    settings.audiveris_bin = str((Path(__file__).parent / "fake_audiveris.sh").resolve())  # type: ignore[misc]


def test_pdf_success_flow():
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


def test_image_success_flow():
    files = {"file": ("score.png", io.BytesIO(b"\x89PNG"), "image/png")}
    data = {"sourceType": "image"}
    create = client.post("/api/omr/jobs", files=files, data=data)
    job_id = create.json()["jobId"]
    state = _wait_for_terminal(job_id)
    assert state["status"] == "completed"


def test_invalid_file_type():
    files = {"file": ("bad.txt", io.BytesIO(b"abc"), "text/plain")}
    data = {"sourceType": "pdf"}
    resp = client.post("/api/omr/jobs", files=files, data=data)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "UNSUPPORTED_FILE_TYPE"


def test_failure_flow(monkeypatch):
    monkeypatch.setenv("FAKE_AUDIVERIS_FAIL", "true")
    files = {"file": ("bad.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")}
    data = {"sourceType": "pdf"}
    create = client.post("/api/omr/jobs", files=files, data=data)
    job_id = create.json()["jobId"]
    state = _wait_for_terminal(job_id)
    assert state["status"] == "failed"

    error_resp = client.get(f"/api/omr/jobs/{job_id}/error")
    assert error_resp.status_code == 200
    assert error_resp.json()["error"]["code"] == "AUDIVERIS_EXIT_NONZERO"
