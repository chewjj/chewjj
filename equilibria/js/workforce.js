// Workforce & workplace scenarios: a fictional organisation, its aggregated workforce data, and a model that
// compares renewing, right-sizing, consolidating, relocating or going hub-and-spoke on cost, carbon (building,
// commuting, fit-out), employee experience and early-career impacts. All data is synthetic and illustrative,
// and only aggregated, opt-in figures are used: no individual employee records exist in this tool.

const ORG = {
  name: 'Your organisation',
  headcount: 1200,
  growth: 0.02,         // annual headcount growth
  horizon: 5,           // years compared (new lease term)
  currentSite: 'QEX',
  currentArea: 14000,   // m² leased today
  leaseExpiry: 2027,
  surveyResponse: 0.62, // opt-in pulse survey response rate
};

const K_MIN = 10; // privacy threshold: any group smaller than this is merged into its nearest region

const REGIONS = [
  { id: 'C', name: 'Central', lat: 1.300, lng: 103.830 },
  { id: 'E', name: 'East', lat: 1.352, lng: 103.940 },
  { id: 'N', name: 'North', lat: 1.432, lng: 103.786 },
  { id: 'NE', name: 'North-East', lat: 1.375, lng: 103.893 },
  { id: 'W', name: 'West', lat: 1.345, lng: 103.715 },
];

// Career stages, not generations, drive the model; generation is a secondary label only.
// home = share of the cohort living in each region (aggregated postcode sector -> region); mode = commute mode share.
const COHORTS = [
  { id: 'early', name: 'Early-career', detail: '0–3 years in work · mostly Gen Z', share: 0.24,
    home: { C: 0.12, E: 0.24, N: 0.18, NE: 0.26, W: 0.20 }, mode: { pt: 0.86, car: 0.06, active: 0.08 } },
  { id: 'mid', name: 'Mid-career', detail: 'mostly Millennials · 45% with caregiving duties', share: 0.46,
    home: { C: 0.18, E: 0.22, N: 0.14, NE: 0.24, W: 0.22 }, mode: { pt: 0.64, car: 0.31, active: 0.05 } },
  { id: 'senior', name: 'Senior & leaders', detail: 'mostly Gen X and Baby Boomers', share: 0.30,
    home: { C: 0.36, E: 0.26, N: 0.02, NE: 0.18, W: 0.18 }, mode: { pt: 0.52, car: 0.45, active: 0.03 } },
];

// Opt-in pulse survey: % of each cohort rating the need "very important" (synthetic)
const NEEDS = [
  { need: 'Learning from colleagues in person', early: 78, mid: 52, senior: 41 },
  { need: 'Time and space to mentor others', early: 22, mid: 47, senior: 64 },
  { need: 'Short, predictable commute', early: 71, mid: 76, senior: 58 },
  { need: 'Quiet space for focus work', early: 55, mid: 68, senior: 66 },
  { need: 'Flexibility over where I work', early: 63, mid: 81, senior: 62 },
  { need: 'Belonging and social connection', early: 69, mid: 51, senior: 47 },
  { need: 'Healthy, comfortable building', early: 58, mid: 62, senior: 64 },
  { need: 'Employer acting on climate', early: 57, mid: 47, senior: 40 },
];

// Candidate workplaces are buildings in the portfolio. rent = S$/m²/month; amenity = 0-1 access to food, transit and third places.
const SITES = {
  MBT: { rent: 120, amenity: 0.95 },
  QEX: { rent: 115, amenity: 0.95 },
  PGP: { rent: 108, amenity: 0.95 },
  BGM: { rent: 86, amenity: 1.0 },
  AGW: { rent: 78, amenity: 0.8 },
  FSL: { rent: 72, amenity: 0.85 },
  CIH: { rent: 50, amenity: 0.65 },
};

