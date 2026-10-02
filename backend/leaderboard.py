"""Bestenliste, sortiert nach Abweichung von 10.000s (kleinste zuerst).

ACHTUNG Einzelprozess-Annahme: _entries ist ein In-Memory-Cache, _lock ein
asyncio.Lock — gilt nur mit genau einer laufenden uvicorn-Instanz.
"""

import asyncio
import random
import uuid
from datetime import datetime, timezone

import store
from config import settings

_lock = asyncio.Lock()
_entries: list[dict] | None = None

_DUMMY_PREFIXES = [
    "Flinker", "Geheimnisvoller", "Schneller", "Verschlafener", "Listiger",
    "Neugieriger", "Mutiger", "Stiller", "Wendiger", "Pfiffiger",
]
_DUMMY_NAMES = [
    "Waschbär", "Sekundenjäger", "Zeitdetektiv", "Pfotengänger",
    "Nachtschwärmer", "Mülltonnen-Profi", "Zirndorfer",
]


def _dummy_nickname() -> str:
    return (
        f"{random.choice(_DUMMY_PREFIXES)} "
        f"{random.choice(_DUMMY_NAMES)} #{random.randint(10, 99)}"
    )


def _load() -> list[dict]:
    global _entries
    if _entries is None:
        _entries = store.read_json(settings.leaderboard_file, [])
    return _entries


def _sorted(entries: list[dict]) -> list[dict]:
    return sorted(entries, key=lambda e: e["deviation_ms"])


def _public_view(entries: list[dict]) -> list[dict]:
    """Nie die Mailadresse ausliefern — das ist der einzige Ort, der über die
    öffentlichen Endpunkte erreichbare Daten formt, damit sie an keiner
    Stelle versehentlich mit rausrutscht."""
    return [
        {
            "rank": i,
            "nickname": e["nickname"],
            "elapsed_ms": e["elapsed_ms"],
            "deviation_ms": e["deviation_ms"],
            "created_at": e["created_at"],
        }
        for i, e in enumerate(entries, start=1)
    ]


async def list_public() -> list[dict]:
    async with _lock:
        return _public_view(_sorted(_load()))


async def list_admin() -> list[dict]:
    async with _lock:
        entries = _sorted(_load())
        return [
            {**e, "rank": i} for i, e in enumerate(entries, start=1)
        ]


async def raffle_pool() -> list[dict]:
    """Oberste N Einträge mit unterschiedlicher Mailadresse, nach Abweichung
    sortiert — die Kandidat:innen-Liste für die Verlosung. Pro Person zählt
    nur der beste Versuch; belegt eine Person mehrere Spitzenplätze, rückt
    automatisch die nächste unterschiedliche Person nach (siehe Vorgabe:
    "wenn eine Person die ersten 5 Plätze hat, bekommt sie trotzdem nur den
    ersten Preis")."""
    async with _lock:
        entries = _sorted(_load())
        pool: list[dict] = []
        seen_emails: set[str] = set()
        for i, e in enumerate(entries, start=1):
            email = (e.get("email") or "").strip().lower()
            if not email or email in seen_emails:
                continue
            seen_emails.add(email)
            pool.append({**e, "rank": i})
            if len(pool) >= settings.raffle_pool_size:
                break
        return pool


async def would_qualify(deviation_ms: float) -> bool:
    async with _lock:
        entries = _sorted(_load())
        if len(entries) < settings.leaderboard_size:
            return True
        return deviation_ms < entries[-1]["deviation_ms"]


async def submit(nickname: str, email: str, elapsed_ms: float) -> tuple[bool, int | None, list[dict]]:
    """Fügt ein Ergebnis hinzu, falls es für die Top N reicht.

    Rückgabe: (qualifiziert, Platz (1-basiert) oder None, öffentliche Bestenliste).
    """
    deviation_ms = round(abs(elapsed_ms - 10000.0), 3)
    entry = {
        "id": uuid.uuid4().hex,
        "nickname": nickname.strip()[:20] or _dummy_nickname(),
        "email": email.strip()[:254],
        "elapsed_ms": round(elapsed_ms, 3),
        "deviation_ms": deviation_ms,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    async with _lock:
        entries = _sorted(_load())
        qualifies = len(entries) < settings.leaderboard_size or deviation_ms < entries[-1]["deviation_ms"]
        if qualifies:
            entries = _sorted(entries + [entry])[: settings.leaderboard_size]
            global _entries
            _entries = entries
            store.write_json(settings.leaderboard_file, entries)
            rank = next(i for i, e in enumerate(entries, start=1) if e["id"] == entry["id"])
            return True, rank, _public_view(entries)
        return False, None, _public_view(entries)
