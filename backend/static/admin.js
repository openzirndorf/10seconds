(() => {
  const SESSION_KEY = 'admin_password'; // nur sessionStorage: weg beim Tab-Schließen

  const loginView = document.getElementById('login-view');
  const adminView = document.getElementById('admin-view');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const loginError = document.getElementById('login-error');
  const refreshBtn = document.getElementById('refresh-btn');
  const logoutBtn = document.getElementById('logout-btn');

  const poolRows = document.getElementById('pool-rows');
  const poolEmpty = document.getElementById('pool-empty');
  const poolSize = document.getElementById('pool-size');
  const allRows = document.getElementById('all-rows');
  const allEmpty = document.getElementById('all-empty');

  function fmt(ms) {
    return (ms / 1000).toFixed(3);
  }

  function renderTable(tbody, emptyEl, list) {
    tbody.innerHTML = '';
    emptyEl.hidden = list.length > 0;
    for (const entry of list) {
      const tr = document.createElement('tr');
      if (entry.rank <= 3) tr.className = `rank-${entry.rank}`;

      const rank = document.createElement('td');
      rank.className = 'rank';
      rank.textContent = `${entry.rank}.`;

      const nick = document.createElement('td');
      nick.textContent = entry.nickname;

      const time = document.createElement('td');
      time.className = 'time';
      time.textContent = `${fmt(entry.elapsed_ms)} s`;

      const dev = document.createElement('td');
      dev.className = 'dev';
      const sign = entry.elapsed_ms >= 10000 ? '+' : '−';
      dev.textContent = `${sign}${fmt(entry.deviation_ms)} s`;

      const email = document.createElement('td');
      email.textContent = entry.email || '—';

      tr.append(rank, nick, time, dev, email);
      tbody.appendChild(tr);
    }
  }

  async function authedFetch(path) {
    const password = sessionStorage.getItem(SESSION_KEY);
    const res = await fetch(path, { headers: { 'X-Admin-Password': password || '' } });
    if (res.status === 401 || res.status === 404) {
      sessionStorage.removeItem(SESSION_KEY);
      showLogin(res.status === 404 ? 'Admin-Zugang ist serverseitig nicht konfiguriert.' : 'Falsches Passwort.');
      throw new Error('unauthorized');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function showLogin(error) {
    loginView.hidden = false;
    adminView.hidden = true;
    loginError.hidden = !error;
    loginError.textContent = error || '';
  }

  function showAdmin() {
    loginView.hidden = true;
    adminView.hidden = false;
  }

  async function loadAll() {
    try {
      const [pool, entries] = await Promise.all([
        authedFetch('/api/admin/raffle-pool'),
        authedFetch('/api/admin/entries'),
      ]);
      poolSize.textContent = pool.length;
      renderTable(poolRows, poolEmpty, pool);
      renderTable(allRows, allEmpty, entries);
      showAdmin();
    } catch {
      /* showLogin wurde bereits von authedFetch aufgerufen, falls das der Grund war */
    }
  }

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sessionStorage.setItem(SESSION_KEY, passwordInput.value);
    passwordInput.value = '';
    loadAll();
  });

  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    showLogin();
  });

  refreshBtn.addEventListener('click', loadAll);

  if (sessionStorage.getItem(SESSION_KEY)) {
    loadAll();
  } else {
    showLogin();
  }
})();
