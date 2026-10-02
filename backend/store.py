"""Atomare Lese/Schreib-Abstraktion für leaderboard.json — lokale Datei,
kein Objektspeicher nötig für dieses kleine Spiel."""

import json
from pathlib import Path


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path: Path, data) -> None:
    body = json.dumps(data, indent=1, ensure_ascii=False)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(body, encoding="utf-8")
    tmp.replace(path)
