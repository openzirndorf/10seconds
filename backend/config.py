from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Bewusst minimal: keine Datenbank, keine Nutzerkonten. Einzige
    persistente Datei ist leaderboard.json; das Admin-Passwort lebt
    ausschließlich als Server-Env-Var, nie im Quelltext oder Frontend."""

    leaderboard_file: Path = Path(__file__).parent / "leaderboard.json"
    leaderboard_size: int = 20  # wie viele Einträge insgesamt geführt werden
    raffle_pool_size: int = 5   # Top-N unterschiedliche Mailadressen für die Verlosung

    # Kommagetrennte Liste erlaubter Origins fürs öffentliche GitHub-Pages-
    # Frontend (index.html) — /live und /admin werden selbst ausgeliefert
    # und brauchen daher kein CORS.
    cors_origins: str = "http://localhost:5500,http://127.0.0.1:5500,https://openzirndorf.github.io"

    submit_rate_limit: str = "20/minute"
    admin_rate_limit: str = "10/minute"

    # Schützt /api/admin/*. NUR per Env-Var setzen (.env lokal, Deployment-
    # Secret produktiv) — steht bewusst nirgends im Quelltext. Ohne gesetztes
    # Passwort bleiben die Admin-Endpunkte komplett unerreichbar (404), damit
    # ein vergessenes Setup nicht versehentlich offen daliegt.
    admin_password: str = ""

    class Config:
        env_file = ".env"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
