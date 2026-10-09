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

  function renderTable(tbody, emptyEl, list, editable = false) {
    tbody.innerHTML = '';
    emptyEl.hidden = list.length > 0;
    for (const entry of list) {
      const tr = document.createElement('tr');
      if (entry.rank <= 3) tr.className = `rank-${entry.rank}`;

      const rank = document.createElement('td');
      rank.className = 'rank';
      rank.textContent = `${entry.rank}.`;

      const code = document.createElement('td');
      code.className = 'code';
      code.textContent = entry.code || '—';

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
      if (editable) {
        email.append(mailForm(entry));
      } else {
        email.textContent = entry.email || '—';
      }

      tr.append(rank, code, nick, time, dev, email);
      if (editable) {
        const actions = document.createElement('td');
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-danger btn-small';
        del.textContent = 'Entfernen';
        del.addEventListener('click', () => removeEntry(entry));
        actions.append(del);
        tr.append(actions);
      }
      tbody.appendChild(tr);
    }
  }

  // Mail von einem Papier-Zettel eintragen (oder mit leerem Feld wieder entfernen).
  function mailForm(entry) {
    const form = document.createElement('form');
    form.className = 'mail-form';
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'email';
    input.autocomplete = 'off';
    input.placeholder = 'Mail vom Zettel';
    input.value = entry.email || '';
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn btn-primary';
    save.textContent = 'Speichern';
    const msg = document.createElement('span');
    msg.className = 'row-msg';
    form.append(input, save);
    const wrap = document.createElement('div');
    wrap.append(form, msg);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      msg.className = 'row-msg';
      msg.textContent = '';
      try {
        await authedFetch(`/api/admin/entries/${entry.id}/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: input.value.trim() }),
        });
        await loadAll();
      } catch (err) {
        if (err.message === 'unauthorized') return;
        msg.className = 'row-msg error';
        msg.textContent = err.message;
        save.disabled = false;
      }
    });
    return wrap;
  }

  async function removeEntry(entry) {
    if (!confirm(`Eintrag „${entry.nickname}“ (${fmt(entry.elapsed_ms)} s) aus der Rangliste entfernen?`)) return;
    try {
      await authedFetch(`/api/admin/entries/${entry.id}`, { method: 'DELETE' });
      await loadAll();
    } catch (err) {
      if (err.message !== 'unauthorized') alert(err.message);
    }
  }

  async function authedFetch(path, options = {}) {
    const password = sessionStorage.getItem(SESSION_KEY);
    const res = await fetch(path, {
      ...options,
      headers: { ...(options.headers || {}), 'X-Admin-Password': password || '' },
    });
    if (res.status === 401 || res.status === 404) {
      sessionStorage.removeItem(SESSION_KEY);
      showLogin(res.status === 404 ? 'Admin-Zugang ist serverseitig nicht konfiguriert.' : 'Falsches Passwort.');
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const detail = data && (typeof data.detail === 'string' ? data.detail : data.detail?.[0]?.msg);
      throw new Error((detail || `HTTP ${res.status}`).replace(/^Value error, /, ''));
    }
    return res.status === 204 ? null : res.json();
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
      renderTable(allRows, allEmpty, entries, true);
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
