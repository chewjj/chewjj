// "A day in 2035": the same Tuesday in the selected building, in two futures, told visually.
// Future A: nothing done in 2026. Future B: the retrofit package. Comfort, air, mould, cost and CRREM figures
// come from the models; the carbon price, valuation discount and asset values are stated illustrative assumptions.

const Story = (() => {
  const YEAR = 2035;
  const CARBON_PRICE = 80;      // S$/tCO2e, illustrative; Singapore's carbon tax is legislated to reach S$50-80 by 2030
  const BROWN_DISCOUNT = 0.12;  // illustrative maximum valuation discount for an asset well above its 1.5°C pathway
  const FULL_DISCOUNT_AT = 0.5; // the full discount applies at 50% above the pathway; smaller overshoots scale down
  const VALUE_PER_M2 = { Office: 28000, Retail: 30000, 'Mixed-use': 22000, Logistics: 4500 }; // S$, illustrative
  const CROWD = 20;             // people shown in each isotype
  let observer = null;

  function future(i, mask) {
    const b = BUILDINGS[i], e = CACHE[i][mask];
    const intensity = e.eui * gridEF(YEAR), allowed = pathwayAt(b.type, YEAR);
    const carbon = (e.kwh * gridEF(YEAR)) / 1000;
    const overshoot = Math.max(0, intensity / allowed - 1);
    return {
      e, intensity, allowed, carbon, stranded: intensity > allowed,
      energyCost: e.kwh * TARIFF, carbonCost: carbon * CARBON_PRICE,
      valueLoss: b.gfa * VALUE_PER_M2[b.type] * BROWN_DISCOUNT * Math.min(1, overshoot / FULL_DISCOUNT_AT),
    };
  }

  // ---------- SVG helpers ----------

  const tip = s => `data-tip="${escapeHtml(s)}"`;
  const lin = (d0, d1, r0, r1) => v => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  const hh = h => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;

  // Isotype: `count` of CROWD people highlighted in the future's colour
  function crowd(count, cls, caption) {
    const per = 10, w = 24, h = 46;
    let marks = '';
    for (let k = 0; k < CROWD; k++) {
      const x = (k % per) * w + 12, y = Math.floor(k / per) * h + 2, on = k < count;
      marks += `<g class="person ${on ? cls : 'off'}" transform="translate(${x},${y})"><circle cy="7" r="6"/><rect x="-7" y="15" width="14" height="24" rx="5"/></g>`;
    }
    return `<figure class="iso"><svg viewBox="0 0 ${per * w} ${2 * h}" role="img" aria-label="${escapeHtml(caption)}" ${tip(caption)}>${marks}</svg><figcaption>${caption}</figcaption></figure>`;
  }

  const pair = (a, b) => `<div class="viz-pair"><div><span class="tag-a">A · Did nothing</span>${a}</div><div><span class="tag-b">B · Retrofitted</span>${b}</div></div>`;

  // CO2 through the working day (shared axis, both futures)
  const OCC = [[8, 0.05], [9, 0.5], [10.5, 1], [12, 0.75], [13, 0.55], [15, 0.95], [17, 0.6], [18, 0.2]];
  function occupancy(t) {
    for (let k = 1; k < OCC.length; k++) {
      if (t <= OCC[k][0]) return OCC[k - 1][1] + ((t - OCC[k - 1][0]) / (OCC[k][0] - OCC[k - 1][0])) * (OCC[k][1] - OCC[k - 1][1]);
    }
    return OCC.at(-1)[1];
  }

  function co2Chart(A, B) {
    const W = 720, H = 262, L = 52, R = 104, T = 34, Bm = 30;
    const times = Array.from({ length: 21 }, (_, k) => 8 + k * 0.5);
    const series = f => times.map(t => 420 + (f.e.co2 - 420) * occupancy(t));
    const a = series(A), b = series(B);
    const yMax = Math.max(1300, Math.ceil(Math.max(...a) / 100) * 100 + 100);
    const x = lin(8, 18, L, W - R), y = lin(400, yMax, H - Bm, T);
    const path = s => s.map((v, k) => `${k ? 'L' : 'M'}${x(times[k]).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const grid = [400, 600, 800, 1000, 1200].filter(v => v <= yMax)
      .map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmt.int(v)}</text>`).join('');
    const xt = [8, 10, 12, 14, 16, 18].map(t => `<text class="axis" x="${x(t)}" y="${H - 8}" text-anchor="middle">${hh(t)}</text>`).join('');
    const hover = times.map((t, k) => `<rect class="hov" x="${x(t) - 8}" y="${T}" width="16" height="${H - Bm - T}" ${tip(`${hh(t)} · A ${fmt.int(a[k])} ppm · B ${fmt.int(b[k])} ppm`)}/>`).join('');
    const end = (s, cls, label) => `<circle class="${cls}" cx="${x(18)}" cy="${y(s.at(-1))}" r="4"/>`
      + `<text class="lbl" x="${W - R + 10}" y="${y(Math.max(...s))}">${label} peak ${fmt.int(Math.max(...s))}</text>`
      + `<line class="${cls}-stroke" x1="${x(10.5)}" x2="${W - R + 6}" y1="${y(Math.max(...s))}" y2="${y(Math.max(...s))}" stroke-dasharray="1 4"/>`;
    return `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="CO2 through the day: Future A peaks at ${fmt.int(A.e.co2)} ppm, Future B at ${fmt.int(B.e.co2)} ppm">
      ${grid}${xt}
      <line class="threshold" x1="${L}" x2="${W - R}" y1="${y(1000)}" y2="${y(1000)}"/>
      <line class="threshold" x1="${L}" x2="${L + 26}" y1="8" y2="8"/>
      <text class="lbl muted-lbl" x="${L + 34}" y="12">1,000 ppm: people start to feel drowsy</text>
      <path class="line-a" d="${path(a)}"/><path class="line-b" d="${path(b)}"/>
      ${end(a, 'fa', 'A')}${end(b, 'fb', 'B')}
      <text class="axis" x="${L - 8}" y="${T - 12}" text-anchor="end">ppm</text>
      ${hover}</svg>`;
  }

  // Coldest surface temperature vs the outdoor dew point
  function surfaceChart(A, B) {
    const W = 720, H = 150, L = 110, R = 30;
    const x = lin(14, 30, L, W - R);
    const dp = OUTDOOR_DEW_POINT;
    const row = (f, cls, label, yy) => `<text class="lbl" x="${L - 12}" y="${yy + 4}" text-anchor="end">${label}</text>
      <line class="track" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>
      <circle class="${cls}" cx="${x(f.e.mould.coldSurface)}" cy="${yy}" r="9" ${tip(`${label}: coldest surfaces ${f.e.mould.coldSurface.toFixed(1)}°C · mould risk ${f.e.mould.level}`)}/>
      <text class="lbl" x="${x(f.e.mould.coldSurface)}" y="${yy - 16}" text-anchor="middle">${f.e.mould.coldSurface.toFixed(1)}°C · ${f.e.mould.level} risk</text>`;
    const ticks = [14, 18, 22, 26, 30].map(t => `<text class="axis" x="${x(t)}" y="${H - 6}" text-anchor="middle">${t}°C</text>`).join('');
    return `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="Coldest surface temperatures compared with the outdoor dew point">
      <defs><pattern id="wet" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" class="hatch"/></pattern></defs>
      <rect x="${x(14)}" y="12" width="${x(dp) - x(14)}" height="${H - 40}" fill="url(#wet)" class="wet-zone"/>
      <text class="lbl muted-lbl" x="${x(14) + 6}" y="26">Condensation zone: surfaces below the ${dp}°C outdoor dew point</text>
      <line class="threshold" x1="${x(dp)}" x2="${x(dp)}" y1="12" y2="${H - 28}"/>
      ${row(A, 'fa', 'A · Did nothing', 66)}${row(B, 'fb', 'B · Retrofitted', 106)}${ticks}</svg>`;
  }

  // Annual running cost: energy (solid) + carbon price (hatched), same scale
  function costChart(A, B) {
    const W = 720, H = 130, L = 110, R = 120;
    const max = Math.max(A.energyCost + A.carbonCost, B.energyCost + B.carbonCost);
    const x = lin(0, max, 0, W - L - R);
    const bar = (f, cls, label, yy) => {
      const e = x(f.energyCost), c = x(f.carbonCost);
      return `<text class="lbl" x="${L - 12}" y="${yy + 15}" text-anchor="end">${label}</text>
        <rect class="${cls}" x="${L}" y="${yy}" width="${Math.max(0, e - 1)}" height="22" rx="3" ${tip(`${label} energy: ${fmt.money(f.energyCost)}/yr`)}/>
        <rect fill="url(#hatch-${cls})" class="${cls}-stroke seg" x="${L + e + 1}" y="${yy}" width="${Math.max(0, c - 1)}" height="22" rx="3" ${tip(`${label} carbon price: ${fmt.money(f.carbonCost)}/yr`)}/>
        <text class="lbl strong" x="${L + e + c + 10}" y="${yy + 15}">${fmt.money(f.energyCost + f.carbonCost)}/yr</text>`;
    };
    const hatch = cls => `<pattern id="hatch-${cls}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="${cls}-stroke" stroke-width="2.5"/></pattern>`;
    return `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="Annual running cost, Future A ${fmt.money(A.energyCost + A.carbonCost)}, Future B ${fmt.money(B.energyCost + B.carbonCost)}">
      <defs>${hatch('fa')}${hatch('fb')}</defs>
      ${bar(A, 'fa', 'A · Did nothing', 14)}${bar(B, 'fb', 'B · Retrofitted', 56)}
      <text class="axis" x="${L}" y="${H - 10}">Solid = energy · Hatched = carbon price at S$${CARBON_PRICE}/t</text></svg>`;
  }

  // CRREM pathway vs both futures' intensity trajectories, 2025-2050
  function pathwayChart(b, A, B) {
    const W = 720, H = 262, L = 52, R = 104, T = 30, Bm = 30;
    const years = YEARS;
    const pw = years.map(yr => pathwayAt(b.type, yr));
    const ta = trajectory(A.e.eui), tb = trajectory(B.e.eui);
    const yMax = Math.ceil(Math.max(...ta, ...pw) / 20) * 20;
    const x = lin(2025, 2050, L, W - R), y = lin(0, yMax, H - Bm, T);
    const path = s => s.map((v, k) => `${k ? 'L' : 'M'}${x(years[k]).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const grid = [0, yMax / 2, yMax].map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmt.int(v)}</text>`).join('');
    const xt = [2025, 2030, 2035, 2040, 2045, 2050].map(t => `<text class="axis" x="${x(t)}" y="${H - 8}" text-anchor="middle">${t}</text>`).join('');
    const k35 = years.indexOf(YEAR);
    const hover = years.map((yr, k) => `<rect class="hov" x="${x(yr) - 8}" y="${T}" width="16" height="${H - Bm - T}" ${tip(`${yr} · allowed ${pw[k].toFixed(0)} · A ${ta[k].toFixed(0)} · B ${tb[k].toFixed(0)} kgCO₂e/m²`)}/>`).join('');
    return `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="Carbon intensity against the 1.5°C pathway">
      ${grid}${xt}
      <path class="pathway" d="${path(pw)}"/>
      <path class="line-a" d="${path(ta)}"/><path class="line-b" d="${path(tb)}"/>
      <line class="now" x1="${x(YEAR)}" x2="${x(YEAR)}" y1="${T}" y2="${H - Bm}"/><text class="lbl muted-lbl" x="${x(YEAR) + 6}" y="${T + 10}">${YEAR}</text>
      <circle class="fa" cx="${x(YEAR)}" cy="${y(ta[k35])}" r="5"/><circle class="fb" cx="${x(YEAR)}" cy="${y(tb[k35])}" r="5"/>
      <text class="lbl" x="${W - R + 10}" y="${y(ta.at(-1)) + 4}">A · Did nothing</text>
      <text class="lbl" x="${W - R + 10}" y="${y(tb.at(-1)) + 4}">B · Retrofitted</text>
      <text class="lbl muted-lbl" x="${W - R + 10}" y="${y(pw.at(-1)) + 4}">1.5°C pathway</text>
      <text class="axis" x="${L - 8}" y="${T - 14}" text-anchor="end">kgCO₂e/m²</text>
      ${hover}</svg>`;
  }

  // Asset value with the brown discount carved out
  function valueBars(b, A, B) {
    const value = b.gfa * VALUE_PER_M2[b.type];
    const row = (f, cls, label) => `<div class="vbar"><span>${label}</span>
      <div class="vtrack" ${tip(`${label}: brown discount ${f.valueLoss ? `−${fmt.money(f.valueLoss)}` : 'none'}`)}>
        <i class="${cls}-bg" style="width:${((value - f.valueLoss) / value) * 100}%"></i><i class="loss" style="width:${(f.valueLoss / value) * 100}%"></i></div>
      <b>${f.valueLoss ? `−${fmt.money(f.valueLoss)}` : 'no discount'}</b></div>`;
    return `<div class="vbars">${row(A, 'fa', 'A · Did nothing')}${row(B, 'fb', 'B · Retrofitted')}
      <p class="axis-note">Bar = asset value (${fmt.money(value)}, illustrative). Hatched end = value lost to the brown discount.</p></div>`;
  }

  // Two carbon towers for the hero: height = 2035 emissions
  function towers(A, B) {
    const H = 260, max = Math.max(A.carbon, B.carbon);
    const tower = (f, cls, x, label) => {
      const h = (f.carbon / max) * (H - 60);
      let windows = '';
      for (let yy = H - 30 - h + 14; yy < H - 40; yy += 18) for (let xx = x + 14; xx < x + 96; xx += 20) windows += `<rect class="win" x="${xx}" y="${yy}" width="10" height="8"/>`;
      return `<rect class="${cls}" x="${x}" y="${H - 30 - h}" width="110" height="${h}" rx="3" ${tip(`${label}: ${fmt.int(f.carbon)} tCO₂e in ${YEAR}`)}/>${windows}
        <text class="lbl strong" x="${x + 55}" y="${H - 38 - h}" text-anchor="middle">${fmt.int(f.carbon)} t</text>
        <text class="lbl" x="${x + 55}" y="${H - 10}" text-anchor="middle">${label}</text>`;
    };
    return `<svg class="viz towers" viewBox="0 0 320 ${H}" role="img" aria-label="Emissions in ${YEAR}: Future A ${fmt.int(A.carbon)} tonnes, Future B ${fmt.int(B.carbon)} tonnes">
      <line class="grid" x1="0" x2="320" y1="${H - 30}" y2="${H - 30}"/>${tower(A, 'fa', 30, 'A · Did nothing')}${tower(B, 'fb', 180, 'B · Retrofitted')}</svg>`;
  }

  // ---------- scenes ----------

  function scenes(b, A, B) {
    const n = f => Math.round((f.e.ppd / 100) * CROWD);
    const score = f => Math.round((f.e.people / 100) * CROWD);
    return [
      { time: '07:45', title: 'Arrival',
        headline: `${n(A)} in ${CROWD} people walk into a ${A.e.pmv < -0.5 ? 'cold' : A.e.pmv > 0.5 ? 'warm' : 'comfortable'} building in Future A. In Future B, ${n(B)}.`,
        viz: pair(crowd(n(A), 'fa', `${Math.round(A.e.ppd)}% uncomfortable at ${A.e.ta}°C`), crowd(n(B), 'fb', `${Math.round(B.e.ppd)}% uncomfortable at ${B.e.ta}°C${B.e.vel > 0.2 ? ' with fans' : ''}`)),
        a: A.e.pmv < -0.5 ? 'People reach for the jackets they keep at their desks.' : 'The air feels heavy.',
        b: B.e.vel > 0.2 ? 'A gentle breeze from the ceiling fans; nobody thinks about the temperature.' : 'Nobody thinks about the temperature, which is the point.' },
      { time: '10:30', title: 'The big meeting',
        headline: `The boardroom fills up. CO₂ peaks at ${fmt.int(A.e.co2)} ppm in Future A and ${fmt.int(B.e.co2)} ppm in Future B.`,
        viz: co2Chart(A, B),
        a: 'Fresh air runs on a fixed schedule, so CO₂ climbs with every person who walks in.',
        b: B.e.co2 < A.e.co2 ? 'CO₂ sensors push fresh air to the rooms people are actually in.' : 'Ventilation is unchanged in this future.' },
      { time: '13:00', title: 'Facilities walk-round',
        headline: `In Future A the coldest surfaces sit ${(OUTDOOR_DEW_POINT - A.e.mould.coldSurface).toFixed(1)}°C below the dew point, so humid air condenses on them.`,
        viz: surfaceChart(A, B),
        a: 'Condensation on the chilled-water pipes again. Another stained ceiling tile replaced.',
        b: 'Warmer surfaces mean less condensation. The team does planned work instead of patching.' },
      { time: '15:00', title: 'Finance reviews the bills',
        headline: `Future B runs ${fmt.money(A.energyCost + A.carbonCost - (B.energyCost + B.carbonCost))} a year cheaper.`,
        viz: costChart(A, B),
        a: `Energy plus a S$${CARBON_PRICE}/t carbon price passed through in electricity.`,
        b: 'Same building, a smaller bill, and the retrofit has paid for itself.' },
      { time: '17:00', title: 'Board meeting: the valuation',
        headline: A.stranded ? `Future A sits ${Math.round((A.intensity / A.allowed - 1) * 100)}% above its 1.5°C pathway. ${B.stranded ? `Future B is still above it, but only by ${Math.round((B.intensity / B.allowed - 1) * 100)}%.` : 'Future B is on it.'}` : 'Both futures are on the 1.5°C pathway in 2035.',
        viz: `${pathwayChart(b, A, B)}${valueBars(b, A, B)}`,
        a: A.stranded ? 'The valuer applies a brown discount for a stranded asset.' : 'No discount yet.',
        b: B.stranded ? 'A smaller discount: the asset is closer to its pathway.' : 'No discount: the asset is investable.' },
      { time: '18:30', title: 'Lease renewal',
        headline: `The anchor tenant compares workplaces. People Score (comfort, air and satisfaction): ${A.e.people.toFixed(0)} in Future A, ${B.e.people.toFixed(0)} in Future B.`,
        viz: pair(`${crowd(score(A), 'fa', `People Score ${A.e.people.toFixed(0)} / 100`)}<div class="stamp a">Touring other buildings</div>`,
          `${crowd(score(B), 'fb', `People Score ${B.e.people.toFixed(0)} / 100`)}<div class="stamp b">Lease renewed ✓</div>`),
        a: `Only ${Math.round(A.e.pulse)}% of staff say they're satisfied. They are touring greener buildings next week.`,
        b: 'The tenant renews, with green-lease clauses and comfort guarantees.' },
    ];
  }

  function bindTooltips(body) {
    const tipEl = document.createElement('div');
    tipEl.className = 'viz-tip';
    body.appendChild(tipEl);
    body.addEventListener('mousemove', ev => {
      const t = ev.target.closest('[data-tip]');
      tipEl.hidden = !t;
      if (!t) return;
      tipEl.textContent = t.dataset.tip;
      tipEl.style.left = `${Math.min(ev.clientX + 14, window.innerWidth - tipEl.offsetWidth - 10)}px`;
      tipEl.style.top = `${ev.clientY + 14}px`;
    });
    body.addEventListener('mouseleave', () => { tipEl.hidden = true; });
  }

  function open(i = state.selected) {
    const b = BUILDINGS[i];
    const mask = state.plan[i] || Negotiation.bestPackage(i);
    const A = future(i, 0), B = future(i, mask);
    const measures = ACTIONS.filter((a, k) => mask & (1 << k)).map(a => `${a.icon} ${a.name}`).join(' · ');
    const list = scenes(b, A, B);
    const body = openXp('04 / A day in 2035', `
      <nav class="story-clock">${list.map((s, k) => `<a href="#scene-${k}" data-k="${k}"><b>${s.time}</b><span>${s.title}</span></a>`).join('')}</nav>
      <section class="story-hero">
        <div class="hero-text">
          <span class="sec-no">TUESDAY · 3 JUNE ${YEAR}</span>
          <h2>${b.name}</h2>
          <p>Same building. Same Tuesday. Two decisions made in ${new Date().getFullYear()}.</p>
          <div class="story-cols-head"><div class="a"><b>A · Did nothing</b><span>No retrofit</span></div><div class="b"><b>B · Retrofitted</b><span>${measures || 'Retrofit package'}</span></div></div>
        </div>
        <div class="hero-viz">${towers(A, B)}<p class="axis-note">Building emissions in ${YEAR}, tCO₂e</p></div>
        <span class="story-scroll">scroll ↓</span>
      </section>
      ${list.map((s, k) => `
        <section class="scene" id="scene-${k}" data-k="${k}">
          <div class="scene-time"><b>${s.time}</b><span>${s.title}</span></div>
          <div class="scene-main">
            <h3>${s.headline}</h3>
            <div class="scene-viz">${s.viz}</div>
            <div class="scene-notes"><p class="na"><b>A</b>${s.a}</p><p class="nb"><b>B</b>${s.b}</p></div>
          </div>
        </section>`).join('')}
      <section class="story-end">
        <h2>The difference one decision makes</h2>
        <div class="plan-kpis">
          <div><span>Carbon in ${YEAR}</span><b>−${fmt.int(A.carbon - B.carbon)} t</b><em>per year</em></div>
          <div><span>People uncomfortable</span><b>${Math.round(A.e.ppd)}% → ${Math.round(B.e.ppd)}%</b><em>every working day</em></div>
          <div><span>Running cost</span><b>−${fmt.money(A.energyCost + A.carbonCost - B.energyCost - B.carbonCost)}</b><em>per year</em></div>
          <div><span>Value protected ${info('brown')}</span><b>${fmt.money(A.valueLoss - B.valueLoss)}</b><em>brown discount avoided</em></div>
        </div>
        <p class="muted">Comfort, air quality, mould, energy and CRREM figures come from the Equilibria models (synthetic portfolio). The S$${CARBON_PRICE}/t carbon price,
          brown discount (up to ${Math.round(BROWN_DISCOUNT * 100)}%, scaled by how far the asset sits above its pathway), asset values and the daily CO₂ profile are illustrative assumptions.</p>
        <div class="chat-actions"><button class="btn" id="storyApply" ${state.plan[i] === mask ? 'disabled' : ''}>Choose Future B: apply the package</button></div>
      </section>`, true);

    bindTooltips(body);
    // Fade scenes in and track the current time of day in the clock
    observer = new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      const k = en.target.dataset.k;
      if (k != null) body.querySelectorAll('.story-clock a').forEach(a => a.classList.toggle('on', a.dataset.k === k));
    }), { root: body, threshold: 0.4 });
    body.querySelectorAll('.scene, .story-end').forEach(el => observer.observe(el));
    xpHandlers.onClose = () => observer && observer.disconnect();
    body.querySelectorAll('.story-clock a').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault();
      body.querySelector(`#scene-${a.dataset.k}`).scrollIntoView({ behavior: 'smooth' });
    }));
    $('#storyApply').addEventListener('click', () => {
      state.plan[i] = mask;
      refreshAll();
      toast(`Future B chosen for ${b.name}`);
      closeXp();
    });
  }

  return { open };
})();