const WX = {
  workWeeks: 46,
  deskArea: 9,             // m² per desk including circulation
  collabShare: 0.35,       // meeting and collaboration space on top of desk area
  podsExtra: 0.05,         // mentoring and learning pods
  peakFactor: 1.25,        // anchor-day peak vs average attendance when office days are coordinated
  unplannedPeak: 1.1,      // peak vs average when everyone picks their own days
  buffer: 1.05,            // desk buffer on peak days
  fitout: { renew: 250, reconfigure: 900, new: 1800 },     // S$/m²
  embodied: { renew: 0.03, reconfigure: 0.08, new: 0.15 }, // tCO2e/m² of fit-out materials
  moveCostPerHead: 1500,   // S$
  ef: { pt: 0.04, car: 0.17, active: 0 },                  // kgCO2e per passenger-km
  detour: 1.3,             // road/rail distance vs straight line
  activeMaxKm: 5,          // beyond this, walkers and cyclists switch to public transport
  ptMin: km => 15 + km * 2.0,
  carMin: km => 8 + km * 1.3,
  activeMin: km => km * 5,
  fare: km => Math.min(2.37, 0.99 + km * 0.07), // S$ per public-transport trip (approximate distance fare)
};

const POLICY_DEFAULT = { days: 3, anchors: true, pods: true };

// Which portfolio buildings are the current office and the relocation candidates (set in the Studio's first panel)
const DEFAULT_SELECTION = { current: 'QEX', candidates: ['AGW', 'CIH', 'BGM', 'FSL'], hub: true };

// ---------- helpers ----------

const REGION_BY_ID = Object.fromEntries(REGIONS.map(r => [r.id, r]));
const buildingById = id => BUILDINGS.find(b => b.id === id);
const WORKPLACE_SITES = Object.keys(SITES);

// Workforce-weighted home locations (aggregated, after privacy merging)
function homeWeights() {
  const H = planningHeadcount(), w = {};
  COHORTS.forEach(c => Object.entries(privateHome(c, H).home).forEach(([rid, s]) => { w[rid] = (w[rid] || 0) + H * c.share * s; }));
  return w;
}

// Average distance from home to the nearest of a set of sites
function reachKm(siteIds, w = homeWeights()) {
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  return Object.entries(w).reduce((sum, [rid, n]) => sum + n * Math.min(...siteIds.map(id => km(REGION_BY_ID[rid], buildingById(id)))), 0) / total;
}

// Hub = the most central site; spokes = the pair that brings the nearest office closest to where people live
function pickHubAndSpokes(pool, hub) {
  const w = homeWeights();
  hub = hub || pool.reduce((best, id) => (reachKm([id], w) < reachKm([best], w) ? id : best));
  const rest = pool.filter(id => id !== hub);
  let spokes = rest.slice(0, 2), bestKm = Infinity;
  rest.forEach((a, i) => rest.slice(i + 1).forEach(b => {
    const d = reachKm([hub, a, b], w);
    if (d < bestKm) { bestKm = d; spokes = [a, b]; }
  }));
  return { hub, spokes };
}

// Build the scenario list from the sites chosen in the portfolio
function buildScenarios(sel = DEFAULT_SELECTION) {
  const cur = buildingById(sel.current);
  const list = [
    { id: 'renew', name: 'Renew as-is', icon: '↻', sites: [{ id: cur.id, share: 1 }], area: 'current', fitout: 'renew', measures: [], move: false,
      blurb: `Stay at ${cur.name} on the same ${ORG.currentArea.toLocaleString('en-SG')} m² with a light refresh.` },
    { id: 'rightsize', name: 'Right-size & retrofit', icon: '⇲', sites: [{ id: cur.id, share: 1 }], area: 'demand', fitout: 'reconfigure', measures: ['temp', 'dcv', 'led'], move: false,
      blurb: `Stay at ${cur.name}, hand back floors we no longer need, and retrofit the space we keep.` },
    ...sel.candidates.filter(id => id !== cur.id).map(id => {
      const b = buildingById(id);
      return { id: `move-${id}`, name: `Relocate to ${b.name}`, icon: '→', sites: [{ id, share: 1 }], area: 'demand', fitout: 'new', measures: [], move: true, planB: true,
        blurb: `Consolidate into ${b.name} (${b.area}, built ${b.built}), sized to real attendance.` };
    }),
  ];
  const pool = [...new Set([cur.id, ...sel.candidates])];
  if (sel.hub && pool.length >= 3) {
    const { hub, spokes } = pickHubAndSpokes(pool, cur.id);
    const n = id => buildingById(id).name;
    // keep the current building as the hub (reconfigured) and add two small new spokes; only the spoke share moves
    list.push({ id: 'hub', name: 'Hub & spokes', icon: '✳', sites: [{ id: hub, share: 0.7, hub: true, fitout: 'reconfigure' }, ...spokes.map(id => ({ id, share: 0.15 }))],
      area: 'demand', fitout: 'new', measures: [], move: 0.3,
      blurb: `Keep ${n(hub)} as the hub for anchor days, and add small spokes at ${n(spokes[0])} and ${n(spokes[1])} near where people live.` });
  }
  return list;
}

