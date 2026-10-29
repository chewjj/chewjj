// "Talk to the building": the selected building speaks in the first person about its own data.
// Voiced by Claude (with the portfolio tools) when connected; otherwise an offline voice built from the models.

const Talk = (() => {
  const QUESTIONS = ['How are you feeling today?', 'Why do people complain about you?', 'Do you have a mould problem?',
    'What if we set you to 22°C?', 'What would it take to get you on the 1.5°C pathway?'];
  let idx = 0, busy = false;

  const log = () => $('#talkLog');
  const scroll = () => { if (log()) log().scrollTop = log().scrollHeight; };

  function line(who, html) {
    const div = document.createElement('div');
    if (!log()) return div; // modal closed while a reply was still arriving
    div.className = `msg ${who}`;
    div.innerHTML = html;
    log().appendChild(div);
    scroll();
    return div;
  }

  // ---------- offline voice ----------

  function intro(i) {
    const b = BUILDINGS[i], e = cur(i), age = new Date().getFullYear() - b.built;
    const strand = e.strand === null ? 'I am on track with my 1.5°C carbon pathway beyond 2050'
      : e.strand <= 2025 ? 'I am <b>already over my 1.5°C carbon budget</b>' : `I will be <b>over my 1.5°C carbon budget by ${e.strand}</b>`;
    const feel = e.pmv < -0.5 ? `my people are cold. I run at ${e.ta}°C and about <b>${Math.round(e.ppd)}%</b> of them are uncomfortable. Some keep jackets at their desks.`
      : e.pmv > 0.5 ? `it is warm inside me (${e.ta}°C) and about ${Math.round(e.ppd)}% of my people are uncomfortable.`
        : `my people are mostly comfortable at ${e.ta}°C.`;
    const air = e.co2 > 1000 ? ` By mid-afternoon my meeting rooms reach <b>${fmt.int(e.co2)} ppm</b> of CO₂, and people get drowsy.` : '';
    const mould = ['high', 'elevated'].includes(e.mould.level) ? ` Honestly, my coldest ducts sit below the outdoor dew point, so my mould risk is <b>${e.mould.level}</b>.` : '';
    return `<p>Hi. I'm <b>${b.name}</b>, ${age} years old, ${fmt.int(b.gfa)} m² in ${b.area}. ${strand}, and I emit ${fmt.int(e.carbon)} tonnes of CO₂ a year.</p>
      <p>Right now ${feel}${air}${mould}</p><p>Ask me anything.</p>`;
  }

  function offlineAnswer(i, text) {
    const b = BUILDINGS[i], e = cur(i), t = text.toLowerCase();
    if (/feel|how are you|doing|mood/.test(t)) return intro(i);
    if (/complain|comfort|cold|hot|warm|people|unhappy/.test(t) && !/\d{2}/.test(t)) {
      return `<p>Because ${e.pmv < -0.3 ? `I'm too cold: PMV ${e.pmv.toFixed(2)} at ${e.ta}°C, so <b>${Math.round(e.ppd)}%</b> of my people feel uncomfortable` : `my comfort is fine (PMV ${e.pmv.toFixed(2)})`}.
        ${e.co2 > 1000 ? `My air gets stale too (${fmt.int(e.co2)} ppm CO₂ in busy rooms).` : ''} Only <b>${Math.round(e.pulse)}%</b> say they're satisfied in the QR pulse survey.</p>
        <p>${b.allowed & actionBit('temp') && !(e.mask & actionBit('temp')) ? 'Raise me to 25.5°C with quiet fans. It feels better and cuts about 12% of my energy.' : 'Better ventilation control would help my people most.'}</p>`;
    }
    if (/pathway|net zero|1\.5|strand|what would it take|carbon budget/.test(t)) {
      const pkg = Negotiation.bestPackage(i), p = CACHE[i][pkg];
      const names = ACTIONS.filter((a, k) => pkg & (1 << k)).map(a => a.name);
      return `<p>Give me ${names.join(', ')}. That's about <b>${fmt.money(p.capex)}</b>.</p>
        <p>It would cut me from ${fmt.int(BASELINE[i].carbon)} to <b>${fmt.int(p.carbon)} tCO₂</b> a year and move my stranding year from ${strandLabel(BASELINE[i].strand)} to <b>${strandLabel(p.strand)}</b>,
        while my People Score goes from ${BASELINE[i].people.toFixed(0)} to <b>${p.people.toFixed(0)}</b>. Want to negotiate it with my tenants? Try the green-lease negotiation.</p>`;
    }
    return `<p>Here's what my sensors and models say:</p>${Copilot.ask(`${text} ${b.name}`)}`;
  }

  // ---------- conversation ----------

  async function ask(text) {
    if (!text.trim() || busy) return;
    line('user', escapeHtml(text));
    if (!AI.enabled()) {
      const box = line('bot', `${TYPING}`);
      setTimeout(() => { box.innerHTML = offlineAnswer(idx, text); scroll(); }, 500);
      return;
    }
    busy = true;
    $('#talkForm button').disabled = true;
    await streamClaude(line('bot ai', ''), ui => AI.askBuilding(idx, text, ui), scroll);
    busy = false;
    if ($('#talkForm button')) $('#talkForm button').disabled = false;
  }

  function open(i = state.selected) {
    idx = i;
    const b = BUILDINGS[i], e = cur(i);
    const body = openXp(`02 / Talk to the building`, `
      <div class="talk-head">
        <div class="talk-avatar strand-${strandClass(e.strand)}"><b>${b.id}</b><span>${b.built}</span></div>
        <div><h3>${b.name}</h3>
          <p class="muted">${b.type} · ${b.area} · ${fmt.int(b.gfa)} m² · ${AI.enabled() ? 'voiced by Claude Opus 5.5 using its own live data' : 'offline voice from the models (connect Claude in the Copilot tab for open conversation)'}</p></div>
      </div>
      <div class="chat talk-log" id="talkLog"></div>
      <div class="chips">${QUESTIONS.map(q => `<button class="suggestion talk-q">${q}</button>`).join('')}</div>
      <form class="chat-form" id="talkForm"><input id="talkInput" autocomplete="off" placeholder="> Ask ${b.name} anything_"><button class="btn">Ask</button></form>`);
    line('bot', intro(i));
    body.querySelector('#talkForm').addEventListener('submit', ev => {
      ev.preventDefault();
      const v = $('#talkInput').value;
      $('#talkInput').value = '';
      ask(v);
    });
    body.querySelectorAll('.talk-q').forEach(q => q.addEventListener('click', () => ask(q.textContent)));
    $('#talkInput').focus();
  }

  return { open };
})();
