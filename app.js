(() => {
  // URL des Backends: window.API_BASE (gehostet) bzw. localhost:8000 bei
  // lokaler Entwicklung. Sonst – z. B. auf GitHub Pages zum Testen – läuft
  // das Spiel ohne Backend: keine Rangliste, keine Ranglisten-Runden, alles
  // andere (Sofort-Preise, Statistik, Personal-Anzeige) funktioniert normal.
  const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
  const API_BASE = window.API_BASE || (IS_LOCAL ? 'http://localhost:8000' : null);
  const HAS_BACKEND = API_BASE !== null;

  const TARGET_MS = 10000;

  // Preisfenster (Abweichung von 10,000 s). Startwerte, ausgelegt auf ~150–200
  // Runden in 5 Stunden bei 14 Preisen in Kategorie 1 und 46 in Kategorie 2.
  // Das Standpersonal kann sie am Tag per Taste S anpassen (siehe Personal-
  // Anzeige unten); die Anpassung gilt nur auf diesem Rechner.
  const DEFAULTS = { kat1Ms: 100, kat2Ms: 400, kat1Stock: 14, kat2Stock: 46 };
  const SETTINGS_KEY = 'zehnsek_settings_v1';
  const STATS_KEY = 'zehnsek_stats_v1';
  const STATS_MIN_ROUNDS = 10; // „näher dran als …“ erst ab so vielen Versuchen

  const LEADERBOARD_POLL_MS = 15000;
  // Am Stand wird nur gebuzzert: Ergebnis bleibt eine Weile stehen und
  // springt dann von selbst zurück, damit die nächste Person direkt loslegen kann.
  const RESULT_MS_WITH_QR = 45000; // genug Zeit, Code + Zeit auf den Zettel zu schreiben
  const RESULT_MS_PLAIN = 12000;
  const BUZZ_LOCK_MS = 1200; // schützt vor versehentlichem Doppel-Buzzern nach dem Stopp

  const stage = document.getElementById('stage');
  const timerEl = document.getElementById('timer');
  const timerValue = document.getElementById('timer-value');
  const stageHint = document.getElementById('stage-hint');
  const resultEl = document.getElementById('result');
  const resultHeadline = document.getElementById('result-headline');
  const resultDetail = document.getElementById('result-detail');
  const prizeBanner = document.getElementById('prize-banner');
  const prizeLabel = document.getElementById('prize-label');
  const prizeInstruction = document.getElementById('prize-instruction');
  const claimEl = document.getElementById('claim');
  const claimQr = document.getElementById('claim-qr');
  const claimRank = document.getElementById('claim-rank');
  const claimName = document.getElementById('claim-name');
  const claimCode = document.getElementById('claim-code');
  const claimTime = document.getElementById('claim-time');
  const claimNote = document.getElementById('claim-note');
  const resultBar = document.getElementById('result-bar');
  const donateBadge = document.getElementById('donate-badge');
  const rankedBadge = document.getElementById('ranked-badge');

  const leaderboardList = document.getElementById('leaderboard-list');
  const leaderboardEmpty = document.getElementById('leaderboard-empty');
  const leaderboardError = document.getElementById('leaderboard-error');
  const liveDot = document.getElementById('live-dot');

  const resultCompare = document.getElementById('result-compare');
  const trostNote = document.getElementById('trost-note');
  const statsCount = document.getElementById('stats-count');
  const statsBar = document.getElementById('stats-bar');
  const statsLegend = document.getElementById('stats-legend');
  const statsBest = document.getElementById('stats-best');
  const staffPanel = document.getElementById('staff');
  const staffForm = document.getElementById('staff-form');
  const staffSummary = document.getElementById('staff-summary');

  let state = 'idle'; // idle | visible | hidden | result
  let startTime = 0;
  let stoppedAt = 0;
  let revealTimeout = null;
  let resultTimeout = null;
  let rafId = null;
  let round = 0; // verwirft verspätete Server-Antworten aus einer früheren Runde
  let cachedLeaderboard = []; // zuletzt vom Server geladene, sortierte Liste
  let highlightRank = -1; // eigener, gerade eingetragener Platz in der Seitenleiste
  // Nur Ranglisten-Runden (Erwachsene oder Kinder mit Erwachsenen, vom
  // Standpersonal vor dem Start per Taste R gesetzt) landen in der Rangliste.
  // Alle anderen Runden zählen nur für die Sofort-Preise. Gilt immer nur für
  // die nächste Runde.
  let rankedNext = false;
  let rankedRound = false;

  document.querySelectorAll('[data-terms-link]').forEach((a) => {
    if (HAS_BACKEND) a.href = `${API_BASE}/teilnahme`;
    else (a.closest('.terms-item') || a).remove(); // /teilnahme liefert nur das Backend aus
  });

  // ---------- Bestenliste (Backend) ----------

  async function refreshLeaderboard() {
    try {
      const res = await fetch(`${API_BASE}/api/leaderboard`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cachedLeaderboard = await res.json();
      return true;
    } catch {
      return false;
    }
  }

  function qualifies(deviationMs) {
    if (cachedLeaderboard.length < 20) return true;
    return deviationMs < cachedLeaderboard[cachedLeaderboard.length - 1].deviation_ms;
  }

  // Ohne Nickname: Server vergibt einen Waschbär-Namen, Nickname/Mail werden
  // per QR-Link (Handy) oder Papier-Zettel (Admin) nachgetragen.
  async function submitScore(elapsedMs) {
    const res = await fetch(`${API_BASE}/api/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elapsed_ms: elapsedMs }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json(); // { qualified, rank, leaderboard, claim_token }
  }

  function fmtSeconds(ms) {
    return (ms / 1000).toFixed(3);
  }

  // Am Spielbildschirm nur die Top 10, damit die Spalte ohne Scrollen
  // auskommt; die volle Liste zeigt /live.
  const BOARD_VISIBLE = 10;

  function renderLeaderboard(list) {
    leaderboardList.innerHTML = '';
    leaderboardEmpty.hidden = list.length > 0;
    list.slice(0, BOARD_VISIBLE).forEach((entry) => {
      const li = document.createElement('li');
      if (entry.rank <= 3) li.classList.add(`top-${entry.rank}`);
      if (entry.rank === highlightRank) li.classList.add('is-new');

      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = entry.rank;

      const nick = document.createElement('span');
      nick.className = 'nick';
      nick.textContent = entry.nickname;

      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = `${fmtSeconds(entry.elapsed_ms)} s`;

      li.append(rank, nick, time);
      leaderboardList.appendChild(li);
    });
  }

  async function updateLeaderboard() {
    if (!HAS_BACKEND) return;
    const ok = await refreshLeaderboard();
    leaderboardError.hidden = ok;
    liveDot.classList.toggle('is-offline', !ok);
    if (ok) renderLeaderboard(cachedLeaderboard);
  }

  function showOwnRank(rank) {
    highlightRank = rank;
    renderLeaderboard(cachedLeaderboard);
    const li = leaderboardList.querySelector('li.is-new');
    if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  setInterval(() => {
    if (!document.hidden) updateLeaderboard();
  }, LEADERBOARD_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateLeaderboard();
  });

  // Schwellwerte in der Info-Spalte aus denselben Konstanten wie die Spiellogik.
  // ---------- Einstellungen & Tagesstatistik (nur lokal auf dem Spiel-PC) ----------
  //
  // Bewusst localStorage statt Backend: Die Statistik umfasst ALLE Runden
  // (auch Kinder/Nicht-Ranglisten-Runden, die nie an den Server gehen), braucht
  // kein Netz und enthält nur Abweichungen – keine personenbezogenen Daten.

  function loadJson(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v && typeof v === 'object' ? v : fallback;
    } catch {
      return fallback;
    }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privater Modus o. Ä. */ }
  }

  const settings = { ...DEFAULTS, ...loadJson(SETTINGS_KEY, {}) };

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function emptyStats() {
    return { day: today(), devs: [], kat1: 0, kat2: 0 };
  }
  let stats = loadJson(STATS_KEY, emptyStats());
  if (stats.day !== today() || !Array.isArray(stats.devs)) stats = emptyStats(); // neuer Tag, neue Statistik

  function recordRound(deviationMs, tier) {
    if (stats.day !== today()) stats = emptyStats();
    stats.devs.push(Math.round(deviationMs));
    if (tier === 'kat1') stats.kat1++;
    if (tier === 'kat2') stats.kat2++;
    saveJson(STATS_KEY, stats);
  }

  // Anteil der bisherigen Versuche, die weiter weg waren als dieser.
  function betterThanShare(deviationMs, previous) {
    if (previous.length === 0) return null;
    return Math.round((previous.filter((d) => d > deviationMs).length / previous.length) * 100);
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  function applyThresholdLabels() {
    document.querySelectorAll('[data-threshold="kat1"]').forEach((el) => { el.textContent = fmtSeconds(settings.kat1Ms); });
    document.querySelectorAll('[data-threshold="kat2"]').forEach((el) => { el.textContent = fmtSeconds(settings.kat2Ms); });
  }
  applyThresholdLabels();

  // Kompakte Live-Statistik in der Seitenleiste: ein gestapelter Balken
  // (Kategorie 1 / Kategorie 2 / unter 1 s / weiter weg) statt vieler Zahlen.
  function renderStats() {
    const devs = stats.devs;
    const n = devs.length;
    statsCount.textContent = n === 1 ? '1 Versuch' : `${n} Versuche`;
    const buckets = [
      { cls: 'b-kat1', label: 'Kat. 1', count: devs.filter((d) => d <= settings.kat1Ms).length },
      { cls: 'b-kat2', label: 'Kat. 2', count: devs.filter((d) => d > settings.kat1Ms && d <= settings.kat2Ms).length },
      { cls: 'b-near', label: '< 1 s', count: devs.filter((d) => d > settings.kat2Ms && d <= 1000).length },
      { cls: 'b-far', label: 'weiter', count: devs.filter((d) => d > Math.max(1000, settings.kat2Ms)).length },
    ];
    statsBar.innerHTML = '';
    statsLegend.innerHTML = '';
    for (const b of buckets) {
      const share = n ? (b.count / n) * 100 : 0;
      const seg = document.createElement('span');
      seg.className = `stats-seg ${b.cls}`;
      seg.style.width = `${share}%`;
      statsBar.append(seg);
      const item = document.createElement('li');
      item.className = b.cls;
      item.innerHTML = `<i aria-hidden="true"></i>${b.label} <strong>${n ? Math.round(share) : 0}&nbsp;%</strong>`;
      statsLegend.append(item);
    }
    statsBest.textContent = n ? `Beste Runde heute: ±${fmtSeconds(Math.min(...devs))} s` : 'Noch keine Runde heute – leg los!';
  }
  renderStats();

  // ---------- QR-Code zum Nachtragen ----------

  function renderQr(url) {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    claimQr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    claimQr.title = url;
  }

  function scheduleReset(ms) {
    clearTimeout(resultTimeout);
    resultTimeout = setTimeout(resetToIdle, ms);
    // Fortschrittsbalken neu starten
    resultBar.style.animation = 'none';
    void resultBar.offsetWidth;
    resultBar.style.animation = `result-countdown ${ms}ms linear forwards`;
  }

  async function enterLeaderboard(elapsedMs, myRound) {
    try {
      const result = await submitScore(elapsedMs);
      if (myRound !== round) return;
      cachedLeaderboard = result.leaderboard;
      leaderboardError.hidden = true;
      if (!result.qualified || !result.claim_token) {
        showNote('Diesmal nicht in den Top 20 – Sofort-Preise gelten trotzdem.');
        return;
      }
      showOwnRank(result.rank);
      claimRank.textContent = result.rank;
      const own = result.leaderboard.find((e) => e.rank === result.rank);
      claimName.textContent = own ? own.nickname : '';
      claimCode.textContent = result.code || '';
      claimTime.textContent = fmtSeconds(elapsedMs);
      renderQr(`${API_BASE}/e/${result.claim_token}`);
      claimEl.hidden = false;
      scheduleReset(RESULT_MS_WITH_QR);
    } catch {
      if (myRound !== round) return;
      showNote('Rangliste gerade nicht erreichbar – das Ergebnis zählt trotzdem für die Sofort-Preise.');
    }
  }

  function showNote(text) {
    claimNote.textContent = text;
    claimNote.hidden = false;
  }

  function setRankedNext(on) {
    rankedNext = on;
    rankedBadge.hidden = !on;
    stage.classList.toggle('is-ranked', on);
  }

  // ---------- Spiel-Logik ----------

  // Preisstufen haben Vorrang vor der reinen Gefühls-Bewertung (siehe prizeFor).
  function ratingFor(deviationMs) {
    if (deviationMs <= 1000) return '🙂 Ordentlich nah dran.';
    if (deviationMs <= 2500) return '🤔 Ausbaufähig – der Waschbär schnuppert nochmal.';
    return '😅 Weit daneben geschnüffelt – nochmal versuchen!';
  }

  function prizeFor(deviationMs) {
    if (deviationMs <= settings.kat1Ms) return { tier: 'kat1', label: '🏆 Kategorie 1 gewonnen!', instruction: 'Zeig das dem Standpersonal und such dir einen Preis aus Kategorie 1 aus – Retourenware, bitte gemeinsam prüfen.' };
    if (deviationMs <= settings.kat2Ms) return { tier: 'kat2', label: '🎖️ Kategorie 2 gewonnen!', instruction: 'Zeig das dem Standpersonal und such dir einen Preis aus Kategorie 2 aus – Retourenware, bitte gemeinsam prüfen.' };
    return null;
  }

  function tick() {
    const elapsed = performance.now() - startTime;
    timerValue.textContent = fmtSeconds(elapsed);
    rafId = requestAnimationFrame(tick);
  }

  function startRound() {
    state = 'visible';
    round++;
    rankedRound = rankedNext;
    clearTimeout(resultTimeout);
    startTime = performance.now();
    if (highlightRank !== -1) {
      highlightRank = -1; // Platznummern verschieben sich, alte Markierung wäre irreführend
      renderLeaderboard(cachedLeaderboard);
    }

    // Zufällige, nicht-runde Wobbel-Dauer pro Runde, damit der Waschbär nicht
    // als heimlicher Sekundentakt zum Mitzählen missbraucht werden kann.
    const sniffDuration = (0.7 + Math.random() * 0.9).toFixed(2);
    stage.style.setProperty('--sniff-duration', `${sniffDuration}s`);

    stage.classList.add('is-running');
    stage.classList.remove('is-result');
    donateBadge.hidden = true;
    timerEl.style.display = '';
    timerEl.classList.remove('is-hidden');
    resultEl.hidden = true;
    stageHint.hidden = false;
    stageHint.textContent = 'Merk dir das Gefühl für 10 Sekunden …';

    rafId = requestAnimationFrame(tick);

    const revealMs = (2 + Math.random()) * 1000; // 2,0–3,0 s sichtbar
    revealTimeout = setTimeout(() => {
      if (state !== 'visible') return;
      state = 'hidden';
      timerEl.classList.add('is-hidden');
      stageHint.textContent = 'Jetzt bei genau 10,000 s stoppen!';
    }, revealMs);
  }

  function stopRound() {
    const elapsedMs = performance.now() - startTime;
    cancelAnimationFrame(rafId);
    clearTimeout(revealTimeout);
    state = 'result';
    stoppedAt = performance.now();

    stage.classList.remove('is-running');
    stage.classList.add('is-result');
    timerEl.style.display = 'none';
    stageHint.hidden = true;

    const deviationMs = Math.abs(elapsedMs - TARGET_MS);
    resultEl.hidden = false;
    claimEl.hidden = true;
    claimNote.hidden = true;
    resultCompare.hidden = true;

    const prize = prizeFor(deviationMs);
    if (prize) {
      prizeBanner.hidden = false;
      prizeBanner.className = `prize-banner prize-${prize.tier}`;
      prizeLabel.textContent = prize.label;
      prizeInstruction.textContent = prize.instruction;
      resultHeadline.hidden = true;
      resultHeadline.textContent = '';
      trostNote.hidden = true;
    } else {
      prizeBanner.hidden = true;
      resultHeadline.hidden = false;
      resultHeadline.textContent = ratingFor(deviationMs);
      trostNote.hidden = false;
    }

    // Vergleich mit dem Tag: ab der besseren Hälfte als Prozentwert, darunter
    // freundlicher als Tagesschnitt (Median) statt eines frustrierenden „0 %“.
    const enough = stats.devs.length >= STATS_MIN_ROUNDS;
    resultCompare.hidden = !enough;
    if (enough) {
      const share = betterThanShare(deviationMs, stats.devs);
      resultCompare.innerHTML = share >= 50
        ? `Näher dran als <strong>${share}&nbsp;%</strong> aller Versuche heute`
        : `Heute liegen die meisten etwa <strong>±${fmtSeconds(median(stats.devs))}&nbsp;s</strong> daneben – nochmal?`;
    }
    recordRound(deviationMs, prize && prize.tier);
    renderStats();
    renderStaff();

    const sign = elapsedMs >= TARGET_MS ? '+' : '−';
    resultDetail.innerHTML =
      `<span class="result-time">${fmtSeconds(elapsedMs)} s</span>` +
      `<span class="deviation">Abweichung ${sign}${fmtSeconds(deviationMs)} s</span>`;

    scheduleReset(RESULT_MS_PLAIN);
    if (rankedRound) {
      if (qualifies(deviationMs)) enterLeaderboard(elapsedMs, round);
      else showNote('Diesmal nicht in den Top 20 – Sofort-Preise gelten trotzdem.');
    }
  }

  function resetToIdle() {
    state = 'idle';
    clearTimeout(resultTimeout);
    stage.classList.remove('is-running', 'is-result');
    timerEl.style.display = '';
    timerEl.classList.remove('is-hidden');
    timerValue.textContent = '0.000';
    stageHint.hidden = false;
    stageHint.textContent = 'Buzzer drücken zum Start';
    donateBadge.hidden = false;
    setRankedNext(false);
    resultEl.hidden = true;
    claimEl.hidden = true;
    prizeBanner.hidden = true;
    resultHeadline.hidden = false;
  }

  function handleActivate() {
    if (state === 'idle') startRound();
    else if (state === 'visible' || state === 'hidden') stopRound();
    else if (state === 'result' && performance.now() - stoppedAt > BUZZ_LOCK_MS) resetToIdle();
  }

  stage.addEventListener('click', handleActivate);

  const INTERACTIVE_TAGS = ['INPUT', 'TEXTAREA', 'BUTTON', 'A', 'SELECT'];
  document.addEventListener('keydown', (e) => {
    // Taste R (nur Standpersonal, der Buzzer sendet Enter/Leertaste): nächste
    // Runde als Ranglisten-Runde markieren bzw. wieder zurücknehmen. Nur vor
    // dem Start, damit niemand nach einem guten Ergebnis umentscheidet.
    const active = document.activeElement;
    const typing = active && INTERACTIVE_TAGS.includes(active.tagName) && active !== stage;
    const plain = !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!typing && plain && (e.key === 'r' || e.key === 'R')) {
      if (state === 'idle' && HAS_BACKEND) setRankedNext(!rankedNext);
      return;
    }
    // Taste S: Personal-Anzeige (Zähler, Vorrat, Preisfenster). Nicht während
    // einer laufenden Runde, damit das Spiel nicht gestört wird.
    if (!typing && plain && (e.key === 's' || e.key === 'S')) {
      if (state === 'idle' || state === 'result') toggleStaff();
      return;
    }
    if (e.key === 'Escape' && !staffPanel.hidden) {
      toggleStaff(false);
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.repeat) return;
    if (typing) return;
    e.preventDefault();
    handleActivate();
  });

  // ---------- Personal-Anzeige (Taste S) ----------

  function renderStaff() {
    if (staffPanel.hidden) return;
    const n = stats.devs.length;
    const left1 = settings.kat1Stock - stats.kat1;
    const left2 = settings.kat2Stock - stats.kat2;
    staffSummary.innerHTML =
      `<li><strong>${n}</strong> Runden heute</li>` +
      `<li>Kat. 1: <strong>${stats.kat1}</strong> vergeben · <strong class="${left1 <= 2 ? 'low' : ''}">${left1}</strong> übrig` +
      `${n ? ` · ${((stats.kat1 / n) * 100).toFixed(1)}&nbsp;% der Runden` : ''}</li>` +
      `<li>Kat. 2: <strong>${stats.kat2}</strong> vergeben · <strong class="${left2 <= 5 ? 'low' : ''}">${left2}</strong> übrig` +
      `${n ? ` · ${((stats.kat2 / n) * 100).toFixed(1)}&nbsp;% der Runden` : ''}</li>`;
  }

  function toggleStaff(force) {
    const open = typeof force === 'boolean' ? force : staffPanel.hidden;
    staffPanel.hidden = !open;
    if (open) {
      for (const [k, v] of Object.entries(settings)) {
        const input = staffForm.elements[k];
        if (input) input.value = v;
      }
      clearTimeout(resultTimeout); // Ergebnis nicht wegspringen lassen, während das Personal schaut
      renderStaff();
    } else {
      if (document.activeElement && staffPanel.contains(document.activeElement)) document.activeElement.blur();
      if (state === 'result') scheduleReset(RESULT_MS_PLAIN);
      stage.focus();
    }
  }

  staffForm.addEventListener('submit', (e) => {
    e.preventDefault();
    for (const k of Object.keys(DEFAULTS)) {
      const v = Math.round(Number(staffForm.elements[k].value));
      if (Number.isFinite(v) && v >= 0) settings[k] = v;
    }
    if (settings.kat2Ms < settings.kat1Ms) settings.kat2Ms = settings.kat1Ms;
    saveJson(SETTINGS_KEY, settings);
    applyThresholdLabels();
    renderStats();
    toggleStaff(false);
  });
  document.getElementById('staff-close').addEventListener('click', () => toggleStaff(false));
  document.getElementById('staff-reset').addEventListener('click', () => {
    if (!confirm('Tagesstatistik und Zähler wirklich auf 0 setzen?')) return;
    stats = emptyStats();
    saveJson(STATS_KEY, stats);
    renderStats();
    renderStaff();
  });

  if (!HAS_BACKEND) {
    leaderboardEmpty.hidden = false;
    leaderboardEmpty.textContent = 'Testversion – die Rangliste ist hier nicht aktiv.';
    liveDot.style.display = 'none';
  }

  resetToIdle();
  updateLeaderboard();
})();
