import logging
import re
import secrets
import sys
from contextlib import asynccontextmanager
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger(__name__)

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

import leaderboard
from config import settings

STATIC_DIR = Path(__file__).parent / "static"
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    entries = await leaderboard.list_public()
    logger.info("Bestenliste geladen: %d Einträge.", len(entries))
    yield


app = FastAPI(title="10 Sekunden", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


@limiter.limit(settings.admin_rate_limit)
async def _require_admin(request: Request, x_admin_password: str | None = Header(default=None)) -> None:
    """Schützt /api/admin/*. Das Passwort lebt ausschließlich als Server-
    Env-Var (ADMIN_PASSWORD) — steht nirgends im Quelltext oder Frontend-
    Bundle. Ohne konfiguriertes Passwort bleiben die Endpunkte komplett
    unerreichbar (404), damit ein vergessenes Setup nicht offen daliegt.

    Das Rate-Limit sitzt bewusst HIER (auf der Dependency) statt auf den
    Endpunkt-Funktionen: FastAPI löst Depends()-Parameter auf, bevor die
    eigentliche Endpunkt-Funktion aufgerufen wird. Ein @limiter.limit auf
    dem Endpunkt selbst würde bei falschem Passwort also nie ausgeführt —
    genau der Fall, den das Rate-Limit eigentlich bremsen soll."""
    if not settings.admin_password:
        raise HTTPException(status_code=404, detail="Nicht verfügbar.")
    if not x_admin_password or not secrets.compare_digest(x_admin_password, settings.admin_password):
        raise HTTPException(status_code=401, detail="Falsches Passwort.")


# ---------- Schemas ----------

class ScoreIn(BaseModel):
    # Bewusst nur die Zeit: Nickname/Mail kommen ausschließlich über
    # /api/claim (QR-Link) bzw. /api/admin/entries/{id}/email (Papier-Zettel),
    # wo Einwilligung und "jede Mail nur einmal" geprüft werden.
    elapsed_ms: float = Field(gt=0, le=60_000)


class ClaimIn(BaseModel):
    nickname: str = Field(default="", max_length=20)
    email: str = Field(default="", max_length=254)
    consent: bool = False

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip()
        if v and not _EMAIL_RE.match(v):
            raise ValueError("Ungültige E-Mail-Adresse.")
        return v


class ClaimInfo(BaseModel):
    rank: int
    nickname: str
    elapsed_ms: float
    deviation_ms: float
    has_email: bool


class ClaimOut(BaseModel):
    rank: int


class PublicEntry(BaseModel):
    rank: int
    nickname: str
    elapsed_ms: float
    deviation_ms: float
    created_at: str


class AdminEntry(PublicEntry):
    id: str
    code: str = ""
    email: str
    consent: bool = False


class AdminEmailIn(BaseModel):
    email: str = Field(default="", max_length=254)

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip()
        if v and not _EMAIL_RE.match(v):
            raise ValueError("Ungültige E-Mail-Adresse.")
        return v


class ScoreOut(BaseModel):
    qualified: bool
    rank: int | None
    leaderboard: list[PublicEntry]
    claim_token: str | None = None
    # Kurzer Code für den Papier-Zettel. Steht bewusst nicht in der
    # öffentlichen Rangliste, nur auf dem Spielbildschirm und im Admin.
    code: str | None = None


# ---------- Öffentliche Routen ----------

@app.get("/api/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


@app.get("/api/leaderboard", response_model=list[PublicEntry])
async def get_leaderboard():
    return await leaderboard.list_public()


@app.post("/api/scores", response_model=ScoreOut)
@limiter.limit(settings.submit_rate_limit)
async def post_score(request: Request, score: ScoreIn):
    qualified, rank, entries, token, code = await leaderboard.submit("", "", score.elapsed_ms)
    return ScoreOut(qualified=qualified, rank=rank, leaderboard=entries, claim_token=token, code=code)


# ---------- Nachtragen per QR-Link (eigenes Handy) ----------

@app.get("/api/claim/{token}", response_model=ClaimInfo)
@limiter.limit(settings.claim_rate_limit)
async def get_claim(request: Request, token: str):
    try:
        return await leaderboard.claim_info(token)
    except leaderboard.ClaimError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/claim/{token}", response_model=ClaimOut)
@limiter.limit(settings.claim_rate_limit)
async def post_claim(request: Request, token: str, body: ClaimIn):
    try:
        rank = await leaderboard.claim(token, body.nickname, body.email, body.consent)
    except leaderboard.ClaimError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ClaimOut(rank=rank)


# ---------- Admin-Routen ----------

@app.get("/api/admin/entries", response_model=list[AdminEntry])
async def admin_entries(_: None = Depends(_require_admin)):
    return await leaderboard.list_admin()


@app.get("/api/admin/raffle-pool", response_model=list[AdminEntry])
async def admin_raffle_pool(_: None = Depends(_require_admin)):
    return await leaderboard.raffle_pool()


@app.post("/api/admin/entries/{entry_id}/email", response_model=ClaimOut)
async def admin_set_email(entry_id: str, body: AdminEmailIn, _: None = Depends(_require_admin)):
    try:
        rank = await leaderboard.admin_set_email(entry_id, body.email)
    except leaderboard.ClaimError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ClaimOut(rank=rank)


@app.delete("/api/admin/entries/{entry_id}", status_code=204)
async def admin_delete(entry_id: str, _: None = Depends(_require_admin)):
    try:
        await leaderboard.admin_delete(entry_id)
    except leaderboard.ClaimError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ---------- /live und /admin (eigene statische Seiten) ----------

@app.get("/live", include_in_schema=False)
async def live_page():
    return FileResponse(STATIC_DIR / "live.html")


@app.get("/e/{token}", include_in_schema=False)
async def claim_page(token: str):
    return FileResponse(STATIC_DIR / "claim.html")


@app.get("/teilnahme", include_in_schema=False)
async def terms_page():
    return FileResponse(STATIC_DIR / "teilnahme.html")


@app.get("/admin", include_in_schema=False)
async def admin_page():
    return FileResponse(STATIC_DIR / "admin.html")


app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")
