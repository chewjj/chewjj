// Workplace Scenario Studio: compare renew / right-size / consolidate / relocate / hub-and-spoke options for a
// multigenerational workforce on cost, carbon (building + commuting + fit-out), employee experience and
// early-career impacts, with policy levers, weights, privacy and assumptions made visible.

const Studio = (() => {
  const st = {
    selection: { ...DEFAULT_SELECTION, candidates: [...DEFAULT_SELECTION.candidates] },
    policy: { ...POLICY_DEFAULT },
    weights: { cost: 25, carbon: 25, experience: 25, early: 25 },
    selected: 'hub',
    scenarios: [],
    results: [],
  };
  const PILLARS = { cost: 'Cost', carbon: 'Carbon', experience: 'Employee experience', early: 'Early-career' };
  const surveyN = Math.round(ORG.headcount * ORG.surveyResponse);

  const byId = id => st.results.find(r => r.sc.id === id);
  const base = () => byId('renew');
  const sel = () => byId(st.selected);
  const pct = v => `${Math.round(v * 100)}%`;
  const sign = (v, digits = 0) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}`;
  const lin = (d0, d1, r0, r1) => v => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  const tip = s => `data-tip="${escapeHtml(s)}"`;

  function compute() {
    ORG.currentSite = st.selection.current;
    st.scenarios = buildScenarios(st.selection);
    // Plan A options before Plan B in every table and chart (stable, so columns don't jump as weights change)
    st.results = scoreScenarios(st.scenarios.map(sc => evaluateWorkplace(sc, st.policy)), st.weights)
      .sort((a, b) => a.plan.localeCompare(b.plan));
    if (!byId(st.selected)) st.selected = st.results.find(r => r.rank === 1).sc.id;
  }

  // ---------- 01 portfolio site selection ----------

  // Schematic map: simplified island outline, home regions sized by headcount, workplace buildings as clickable dots
  const ISLAND = [[103.64, 1.32], [103.67, 1.36], [103.70, 1.41], [103.74, 1.445], [103.79, 1.47], [103.83, 1.455], [103.87, 1.43], [103.91, 1.42],
    [103.96, 1.41], [104.02, 1.395], [104.04, 1.36], [104.0, 1.33], [103.96, 1.315], [103.91, 1.305], [103.87, 1.29], [103.84, 1.265],
    [103.80, 1.265], [103.76, 1.275], [103.72, 1.29], [103.68, 1.30]];

  function siteMap() {
    const W = 600, H = 330;
    const x = lng => ((lng - 103.62) / 0.44) * W, y = lat => ((1.48 - lat) / 0.24) * H;
    const LABEL = { QEX: [14, -4], MBT: [14, 14], PGP: [-46, 12], BGM: [14, -6], AGW: [-48, 5], FSL: [-42, -8], CIH: [14, 5] };
    const w = homeWeights();
    const island = `<path class="sm-island" d="${ISLAND.map(([lng, lat], k) => `${k ? "L" : "M"}${x(lng).toFixed(1)},${y(lat).toFixed(1)}`).join("")}Z"/>`;
    const regions = REGIONS.filter(r => w[r.id]).map(r => `
      <circle class="sm-region" cx="${x(r.lng)}" cy="${y(r.lat)}" r="${14 + Math.sqrt(w[r.id]) * 1.6}" ${tip(`${r.name}: ~${fmt.int(w[r.id])} people live here (aggregated)`)}/>
      <text class="sm-region-label" x="${x(r.lng)}" y="${y(r.lat) - 2}" text-anchor="middle">${r.name}</text>
      <text class="sm-region-n" x="${x(r.lng)}" y="${y(r.lat) + 13}" text-anchor="middle">${fmt.int(w[r.id])}</text>`).join("");
    const sites = WORKPLACE_SITES.map(id => {
      const b = buildingById(id), isCur = id === st.selection.current, isCand = st.selection.candidates.includes(id);
      const cls = isCur ? "sm-site cur" : isCand ? "sm-site on" : "sm-site";
      return `<g class="${cls}" data-site="${id}" ${tip(`${b.name} · ${b.area}${isCur ? " · current office" : isCand ? " · candidate (click to remove)" : " · click to add as candidate"}`)}>
        <circle cx="${x(b.lng)}" cy="${y(b.lat)}" r="16" class="sm-hit"/>
        <circle cx="${x(b.lng)}" cy="${y(b.lat)}" r="${isCur ? 10 : 8}"/>
        <text x="${x(b.lng) + LABEL[id][0]}" y="${y(b.lat) + LABEL[id][1]}">${id}</text></g>`;
    }).join("");
    return `<svg class="viz site-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Schematic map of home regions and workplace buildings">
      ${island}${regions}${sites}</svg>
      <div class="sm-legend">
        <span><i class="k-region"></i>where people live (size = headcount)</span>
        <span><i class="k-cur"></i>current office</span><span><i class="k-on"></i>candidate</span><span><i class="k-off"></i>not considered</span>
      </div>
      <p class="sm-note">Schematic, not to scale for streets · home locations aggregated to 5 regions</p>`;
  }

  function renderSites() {
    const rows = WORKPLACE_SITES.map(id => {
      const i = BUILDINGS.findIndex(b => b.id === id), b = BUILDINGS[i], e = cur(i);
      const isCur = id === st.selection.current, isCand = st.selection.candidates.includes(id);
      const solo = evaluateWorkplace({ id, sites: [{ id, share: 1 }], area: 'demand', fitout: 'new', measures: [], move: !isCur }, st.policy);
      const cls = strandClass(e.strand);
      return `<tr class="${isCur ? 'cur' : isCand ? 'on' : ''}">
        <td><input type="radio" name="stCurrent" value="${id}" ${isCur ? 'checked' : ''} aria-label="Current office: ${b.name}"></td>
        <td><input type="checkbox" data-cand="${id}" ${isCand || isCur ? 'checked' : ''} ${isCur ? 'disabled' : ''} aria-label="Candidate: ${b.name}"></td>
        <td><strong>${b.name}</strong><span>${b.area} · built ${b.built}</span></td>
        <td>S$${SITES[id].rent}</td><td>${Math.round(e.eui)}</td><td>${Math.round(e.people)}</td>
        <td><span class="status-pill" data-term="status-${cls}"><i class="st-${cls}"></i>${STATUS_NAME[cls]}</span></td>
        <td>${Math.round(solo.avgMinutes)} min</td><td>${pct(solo.cohorts.early.longShare)}</td></tr>`;
    }).join('');
    const pool = new Set([st.selection.current, ...st.selection.candidates]).size;
    $('#stSites').innerHTML = `
      <div class="st-sites-map">${siteMap()}</div>
      <div class="st-sites-list">
        <div class="table-wrap"><table class="ptable dtable st-site-table">
          <thead><tr><th>Current</th><th>Candidate</th><th>Building</th><th>Rent <small>S$/m²/mo</small></th><th>Energy <small>kWh/m²</small> ${info('eui')}</th>
            <th>People <small>score</small> ${info('people')}</th><th>CRREM ${info('crrem')}</th><th>Avg commute <small>if all moved here</small> ${info('avgcommute')}</th><th>Juniors &gt;1 h <small>if all moved here</small> ${info('juniors')}</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
        <div class="st-sites-foot">
          <label class="st-check"><input type="checkbox" id="stHub" ${st.selection.hub ? 'checked' : ''} ${pool < 3 ? 'disabled' : ''}>
            Also test a hub &amp; spokes network <span class="hint">${pool < 3 ? 'needs at least 3 sites selected' : 'keeps the current building as the hub; spokes are picked to minimise commuting'}</span></label>
          <span class="muted">${st.scenarios.length} scenarios generated from ${pool} site${pool === 1 ? '' : 's'} · retail and logistics assets are not office workplaces, so they are not shown</span>
        </div>
      </div>`;
    const c = buildingById(st.selection.current);
    $('#stQuestion').innerHTML = `Our ${c.area} lease at ${c.name} ends in ${ORG.leaseExpiry}. <b>Renew, consolidate or relocate</b>, for a workforce spanning three career stages, while cutting carbon?`;
  }

  function toggleCandidate(id) {
    if (id === st.selection.current) return;
    const cands = st.selection.candidates;
    st.selection.candidates = cands.includes(id) ? cands.filter(x => x !== id) : [...cands, id];
    render();
  }

  // ---------- scenario cards ----------

  function renderCards() {
    const ranked = [...st.results].sort((a, b) => a.rank - b.rank);
    const group = (plan, title, note) => {
      const rs = ranked.filter(r => r.plan === plan);
      return rs.length ? `<div class="st-group st-plan-${plan.toLowerCase()}" style="flex:${rs.length}">
        <div class="st-group-head"><b>${title}</b><span>${note}</span></div>
        <div class="st-group-cards" style="grid-template-columns:repeat(${rs.length}, minmax(0, 1fr))">${rs.map(card).join('')}</div></div>` : '';
    };
    $('#stCards').innerHTML = group('A', 'Plan A · stay', 'Make the current building work first')
      + group('B', 'Plan B · relocate', 'Only if staying cannot meet the brief');
  }

  function card(r) {
    return `
      <button class="st-card ${r.sc.id === st.selected ? 'on' : ''}" data-sc="${r.sc.id}">
        <span class="st-rank ${r.rank === 1 ? 'top' : ''}">${r.label}</span>
        <span class="st-icon">${r.sc.icon}</span>
        <b>${r.sc.name}</b>
        <p>${r.sc.blurb}</p>
        <div class="st-score"><i style="width:${Math.round(r.score * 100)}%"></i></div>
        <dl>
          <div><dt>5-yr cost</dt><dd>${fmt.money(r.cost5)}</dd></div>
          <div><dt>tCO₂e/yr</dt><dd>${fmt.int(r.annualT)}</dd></div>
          <div><dt>Avg commute</dt><dd>${Math.round(r.avgMinutes)} min</dd></div>
          <div><dt>Mentoring</dt><dd>${Math.round(r.mentoring)}/100</dd></div>
        </dl>
      </button>`;
  }

  // ---------- comparison table ----------

  const ROWS = [
    ['Cost', [
      ['5-year cost (rent, energy, fit-out, move)', r => r.cost5, fmt.money, 'low'],
      ['Annual running cost', r => r.annualCost, fmt.money, 'low'],
      ['Space leased', r => r.area, v => `${fmt.int(v)} m²`, 'low'],
      ['Desk use on peak days', r => r.utilisation, pct, null],
    ]],
    ['Carbon (tCO₂e per year)', [
      ['Building energy', r => r.buildingT, fmt.int, 'low'],
      ['Commuting', r => r.commuteT, fmt.int, 'low'],
      ['Fit-out materials (spread over lease)', r => r.embodiedT / ORG.horizon, fmt.int, 'low'],
      ['Total', r => r.annualT, fmt.int, 'low'],
    ]],
    ['Employee experience', [
      ['Average commute, one way', r => r.avgMinutes, v => `${Math.round(v)} min`, 'low'],
      ['Commutes over 60 minutes', r => r.longShare, pct, 'low'],
      ['Belonging index', r => r.belonging, v => `${Math.round(v)}/100`, 'high'],
      ['Building comfort (People Score)', r => r.comfort, v => `${Math.round(v)}/100`, 'high'],
    ]],
    ['Early-career', [
      ['Commute, one way', r => r.cohorts.early.minutes, v => `${Math.round(v)} min`, 'low'],
      ['Commutes over 60 minutes', r => r.cohorts.early.longShare, pct, 'low'],
      ['Mentoring access index', r => r.mentoring, v => `${Math.round(v)}/100`, 'high'],
      ['Monthly public-transport fare', r => r.cohorts.early.monthlyFare, v => `S$${Math.round(v)}`, 'low'],
    ]],
  ];

  const TERMS = {
    'Mentoring access index': 'mentoring', 'Belonging index': 'belonging', 'Building comfort (People Score)': 'people',
    '5-year cost (rent, energy, fit-out, move)': 'cost5', 'Desk use on peak days': 'desk', 'Building energy': 'buildingenergy',
    Commuting: 'commuting', 'Fit-out materials (spread over lease)': 'fitout', 'Commutes over 60 minutes': 'longcommute',
  };

  function renderTable() {
    $('#stTable').innerHTML = `<table class="mini-table st-table">
      <tr><th></th>${st.results.map(r => `<th class="${r.sc.id === st.selected ? 'sel' : ''}">${r.sc.icon} ${r.sc.name}</th>`).join('')}</tr>
      ${ROWS.map(([group, rows]) => `<tr class="cat"><td colspan="${st.results.length + 1}">${group}</td></tr>
        ${rows.map(([label, get, f, better]) => {
          const vals = st.results.map(get);
          const best = better === 'low' ? Math.min(...vals) : better === 'high' ? Math.max(...vals) : null;
          return `<tr><td>${label}${TERMS[label] ? ` ${info(TERMS[label])}` : ''}</td>${st.results.map((r, k) => `<td class="${r.sc.id === st.selected ? 'sel' : ''} ${best !== null && Math.abs(vals[k] - best) < 1e-9 ? 'best' : ''}">${f(vals[k])}</td>`).join('')}</tr>`;
        }).join('')}`).join('')}
    </table>`;
  }

  // ---------- charts ----------

  function carbonChart() {
    const W = 760, rowH = 34, L = 230, R = 90, T = 30;
    const H = T + st.results.length * rowH + 10;
    const max = Math.max(...st.results.map(r => r.annualT));
    const x = lin(0, max, 0, W - L - R);
    const rows = st.results.map((r, k) => {
      const y = T + k * rowH;
      const segs = [['building', r.buildingT, 'Building energy'], ['commute', r.commuteT, 'Commuting'], ['embodied', r.embodiedT / ORG.horizon, 'Fit-out materials']];
      let at = L;
      const bars = segs.map(([cls, v, name]) => {
        const w = Math.max(0, x(v) - 2);
        const out = `<rect class="s-${cls}" x="${at}" y="${y}" width="${w}" height="20" rx="3" ${tip(`${r.sc.name} · ${name}: ${fmt.int(v)} tCO₂e/yr`)}/>`;
        at += x(v);
        return out;
      }).join('');
      return `<text class="lbl ${r.sc.id === st.selected ? 'strong' : ''}" x="${L - 12}" y="${y + 14}" text-anchor="end">${r.sc.name}</text>${bars}
        <text class="lbl strong" x="${at + 8}" y="${y + 14}">${fmt.int(r.annualT)}</text>`;
    }).join('');
    const legend = [['building', 'Building energy'], ['commute', 'Commuting'], ['embodied', 'Fit-out materials']]
      .map(([cls, name], k) => `<rect class="s-${cls}" x="${L + k * 150}" y="4" width="12" height="12" rx="2"/><text class="lbl" x="${L + k * 150 + 18}" y="14">${name}</text>`).join('');
    return `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="Annual carbon by source for each scenario">${legend}${rows}</svg>`;
  }

  function commuteChart() {
    const b = base(), s = sel();
    const W = 760, rowH = 46, L = 230, R = 130, T = 34;
    const H = T + COHORTS.length * rowH;
    const all = COHORTS.flatMap(c => [b.cohorts[c.id].minutes, s.cohorts[c.id].minutes]);
    const x = lin(20, Math.max(70, Math.ceil(Math.max(...all) / 10) * 10), L, W - R);
    const rows = COHORTS.map((c, k) => {
      const y = T + k * rowH + 14, v0 = b.cohorts[c.id].minutes, v1 = s.cohorts[c.id].minutes;
      return `<text class="lbl strong" x="${L - 12}" y="${y - 2}" text-anchor="end">${c.name}</text>
        <text class="axis" x="${L - 12}" y="${y + 12}" text-anchor="end">${c.detail.split(' · ')[0]}</text>
        <line class="track" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/>
        <line class="c-${c.id}-stroke" x1="${x(v0)}" x2="${x(v1)}" y1="${y}" y2="${y}" stroke-width="3"/>
        <circle class="c-${c.id}-ring" cx="${x(v0)}" cy="${y}" r="7" ${tip(`${c.name} today (renew): ${Math.round(v0)} min`)}/>
        <circle class="c-${c.id}" cx="${x(v1)}" cy="${y}" r="7" ${tip(`${c.name} · ${s.sc.name}: ${Math.round(v1)} min`)}/>
        <text class="lbl" x="${W - R + 12}" y="${y + 4}">${Math.round(v0)} → <tspan class="strong-t">${Math.round(v1)} min</tspan> (${sign(v1 - v0)})</text>`;
    }).join('');
    const ticks = [20, 30, 40, 50, 60, 70].filter(t => x(t) <= W - R).map(t => `<text class="axis" x="${x(t)}" y="${H}" text-anchor="middle">${t} min</text>`).join('');
    return `<svg class="viz" viewBox="0 0 ${W} ${H + 10}" role="img" aria-label="One-way commute by career stage, today vs ${escapeHtml(s.sc.name)}">
      <circle class="ring-key" cx="${L + 6}" cy="10" r="6"/><text class="lbl" x="${L + 18}" y="14">Today (renew as-is)</text>
      <circle class="dot-key" cx="${L + 196}" cy="10" r="6"/><text class="lbl" x="${L + 208}" y="14">${escapeHtml(s.sc.name)}</text>
      <line class="threshold" x1="${x(60)}" x2="${x(60)}" y1="${T - 6}" y2="${H - 14}"/><text class="lbl muted-lbl" x="${x(60) + 4}" y="${T - 8}">1-hour commute</text>
      ${rows}${ticks}</svg>`;
  }

  function needsChart() {
    const W = 760, rowH = 30, L = 270, R = 30, T = 30;
    const H = T + NEEDS.length * rowH + 16;
    const x = lin(0, 100, L, W - R);
    const legend = COHORTS.map((c, k) => `<circle class="c-${c.id}" cx="${L + 6 + k * 160}" cy="10" r="6"/><text class="lbl" x="${L + 18 + k * 160}" y="14">${c.name}</text>`).join('');
    const rows = NEEDS.map((n, k) => {
      const y = T + k * rowH + 10, vals = COHORTS.map(c => n[c.id]);
      return `<text class="lbl" x="${L - 12}" y="${y + 4}" text-anchor="end">${n.need}</text>
        <line class="track" x1="${x(Math.min(...vals))}" x2="${x(Math.max(...vals))}" y1="${y}" y2="${y}" stroke-width="2"/>
        ${COHORTS.map(c => `<circle class="c-${c.id}" cx="${x(n[c.id])}" cy="${y}" r="6" ${tip(`${c.name}: ${n[c.id]}% say "${n.need}" is very important`)}/>`).join('')}`;
    }).join('');
    const ticks = [0, 25, 50, 75, 100].map(t => `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - 16}"/><text class="axis" x="${x(t)}" y="${H}" text-anchor="middle">${t}%</text>`).join('');
    return `<svg class="viz" viewBox="0 0 ${W} ${H + 6}" role="img" aria-label="Workplace needs by career stage">${legend}${ticks}${rows}</svg>`;
  }

  // ---------- who wins, who pays ----------

  function safeguards(s) {
    const out = [];
    const multi = s.sc.sites.length > 1;
    if (!st.policy.anchors && (multi || st.policy.days < 5)) {
      const alt = evaluateWorkplace(s.sc, { ...st.policy, anchors: true });
      out.push(`Coordinate 2 anchor days${multi ? ' at the hub' : ''}: mentoring access ${Math.round(s.mentoring)} → <b>${Math.round(alt.mentoring)}</b>, at the cost of a busier peak day (${fmt.int(alt.area - s.area)} m² more space).`);
    }
    if (!st.policy.pods) {
      const alt = evaluateWorkplace(s.sc, { ...st.policy, pods: true });
      out.push(`Add mentoring pods and seat early-career staff near their teams: mentoring access ${Math.round(s.mentoring)} → <b>${Math.round(alt.mentoring)}</b> for +5% space.`);
    }
    if (s.cohorts.early.longShare > base().cohorts.early.longShare + 0.05) {
      out.push(`${pct(s.cohorts.early.longShare)} of early-career staff would commute over an hour (today ${pct(base().cohorts.early.longShare)}). Offer a travel allowance, schedule anchor days off-peak, or keep a spoke near where they live.`);
    }
    if (st.policy.days < 3) out.push('With fewer than 3 office days, early-career staff get less in-person learning time. Consider an optional extra "learning day" with mentors present.');
    if (s.utilisation > 0.97) out.push('Anchor days will be close to full. Book overflow meeting rooms or stagger teams across two anchor days.');
    if (s.utilisation < 0.7) out.push(`Only ${pct(s.utilisation)} of desks are used even on the busiest day: you are paying rent and energy for empty space.`);
    return out;
  }

  function renderImpact() {
    const s = sel(), b = base();
    const e = s.cohorts.early, eb = b.cohorts.early;
    const items = [
      `<b>Cost:</b> ${fmt.money(s.cost5)} over ${ORG.horizon} years (${s.cost5 <= b.cost5 ? '−' : '+'}${fmt.money(Math.abs(s.cost5 - b.cost5))} vs renewing as-is).`,
      `<b>Carbon:</b> ${fmt.int(s.annualT)} tCO₂e/yr (${sign(s.annualT - b.annualT)}). Building ${sign(s.buildingT - b.buildingT)} t, commuting ${sign(s.commuteT - b.commuteT)} t, fit-out ${sign((s.embodiedT - b.embodiedT) / ORG.horizon)} t a year.`,
      ...COHORTS.map(c => `<b>${c.name}:</b> commute ${Math.round(b.cohorts[c.id].minutes)} → ${Math.round(s.cohorts[c.id].minutes)} min one way (${sign(s.cohorts[c.id].weeklyHours - b.cohorts[c.id].weeklyHours, 1)} h a week).`),
      `<b>Early-career learning:</b> mentoring access ${Math.round(b.mentoring)} → ${Math.round(s.mentoring)}/100; commutes over an hour ${pct(eb.longShare)} → ${pct(e.longShare)}; monthly fare S$${Math.round(eb.monthlyFare)} → S$${Math.round(e.monthlyFare)}.`,
    ];
    const guards = safeguards(s);
    $('#stImpact').innerHTML = `
      <div class="st-impact-title">${s.sc.icon} ${escapeHtml(s.sc.name)}</div>
      <ul class="plain st-list">${items.map(t => `<li>${t}</li>`).join('')}</ul>
      ${guards.length ? `<div class="st-guards"><b>Safeguards to consider</b><ul>${guards.map(g => `<li>${g}</li>`).join('')}</ul></div>` : ''}`;
  }

  // ---------- decision memo ----------

  function offlineMemo() {
    const ranked = [...st.results].sort((a, b) => a.rank - b.rank);
    const top = ranked[0], b = base();
    const w = Object.entries(st.weights).map(([k, v]) => `${PILLARS[k]} ${v}`).join(', ');
    const strengths = Object.entries(top.pillars).filter(([, v]) => v >= 0.75).map(([k]) => PILLARS[k].toLowerCase());
    const weak = Object.entries(top.pillars).filter(([, v]) => v <= 0.35).map(([k]) => PILLARS[k].toLowerCase());
    const guards = safeguards(top).map(g => `- ${g.replace(/<\/?b>/g, '**')}`);
    const pb = ranked.find(r => r.plan === 'B');
    const planB = pb ? `\n\n**Plan B, if staying cannot meet the brief:** ${pb.sc.name} (score ${Math.round(pb.score * 100)}, ${fmt.money(pb.cost5)} over 5 years).` : '';
    return `### Recommendation: ${top.sc.name}
${top.sc.blurb} With your weights (${w}), it ranks first of the options that keep the current building${strengths.length ? `, strongest on ${strengths.join(' and ')}` : ''}${weak.length ? `; weakest on ${weak.join(' and ')}` : ''}.

| | Renew as-is | ${top.sc.name} |
|---|---|---|
| 5-year cost | ${fmt.money(b.cost5)} | ${fmt.money(top.cost5)} |
| Carbon, tCO₂e/yr | ${fmt.int(b.annualT)} | ${fmt.int(top.annualT)} |
| Average commute | ${Math.round(b.avgMinutes)} min | ${Math.round(top.avgMinutes)} min |
| Early-career commutes over 1 hr | ${pct(b.cohorts.early.longShare)} | ${pct(top.cohorts.early.longShare)} |
| Mentoring access | ${Math.round(b.mentoring)}/100 | ${Math.round(top.mentoring)}/100 |

**Runner-up:** ${ranked[1].sc.name} (score ${Math.round(ranked[1].score * 100)} vs ${Math.round(top.score * 100)}).${planB}

**Early-career safeguards**
${guards.join('\n') || '- No major early-career risks flagged under this policy.'}

**Policy assumed:** ${st.policy.days} office days a week, ${st.policy.anchors ? 'coordinated anchor days' : 'no coordinated anchor days'}, ${st.policy.pods ? 'with' : 'without'} mentoring pods.

**Next steps**
- Validate commute and needs data with a fresh opt-in pulse survey (groups under ${K_MIN} stay suppressed).
- Pilot the anchor-day pattern for one quarter before signing.
- Check lease break options and landlord retrofit commitments (green-lease clauses).

_Generated offline from the Footfall models with synthetic, aggregated data. All figures are estimates; see Assumptions._`;
  }

  async function writeMemo() {
    const box = $('#stMemo');
    box.hidden = false;
    const head = note => `<div class="panel-head"><div><span>✦</span><h2>Decision memo</h2></div><span class="muted st-hint">${note}</span></div>`;
    if (!AI.enabled()) {
      box.innerHTML = `${head('offline · connect Claude (gear icon) for an AI-written memo')}<div class="panel-body">${renderMarkdown(offlineMemo())}</div>`;
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    box.innerHTML = `${head('written by Claude Opus 5.5 from aggregated data only')}<div class="panel-body"><div class="msg bot ai" id="stMemoOut"></div></div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const prompt = `Write a one-page decision memo for our HR and real estate leaders on whether to renew, consolidate or relocate our workplace when our lease at ${buildingById(st.selection.current).name} (${buildingById(st.selection.current).area}) ends in ${ORG.leaseExpiry}. The scenarios compared are the ones generated from the portfolio sites currently selected: ${st.scenarios.map(s => s.name).join("; ")}.
Current policy: ${st.policy.days} office days a week, anchor days ${st.policy.anchors ? 'coordinated' : 'not coordinated'}, mentoring pods ${st.policy.pods ? 'on' : 'off'}.
Leadership weights: ${Object.entries(st.weights).map(([k, v]) => `${PILLARS[k]} ${v}`).join(', ')}. The scenario currently selected in the dashboard is "${sel().sc.name}".
Use the workplace tools for every number. Cover: recommendation, cost / carbon (building vs commuting) / experience trade-offs, impacts by career stage with particular care for early-career employees (mentoring, belonging, commute), safeguards, assumptions and data limits, and next steps. Avoid generational stereotypes.`;
    await streamClaude($('#stMemoOut'), ui => AI.askMemo(prompt, ui), () => {});
  }

  // ---------- privacy & assumptions ----------

  function openPrivacy() {
    const H = planningHeadcount();
    const suppressed = privacyReport();
    openXp('Data & privacy', `
      <p class="lede">The studio works only with <b>aggregated, anonymised or opt-in</b> data. No individual employee record is stored, shown or sent to AI.</p>
      <table class="mini-table">
        <tr><th>Input</th><th>Granularity</th><th>Source & basis</th></tr>
        <tr><td>Headcount by career stage</td><td>3 career stages, totals only</td><td>HR system export, aggregated before upload</td></tr>
        <tr><td>Home location</td><td>5 planning regions (from postcode sector), never addresses</td><td>HR system, aggregated; groups under ${K_MIN} merged</td></tr>
        <tr><td>Commute mode</td><td>Shares per career stage</td><td>Opt-in pulse survey (${pct(ORG.surveyResponse)} response, n≈${fmt.int(surveyN)})</td></tr>
        <tr><td>Workplace needs</td><td>% "very important" per career stage</td><td>Same opt-in pulse survey</td></tr>
        <tr><td>Office attendance</td><td>Daily totals per site</td><td>Badge data aggregated to counts; no individual tracking</td></tr>
        <tr><td>Building energy & comfort</td><td>Per building</td><td>Building management systems</td></tr>
      </table>
      <div class="sub-head"><i>✓</i>Safeguards applied right now</div>
      <ul class="plain st-list">
        <li><b>Minimum group size ${K_MIN}:</b> ${suppressed.length ? suppressed.map(s => `${s.cohort} in ${s.region} (fewer than ${K_MIN} people) merged into ${s.mergedInto}`).join('; ') : 'no groups needed merging'}.</li>
        <li><b>Career stage, not birth year:</b> generation appears only as a label. Needs are taken from the survey, not assumed from age.</li>
        <li><b>AI sees aggregates only:</b> Claude receives the same summary tables shown here, never individual answers.</li>
        <li><b>Opt-in and transparent:</b> survey participation is voluntary; this page is the plain-language notice of what is used and why.</li>
        <li><b>Purpose-limited:</b> data is used only to plan workplaces, not to assess individual performance.</li>
      </ul>
      <p class="muted">All workforce figures here are illustrative, for demonstration. Planning headcount ${fmt.int(H)}.</p>`);
  }

  function openAssumptions() {
    openXp('Assumptions', `
      <p class="lede">Every number in the studio comes from these assumptions. They are illustrative and meant to be replaced with your own data.</p>
      <table class="mini-table">${ASSUMPTIONS.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
      <p class="muted">Evidence notes: sitting near teammates increases the feedback people receive, especially newer employees (Emanuel, Harrington &amp; Pallais, "The Power of Proximity to Coworkers", 2023).
      Workplace needs vary more by life and career stage than by birth year, so the model segments by career stage.</p>`);
  }

  // ---------- map ----------

  function updateMap() {
    const s = sel();
    if (typeof setCommuteFlows === 'function') setCommuteFlows(s.flows, s.sc.name);
  }

  // ---------- render & events ----------

  function render() {
    compute();
    renderSites();
    renderCards();
    renderTable();
    $('#stCarbon').innerHTML = carbonChart();
    $('#stCommute').innerHTML = commuteChart();
    renderImpact();
    updateMap();
    if (typeof renderOverviewWork === 'function') renderOverviewWork();
  }

  function bindTooltips(root) {
    const tipEl = document.createElement('div');
    tipEl.className = 'viz-tip';
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
    root.addEventListener('mousemove', ev => {
      const t = ev.target.closest('[data-tip]');
      tipEl.hidden = !t;
      if (!t) return;
      tipEl.textContent = t.dataset.tip;
      tipEl.style.left = `${Math.min(ev.clientX + 14, window.innerWidth - tipEl.offsetWidth - 10)}px`;
      tipEl.style.top = `${ev.clientY + 14}px`;
    });
    root.addEventListener('mouseleave', () => { tipEl.hidden = true; });
  }

  function init() {
    const root = $('#studio');
    $('#stNeeds').innerHTML = needsChart();
    $('#stOrg').textContent = `${fmt.int(ORG.headcount)} people · lease ends ${ORG.leaseExpiry}`;
    root.addEventListener('change', ev => {
      if (ev.target.name === 'stCurrent') {
        st.selection.current = ev.target.value;
        st.selection.candidates = st.selection.candidates.filter(id => id !== ev.target.value);
        render();
      } else if (ev.target.dataset.cand) toggleCandidate(ev.target.dataset.cand);
      else if (ev.target.id === 'stHub') { st.selection.hub = ev.target.checked; render(); }
    });
    root.addEventListener('click', ev => {
      const dot = ev.target.closest('[data-site]');
      if (dot) { toggleCandidate(dot.dataset.site); return; }
      const card = ev.target.closest('[data-sc]');
      if (card) {
        st.selected = card.dataset.sc;
        render();
        const hub = sel().sc.sites.find(s => s.hub) || sel().sc.sites[0];
        select(BUILDINGS.findIndex(b => b.id === hub.id));
      }
    });
    $('#stDays').addEventListener('input', ev => { st.policy.days = +ev.target.value; $('#stDaysVal').textContent = `${st.policy.days} days`; render(); });
    $('#stAnchors').addEventListener('change', ev => { st.policy.anchors = ev.target.checked; render(); });
    $('#stPods').addEventListener('change', ev => { st.policy.pods = ev.target.checked; render(); });
    // Weights run 0-100 but cannot be 0: every factor must count for something
    root.querySelectorAll('[data-weight]').forEach(inp => {
      const label = inp.previousElementSibling, value = label.querySelector('b');
      const name = label.firstChild.textContent.trim();
      const warn = document.createElement('p');
      warn.className = 'st-warn';
      warn.setAttribute('role', 'alert');
      warn.hidden = true;
      inp.after(warn);
      inp.addEventListener('input', () => {
        const v = +inp.value;
        value.textContent = v;
        inp.classList.toggle('bad', v === 0);
        warn.hidden = v !== 0;
        warn.textContent = `${name} cannot be 0. Set it to at least 1.`;
        if (v === 0) return; // keep the last valid weight until a non-zero value is chosen
        st.weights[inp.dataset.weight] = v;
        render();
      });
      inp.addEventListener('change', () => {
        if (+inp.value !== 0) return;
        inp.value = st.weights[inp.dataset.weight];
        value.textContent = inp.value;
        inp.classList.remove('bad');
        warn.textContent = `${name} cannot be 0, so it was restored to ${inp.value}.`;
        toast(`${name} weight cannot be 0. Restored to ${inp.value}.`);
        clearTimeout(warn.timer);
        warn.timer = setTimeout(() => { warn.hidden = true; }, 3500);
      });
    });
    $('#stPrivacy').addEventListener('click', openPrivacy);
    $('#stAssumptions').addEventListener('click', openAssumptions);
    $('#stMemoBtn').addEventListener('click', writeMemo);
    bindTooltips(root);
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
  return { render, state: st, scenarios: () => st.scenarios, openPrivacy, openAssumptions };
})();
