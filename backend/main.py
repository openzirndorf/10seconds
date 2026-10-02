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
    allow_methods=["GET", "POST"],
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
    nickname: str = Field(default="", max_length=20)
    email: str = Field(default="", max_length=254)
    elapsed_ms: float = Field(gt=0, le=60_000)

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip()
        if v and not _EMAIL_RE.match(v):
            raise ValueError("Ungültige E-Mail-Adresse.")
        return v


class PublicEntry(BaseModel):
    rank: int
    nickname: str
    elapsed_ms: float
    deviation_ms: float
    created_at: str


class AdminEntry(PublicEntry):
    email: str


class ScoreOut(BaseModel):
    qualified: bool
    rank: int | None
    leaderboard: list[PublicEntry]


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
    qualified, rank, entries = await leaderboard.submit(score.nickname, score.email, score.elapsed_ms)
    return ScoreOut(qualified=qualified, rank=rank, leaderboard=entries)


# ---------- Admin-Routen ----------

@app.get("/api/admin/entries", response_model=list[AdminEntry])
async def admin_entries(_: None = Depends(_require_admin)):
    return await leaderboard.list_admin()


@app.get("/api/admin/raffle-pool", response_model=list[AdminEntry])
async def admin_raffle_pool(_: None = Depends(_require_admin)):
    return await leaderboard.raffle_pool()


# ---------- /live und /admin (eigene statische Seiten) ----------

@app.get("/live", include_in_schema=False)
async def live_page():
    return FileResponse(STATIC_DIR / "live.html")


@app.get("/admin", include_in_schema=False)
async def admin_page():
    return FileResponse(STATIC_DIR / "admin.html")


app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")
