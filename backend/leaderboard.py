"""Bestenliste, sortiert nach Abweichung von 10.000s (kleinste zuerst).

ACHTUNG Einzelprozess-Annahme: _entries ist ein In-Memory-Cache, _lock ein
asyncio.Lock — gilt nur mit genau einer laufenden uvicorn-Instanz.
"""

import asyncio
import random
import secrets
import uuid
from datetime import datetime, timedelta, timezone

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


# Zettel-Code: kurz, ohne verwechselbare Zeichen (0/O, 1/I/L, 5/S, 2/Z, 8/B),
# damit er sich handschriftlich sicher abschreiben lässt.
_CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679"


def _new_code(entries: list[dict]) -> str:
    used = {e.get("code") for e in entries}
    while True:
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(3))
        if code not in used:
            return code


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


class ClaimError(Exception):
    """Eintragen nicht (mehr) möglich – Text geht als Fehlermeldung an die Seite."""


async def submit(nickname: str, email: str, elapsed_ms: float) -> tuple[bool, int | None, list[dict], str | None, str | None]:
    """Fügt ein Ergebnis hinzu, falls es für die Top N reicht.

    Rückgabe: (qualifiziert, Platz (1-basiert) oder None, öffentliche
    Bestenliste, claim_token, Zettel-Code). Der claim_token geht NUR an das Gerät, das
    das Ergebnis eingereicht hat (landet dort im QR-Code) – damit kann
    Nickname/Mail später auf dem eigenen Handy nachgetragen werden.

    Ob ein Versuch überhaupt in die Rangliste soll, entscheidet das
    Standpersonal am Spielrechner (Ranglisten-Runde) – hier kommen nur
    solche Versuche an.
    """
    deviation_ms = round(abs(elapsed_ms - 10000.0), 3)
    entry = {
        "id": uuid.uuid4().hex,
        "nickname": nickname.strip()[:20] or _dummy_nickname(),
        "email": email.strip()[:254],
        "elapsed_ms": round(elapsed_ms, 3),
        "deviation_ms": deviation_ms,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "claim_token": secrets.token_urlsafe(16),
        "consent": False,
    }
    async with _lock:
        entries = _sorted(_load())
        entry["code"] = _new_code(entries)
        qualifies = len(entries) < settings.leaderboard_size or deviation_ms < entries[-1]["deviation_ms"]
        if qualifies:
            entries = _sorted(entries + [entry])[: settings.leaderboard_size]
            global _entries
            _entries = entries
            store.write_json(settings.leaderboard_file, entries)
            rank = next(i for i, e in enumerate(entries, start=1) if e["id"] == entry["id"])
            return True, rank, _public_view(entries), entry["claim_token"], entry["code"]
        return False, None, _public_view(entries), None, None


def _created(e: dict) -> datetime:
    return datetime.fromisoformat(e["created_at"])


def _email_key(email: str) -> str:
    """Vergleichsschlüssel: ohne Groß/Klein und ohne +Zusatz, damit
    name+1@… / Name@… nicht als zweite Teilnahme durchrutschen."""
    local, _, domain = email.strip().lower().partition("@")
    return f"{local.split('+', 1)[0]}@{domain}"


_HINT_QR = "Jede Mail nimmt nur einmal teil – lass das Feld leer, um nur den Nickname zu speichern."
_HINT_ADMIN = "Dieser Eintrag zählt nicht für die Verlosung – Mail-Feld leer lassen."


def _apply_claim(entries: list[dict], entry: dict, nickname: str, email: str, consent: bool,
                 hint: str = _HINT_QR) -> list[dict]:
    """Trägt Nickname/Mail ein. Jede Mail nimmt nur EINMAL teil: Gibt es sie
    schon an einem anderen Eintrag, zählt nur das bessere Ergebnis – ist das
    neue besser, fliegt der alte Eintrag raus (Platz wird frei), sonst wird
    die Mail abgelehnt. Gibt die (ggf. verkürzte) Liste zurück."""
    nickname = nickname.strip()[:20]
    email = email.strip()[:254]
    if email and not consent:
        raise ClaimError("Bitte bestätigen, dass du mindestens 18 Jahre alt bist oder als erwachsene Begleitperson einträgst.")
    if email:
        key = _email_key(email)
        others = [e for e in entries if e is not entry and e.get("email") and _email_key(e["email"]) == key]
        for other in others:
            if other["deviation_ms"] <= entry["deviation_ms"]:
                rank = entries.index(other) + 1
                raise ClaimError(f"Mit dieser Mail ist schon ein besseres Ergebnis eingetragen (Platz {rank}). {hint}")
        entries = [e for e in entries if e not in others]
    if nickname:
        entry["nickname"] = nickname
    entry["email"] = email
    entry["consent"] = bool(email) and consent
    return entries


def _save(entries: list[dict]) -> None:
    global _entries
    _entries = entries
    store.write_json(settings.leaderboard_file, entries)


async def claim_info(token: str) -> dict:
    async with _lock:
        entries = _sorted(_load())
        for i, e in enumerate(entries, start=1):
            if e.get("claim_token") == token:
                if datetime.now(timezone.utc) - _created(e) > timedelta(hours=settings.claim_ttl_hours):
                    raise ClaimError("Dieser Link ist abgelaufen.")
                return {
                    "rank": i,
                    "nickname": e["nickname"],
                    "elapsed_ms": e["elapsed_ms"],
                    "deviation_ms": e["deviation_ms"],
                    "has_email": bool(e.get("email")),
                }
        raise ClaimError("Dieses Ergebnis ist nicht (mehr) in den Top 20.")


async def claim(token: str, nickname: str, email: str, consent: bool) -> int:
    """Nachtragen per QR-Link. Darf innerhalb der Gültigkeit beliebig oft
    korrigiert werden – auch wenn per Zettel schon etwas eingetragen wurde,
    der Token-Besitz ist der stärkere Nachweis."""
    async with _lock:
        entries = _sorted(_load())
        for i, e in enumerate(entries, start=1):
            if e.get("claim_token") == token:
                if datetime.now(timezone.utc) - _created(e) > timedelta(hours=settings.claim_ttl_hours):
                    raise ClaimError("Dieser Link ist abgelaufen.")
                entries = _apply_claim(entries, e, nickname, email, consent)
                _save(entries)
                return entries.index(e) + 1
        raise ClaimError("Dieses Ergebnis ist nicht (mehr) in den Top 20.")


async def admin_set_email(entry_id: str, email: str) -> int:
    """Mail von einem Papier-Zettel nachtragen (Admin). Die Ab-18-Bestätigung
    steht als Häkchen auf dem Zettel, deshalb consent=True. Gleiche Regel wie
    beim QR-Link: jede Mail nur einmal, das bessere Ergebnis zählt. Leere Mail
    entfernt eine falsch zugeordnete Mail wieder."""
    async with _lock:
        entries = _sorted(_load())
        for e in entries:
            if e["id"] == entry_id:
                entries = _apply_claim(entries, e, "", email, consent=True, hint=_HINT_ADMIN)
                _save(entries)
                return entries.index(e) + 1
        raise ClaimError("Eintrag nicht gefunden.")


async def admin_delete(entry_id: str) -> None:
    """Versehentliche Ranglisten-Runde (z. B. Kind) oder offensichtliche
    Manipulation wieder aus der Rangliste nehmen."""
    async with _lock:
        entries = _sorted(_load())
        remaining = [e for e in entries if e["id"] != entry_id]
        if len(remaining) == len(entries):
            raise ClaimError("Eintrag nicht gefunden.")
        _save(remaining)
