#!/usr/bin/env bash
# Fake oemer CLI used by the test suite.
# Mirrors the real oemer command signature:
#   oemer <img_path> [--output-dir <dir>] [--use-tf] [--to-midi] [-o <dir>]
set -euo pipefail

OUTPUT_DIR=""
INPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir|-o) OUTPUT_DIR="$2"; shift 2 ;;
    --use-tf|--to-midi|--save-cache) shift ;;   # recognised flags, ignored
    -*) shift ;;                                 # any other flag
    *) INPUT="$1"; shift ;;                      # positional = input image
  esac
done

mkdir -p "$OUTPUT_DIR"

if [[ "${FAKE_OEMER_FAIL:-false}" == "true" ]]; then
  echo "simulated oemer failure" >&2
  exit 1
fi

# Derive output base name from the input filename (mirrors real oemer behaviour).
base="${INPUT##*/}"
base="${base%.*}"

cat > "$OUTPUT_DIR/$base.musicxml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Black Velvet</work-title></work>
  <identification><creator type="composer">Alannah Myles</creator></identification>
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>1</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
        <lyric><text>la</text></lyric>
      </note>
    </measure>
  </part>
</score-partwise>
XML

# Simulate .mxl output only for PDF inputs (same as Audiveris behaviour).
if [[ "${INPUT##*.}" == "pdf" || "${INPUT##*.}" == "png" && "${INPUT}" == *"page_001"* ]]; then
  touch "$OUTPUT_DIR/$base.mxl"
fi
