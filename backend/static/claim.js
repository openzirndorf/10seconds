(() => {
  const token = decodeURIComponent(location.pathname.split('/').pop() || '');
  const lead = document.getElementById('lead');
  const box = document.getElementById('box');

  function done(rank, body) {
    lead.hidden = true;
    ClaimForm.renderDone(box, { rank, nickname: body.nickname, withEmail: !!body.email });
    const again = document.createElement('button');
    again.className = 'cf-secondary';
    again.type = 'button';
    again.textContent = 'Nochmal ändern';
    again.addEventListener('click', load);
    box.append(again);
  }

  async function load() {
    lead.hidden = false;
    try {
      const res = await fetch(`/api/claim/${encodeURIComponent(token)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.detail) || `Fehler ${res.status}`);
      lead.textContent = 'Super gespielt! Gib dir einen Nickname – die Rangliste am Stand aktualisiert sich gleich.';
      ClaimForm.mount(box, {
        rank: data.rank,
        elapsedMs: data.elapsed_ms,
        nickname: data.nickname,
        onSubmit: async (body) => {
          const out = await ClaimForm.postJson(`/api/claim/${encodeURIComponent(token)}`, body);
          done(out.rank, body);
        },
      });
    } catch (err) {
      lead.textContent = err.message;
      box.hidden = true;
    }
  }

  load();
})();
