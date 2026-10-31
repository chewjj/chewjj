// Offline copilot: answers portfolio questions by routing them to the models with rule-based intent parsing.
// Used when no Claude API key is connected (see ai.js for the Claude-powered copilot).

const Copilot = (() => {
  const plans = PortfolioTools.plans;
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

  function parseBudget(t) {
    const m = t.match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m|mil|million)\b/i) || t.match(/\$\s*(\d[\d,]*)/);
    if (!m) return null;
    const v = parseFloat(m[1].replace(/,/g, ''));
    const unit = (m[2] || '').toLowerCase();
    return unit === 'k' ? v * 1e3 : unit.startsWith('m') ? v * 1e6 : v;
  }

  function parseCount(t) {
    const m = t.match(/\b(\d+|one|two|three|four|five|six)\s+(?:\w+\s+)?(buildings|assets|properties|sites)\b/i);
    if (!m) return null;
    return WORDS[m[1].toLowerCase()] || parseInt(m[1], 10);
  }

  const buildingLink = i => `<a href="#" class="blink" data-building="${i}">${BUILDINGS[i].name}</a>`;
  const strandTag = y => `<span class="strand ${strandClass(y)}">${strandLabel(y)}</span>`;

  function planAnswer(text) {
    const budget = parseBudget(text) ?? getBudget();
    const protect = /without|maintain|protect|not (hurt|harm|reduce|lower)|tenant|comfort|wellbeing|satisf|happy/i.test(text);
    const count = parseCount(text);
    const { id, genes, explored, paretoSize } = PortfolioTools.recommendPlan(budget, protect, count);
    const s = statsWithSavings(genes);
    return `
      <p>I ran the <b>NSGA-II optimiser</b> on a <b>${fmt.money(budget)}</b> budget: <b>${fmt.int(explored)}</b> plans explored,
      <b>${paretoSize}</b> Pareto-optimal.${protect ? ` Constraint applied: portfolio People Score must stay ≥ today's <b>${BASE_STATS.people.toFixed(1)}</b>.` : ''}
      ${count ? ` Showing the <b>${count}</b> highest-impact buildings (uses ${fmt.money(s.capex)}).` : ''}</p>
      ${planSummaryHTML(genes)}
      ${planTableHTML(genes)}
      <div class="chat-actions"><button class="btn sm" data-plan="${id}">Apply this plan</button></div>`;
  }

  function strandingAnswer() {
    const rows = BUILDINGS.map((b, i) => ({ i, e: CACHE[i][state.plan[i]] }))
      .sort((a, b) => (a.e.strand ?? 9999) - (b.e.strand ?? 9999));
    const by2030 = rows.filter(r => r.e.strand !== null && r.e.strand <= 2030).length;
    return `
      <p><b>${by2030} of ${BUILDINGS.length}</b> assets cross their CRREM 1.5°C pathway by 2030 under the current plan.
      Stranded assets face falling valuations, higher financing costs and tenants walking away.</p>
      <ol class="rank">${rows.map(r => `<li>${buildingLink(r.i)} ${strandTag(r.e.strand)}
        <span class="muted">${r.e.intensity.toFixed(0)} kgCO₂e/m² vs ${pathwayAt(BUILDINGS[r.i].type, 2025).toFixed(0)} allowed</span></li>`).join('')}</ol>`;
  }

  function overcoolAnswer() {
    const bit = actionBit('temp');
    const rows = BUILDINGS.map((b, i) => ({ b, i, e: BASELINE[i], t: CACHE[i][bit] }))
      .filter(r => r.t && r.e.pmv < -0.3)
      .sort((a, b) => a.e.pmv - b.e.pmv);
    if (!rows.length) return '<p>No assets are significantly over-cooled.</p>';
    return `
      <p>Yes: <b>${rows.length}</b> assets are over-cooled. These are classic Singapore offices running at 22–23°C, where people wear jackets indoors.
      This is the rare <b>win-win</b>: raising the setpoint to 25.5°C with smart fans cuts energy <i>and</i> improves comfort.</p>
      <table class="mini-table"><tr><th>Building</th><th>Setpoint</th><th>PMV now → after</th><th>Energy cut</th><th>tCO₂e/yr</th></tr>
      ${rows.map(r => `<tr><td>${buildingLink(r.i)}</td><td>${r.b.setpoint}°C</td>
        <td>${r.e.pmv.toFixed(2)} → <b>${r.t.pmv.toFixed(2)}</b></td><td>${fmt.pct(ACTIONS[1].cut(r.b))}</td>
        <td>−${fmt.int(r.e.carbon - r.t.carbon)}</td></tr>`).join('')}</table>`;
  }

  function consolidationAnswer() {
    const bit = actionBit('consol');
    const rows = BUILDINGS.map((b, i) => ({ b, i, e: BASELINE[i], c: CACHE[i][bit] })).filter(r => r.c);
    const total = rows.reduce((s, r) => s + r.e.carbon - r.c.carbon, 0);
    return `
      <p>Hybrid work leaves <b>${rows.length}</b> assets below 65% average occupancy. Consolidating teams onto fewer floors on low-attendance days
      saves <b>${fmt.int(total)} tCO₂e/yr</b>. There is a small people cost (disruption) that the engagement app offsets.</p>
      <table class="mini-table"><tr><th>Building</th><th>Occupancy</th><th>Energy cut</th><th>tCO₂e/yr</th></tr>
      ${rows.map(r => `<tr><td>${buildingLink(r.i)}</td><td>${fmt.pct(r.b.occ)}</td><td>${fmt.pct(ACTIONS[5].cut(r.b))}</td>
        <td>−${fmt.int(r.e.carbon - r.c.carbon)}</td></tr>`).join('')}</table>`;
  }

  function alignmentAnswer() {
    const rows = BUILDINGS.map((b, i) => {
      const e = CACHE[i][state.plan[i]];
      const need = Math.max(0, 1 - pathwayAt(b.type, 2030) / (e.eui * gridEF(2030)));
      return { i, need };
    }).sort((a, b) => b.need - a.need);
    return `
      <p>Energy reduction each asset still needs to sit on its CRREM 1.5°C pathway in <b>2030</b> (from the current plan):</p>
      <ol class="rank">${rows.map(r => `<li>${buildingLink(r.i)} <b>${r.need > 0 ? '−' + fmt.pct(r.need) : '✓ aligned'}</b></li>`).join('')}</ol>
      <p class="muted">Tip: ask me for a plan with a budget, e.g. “I have S$20M, maximise carbon cut”.</p>`;
  }

  function peopleAnswer() {
    const rows = BUILDINGS.map((b, i) => ({ i, e: CACHE[i][state.plan[i]] })).sort((a, b) => a.e.people - b.e.people);
    const driver = e => [['thermal comfort', e.thermal], ['air quality', e.iaq], ['occupant satisfaction', e.pulse]].sort((a, b) => a[1] - b[1])[0][0];
    return `
      <p>People Score combines ISO 7730 thermal comfort (40%), indoor air quality (30%) and occupant pulse (30%). Weakest assets first:</p>
      <ol class="rank">${rows.slice(0, 6).map(r => `<li>${buildingLink(r.i)} <b>${r.e.people.toFixed(0)}</b>
        <span class="muted">weakest driver: ${driver(r.e)}</span></li>`).join('')}</ol>`;
  }

  const targetBuilding = text => PortfolioTools.mentionedBuilding(text) ?? state.selected;

  function whatIfRow(label, r) {
    return `<tr><td>${label}</td><td>${r.change.energy_pct > 0 ? '+' : ''}${r.change.energy_pct}%</td>
      <td>${r.after.thermal_comfort.pmv} · ${r.after.thermal_comfort.sensation}</td>
      <td>${r.after.mould_risk.level}</td><td>${r.after.crrem_stranding_year}</td></tr>`;
  }

  function mouldAnswer(text) {
    const i = targetBuilding(text), b = BUILDINGS[i];
    const risk = PortfolioTools.assess_mould_risk({ building: b.id });
    const scenarios = [];
    if (b.allowed & actionBit('temp') && !(cur(i).mask & actionBit('temp'))) {
      scenarios.push(['Raise setpoint to 25.5°C + smart fans', PortfolioTools.simulate_what_if({ building: b.id, add_measures: ['temp'] })]);
    }
    scenarios.push([`Dehumidify to 55% RH`, PortfolioTools.simulate_what_if({ building: b.id, relative_humidity_pct: 55 })]);
    if (!(cur(i).mask & actionBit('dcv'))) {
      scenarios.push(['Both, plus demand-controlled ventilation', PortfolioTools.simulate_what_if({
        building: b.id, relative_humidity_pct: 55, add_measures: ['dcv', ...(b.allowed & actionBit('temp') && !(cur(i).mask & actionBit('temp')) ? ['temp'] : [])],
      })]);
    }
    return `
      <p>Mould screen for ${buildingLink(i)}: risk is <b>${risk.risk_level}</b>
      (${risk.relative_humidity_pct}% RH, coldest surfaces ~${risk.coldest_surface_c}°C vs outdoor dew point ${risk.outdoor_dew_point_c}°C).</p>
      <ul>${risk.drivers.map(d => `<li>${d}</li>`).join('')}</ul>
      <table class="mini-table"><tr><th>Change</th><th>Energy</th><th>Comfort (PMV)</th><th>Mould risk</th><th>Strands</th></tr>
      ${scenarios.map(([label, r]) => whatIfRow(label, r)).join('')}</table>
      <p class="muted">Also: inspect and clean affected areas, find leaks and air gaps, and check that the dehumidification and drain pans work. Connect Claude for a tailored plan.</p>`;
  }

  function setpointAnswer(text, requested) {
    const i = targetBuilding(text), b = BUILDINGS[i];
    const current = cur(i).ta;
    // Already there: show the opposite move instead, which is usually the win-win in over-cooled offices
    const same = Math.abs(requested - current) < 0.05;
    const setpoint = same ? 25.5 : requested;
    const r = PortfolioTools.simulate_what_if({ building: b.id, setpoint_c: setpoint, ...(same && setpoint > current ? { air_speed_ms: 0.25 } : {}) });
    const up = r.change.energy_pct > 0;
    return `
      ${same ? `<p>${buildingLink(i)} is <b>already at ${current}°C</b>, and occupants feel ${pmvLabel(cur(i).pmv).toLowerCase()}. Here is the opposite move, raising it to 25.5°C with gentle fans:</p>` : ''}
      <p>What-if for ${buildingLink(i)}: air-con from <b>${r.before.indoor.setpoint_c}°C → ${setpoint}°C</b> (nothing applied).</p>
      <table class="mini-table"><tr><th></th><th>Now</th><th>At ${setpoint}°C</th></tr>
      <tr><td>Energy</td><td>${fmt.int(r.before.energy_mwh_per_yr)} MWh</td><td>${fmt.int(r.after.energy_mwh_per_yr)} MWh (${up ? '+' : ''}${r.change.energy_pct}%)</td></tr>
      <tr><td>Emissions</td><td>${fmt.int(r.before.emissions_tco2e_per_yr)} t</td><td>${fmt.int(r.after.emissions_tco2e_per_yr)} t</td></tr>
      <tr><td>Energy cost</td><td colspan="2">${up ? '+' : '−'}${fmt.money(Math.abs(r.change.energy_cost_sgd_per_yr))}/yr</td></tr>
      <tr><td>Comfort (PMV)</td><td>${r.before.thermal_comfort.pmv} · ${r.before.thermal_comfort.sensation}</td><td>${r.after.thermal_comfort.pmv} · ${r.after.thermal_comfort.sensation}</td></tr>
      <tr><td>% dissatisfied</td><td>${r.before.thermal_comfort.predicted_dissatisfied_pct}%</td><td>${r.after.thermal_comfort.predicted_dissatisfied_pct}%</td></tr>
      <tr><td>Mould risk (coldest surface vs ${OUTDOOR_DEW_POINT}°C dew point)</td><td>${r.before.mould_risk.level} · ${r.before.mould_risk.coldest_surface_c}°C</td><td>${r.after.mould_risk.level} · ${r.after.mould_risk.coldest_surface_c}°C</td></tr>
      <tr><td>CRREM stranding</td><td>${r.before.crrem_stranding_year}</td><td>${r.after.crrem_stranding_year}</td></tr></table>
      ${setpoint < r.before.indoor.setpoint_c ? `<p>Colder air costs carbon and money, leaves more people feeling cold, and pushes surfaces further below the outdoor dew point, which <b>raises condensation and mould risk</b>.</p>` : ''}`;
  }

  function workplaceAnswer() {
    const ranked = [...Studio.state.results].sort((a, b) => a.rank - b.rank);
    const base = ranked.find(r => r.sc.id === 'renew');
    const p = Studio.state.policy;
    return `
      <p>Your lease at ${buildingById(ORG.currentSite).name} ends in ${ORG.leaseExpiry}. From the portfolio sites selected in the studio, with ${p.days} office days${p.anchors ? ', coordinated anchor days' : ''} and the current leadership weights, the scenarios rank:</p>
      <table class="mini-table"><tr><th>#</th><th>Scenario</th><th>5-yr cost</th><th>tCO₂e/yr</th><th>Early-career &gt;1 hr</th><th>Mentoring</th></tr>
      ${ranked.map(r => `<tr><td>${r.rank}</td><td>${r.sc.name}</td><td>${fmt.money(r.cost5)}</td><td>${fmt.int(r.annualT)}</td>
        <td>${Math.round(r.cohorts.early.longShare * 100)}%</td><td>${Math.round(r.mentoring)}</td></tr>`).join('')}</table>
      <p>Commuting is ${Math.round((base.commuteT / base.annualT) * 100)}% of today's workplace carbon, so location matters as much as the building. Open the <b>Workplace Scenario Studio</b> at the top of the page to change the policy and weights, or connect Claude for a decision memo.</p>`;
  }

  const help = `
    <p>I can reason over your portfolio's carbon and people data. Try:</p>
    <ul><li>“I have S$5M, which 3 buildings should we retrofit first without hurting comfort?”</li>
    <li>“Which buildings are at risk of stranding?”</li><li>“Are any buildings over-cooled?”</li>
    <li>“Where can hybrid work save carbon?”</li><li>“What do we need for 2030 alignment?”</li><li>“Generate an ESG report”</li></ul>`;

  function ask(text) {
    const t = text.toLowerCase();
    if (/report|esg|gresb|disclos/.test(t)) { openReport(); return '<p>I generated the ESG report from the current plan. It is open now, ready to print or save as PDF.</p>'; }
    if (/renew|relocat|lease|gen ?z|early.career|graduate|commut|hub|where should we work|office days|workforce/.test(t)) return workplaceAnswer();
    if (/mou?ld|fung|damp|condensat|humid/.test(t)) return mouldAnswer(text);
    const sp = t.match(/\b(1[8-9]|2\d|30)(?:\.\d)?\s*(?:°|deg|degrees?)?\s*c?\b/);
    if (sp && /air.?con|aircon|setpoint|thermostat|temperature|cool|°c|degrees?/.test(t)) return setpointAnswer(text, parseFloat(sp[0]));
    if (parseBudget(t) !== null || /retrofit|invest|spend|budget|prioriti|plan\b/.test(t)) return planAnswer(text);
    if (/strand|risk|crrem/.test(t)) return strandingAnswer();
    if (/cold|cool|temperature|setpoint|thermostat/.test(t)) return overcoolAnswer();
    if (/consolidat|hybrid|occupan|empty|under.?used|floor/.test(t)) return consolidationAnswer();
    if (/2030|align|target|net.?zero|pathway/.test(t)) return alignmentAnswer();
    if (/people|wellbeing|comfort|happ|satisf|tenant/.test(t)) return peopleAnswer();
    return help;
  }

  const suggestions = [
    'Our lease ends in 2027. Should we renew, consolidate or relocate?',
    'How would relocating to Changi affect early-career employees?',
    'My building has mould. What changes do you propose?',
    'What if I lower the aircon to 22°C?',
    'I have S$5M — which 3 buildings should we retrofit first without hurting tenant comfort?',
    'Which buildings are at risk of stranding?',
    'Are any of our buildings over-cooled?',
    'Where can hybrid work save carbon?',
    'What cuts do we need for 2030 alignment?',
    'Generate an ESG report',
  ];

  return { ask, plans, suggestions };
})();
