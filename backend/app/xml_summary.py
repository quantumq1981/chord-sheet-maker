from __future__ import annotations

from pathlib import Path
import xml.etree.ElementTree as ET


def _text(node: ET.Element | None) -> str | None:
    if node is None or not node.text:
        return None
    value = node.text.strip()
    return value or None


def parse_musicxml_summary(path: Path) -> dict:
    tree = ET.parse(path)
    root = tree.getroot()

    title = _text(root.find(".//work/work-title")) or _text(root.find(".//movement-title"))
    composer = _text(root.find(".//identification/creator[@type='composer']"))

    measures = root.findall(".//measure")
    pages = {el.get("new-page") for el in root.findall(".//print") if el.get("new-page") == "yes"}
    part_ids = {p.get("id") for p in root.findall(".//part") if p.get("id")}

    harmony_exists = root.find(".//harmony") is not None
    lyrics_exists = root.find(".//lyric") is not None

    beats = _text(root.find(".//time/beats"))
    beat_type = _text(root.find(".//time/beat-type"))
    fifths = _text(root.find(".//key/fifths"))

    key_map = {
        "0": "C",
        "1": "G",
        "2": "D",
        "3": "A",
        "4": "E",
        "5": "B",
        "6": "F#",
        "7": "C#",
        "-1": "F",
        "-2": "Bb",
        "-3": "Eb",
        "-4": "Ab",
        "-5": "Db",
        "-6": "Gb",
        "-7": "Cb",
    }

    return {
        "title": title,
        "composer": composer,
        "pages": max(1, len(pages) + 1) if measures else 0,
        "parts": len(part_ids),
        "measures": len(measures),
        "hasHarmonyTags": harmony_exists,
        "hasLyrics": lyrics_exists,
        "timeSignature": f"{beats}/{beat_type}" if beats and beat_type else None,
        "keySignature": key_map.get(fifths) if fifths is not None else None,
    }