function km(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h)) * WX.detour;
}

const planningHeadcount = () => Math.round(ORG.headcount * Math.pow(1 + ORG.growth, ORG.horizon / 2));

// Privacy: merge any cohort x region cell below K_MIN people into its nearest region
function privateHome(cohort, H = planningHeadcount()) {
  const heads = H * cohort.share;
  const home = { ...cohort.home };
  const suppressed = [];
  Object.keys(home).forEach(rid => {
    if (heads * home[rid] >= K_MIN) return;
    const from = REGION_BY_ID[rid];
    const to = REGIONS.filter(r => r.id !== rid && heads * home[r.id] >= K_MIN).sort((x, y) => km(from, x) - km(from, y))[0];
    home[to.id] += home[rid];
    delete home[rid];
    suppressed.push({ cohort: cohort.name, region: from.name, mergedInto: to.name });
  });
  return { home, suppressed };
}

function nearestSite(region, siteIds) {
  return siteIds.reduce((best, id) => (km(region, buildingById(id)) < km(region, buildingById(best)) ? id : best));
}

// Share of a cohort whose nearest site is each site
function nearestShares(cohort, siteIds) {
  const out = {};
  Object.entries(privateHome(cohort).home).forEach(([rid, s]) => {
    const n = nearestSite(REGION_BY_ID[rid], siteIds);
    out[n] = (out[n] || 0) + s;
  });
  return out;
}

const overlap = (p, q) => Object.keys(p).reduce((sum, k) => sum + p[k] * (q[k] || 0), 0);

// ---------- the model ----------

