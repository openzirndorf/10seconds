(() => {
  const POLL_MS = 4000;
  const rows = document.getElementById('rows');
  const empty = document.getElementById('empty');
  const updated = document.getElementById('updated');

  function fmt(ms) {
    return (ms / 1000).toFixed(3);
  }

  async function refresh() {
    try {
      const res = await fetch('/api/leaderboard', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();

      rows.innerHTML = '';
      empty.hidden = list.length > 0;

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

        tr.append(rank, nick, time, dev);
        rows.appendChild(tr);
      }

      updated.textContent = `Stand: ${new Date().toLocaleTimeString('de-DE')} · aktualisiert alle ${POLL_MS / 1000}s`;
    } catch {
      updated.textContent = 'Verbindung zum Server unterbrochen – versuche es weiter …';
    }
  }

  refresh();
  setInterval(refresh, POLL_MS);
})();
