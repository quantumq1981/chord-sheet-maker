# Audiveris OMR Backend Setup (REST Service)

This guide provisions Audiveris as a backend service that accepts image/PDF uploads and returns MusicXML-oriented JSON for iOS clients.

## 1) Repository acquisition (Audiveris development branch)

```bash
mkdir -p /opt/omr && cd /opt/omr
git clone --branch development --single-branch https://github.com/Audiveris/audiveris.git
cd audiveris
git rev-parse --abbrev-ref HEAD
```

## 2) Java environment (determine and verify required JDK)

Detect from the cloned Audiveris build configuration:

```bash
cd /opt/omr/audiveris
rg "languageVersion|sourceCompatibility|targetCompatibility|toolchain" app/build.gradle* build.gradle* gradle.properties
```

For current `development`, Audiveris uses Java 17 toolchains in typical deployments. Install and verify:

```bash
sudo apt-get update
sudo apt-get install -y openjdk-17-jdk
java -version
javac -version
```

If Audiveris build files indicate another version, install that exact JDK and set:

```bash
export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
export PATH="$JAVA_HOME/bin:$PATH"
```

## 3) Build Audiveris with Gradle

```bash
cd /opt/omr/audiveris
./gradlew --version
./gradlew clean build -x test
```

Useful dependency warm-up:

```bash
./gradlew dependencies >/tmp/audiveris-deps.txt
```

Common build issues:

- **Gradle wrapper blocked**: run `chmod +x ./gradlew`.
- **Wrong JDK selected**: re-check `java -version` and `JAVA_HOME`.
- **Missing native libs**: install common runtime libs:

```bash
sudo apt-get install -y libxrender1 libxtst6 libxi6 libfreetype6 libfontconfig1
```

## 4) Tesseract OCR + Tesseract 3.04 data

Install binaries:

```bash
sudo apt-get install -y tesseract-ocr
```

Install legacy tessdata (3.04 lineage) used by Audiveris pipelines:

```bash
sudo mkdir -p /opt/tessdata-3.04
cd /opt/tessdata-3.04
sudo wget -O eng.traineddata https://github.com/tesseract-ocr/tessdata/raw/3.04.00/eng.traineddata
sudo wget -O osd.traineddata https://github.com/tesseract-ocr/tessdata/raw/3.04.00/osd.traineddata
```

Required baseline files:
- `eng.traineddata`
- `osd.traineddata`

Export for Audiveris runtime:

```bash
export TESSDATA_PREFIX=/opt/tessdata-3.04
```

## 5) Ghostscript

```bash
sudo apt-get install -y ghostscript
which gs
gs --version
```

## 6) REST API wrapper in this repository

This repository ships a FastAPI OMR service with:
- async jobs under `/api/omr/jobs`
- direct synchronous endpoint under `/process` (multipart upload)

Install backend dependencies:

```bash
cd /workspace/chord-sheet-maker
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

Run API locally:

```bash
AUDIVERIS_BIN=/opt/omr/audiveris/app/build/scripts/Audiveris \
TESSDATA_PREFIX=/opt/tessdata-3.04 \
OMR_DATA_ROOT=/var/lib/omr/jobs \
MAX_UPLOAD_MB=50 \
AUDIVERIS_TIMEOUT_SECONDS=300 \
API_PORT=8080 \
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8080
```

### iOS request format

`POST /process` with `multipart/form-data`:
- field: `file`
- value: image (`png/jpg/jpeg`) or `pdf`

Response contains:
- `status`
- `musicxml` (inline string when generated)
- `mxlGenerated`
- `summary`
- `logs`

## 7) Persistent server configuration

Use bundled scripts:

- startup script: `backend/scripts/start-omr-api.sh`
- unit file: `backend/systemd/omr-api.service`

Install systemd unit:

```bash
sudo cp backend/systemd/omr-api.service /etc/systemd/system/omr-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now omr-api.service
sudo systemctl status omr-api.service
```

Default API port is `8080`.

## 8) Verification with curl

Synchronous endpoint:

```bash
curl -sS -X POST http://127.0.0.1:8080/process \
  -F "file=@/path/to/score.png" | jq .
```

Async job endpoint:

```bash
curl -sS -X POST http://127.0.0.1:8080/api/omr/jobs \
  -F "file=@/path/to/score.png" \
  -F "sourceType=image"
```
