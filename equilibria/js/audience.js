// Live audience vote: judges scan a QR code, become occupants of an over-cooled building and vote on how they
// feel and whether they'd trade 25.5°C + a fan for a carbon cut. Votes travel through ntfy.sh (free public
// pub/sub, no account) on a random per-session topic, so no backend is needed. A simulator covers venues
// where phones can't reach the vote page.

const Audience = (() => {
  const TARGET = 1; // Quayside Exchange: the over-cooled office the audience votes on
  const RELAY = 'https://ntfy.sh';
  const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
  const FEELINGS = { cold: '❄ Too cold', ok: '🙂 Just right', warm: '🔥 Too warm', stuffy: '😮‍💨 Stuffy' };
  const voters = new Map();
  let topic = null, source = null, connected = false, qrLoaded = null, simSeq = 0;

  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };

  function sessionTopic() {
    if (!topic) {
      topic = store.get('eq-audience-topic');
      if (!topic) {
        topic = `equilibria-${Math.random().toString(36).slice(2, 10)}`;
        store.set('eq-audience-topic', topic);
      }
    }
    return topic;
  }

  // Phones can reach the vote page only when the dashboard is served over the network (node serve.js)
  function voteBase() {
    const lan = location.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(location.hostname);
    return lan ? new URL('vote.html', location.href).href : store.get('eq-vote-url') || '';
  }

  const tempSaving = () => BASELINE[TARGET].carbon - CACHE[TARGET][actionBit('temp')].carbon;

  function voteLink() {
    const base = voteBase();
    if (!base) return '';
    const u = new URL(base);
    u.searchParams.set('s', sessionTopic());
    u.searchParams.set('b', BUILDINGS[TARGET].name);
    u.searchParams.set('t', BASELINE[TARGET].ta);
    u.searchParams.set('save', Math.round(tempSaving()));
    return u.href;
  }

  function connect() {
    if (source) return;
    source = new EventSource(`${RELAY}/${sessionTopic()}/sse`);
    source.onopen = () => { connected = true; render(); };
    source.onerror = () => { connected = false; render(); };
    source.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.event === 'message') record(JSON.parse(msg.message));
      } catch (e) { /* ignore malformed messages on the public topic */ }
    };
  }

  function record(v) {
    if (!v || typeof v.id !== 'string' || v.id.length > 40) return;
    const prev = voters.get(v.id) || {};
    voters.set(v.id, {
      feel: FEELINGS[v.feel] ? v.feel : prev.feel,
      accept: typeof v.accept === 'boolean' ? v.accept : prev.accept,
    });
    render();
  }

  function simulate(n) {
    const pmv = cur(TARGET).pmv;
    for (let k = 0; k < n; k++) {
      const r = Math.random();
      const feel = pmv < -0.5 ? (r < 0.58 ? 'cold' : r < 0.85 ? 'ok' : r < 0.95 ? 'stuffy' : 'warm') : (r < 0.15 ? 'cold' : r < 0.75 ? 'ok' : r < 0.9 ? 'stuffy' : 'warm');
      record({ id: `sim-${++simSeq}`, feel, accept: Math.random() < (feel === 'cold' ? 0.85 : 0.5) });
    }
  }

  function tally() {
    const all = [...voters.values()];
    const counts = Object.fromEntries(Object.keys(FEELINGS).map(f => [f, all.filter(v => v.feel === f).length]));
    const felt = all.filter(v => v.feel).length;
    const yes = all.filter(v => v.accept === true).length, no = all.filter(v => v.accept === false).length;
    return { total: all.length, felt, counts, yes, no, uncomfortable: felt ? ((felt - counts.ok) / felt) * 100 : 0 };
  }

  function loadQr() {
    if (!qrLoaded) {
      qrLoaded = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = QR_LIB;
        s.onload = resolve;
        s.onerror = () => reject(new Error('QR library failed to load'));
        document.head.appendChild(s);
      });
    }
    return qrLoaded;
  }

  async function drawQr() {
    const box = $('#audQr'), link = voteLink();
    if (!box) return;
    if (!link) {
      box.innerHTML = `<div class="aud-noqr"><b>Phones can't reach this page yet.</b>
        <p>In the <code>equilibria</code> folder run <code>node serve.js</code>, then open the dashboard from the <b>Network</b> address it prints. The QR code will then point phones at your laptop (same Wi-Fi).</p>
        <p>Or paste the URL of a hosted <code>vote.html</code>:</p>
        <form id="audUrlForm" class="ai-key"><input id="audUrl" placeholder="https://…/vote.html"><button class="btn sm">Use</button></form>
        <p>No network? Use <b>Simulate judges</b>.</p></div>`;
      $('#audUrlForm').addEventListener('submit', ev => { ev.preventDefault(); store.set('eq-vote-url', $('#audUrl').value.trim()); drawQr(); });
      return;
    }
    try {
      await loadQr();
      box.innerHTML = '<div class="aud-qr-img"></div>';
      new QRCode(box.firstChild, { text: link, width: 220, height: 220, colorDark: '#000000', colorLight: '#ffffff' });
      box.insertAdjacentHTML('beforeend', `<a class="aud-link" href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(link.replace(/^https?:\/\//, '').split('?')[0])}</a>`);
    } catch (err) {
      box.innerHTML = `<p class="bad-txt">${escapeHtml(err.message)}</p><a class="aud-link" href="${escapeHtml(link)}" target="_blank">${escapeHtml(link)}</a>`;
    }
  }

  function render() {
    const el = $('#audLive');
    if (!el) return;
    const t = tally(), b = BUILDINGS[TARGET], e = BASELINE[TARGET];
    const applied = !!(state.plan[TARGET] & actionBit('temp'));
    const bar = (n, of, cls) => `<div class="aud-bar"><i class="${cls}" style="width:${of ? (n / of) * 100 : 0}%"></i></div>`;
    const accepted = t.yes + t.no ? t.yes / (t.yes + t.no) : 0;
    el.innerHTML = `
      <div class="aud-status"><i class="${connected ? 'on' : ''}"></i>${connected ? 'Live relay connected' : 'Connecting to relay…'} · <b>${t.total}</b> ${t.total === 1 ? 'person has' : 'people have'} voted</div>
      <h4>How does ${b.name} feel?</h4>
      ${Object.entries(FEELINGS).map(([k, label]) => `<div class="aud-row"><span>${label}</span>${bar(t.counts[k], t.felt, k)}<b>${t.counts[k]}</b></div>`).join('')}
      <div class="aud-compare">
        <div><span>Model predicted</span><b>${Math.round(e.ppd)}%</b><em>uncomfortable (ISO 7730)</em></div>
        <div><span>Audience says</span><b>${t.felt ? Math.round(t.uncomfortable) : '–'}%</b><em>uncomfortable</em></div>
      </div>
      <h4>Accept 25.5°C + a quiet fan to cut ${fmt.int(tempSaving())} tCO₂/yr?</h4>
      <div class="aud-row"><span>Yes</span>${bar(t.yes, t.yes + t.no, 'yes')}<b>${t.yes}</b></div>
      <div class="aud-row"><span>No</span>${bar(t.no, t.yes + t.no, 'no')}<b>${t.no}</b></div>
      <p class="aud-insight">${t.yes + t.no ? `<b>${Math.round(accepted * 100)}%</b> accept the trade, so this room has unlocked about <b>${fmt.int(tempSaving() * accepted)} tCO₂/yr</b> of <span data-term="comfortflex" class="term-word">comfort flexibility</span>, carbon that only exists because people said yes.` : 'Waiting for votes…'}</p>
      <div class="chat-actions">
        <button class="btn" id="audApply" ${applied || t.yes <= t.no || t.yes < 2 ? 'disabled' : ''}>${applied ? '✓ Audience decision applied' : '⚡ Apply the audience\'s decision'}</button>
        <button class="btn ghost sm" id="audSim">+ Simulate 10 judges</button>
        <button class="btn ghost sm" id="audReset">Reset votes</button>
      </div>`;
    $('#audApply').addEventListener('click', () => {
      state.plan[TARGET] |= actionBit('temp');
      refreshAll();
      toast(`The audience decided: ${b.name} moves to 25.5°C with fans`);
      closeXp();
      select(TARGET);
    });
    $('#audSim').addEventListener('click', () => simulate(10));
    $('#audReset').addEventListener('click', () => { voters.clear(); render(); });
  }

  function open() {
    connect();
    const b = BUILDINGS[TARGET];
    openXp('01 / Live audience vote', `
      <div class="aud">
        <div class="aud-left">
          <span class="sec-no">SCAN TO BECOME AN OCCUPANT</span>
          <h2>You are inside ${b.name}</h2>
          <p class="muted">It's ${BASELINE[TARGET].ta}°C. Tell the building how you feel, and whether you'd trade a little warmth for a lot less carbon.</p>
          <div id="audQr" class="aud-qr"></div>
          <p class="tiny">Session ${escapeHtml(sessionTopic().replace('equilibria-', ''))} · votes are anonymous and relayed via ntfy.sh</p>
        </div>
        <div class="aud-right" id="audLive"></div>
      </div>`);
    drawQr();
    render();
  }

  return { open, simulate };
})();
