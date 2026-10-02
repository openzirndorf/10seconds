(() => {
  // Vor dem Deploy anpassen: URL des gehosteten Backends (siehe backend/README
  // bzw. backend/Dockerfile). localhost:8000 ist nur für die lokale Entwicklung.
  const API_BASE = window.API_BASE || 'http://localhost:8000';

  const TARGET_MS = 10000;
  const EMAIL_PROMPT_RANK = 10; // ab diesem Rang wird zusätzlich die Mail gefragt

  // Preisfenster (Abweichung von 10,000 s) — Hauptpreis selten, Trostpreis mittel.
  const HAUPTPREIS_MS = 50;
  const TROSTPREIS_MS = 400;

  const stage = document.getElementById('stage');
  const timerEl = document.getElementById('timer');
  const timerValue = document.getElementById('timer-value');
  const stageHint = document.getElementById('stage-hint');
  const resultEl = document.getElementById('result');
  const resultHeadline = document.getElementById('result-headline');
  const resultDetail = document.getElementById('result-detail');
  const prizeBanner = document.getElementById('prize-banner');
  const prizeLabel = document.getElementById('prize-label');
  const entryForm = document.getElementById('entry-form');
  const nicknameInput = document.getElementById('nickname');
  const emailRow = document.getElementById('email-row');
  const emailInput = document.getElementById('email');
  const entryError = document.getElementById('entry-error');
  const skipEntryBtn = document.getElementById('skip-entry');

  const openLeaderboardBtn = document.getElementById('open-leaderboard');
  const closeLeaderboardBtn = document.getElementById('close-leaderboard');
  const modalBackdrop = document.getElementById('modal-backdrop');
  const leaderboardList = document.getElementById('leaderboard-list');
  const leaderboardEmpty = document.getElementById('leaderboard-empty');
  const leaderboardError = document.getElementById('leaderboard-error');

  let state = 'idle'; // idle | visible | hidden | result
  let startTime = 0;
  let revealTimeout = null;
  let rafId = null;
  let pendingEntry = null; // { elapsedMs, deviationMs }
  let cachedLeaderboard = []; // zuletzt vom Server geladene, sortierte Liste

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

  function estimateRank(deviationMs) {
    let rank = 1;
    for (const entry of cachedLeaderboard) {
      if (entry.deviation_ms <= deviationMs) rank++;
      else break;
    }
    return rank;
  }

  async function submitScore(nickname, email, elapsedMs) {
    const res = await fetch(`${API_BASE}/api/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, email, elapsed_ms: elapsedMs }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = body && (body.detail || (Array.isArray(body) && body[0]?.msg));
      throw new Error(detail || `HTTP ${res.status}`);
    }
    return body; // { qualified, rank, leaderboard }
  }

  function fmtSeconds(ms) {
    return (ms / 1000).toFixed(3);
  }

  function renderLeaderboard(list, highlightRank = -1) {
    leaderboardList.innerHTML = '';
    leaderboardEmpty.hidden = list.length > 0;
    list.forEach((entry) => {
      const li = document.createElement('li');
      if (entry.rank === highlightRank) li.classList.add('is-new');
      const sign = entry.elapsed_ms >= TARGET_MS ? '+' : '−';

      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = `${entry.rank}.`;

      const nick = document.createElement('span');
      nick.className = 'lb-nick';
      nick.textContent = entry.nickname;

      const dev = document.createElement('span');
      dev.className = 'lb-dev';
      dev.textContent = `${sign}${fmtSeconds(entry.deviation_ms)} s`;

      li.append(rank, nick, dev);
      leaderboardList.appendChild(li);
    });
  }

  async function openLeaderboard(highlightRank = -1) {
    modalBackdrop.hidden = false;
    leaderboardError.hidden = true;
    const ok = await refreshLeaderboard();
    if (ok) {
      renderLeaderboard(cachedLeaderboard, highlightRank);
    } else {
      leaderboardError.hidden = false;
    }
  }

  function closeLeaderboard() {
    modalBackdrop.hidden = true;
  }

  openLeaderboardBtn.addEventListener('click', () => openLeaderboard());
  closeLeaderboardBtn.addEventListener('click', closeLeaderboard);
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeLeaderboard();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalBackdrop.hidden) closeLeaderboard();
  });

  // ---------- Spiel-Logik ----------

  // Preisstufen haben Vorrang vor der reinen Gefühls-Bewertung (siehe prizeFor).
  function ratingFor(deviationMs) {
    if (deviationMs <= 1000) return '🙂 Ordentlich nah dran.';
    if (deviationMs <= 2500) return '🤔 Ausbaufähig – der Waschbär schnuppert nochmal.';
    return '😅 Weit daneben geschnüffelt – nochmal versuchen!';
  }

  function prizeFor(deviationMs) {
    if (deviationMs <= HAUPTPREIS_MS) return { tier: 'haupt', label: '🏆 Hauptpreis gewonnen!' };
    if (deviationMs <= TROSTPREIS_MS) return { tier: 'trost', label: '🎖️ Trostpreis gewonnen!' };
    return null;
  }

  function tick() {
    const elapsed = performance.now() - startTime;
    timerValue.textContent = fmtSeconds(elapsed);
    rafId = requestAnimationFrame(tick);
  }

  function startRound() {
    state = 'visible';
    startTime = performance.now();

    // Zufällige, nicht-runde Wobbel-Dauer pro Runde, damit der Waschbär nicht
    // als heimlicher Sekundentakt zum Mitzählen missbraucht werden kann.
    const sniffDuration = (0.7 + Math.random() * 0.9).toFixed(2);
    stage.style.setProperty('--sniff-duration', `${sniffDuration}s`);

    stage.classList.add('is-running');
    stage.classList.remove('is-result');
    timerEl.style.display = '';
    timerEl.classList.remove('is-hidden');
    resultEl.hidden = true;
    entryForm.hidden = true;
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

    stage.classList.remove('is-running');
    stage.classList.add('is-result');
    timerEl.style.display = 'none';
    stageHint.hidden = true;

    const deviationMs = Math.abs(elapsedMs - TARGET_MS);
    resultEl.hidden = false;

    const prize = prizeFor(deviationMs);
    if (prize) {
      prizeBanner.hidden = false;
      prizeBanner.className = `prize-banner prize-${prize.tier}`;
      prizeLabel.textContent = prize.label;
      resultHeadline.hidden = true;
      resultHeadline.textContent = '';
    } else {
      prizeBanner.hidden = true;
      resultHeadline.hidden = false;
      resultHeadline.textContent = ratingFor(deviationMs);
    }

    const sign = elapsedMs >= TARGET_MS ? '+' : '−';
    resultDetail.innerHTML =
      `Deine Zeit: <strong>${fmtSeconds(elapsedMs)} s</strong> · ` +
      `Abweichung: <span class="deviation">${sign}${fmtSeconds(deviationMs)} s</span>`;

    entryError.hidden = true;
    if (qualifies(deviationMs)) {
      pendingEntry = { elapsedMs, deviationMs };
      entryForm.hidden = false;
      nicknameInput.value = '';
      emailInput.value = '';
      emailRow.hidden = estimateRank(deviationMs) > EMAIL_PROMPT_RANK;
      setTimeout(() => nicknameInput.focus(), 50);
    } else {
      pendingEntry = null;
      entryForm.hidden = true;
    }
  }

  function resetToIdle() {
    state = 'idle';
    stage.classList.remove('is-running', 'is-result');
    timerEl.style.display = '';
    timerEl.classList.remove('is-hidden');
    timerValue.textContent = '0.000';
    stageHint.hidden = false;
    stageHint.textContent = 'Enter oder Klick zum Start';
    resultEl.hidden = true;
    entryForm.hidden = true;
    prizeBanner.hidden = true;
    resultHeadline.hidden = false;
    pendingEntry = null;
  }

  function handleActivate() {
    if (!modalBackdrop.hidden) return;
    if (state === 'idle') startRound();
    else if (state === 'visible' || state === 'hidden') stopRound();
    else if (state === 'result') resetToIdle();
  }

  stage.addEventListener('click', (e) => {
    if (e.target.closest('#entry-form')) return;
    handleActivate();
  });

  const INTERACTIVE_TAGS = ['INPUT', 'TEXTAREA', 'BUTTON', 'A', 'SELECT'];
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (!modalBackdrop.hidden) return;
    const active = document.activeElement;
    if (active && INTERACTIVE_TAGS.includes(active.tagName) && active !== stage) return;
    e.preventDefault();
    handleActivate();
  });

  entryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pendingEntry) return;
    const nickname = nicknameInput.value.trim().slice(0, 20);
    const email = emailRow.hidden ? '' : emailInput.value.trim().slice(0, 254);

    const submitBtn = entryForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    entryError.hidden = true;
    try {
      const result = await submitScore(nickname, email, pendingEntry.elapsedMs);
      pendingEntry = null;
      entryForm.hidden = true;
      if (result.qualified) {
        cachedLeaderboard = result.leaderboard;
        modalBackdrop.hidden = false;
        leaderboardError.hidden = true;
        renderLeaderboard(cachedLeaderboard, result.rank);
      } else {
        resultDetail.insertAdjacentHTML(
          'beforeend',
          '<br><span class="muted-note">Knapp kein Top-20-Platz mehr – in der Zwischenzeit überboten.</span>'
        );
      }
    } catch (err) {
      entryError.hidden = false;
      entryError.textContent = err.message || 'Eintragen hat nicht geklappt, bitte nochmal versuchen.';
    } finally {
      submitBtn.disabled = false;
    }
  });

  skipEntryBtn.addEventListener('click', () => {
    pendingEntry = null;
    entryForm.hidden = true;
  });

  resetToIdle();
  refreshLeaderboard();
})();
