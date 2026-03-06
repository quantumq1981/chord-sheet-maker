#!/usr/bin/env bash
set -euo pipefail
OUTPUT=""
INPUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -output) OUTPUT="$2"; shift 2 ;;
    --) INPUT="$2"; shift 2 ; break ;;
    *) shift ;;
  esac
done

mkdir -p "$OUTPUT"
if [[ "${FAKE_AUDIVERIS_FAIL:-false}" == "true" ]]; then
  echo "simulated failure" >&2
  exit 1
fi

base="score"
cat > "$OUTPUT/$base.musicxml" <<'XML'
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
      <harmony><root><root-step>C</root-step></root></harmony>
    </measure>
    <measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><lyric><text>la</text></lyric></note></measure>
  </part>
</score-partwise>
XML

if [[ "${INPUT##*.}" == "pdf" ]]; then
  touch "$OUTPUT/$base.mxl"
fi

touch "$OUTPUT/$base.omr"
