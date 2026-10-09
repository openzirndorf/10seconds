// Gemeinsames Eintrage-Formular (Nickname, optional Mail + Einwilligung) für
// die Handy-Seite (/e/<token>).
window.ClaimForm = (() => {
  const EMAIL_MAX_RANK = 20; // ganze Rangliste: dort landen nur Ranglisten-Runden (Erwachsene/mit Erwachsenen)

  const ICON_USER = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
  const ICON_MAIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>';

  function fmt(ms) {
    return (ms / 1000).toFixed(3).replace('.', ',');
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'hidden') node.hidden = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) node.append(c);
    return node;
  }

  function hero(rank, elapsedMs) {
    return el('div', { class: 'cf-hero' }, [
      el('span', { class: `cf-medal${rank <= 3 ? ` m${rank}` : ''}`, text: rank }),
      el('div', { class: 'cf-hero-body' }, [
        el('span', { class: 'cf-hero-label', text: `Platz ${rank} · dein Ergebnis` }),
        el('span', { class: 'cf-hero-time', text: `${fmt(elapsedMs)} s` }),
      ]),
    ]);
  }

  function field(id, label, icon, input, hint) {
    return el('div', { class: 'cf-field' }, [
      el('label', { for: id, text: label }),
      el('div', { class: 'cf-input' }, [el('span', { class: 'cf-icon', html: icon }), input]),
      hint ? el('p', { class: 'cf-hint', text: hint }) : '',
    ]);
  }

  /**
   * mount(container, { rank, elapsedMs, nickname, submitLabel, onSubmit })
   * onSubmit({ nickname, email, consent }) → Promise; wirft Error mit Text.
   */
  function mount(container, opts) {
    container.innerHTML = '';
    const withEmail = opts.rank <= EMAIL_MAX_RANK;
    const submitLabel = opts.submitLabel || 'Eintragen';

    const nick = el('input', {
      type: 'text', id: 'cf-nick', maxlength: '20', autocomplete: 'off',
      placeholder: opts.nickname || 'Dein Spitzname', enterkeyhint: withEmail ? 'next' : 'done',
    });
    const email = el('input', {
      type: 'email', id: 'cf-email', maxlength: '254', autocomplete: 'email',
      placeholder: 'name@beispiel.de', inputmode: 'email', enterkeyhint: 'done',
    });
    const consent = el('input', { type: 'checkbox', id: 'cf-consent' });
    const consentRow = el('label', { class: 'cf-check', for: 'cf-consent', hidden: true }, [
      consent,
      el('span', { class: 'cf-check-box', 'aria-hidden': 'true' }),
      el('span', {
        class: 'cf-check-text',
        html: 'Ich bin mindestens <strong>18 Jahre</strong> alt – oder trage als <strong>erwachsene Begleitperson</strong> meine Mail für ein Kind ein. ' +
          'Die Mail wird nur zur Gewinnbenachrichtigung genutzt. <a href="/teilnahme" target="_blank">Teilnahmebedingungen</a>',
      }),
    ]);
    email.addEventListener('input', () => { consentRow.hidden = !email.value.trim(); });

    const error = el('p', { class: 'cf-error', role: 'alert', hidden: true });
    const submit = el('button', { class: 'cf-submit', type: 'submit', text: submitLabel });

    const form = el('form', { class: 'cf', novalidate: '' }, [
      hero(opts.rank, opts.elapsedMs),
      field('cf-nick', 'Nickname', ICON_USER, nick, 'Erscheint öffentlich in der Rangliste – bitte keinen vollen echten Namen.'),
    ]);

    if (withEmail) {
      form.append(el('fieldset', { class: 'cf-prize', 'aria-labelledby': 'cf-prize-title' }, [
        el('div', { class: 'cf-prize-head' }, [
          el('span', { class: 'cf-prize-title', id: 'cf-prize-title', text: '🎁 Bei den Ranglisten-Preisen mitmachen' }),
          el('span', { class: 'cf-optional', text: 'optional' }),
        ]),
        el('p', { class: 'cf-prize-text', text: 'Liegst du bei Aktionsende vorne, melden wir uns per Mail. Jede Mail nimmt nur einmal teil – es zählt dein bestes Ergebnis.' }),
        field('cf-email', 'E-Mail-Adresse', ICON_MAIL, email, 'Wird nirgends angezeigt. Für Kinder bitte die Mail einer erwachsenen Begleitperson.'),
        consentRow,
      ]));
    } else {
      form.append(el('p', { class: 'cf-note', text: `🎁 Mail für die Ranglisten-Preise gibt es ab Platz ${EMAIL_MAX_RANK} – nochmal spielen lohnt sich!` }));
    }
    form.append(error, submit);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      const data = {
        nickname: nick.value.trim(),
        email: withEmail ? email.value.trim() : '',
        consent: withEmail && consent.checked,
      };
      if (data.email && !data.consent) {
        error.textContent = 'Bitte das Häkchen setzen – oder die Mail leer lassen.';
        error.hidden = false;
        consentRow.classList.add('is-missing');
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Speichert …';
      try {
        await opts.onSubmit(data);
      } catch (err) {
        error.textContent = err.message || 'Hat nicht geklappt, bitte nochmal versuchen.';
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = submitLabel;
      }
    });
    consent.addEventListener('change', () => consentRow.classList.remove('is-missing'));

    container.append(form);
    return { focus: () => nick.focus() };
  }

  /** Erfolgsansicht nach dem Eintragen. */
  function renderDone(container, { rank, nickname, withEmail }) {
    container.innerHTML = '';
    container.append(el('div', { class: 'cf-done' }, [
      el('div', { class: 'cf-done-icon', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' }),
      el('h2', { text: 'Du bist eingetragen!' }),
      el('p', { class: 'cf-done-name', text: nickname || 'Dein Ergebnis' }),
      el('p', { class: 'cf-done-rank', text: `steht jetzt auf Platz ${rank}` }),
      el('p', {
        class: 'cf-done-text',
        text: withEmail
          ? 'Deine Mail ist für die Ranglisten-Preise gespeichert. Viel Glück!'
          : 'Schau auf den großen Bildschirm – gleich bist du in der Rangliste.',
      }),
    ]));
  }

  async function postJson(url, body, headers = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = data && (typeof data.detail === 'string' ? data.detail : data.detail?.[0]?.msg);
      throw new Error((detail || `Fehler ${res.status}`).replace(/^Value error, /, ''));
    }
    return data;
  }

  return { mount, renderDone, postJson, fmt };
})();
