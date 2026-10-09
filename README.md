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

- **Ranglisten-Runde per Taste `R`:** Nur Runden, die das Standpersonal vor
  dem Start mit `R` markiert (Erwachsene oder Kinder mit Erwachsenen),
  gehen an den Server – alle anderen zählen nur für die Sofort-Preise. Gilt immer nur für
  die nächste Runde; nochmal `R` nimmt es zurück. Der Buzzer sendet
  Enter/Leertaste, `R` kann also nur jemand an der Tastatur auslösen.
- Top 20 der Ranglisten-Runden landen in der Rangliste (Spielbildschirm
  zeigt die Top 10 ohne Scrollen, `/live` alle 20). Der Server vergibt
  einen Waschbär-Fantasienamen und einen 3-stelligen **Zettel-Code** (ohne
  verwechselbare Zeichen, nur auf dem Spielbildschirm und im Admin sichtbar,
  nicht in der öffentlichen Rangliste).
- **Mail nachtragen** passiert abseits des Spielrechners:
  - **QR-Code** im Ergebnis → `/e/<token>` auf dem eigenen Handy. Der
    geheime Token geht nur an das Gerät, das das Ergebnis eingereicht hat,
    und gilt 24 h (`CLAIM_TTL_HOURS`).
  - **Papier-Zettel** (Code + Zeit schreibt das Standpersonal, Mail +
    Häkchen „ab 18 / Begleitperson“ die Person selbst) in eine
    verschlossene Box. Nach Aktionsende trägt der Vorstand die Mails in
    `/admin` ein (`POST /api/admin/entries/{id}/email`), von Platz 1 abwärts,
    Zeit auf dem Zettel gegen die Zeit im Admin prüfen.
  - **Jede Mail nimmt nur einmal teil** (`_apply_claim()` in
    `leaderboard.py`, Vergleich ohne Groß/Klein und `+Zusatz`), egal über
    welchen Weg: besseres Ergebnis ersetzt den alten Eintrag, schlechteres
    wird abgelehnt. `POST /api/scores` nimmt deshalb nur die Zeit an.
  - Versehentliche Ranglisten-Runden lassen sich in `/admin` entfernen.
  - Mail-Häkchen „mindestens 18 Jahre oder erwachsene Begleitperson“: Für
    Kinder trägt die Begleitperson ihre eigene Mail ein. Teilnahmebedingungen
    unter `/teilnahme`.
- **Kosten:** 1 € pro Versuch, 3 Versuche 2 € – für alle, auch Kinder.
  Neue Mitglieder bekommen 2 Freiversuche
  (Hinweis auf der Spielfläche, in `/teilnahme` und auf dem Spielregeln-Blatt).
- Ergebnis springt nach 12 s (bzw. 45 s mit QR-Code/Zettel-Code) automatisch zurück.
- **Sofort-Preise in drei Stufen:** Kategorie 1 ≤ 100 ms, Kategorie 2
  ≤ 400 ms, sonst Trostpreis (Gummibärchen). Startwerte ausgelegt auf
  ~150–200 Runden in 5 Stunden bei 14 bzw. 46 Preisen. Das Banner im Spiel
  sagt, aus welcher Kategorie man sich etwas aussuchen darf (kein
  App-seitiger Spielsperren-Mechanismus: ein gemeinsames Gerät am Stand muss
  für alle Spieler:innen nutzbar bleiben).
- **Personal-Anzeige per Taste `S`:** Runden heute, vergebene/übrige Preise
  pro Kategorie, Preisfenster und Vorrat änderbar, „Tag zurücksetzen“. Gilt
  nur auf diesem Rechner (localStorage), keine Code-Änderung nötig.
- **Live-Statistik** unten in der Sofort-Preise-Spalte (Verteilung aller
  Runden des Tages als ein Balken, beste Runde) und im Ergebnis „Näher dran
  als X % aller Versuche heute“ (ab 10 Runden). Zählt alle Runden, auch die
  ohne `R` – deshalb lokal auf dem Spiel-PC statt im Backend; gespeichert
  werden nur Abweichungen, keine personenbezogenen Daten. Neuer Tag =
  automatisch neue Statistik.
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
