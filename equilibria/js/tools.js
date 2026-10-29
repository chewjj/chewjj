// Portfolio tools: the functions the Claude copilot calls, also reused by the offline rule-based copilot.
// Every function takes a plain-object input (as Claude sends it) and returns plain JSON-able data.

const PortfolioTools = (() => {
  const plans = {};
  let planSeq = 0;
  const r1 = v => Math.round(v * 10) / 10;
  const r2 = v => Math.round(v * 100) / 100;

  function findBuilding(ref) {
    const q = String(ref ?? '').trim().toLowerCase();
    let i = BUILDINGS.findIndex(b => b.id.toLowerCase() === q || b.name.toLowerCase() === q);
    if (i < 0) i = BUILDINGS.findIndex(b => q && (b.name.toLowerCase().includes(q) || q.includes(b.name.toLowerCase()) || b.area.toLowerCase() === q));
    if (i < 0) throw new Error(`Unknown building "${ref}". Valid ids: ${BUILDINGS.map(b => `${b.id} (${b.name})`).join(', ')}`);
    return i;
  }

  // First building named in free text, or null
  function mentionedBuilding(text) {
    const t = text.toLowerCase();
    const i = BUILDINGS.findIndex(b => t.includes(b.name.toLowerCase()) || new RegExp(`\\b${b.id.toLowerCase()}\\b`).test(t)
      || t.includes(b.name.toLowerCase().split(' ')[0]));
    return i < 0 ? null : i;
  }

  const measureIds = mask => ACTIONS.filter((a, k) => mask & (1 << k)).map(a => a.id);

  function maskFromIds(i, ids = []) {
    return ids.reduce((m, id) => {
      const k = ACTIONS.findIndex(a => a.id === id);
      if (k < 0) throw new Error(`Unknown measure "${id}". Valid ids: ${ACTIONS.map(a => a.id).join(', ')}`);
      if (!(BUILDINGS[i].allowed & (1 << k))) throw new Error(`Measure "${id}" is not applicable to ${BUILDINGS[i].name}`);
      return m | (1 << k);
    }, 0);
  }

  function snapshot(e) {
    return {
      energy_mwh_per_yr: Math.round(e.kwh / 1000),
      emissions_tco2e_per_yr: Math.round(e.carbon),
      carbon_intensity_kgco2e_per_m2: r1(e.intensity),
      crrem_stranding_year: e.strand === null ? 'beyond 2050' : e.strand,
      indoor: { setpoint_c: e.ta, relative_humidity_pct: e.rh, air_speed_ms: e.vel, co2_ppm: Math.round(e.co2), occupancy_pct: Math.round(e.occ * 100) },
      thermal_comfort: { pmv: r2(e.pmv), sensation: pmvLabel(e.pmv), predicted_dissatisfied_pct: Math.round(e.ppd) },
      people_score: r1(e.people),
      mould_risk: { level: e.mould.level, indoor_dew_point_c: r1(e.mould.indoorDewPoint), coldest_surface_c: r1(e.mould.coldSurface) },
      measures_applied: measureIds(e.mask),
    };
  }

  function portfolioSummary(plan = state.plan) {
    const s = statsWithSavings(plan);
    return {
      emissions_tco2e_per_yr: Math.round(s.carbon),
      carbon_cut_vs_baseline_pct: r1(carbonCut(s.carbon)),
      people_score: r1(s.people),
      people_score_baseline: r1(BASE_STATS.people),
      assets_stranded_by_2030: s.stranded,
      capex_sgd: Math.round(s.capex),
      energy_savings_sgd_per_yr: Math.round(s.savings),
    };
  }

  function getPortfolioOverview() {
    return {
      portfolio: portfolioSummary(),
      buildings: BUILDINGS.map((b, i) => {
        const e = cur(i);
        return {
          id: b.id, name: b.name, type: b.type, area: b.area, gfa_m2: b.gfa,
          emissions_tco2e_per_yr: Math.round(e.carbon), crrem_stranding_year: e.strand ?? 'beyond 2050',
          people_score: r1(e.people), pmv: r2(e.pmv), setpoint_c: e.ta, relative_humidity_pct: e.rh,
          co2_ppm: Math.round(e.co2), mould_risk: e.mould.level, measures_applied: measureIds(e.mask),
        };
      }),
    };
  }

  function getBuildingDetails({ building }) {
    const i = findBuilding(building), b = BUILDINGS[i], e = cur(i);
    return {
      id: b.id, name: b.name, type: b.type, area: b.area, built: b.built, gfa_m2: b.gfa,
      current: snapshot(e),
      baseline_before_measures: snapshot(BASELINE[i]),
      measure_catalogue: ACTIONS.map((a, k) => {
        const ok = !!(b.allowed & (1 << k));
        return {
          id: a.id, name: a.name, applicable: ok, applied: !!(e.mask & (1 << k)),
          energy_cut_pct: ok ? r1(a.cut(b) * 100) : null, capex_sgd: ok ? Math.round(a.capex * b.gfa) : null, note: a.note,
        };
      }),
    };
  }

  function assessMouldRisk({ building }) {
    const i = findBuilding(building), b = BUILDINGS[i], e = cur(i), m = e.mould;
    const drivers = [];
    if (e.rh >= 60) drivers.push(`Indoor relative humidity ${e.rh}% (keep below 60% to stop mould growth)`);
    if (m.margin < 0) drivers.push(`Coldest surfaces ~${r1(m.coldSurface)}°C are below the outdoor dew point (${OUTDOOR_DEW_POINT}°C): humid air leaking in condenses on ducts, diffusers and the inside of the envelope. Over-cooling makes this worse.`);
    if (e.co2 > 1000) drivers.push(`Peak CO₂ ${Math.round(e.co2)} ppm points to under-ventilated zones where moisture also builds up`);
    if (!(e.mask & actionBit('dcv'))) drivers.push('No demand-controlled ventilation: fresh-air supply is not matched to occupied zones');
    return {
      building: b.name, risk_level: m.level,
      indoor_temperature_c: e.ta, relative_humidity_pct: e.rh,
      indoor_dew_point_c: r1(m.indoorDewPoint), coldest_surface_c: r1(m.coldSurface),
      outdoor_dew_point_c: OUTDOOR_DEW_POINT, condensation_margin_c: r1(m.margin),
      drivers,
      caveat: 'Screening model from building-level data, not a site survey. Visible mould should be inspected and remediated (find the moisture source, clean or replace affected materials).',
    };
  }

  function simulateWhatIf({ building, setpoint_c, relative_humidity_pct, air_speed_ms, add_measures = [], remove_measures = [] }) {
    const i = findBuilding(building), b = BUILDINGS[i], before = cur(i);
    if (setpoint_c != null && (setpoint_c < 18 || setpoint_c > 30)) throw new Error('setpoint_c must be between 18 and 30');
    if (relative_humidity_pct != null && (relative_humidity_pct < 35 || relative_humidity_pct > 90)) throw new Error('relative_humidity_pct must be between 35 and 90');
    if (air_speed_ms != null && (air_speed_ms < 0 || air_speed_ms > 1.5)) throw new Error('air_speed_ms must be between 0 and 1.5');
    const mask = (before.mask | maskFromIds(i, add_measures)) & ~maskFromIds(i, remove_measures);
    const after = evaluate(b, mask, { setpoint: setpoint_c, rh: relative_humidity_pct, airSpeed: air_speed_ms });
    return {
      building: b.name,
      scenario: { setpoint_c, relative_humidity_pct, air_speed_ms, add_measures, remove_measures },
      before: snapshot(before),
      after: snapshot(after),
      change: {
        energy_pct: r1((after.kwh / before.kwh - 1) * 100),
        emissions_tco2e_per_yr: Math.round(after.carbon - before.carbon),
        energy_cost_sgd_per_yr: Math.round((after.kwh - before.kwh) * TARIFF),
        extra_capex_sgd: Math.round(after.capex - before.capex),
        people_score_pts: r1(after.people - before.people),
      },
      note: 'What-if only: nothing has been applied to the portfolio.',
    };
  }

  function applyMeasures({ building, measures, mode = 'add' }) {
    const i = findBuilding(building), m = maskFromIds(i, measures);
    const prev = state.plan[i];
    state.plan[i] = mode === 'replace' ? m : mode === 'remove' ? prev & ~m : prev | m;
    refreshAll();
    return { building: BUILDINGS[i].name, now: snapshot(cur(i)), portfolio: portfolioSummary() };
  }

  // Runs NSGA-II and picks a plan: max carbon cut that keeps People Score ≥ baseline, else balanced
  function recommendPlan(budget, protect, count) {
    const run = Optimiser.runSync(budget, 60);
    const front = run.front();
    let choice;
    if (protect) {
      const ok = front.filter(p => p.people >= BASE_STATS.people);
      choice = ok.length ? ok.reduce((a, b) => (b.carbon < a.carbon ? b : a)) : front.reduce((a, b) => (b.people > a.people ? b : a));
    } else {
      choice = Optimiser.pick(front, 0.5);
    }
    let genes = choice.genes.slice();
    if (count) {
      const top = genes
        .map((m, i) => ({ i, saved: BASELINE[i].carbon - CACHE[i][m].carbon }))
        .filter(r => r.saved > 0)
        .sort((a, b) => b.saved - a.saved)
        .slice(0, count)
        .map(r => r.i);
      genes = genes.map((m, i) => (top.includes(i) ? m : 0));
    }
    const id = `p${++planSeq}`;
    plans[id] = genes;
    return { id, genes, explored: run.explored, paretoSize: front.length };
  }

  function runPortfolioOptimiser({ budget_sgd, protect_comfort = true, max_buildings }) {
    if (!(budget_sgd > 0)) throw new Error('budget_sgd must be positive');
    const p = recommendPlan(budget_sgd, protect_comfort, max_buildings);
    return {
      plan_id: p.id, budget_sgd, plans_explored: p.explored, pareto_optimal_plans: p.paretoSize,
      constraint: protect_comfort ? 'People Score must not fall below baseline' : 'balanced carbon vs people',
      result: portfolioSummary(p.genes),
      buildings: p.genes.map((m, i) => ({ m, i })).filter(r => r.m).map(({ m, i }) => ({
        id: BUILDINGS[i].id, name: BUILDINGS[i].name, measures: measureIds(m),
        tco2e_saved_per_yr: Math.round(BASELINE[i].carbon - CACHE[i][m].carbon),
        stranding_before: BASELINE[i].strand ?? 'beyond 2050', stranding_after: CACHE[i][m].strand ?? 'beyond 2050',
        people_before: r1(BASELINE[i].people), people_after: r1(CACHE[i][m].people),
      })),
      note: 'Not applied yet. The chat shows an "Apply plan" button; call apply_measures only if the user asks you to apply.',
    };
  }

  return {
    plans, findBuilding, mentionedBuilding, recommendPlan,
    get_portfolio_overview: getPortfolioOverview,
    get_building_details: getBuildingDetails,
    assess_mould_risk: assessMouldRisk,
    simulate_what_if: simulateWhatIf,
    apply_measures: applyMeasures,
    run_portfolio_optimiser: runPortfolioOptimiser,
  };
})();
