// Green-lease negotiation: Landlord, Tenant and Planet agents negotiate a retrofit-and-comfort deal for the
// selected building, then a mediator writes the clauses. Live Claude agents when connected; otherwise a
// scripted negotiation filled with the same model numbers (and labelled as such).

const Negotiation = (() => {
  const TENANT_SHARE = 50;      // offline deal: % of energy savings the tenant passes to the landlord until payback
  const HOUSEHOLD_KWH = 4400;   // illustrative annual electricity use of a Singapore household
  const CAPEX_CAP_PER_M2 = 120; // S$/m² the landlord is willing to consider
  const ORDER = ['landlord', 'tenant', 'planet', 'landlord', 'tenant', 'planet'];

  const ROLES = {
    landlord: { name: 'Landlord', icon: '🏢', goal: 'Protect asset value and returns; avoid stranding; limited capex.',
      system: 'You are the asset manager of a Singapore REIT that owns this building, negotiating a green lease. You want to protect asset value from stranding and earn a return on retrofit capex, so you push for the tenant to share energy savings. You are commercially sharp but fair.' },
    tenant: { name: 'Tenant', icon: '👥', goal: 'Comfortable, healthy workplace for staff; lower total occupancy cost.',
      system: 'You are the head of workplace for the main corporate tenant of this building, representing the employees who work there. You care about comfort, health, air quality and productivity, and about total occupancy cost. You are sceptical of "warmer offices" unless comfort is guaranteed.' },
    planet: { name: 'Planet', icon: '🌏', goal: 'Stay on the 1.5°C pathway; real, verified reductions.',
      system: 'You are an independent climate advocate at the table, speaking for the planet. You hold both parties to the CRREM 1.5°C pathway, insist on real (not offset) reductions, transparent data sharing and a review checkpoint. You are direct and evidence-led.' },
  };

  // Retrofit package with the biggest carbon cut that does not lower the People Score, within a capex cap
  function bestPackage(i) {
    const b = BUILDINGS[i], base = BASELINE[i];
    let best = 0;
    CACHE[i].forEach((e, m) => {
      if (!e || e.people < base.people || e.capex > b.gfa * CAPEX_CAP_PER_M2) return;
      if (e.carbon < CACHE[i][best].carbon) best = m;
    });
    return best;
  }

  function dealNumbers(i, mask) {
    const b = BUILDINGS[i], before = BASELINE[i], after = CACHE[i][mask];
    const savings = (before.kwh - after.kwh) * TARIFF;
    return {
      b, before, after, mask,
      measures: ACTIONS.filter((a, k) => mask & (1 << k)),
      capex: after.capex, savings, payback: savings > 0 ? after.capex / savings : null,
      saved: before.carbon - after.carbon,
      households: Math.round((before.kwh - after.kwh) / HOUSEHOLD_KWH),
    };
  }

  function facts(n) {
    return JSON.stringify({
      building: `${n.b.name} (${n.b.type}, ${n.b.area}, built ${n.b.built}, ${n.b.gfa} m2)`,
      today: { setpoint_c: n.before.ta, pmv: +n.before.pmv.toFixed(2), pct_uncomfortable: Math.round(n.before.ppd), peak_co2_ppm: n.before.co2,
        mould_risk: n.before.mould.level, occupant_satisfaction_pct: n.before.pulse, emissions_tco2e_yr: Math.round(n.before.carbon), crrem_stranding_year: n.before.strand ?? 'beyond 2050' },
      proposed_package: n.measures.map(a => a.name),
      after_package: { setpoint_c: n.after.ta, pmv: +n.after.pmv.toFixed(2), pct_uncomfortable: Math.round(n.after.ppd), peak_co2_ppm: n.after.co2,
        mould_risk: n.after.mould.level, emissions_tco2e_yr: Math.round(n.after.carbon), crrem_stranding_year: n.after.strand ?? 'beyond 2050' },
      capex_sgd: Math.round(n.capex), energy_savings_sgd_yr: Math.round(n.savings), simple_payback_years: n.payback && +n.payback.toFixed(1),
      carbon_saved_tco2e_yr: Math.round(n.saved), equivalent_households_electricity: n.households,
      other_available_measures: ACTIONS.filter((a, k) => n.b.allowed & (1 << k) && !(n.mask & (1 << k))).map(a => a.name),
    });
  }

  // ---------- offline scripted negotiation ----------

  function script(n) {
    const names = n.measures.map(a => a.name).join(', ');
    const hasTemp = n.mask & actionBit('temp');
    return [
      ['landlord', `I'm prepared to fund ${names}: <b>${fmt.money(n.capex)}</b> of capex. It saves <b>${fmt.money(n.savings)}</b> a year in energy, but that mostly lands on your bill. I propose you share <b>${TENANT_SHARE}%</b> of the savings with us until the work is paid back (about ${(n.payback / (TENANT_SHARE / 100)).toFixed(1)} years).`],
      ['tenant', `Our people are already ${n.before.pmv < -0.5 ? `cold: <b>${Math.round(n.before.ppd)}%</b> are uncomfortable at ${n.before.ta}°C` : `only ${Math.round(n.before.pulse)}% satisfied`}${n.before.co2 > 1000 ? `, and meeting rooms hit ${fmt.int(n.before.co2)} ppm CO₂` : ''}. We'll share savings only with a <b>written comfort guarantee</b>: PMV within ±0.5, CO₂ under 1,000 ppm, humidity under 60%.${hasTemp ? ' And a warmer setpoint must come with fans, not just less cooling.' : ''}`],
      ['planet', `This building ${n.before.strand === null ? 'is aligned for now' : `strands in <b>${strandLabel(n.before.strand)}</b>`}. The package moves that to <b>${strandLabel(n.after.strand)}</b> and cuts <b>${fmt.int(n.saved)} tCO₂</b> a year, the electricity of about ${fmt.int(n.households)} homes. I'll back it if the reductions are real: no offsets counted, monthly energy data shared, and a 2030 checkpoint against the 1.5°C pathway.`],
      ['landlord', `Agreed on the comfort guarantee. The models put PMV at ${n.after.pmv.toFixed(2)} after the work, well inside ±0.5. In return I need the monthly data feed and your staff in the engagement programme. Savings share stays at ${TENANT_SHARE}%, capped at the capex.`],
      ['tenant', `Deal, with one condition: if comfort targets are breached three months in a row, the savings share pauses until it's fixed. That keeps everyone honest.`],
      ['planet', `Accepted. Write in the 2030 review: if the asset is off-pathway, both parties fund the next measures${n.b.allowed & actionBit('solar') && !(n.mask & actionBit('solar')) ? ', starting with rooftop solar' : ''}.`],
    ];
  }

  function scriptDeal(n) {
    return {
      summary: `Landlord funds ${fmt.money(n.capex)} of retrofits; the tenant shares ${TENANT_SHARE}% of energy savings until payback, backed by a comfort guarantee and shared data, with a 2030 pathway review.`,
      measures: n.measures.map(a => a.id),
      tenant_savings_share_pct: TENANT_SHARE,
      comfort_guarantee: 'PMV within ±0.5, CO₂ below 1,000 ppm and relative humidity below 60% in occupied hours',
      agreed: true,
      clauses: [
        { title: 'Retrofit works', detail: `Landlord delivers ${n.measures.map(a => a.name).join(', ')} within 12 months.`, benefits: 'all' },
        { title: 'Savings share', detail: `Tenant pays ${TENANT_SHARE}% of verified energy savings to the landlord until the capex is recovered.`, benefits: 'landlord' },
        { title: 'Comfort guarantee', detail: 'PMV within ±0.5, CO₂ < 1,000 ppm, RH < 60%. Three consecutive months of breach pauses the savings share.', benefits: 'tenant' },
        { title: 'Data sharing', detail: 'Monthly energy, comfort and occupant-pulse data shared between the parties.', benefits: 'planet' },
        { title: 'Real reductions', detail: 'Reductions are reported without offsets or certificates.', benefits: 'planet' },
        { title: '2030 pathway review', detail: 'If the asset is above its CRREM 1.5°C pathway in 2030, both parties fund the next measures.', benefits: 'all' },
      ],
    };
  }

  // ---------- UI ----------

  function turnBubble(role, html) {
    const r = ROLES[role];
    if (!$('#negoLog')) throw new Error('Negotiation closed.');
    const div = document.createElement('div');
    div.className = `nego-turn ${role}`;
    div.innerHTML = `<div class="nego-who"><i>${r.icon}</i>${r.name}</div><div class="nego-text">${html}</div>`;
    $('#negoLog').appendChild(div);
    div.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return div.querySelector('.nego-text');
  }

  function renderDeal(i, deal, live) {
    const allowedIds = ACTIONS.filter((a, k) => BUILDINGS[i].allowed & (1 << k)).map(a => a.id);
    const mask = deal.measures.filter(id => allowedIds.includes(id)).reduce((m, id) => m | actionBit(id), 0);
    const n = dealNumbers(i, mask);
    const benefitIcon = { landlord: '🏢', tenant: '👥', planet: '🌏', all: '🤝' };
    $('#negoDeal').innerHTML = `
      <div class="deal">
        <div class="deal-head"><span class="dbadge ${deal.agreed ? 'd-improved' : 'd-worsened'}">${deal.agreed ? 'Agreed' : 'No deal'}</span>
          <h3>Green lease · ${escapeHtml(n.b.name)}</h3>${info('greenlease')}<span class="muted">${live ? 'drafted by the Claude mediator' : 'offline scripted deal'}</span></div>
        <p class="diff-headline">${escapeHtml(deal.summary)}</p>
        <div class="plan-kpis">
          <div><span>Capex (landlord)</span><b>${fmt.money(n.capex)}</b><em>saves ${fmt.money(n.savings)}/yr</em></div>
          <div><span>Carbon cut</span><b>${fmt.int(n.saved)} t</b><em>≈ ${fmt.int(n.households)} homes' electricity</em></div>
          <div><span>Stranding</span><b>${strandLabel(n.before.strand)} → ${strandLabel(n.after.strand)}</b><em>CRREM 1.5°C</em></div>
          <div><span>% uncomfortable</span><b>${Math.round(n.before.ppd)}% → ${Math.round(n.after.ppd)}%</b><em>PMV ${n.before.pmv.toFixed(2)} → ${n.after.pmv.toFixed(2)}</em></div>
        </div>
        <p class="muted">Measures: ${n.measures.map(a => `${a.icon} ${a.name}`).join(' · ') || 'none'} · Tenant savings share ${deal.tenant_savings_share_pct}% · Comfort guarantee: ${escapeHtml(deal.comfort_guarantee)}</p>
        <ol class="clauses">${deal.clauses.map(c => `<li><i>${benefitIcon[c.benefits] || '🤝'}</i><div><b>${escapeHtml(c.title)}</b><p>${escapeHtml(c.detail)}</p></div></li>`).join('')}</ol>
        <div class="chat-actions"><button class="btn" id="negoSign" ${mask ? '' : 'disabled'}>✍ Sign &amp; apply to portfolio</button>
          <span class="muted">Applies the agreed measures to ${escapeHtml(n.b.name)}. Watch its column shrink on the 3D map.</span></div>
      </div>`;
    $('#negoSign').addEventListener('click', () => {
      state.plan[i] = mask;
      refreshAll();
      toast(`Green lease signed: ${n.b.name} measures applied`);
      closeXp();
    });
  }

  async function runOffline(i, n) {
    for (const [role, html] of script(n)) {
      const el = turnBubble(role, TYPING);
      await new Promise(r => setTimeout(r, 900));
      el.innerHTML = html;
    }
    renderDeal(i, scriptDeal(n), false);
  }

  async function runLive(i, n) {
    const f = facts(n), transcript = [];
    for (const role of ORDER) {
      const el = turnBubble(role, TYPING);
      let md = '';
      const prompt = `Building facts from the Footfall models:\n${f}\n\nNegotiation so far:\n${transcript.map(t => `${ROLES[t.role].name}: ${t.text}`).join('\n\n') || '(you open the negotiation)'}\n\nYour turn as the ${ROLES[role].name}. Reply in under 70 words, in the first person, using concrete numbers from the facts only. ${transcript.length >= 3 ? 'Converge towards a final deal.' : 'Make a concrete proposal or counter-proposal.'}`;
      const text = await AI.agentTurn(ROLES[role].system, prompt, d => { md += d; el.innerHTML = renderMarkdown(md); });
      transcript.push({ role, text });
    }
    $('#negoDeal').innerHTML = `<p class="muted">${TYPING} The mediator is drafting the green lease…</p>`;
    const ids = ACTIONS.filter((a, k) => BUILDINGS[i].allowed & (1 << k)).map(a => a.id);
    const deal = await AI.mediateDeal(`You are a neutral mediator. Write the green-lease deal the parties below reached for this building. Pick the agreed measures only from these ids: ${ids.join(', ')}. Write 4-7 short clauses.\n\nBuilding facts:\n${f}\n\nTranscript:\n${transcript.map(t => `${ROLES[t.role].name}: ${t.text}`).join('\n\n')}`, ids);
    renderDeal(i, deal, true);
  }

  function open(i = state.selected) {
    const n = dealNumbers(i, bestPackage(i));
    const live = AI.enabled();
    openXp('03 / Green-lease negotiation', `
      <p class="lede">Three agents negotiate a retrofit-and-comfort deal for <b>${n.b.name}</b>, using numbers from the Footfall models.
        ${live ? 'Each agent is a live Claude Opus 5.5 instance.' : 'Offline mode: a scripted negotiation filled with the model numbers. Connect Claude in the Copilot tab for live agents.'}</p>
      <div class="nego-roles">${Object.entries(ROLES).map(([k, r]) => `<div class="${k}"><i>${r.icon}</i><b>${r.name}</b><p>${r.goal}</p></div>`).join('')}</div>
      <div class="nego-log" id="negoLog"></div>
      <div id="negoDeal"><div class="chat-actions"><button class="btn" id="negoStart">▶ Start negotiation</button></div></div>`);
    $('#negoStart').addEventListener('click', async () => {
      $('#negoDeal').innerHTML = '';
      try {
        await (live ? runLive(i, n) : runOffline(i, n));
      } catch (err) {
        if ($('#negoDeal')) $('#negoDeal').innerHTML = `<p class="bad-txt">${escapeHtml(AI.describeError(err))}</p>`;
      }
    });
  }

  return { open, bestPackage, dealNumbers };
})();