function evaluateWorkplace(sc, policy = POLICY_DEFAULT) {
  const H = planningHeadcount();
  const days = policy.days;
  const anchorDays = policy.anchors ? Math.min(2, days) : 0;
  const fa = anchorDays / days;
  const peakShare = Math.min(1, (days / 5) * (policy.anchors ? WX.peakFactor : WX.unplannedPeak));
  const peak = H * peakShare;
  const perDesk = WX.deskArea * (1 + WX.collabShare + (policy.pods ? WX.podsExtra : 0));
  const area = sc.area === 'current' ? ORG.currentArea : Math.round((Math.ceil(peak * WX.buffer) * perDesk) / 100) * 100;
  const capacity = area / perDesk;
  const siteIds = sc.sites.map(s => s.id);
  const hubId = (sc.sites.find(s => s.hub) || sc.sites[0]).id;

  // Where each region's office days are spent: anchor days at the hub, other days at the nearest site
  const dayMix = region => {
    if (siteIds.length === 1) return { [siteIds[0]]: 1 };
    const near = nearestSite(region, siteIds);
    const mix = { [hubId]: fa };
    mix[near] = (mix[near] || 0) + (1 - fa);
    return mix;
  };

  // Commuting, per cohort
  const cohorts = {};
  const flows = {};
  let commuteKg = 0, allMin = 0, allN = 0, allLong = 0;
  COHORTS.forEach(c => {
    const heads = H * c.share;
    let tSum = 0, nSum = 0, long = 0, fare = 0, ptN = 0;
    Object.entries(privateHome(c, H).home).forEach(([rid, hs]) => {
      const region = REGION_BY_ID[rid], n = heads * hs;
      Object.entries(dayMix(region)).forEach(([sid, frac]) => {
        if (!frac) return;
        const d = km(region, buildingById(sid));
        flows[`${rid}>${sid}`] = (flows[`${rid}>${sid}`] || 0) + n * frac;
        Object.entries(c.mode).forEach(([m, ms]) => {
          const mode = m === 'active' && d > WX.activeMaxKm ? 'pt' : m;
          const p = n * ms * frac;
          const t = mode === 'car' ? WX.carMin(d) : mode === 'active' ? WX.activeMin(d) : WX.ptMin(d);
          tSum += p * t;
          nSum += p;
          if (t > 60) long += p;
          commuteKg += p * d * 2 * days * WX.workWeeks * WX.ef[mode];
          if (mode === 'pt') { fare += p * WX.fare(d) * 2 * days * (52 / 12); ptN += p; }
        });
      });
    });
    cohorts[c.id] = { minutes: tSum / nSum, longShare: long / nSum, weeklyHours: ((tSum / nSum) * 2 * days) / 60, monthlyFare: ptN ? fare / ptN : 0 };
    allMin += tSum; allN += nSum; allLong += long;
  });

  // Buildings: our floors run at each building's intensity (with any retrofit measures)
  let kwh = 0, rent = 0, comfort = 0, amenity = 0;
  const siteRows = sc.sites.map(s => {
    const i = BUILDINGS.findIndex(b => b.id === s.id), b = BUILDINGS[i];
    const mask = sc.measures.reduce((m, id) => (b.allowed & actionBit(id) ? m | actionBit(id) : m), 0);
    const e = CACHE[i][mask], a = area * s.share;
    kwh += e.eui * a;
    rent += a * SITES[s.id].rent * 12;
    comfort += e.people * s.share;
    amenity += SITES[s.id].amenity * s.share;
    return { id: s.id, name: b.name, area: a, hub: !!s.hub, share: s.share, eui: e.eui, people: e.people, pmv: e.pmv, built: b.built };
  });

  // Early-career learning: chance a mentor is in the same place on a junior's office day, scaled by in-person time
  const pJ = nearestShares(COHORTS[0], siteIds), pS = nearestShares(COHORTS[2], siteIds);
  const sameSite = siteIds.length === 1 ? 1 : overlap(pJ, pS);
  const mentorPresence = fa + (1 - fa) * (days / 5) * sameSite;
  const mentoring = 100 * mentorPresence * Math.min(1, days / 3) * (policy.pods ? 1 : 0.85);

  // Belonging: whole organisation in one place, local amenity, and enough shared days
  const pAll = {};
  COHORTS.forEach(c => Object.entries(nearestShares(c, siteIds)).forEach(([s, v]) => { pAll[s] = (pAll[s] || 0) + v * c.share; }));
  const colocation = siteIds.length === 1 ? 1 : fa + (1 - fa) * overlap(pAll, pAll);
  const belonging = 100 * colocation * amenity * Math.min(1, days / 2.5);

  const energyCost = kwh * TARIFF;
  const fitShare = key => sc.sites.reduce((s, x) => s + x.share * WX[key][x.fitout || sc.fitout], 0);
  const fitout = area * fitShare('fitout');
  const move = H * WX.moveCostPerHead * (sc.move === true ? 1 : sc.move || 0);
  const buildingT = (kwh * GRID_EF_2025) / 1000;
  const commuteT = commuteKg / 1000;
  const embodiedT = area * fitShare('embodied');
  const avgMinutes = allMin / allN;

  return {
    sc, policy, H, days, peak, area, capacity, utilisation: peak / capacity,
    rent, energyCost, fitout, move,
    annualCost: rent + energyCost,
    cost5: ORG.horizon * (rent + energyCost) + fitout + move,
    buildingT, commuteT, embodiedT,
    annualT: buildingT + commuteT + embodiedT / ORG.horizon,
    cohorts, avgMinutes, longShare: allLong / allN,
    mentoring, belonging, comfort, siteRows,
    flows: Object.entries(flows).map(([k, n]) => { const [rid, sid] = k.split('>'); return { region: rid, site: sid, heads: n }; }),
  };
}

// Four pillars, each 0-100 where higher is better, then min-max normalised across scenarios and weighted
const commuteScore = min => clamp(100 - (min - 20) * 2, 0, 100);

