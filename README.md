# 10 Sekunden

Kleines Reaktions-/Zeitgefühl-Spiel: Enter oder Klick startet die Uhr, die
ersten 2–3 Sekunden (zufällig) sind sichtbar, dann wird die Anzeige
ausgeblendet. Enter oder Klick stoppt die Uhr — Ziel ist, so nah wie möglich
an exakt 10,000 Sekunden zu treffen. Die Zeit wird mit drei Nachkommastellen
angezeigt.

Statische Seite im Stil von [openzirndorf.de](https://openzirndorf.de) mit
dem OpenZirndorf-Waschbär als Maskottchen — keine externen Abhängigkeiten
außer Google Fonts, kein Tracking.

## Inhalt

- `index.html` — Spiel (Start/Stop-Fläche, Ergebnis, Eintragsformular)
- `style.css` — Design im OpenZirndorf-Look (Farb-/Typo-Tokens lokal
  eingebettet, siehe Kommentar im Kopf der Datei)
- `app.js` — Spiel-Logik (Timer via `performance.now()`/`requestAnimationFrame`,
  Bestenliste)
- `images/waschbaer.png` — Maskottchen (gleiche Grafik wie bei den
  [Sommerdetektiven](https://sommerdetektive.openzirndorf.de))
- `impressum.html` — Impressum + Datenschutzhinweis

## Bestenliste

Top 20 wird **lokal im Browser** gespeichert (`localStorage`), nicht geteilt
zwischen Spieler:innen — 100% statisch, kein Backend nötig. Qualifiziert ein
Ergebnis für die Top 20, erscheint automatisch ein Nickname-Eingabefeld.

Falls später eine geräteübergreifende Rangliste gewünscht ist, braucht es
einen kleinen Speicher-Dienst (z. B. Firebase oder ein eigenes API-Backend
wie bei den Sommerdetektiven) — bisher bewusst weggelassen, um ohne Server
als reine GitHub Page lauffähig zu sein.

## Lokal testen

Kein Build nötig, einfach öffnen oder z. B. mit:

```bash
python3 -m http.server 8000
```

und `http://localhost:8000` aufrufen.

## Veröffentlichen (GitHub Pages)

GitHub → Repo **Settings → Pages → Deploy from a branch → `main` / root**.
Danach ist die Seite unter der GitHub-Pages-URL erreichbar; für eine eigene
Subdomain (z. B. `10sekunden.openzirndorf.de`) eine `CNAME`-Datei mit der
gewünschten Domain im Repo-Root anlegen und beim DNS-Anbieter einen
CNAME-Record darauf anlegen.
