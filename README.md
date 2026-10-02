# 10 Sekunden

Kleines Reaktions-/Zeitgefühl-Spiel: Enter oder Klick startet die Uhr, die
ersten 2–3 Sekunden (zufällig) sind sichtbar, dann wird die Anzeige
ausgeblendet. Enter oder Klick stoppt die Uhr — Ziel ist, so nah wie möglich
an exakt 10,000 Sekunden zu treffen. Die Zeit wird mit drei Nachkommastellen
angezeigt.

Im Stil von [openzirndorf.de](https://openzirndorf.de) mit dem
OpenZirndorf-Waschbär als Maskottchen.

## Architektur

Zwei Teile, getrennt deployt:

- **`index.html`/`style.css`/`app.js`/`images/`/`impressum.html`** — das
  eigentliche Spiel, eine reine statische Seite für **GitHub Pages**.
- **`backend/`** — kleines FastAPI-Backend (Muster wie bei den
  [Sommerdetektiven](https://sommerdetektive.openzirndorf.de)), das die
  Rangliste zentral speichert (JSON-Datei) und zwei eigene Seiten ausliefert:
  - **`/live`** — öffentlicher Live-Stand (Nickname + Zeit, ohne Mail), für
    einen zweiten Bildschirm am Stand oder zum Teilen.
  - **`/admin`** — passwortgeschützt, zeigt alle Einträge inkl. Mailadresse
    sowie die Verlosungs-Kandidat:innen.

Das Spiel (`index.html`) ruft die Backend-API per `fetch()` auf (CORS), die
Mailadresse geht **nie** über die öffentlichen Endpunkte raus.

## Preisstufen & Rangliste

- Top 20 landen in der Rangliste (Nickname frei wählbar, sonst vergibt der
  Server einen Waschbär-Fantasienamen).
- Ab Rang 10 wird zusätzlich optional eine Mailadresse abgefragt (für die
  Verlosung) — bleibt das Feld leer, ist nur der Nickname gespeichert.
- **Hauptpreis:** ≤ 50 ms Abweichung (selten) · **Trostpreis:** ≤ 400 ms
  (mittel) — beide zeigen im Spiel einen Hinweis, sich beim Standpersonal
  den Stempel zu holen (kein App-seitiger Spielsperren-Mechanismus, siehe
  Begründung im Code: ein gemeinsames Gerät am Stand muss für alle
  Spieler:innen nutzbar bleiben).
- **Verlosung:** `/admin` zeigt die Top 5 *unterschiedlichen* Mailadressen
  nach Zeitabweichung (bester Versuch pro Person). Belegt eine Person
  mehrere Spitzenplätze, zählt nur ihr bester Platz — die nächste
  unterschiedliche Person rückt nach.

## Lokal testen

**Frontend** (im Projekt-Root, kein Build nötig):

```bash
python3 -m http.server 8934
```

**Backend:**

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # ADMIN_PASSWORD setzen!
.venv/bin/uvicorn main:app --reload --port 8000
```

`app.js` zeigt per Default auf `http://localhost:8000` — für die lokale
Entwicklung passt das direkt. Spiel unter `http://localhost:8934`,
Live-Stand unter `http://localhost:8000/live`, Admin unter
`http://localhost:8000/admin`.

## Veröffentlichen

**Backend zuerst deployen** (z. B. wie bei den Sommerdetektiven als
Docker-Container, `backend/Dockerfile` liegt bereit) — braucht einen
eigenen Host mit öffentlicher URL und `ADMIN_PASSWORD` als Server-Env-Var.
Danach in `app.js` die Konstante `API_BASE` auf diese URL setzen und in
`backend/.env` (bzw. das Deployment-Secret) `CORS_ORIGINS` um die
GitHub-Pages-Origin ergänzen.

**Danach Frontend auf GitHub Pages:** Repo **Settings → Pages → Deploy
from a branch → `main` / root**. Für eine eigene Subdomain (z. B.
`10sekunden.openzirndorf.de`) eine `CNAME`-Datei mit der gewünschten Domain
im Repo-Root anlegen und beim DNS-Anbieter einen CNAME-Record darauf
anlegen.