function pillars(r) {
  const e = r.cohorts.early;
  return {
    cost: -r.cost5,
    carbon: -r.annualT,
    experience: (commuteScore(r.avgMinutes) + r.belonging + r.comfort) / 3,
    early: (r.mentoring + commuteScore(e.minutes) + (1 - e.longShare) * 100) / 3,
  };
}

function scoreScenarios(results, weights) {
  const keys = Object.keys(weights);
  const raw = results.map(pillars);
  const total = keys.reduce((s, k) => s + weights[k], 0) || 1;
  results.forEach((r, i) => {
    r.pillars = {};
    keys.forEach(k => {
      const vals = raw.map(p => p[k]);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      r.pillars[k] = hi === lo ? 1 : (raw[i][k] - lo) / (hi - lo);
    });
    r.score = keys.reduce((s, k) => s + r.pillars[k] * weights[k], 0) / total;
  });
  // Plan A (stay in the current building) is ranked first; relocations are Plan B, ranked among themselves
  const planB = r => (r.sc.planB ? 1 : 0);
  let a = 0, b = 0;
  [...results].sort((x, y) => planB(x) - planB(y) || y.score - x.score).forEach((r, k) => {
    r.rank = k + 1;
    r.plan = r.sc.planB ? 'B' : 'A';
    r.label = r.sc.planB ? `B${++b}` : `#${++a}`;
  });
  return results;
}

function privacyReport() {
  const H = planningHeadcount();
  return COHORTS.flatMap(c => privateHome(c, H).suppressed);
}

const ASSUMPTIONS = [
  ['Planning headcount', `${ORG.headcount.toLocaleString('en-SG')} today, +${ORG.growth * 100}%/yr → mid-term ${planningHeadcount().toLocaleString('en-SG')}`],
  ['Lease term compared', `${ORG.horizon} years`],
  ['Space per desk', `${WX.deskArea} m² + ${WX.collabShare * 100}% collaboration (+${WX.podsExtra * 100}% with mentoring pods)`],
  ['Peak attendance', `average × ${WX.peakFactor} with coordinated anchor days (× ${WX.unplannedPeak} without); ${Math.round((WX.buffer - 1) * 100)}% desk buffer`],
  ['Rent (S$/m²/month)', Object.entries(SITES).map(([id, s]) => `${buildingById(id).name} ${s.rent}`).join(' · ')],
  ['Fit-out (S$/m²)', `refresh ${WX.fitout.renew} · reconfigure ${WX.fitout.reconfigure} · new ${WX.fitout.new}; moving S$${WX.moveCostPerHead}/person`],
  ['Building energy', 'Our floors use the building\'s energy intensity (kWh/m²), including any retrofit; grid 0.412 kgCO₂e/kWh (EMA)'],
  ['Commute emission factors', `public transport ${WX.ef.pt}, car ${WX.ef.car}, walk/cycle 0 kgCO₂e per passenger-km`],
  ['Commute distance & time', `straight line × ${WX.detour}; public transport 15 min + 2.0 min/km; car 8 min + 1.3 min/km; walk/cycle only under ${WX.activeMaxKm} km`],
  ['Fit-out embodied carbon', `refresh ${WX.embodied.renew} · reconfigure ${WX.embodied.reconfigure} · new ${WX.embodied.new} tCO₂e/m², spread over the lease`],
  ['Mentoring access index', 'chance a senior colleague is in the same place on an early-career employee\'s office day × in-person time (full at 3 days/week) × 0.85 without mentoring pods'],
  ['Belonging index', 'share of office days the whole organisation is in one place × local amenity × enough shared days (full at 2.5 days/week)'],
  ['Hub & spokes', 'the current building stays the hub for anchor days (reconfigured); other office days at the site nearest home; 30% of staff move to new spokes'],
  ['Plan A / Plan B', 'options that keep the current building are ranked first; relocations are a fallback, ranked among themselves'],
  ['Workforce data', 'synthetic and aggregated: career stage × home region × commute mode; opt-in pulse survey; no individual records'],
];
