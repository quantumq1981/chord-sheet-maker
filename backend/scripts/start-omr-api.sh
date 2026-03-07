#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"

if [[ ! -d "$VENV_DIR" ]]; then
  python3 -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1090
source "$VENV_DIR/bin/activate"
pip install --quiet -r "$ROOT_DIR/backend/requirements.txt"

export AUDIVERIS_BIN="${AUDIVERIS_BIN:-/opt/omr/audiveris/app/build/scripts/Audiveris}"
export TESSDATA_PREFIX="${TESSDATA_PREFIX:-/opt/tessdata-3.04}"
export OMR_DATA_ROOT="${OMR_DATA_ROOT:-/var/lib/omr/jobs}"
export MAX_UPLOAD_MB="${MAX_UPLOAD_MB:-50}"
export AUDIVERIS_TIMEOUT_SECONDS="${AUDIVERIS_TIMEOUT_SECONDS:-300}"
export AUDIVERIS_FORCE_REPROCESS="${AUDIVERIS_FORCE_REPROCESS:-false}"
export API_PORT="${API_PORT:-8080}"

mkdir -p "$OMR_DATA_ROOT"

exec uvicorn app.main:app --app-dir "$ROOT_DIR/backend" --host 0.0.0.0 --port "$API_PORT"
