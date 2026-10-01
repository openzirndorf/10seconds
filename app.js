(() => {
  const STORAGE_KEY = '10sekunden_leaderboard_v1';
  const LEADERBOARD_SIZE = 20;
  const TARGET_MS = 10000;

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
  const skipEntryBtn = document.getElementById('skip-entry');

  const openLeaderboardBtn = document.getElementById('open-leaderboard');
  const closeLeaderboardBtn = document.getElementById('close-leaderboard');
  const modalBackdrop = document.getElementById('modal-backdrop');
  const leaderboardList = document.getElementById('leaderboard-list');
  const leaderboardEmpty = document.getElementById('leaderboard-empty');

  let state = 'idle'; // idle | visible | hidden | result
  let startTime = 0;
  let revealTimeout = null;
  let rafId = null;
  let pendingEntry = null; // { elapsedMs, deviationMs }

  // ---------- Bestenliste (localStorage, pro Browser) ----------

  function loadLeaderboard() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveLeaderboard(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* z.B. privater Modus / Storage voll – Spiel bleibt trotzdem spielbar */
    }
  }

  function sortByDeviation(list) {
    return [...list].sort((a, b) => a.deviationMs - b.deviationMs);
  }

  function qualifies(deviationMs) {
    const list = sortByDeviation(loadLeaderboard());
    if (list.length < LEADERBOARD_SIZE) return true;
    return deviationMs < list[list.length - 1].deviationMs;
  }

  function addEntry(nickname, elapsedMs, deviationMs) {
    const entry = {
      nickname,
      elapsedMs: Math.round(elapsedMs * 1000) / 1000,
      deviationMs: Math.round(deviationMs * 1000) / 1000,
      date: new Date().toISOString(),
    };
    const list = sortByDeviation([...loadLeaderboard(), entry]).slice(0, LEADERBOARD_SIZE);
    saveLeaderboard(list);
    return { list, index: list.indexOf(entry) };
  }

  function fmtSeconds(ms) {
    return (ms / 1000).toFixed(3);
  }

  function renderLeaderboard(highlightIndex = -1) {
    const list = sortByDeviation(loadLeaderboard());
    leaderboardList.innerHTML = '';
    leaderboardEmpty.hidden = list.length > 0;
    list.forEach((entry, i) => {
      const li = document.createElement('li');
      if (i === highlightIndex) li.classList.add('is-new');
      const sign = entry.elapsedMs >= TARGET_MS ? '+' : '−';

      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = `${i + 1}.`;

      const nick = document.createElement('span');
      nick.className = 'lb-nick';
      nick.textContent = entry.nickname;

      const dev = document.createElement('span');
      dev.className = 'lb-dev';
      dev.textContent = `${sign}${fmtSeconds(entry.deviationMs)} s`;

      li.append(rank, nick, dev);
      leaderboardList.appendChild(li);
    });
  }

  function openLeaderboard(highlightIndex = -1) {
    renderLeaderboard(highlightIndex);
    modalBackdrop.hidden = false;
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

    if (qualifies(deviationMs)) {
      pendingEntry = { elapsedMs, deviationMs };
      entryForm.hidden = false;
      nicknameInput.value = '';
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

  entryForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!pendingEntry) return;
    const nickname = nicknameInput.value.trim().slice(0, 20) || 'Anonymer Waschbär';
    const { index } = addEntry(nickname, pendingEntry.elapsedMs, pendingEntry.deviationMs);
    pendingEntry = null;
    entryForm.hidden = true;
    openLeaderboard(index);
  });

  skipEntryBtn.addEventListener('click', () => {
    pendingEntry = null;
    entryForm.hidden = true;
  });

  resetToIdle();
  renderLeaderboard();
})();
