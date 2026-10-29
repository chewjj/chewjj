// Core models: ISO 7730 thermal comfort (PMV/PPD), carbon, CRREM-style stranding and the People Score.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Predicted Mean Vote, ISO 7730. ta/tr in °C, vel in m/s, rh in %, met in met, clo in clo.
function pmv(ta, tr, vel, rh, met, clo) {
  const pa = rh * 10 * Math.exp(16.6536 - 4030.183 / (ta + 235));
  const icl = 0.155 * clo;
  const m = met * 58.15, mw = m;
  const fcl = icl <= 0.078 ? 1 + 1.29 * icl : 1.05 + 0.645 * icl;
  const hcf = 12.1 * Math.sqrt(vel);
  const taa = ta + 273, tra = tr + 273;
  const tcla = taa + (35.5 - ta) / (3.5 * icl + 0.1);
  const p1 = icl * fcl, p2 = p1 * 3.96, p3 = p1 * 100, p4 = p1 * taa;
  const p5 = 308.7 - 0.028 * mw + p2 * Math.pow(tra / 100, 4);
  let xn = tcla / 100, xf = tcla / 50, hc = hcf, n = 0;
  while (Math.abs(xn - xf) > 0.00015 && n++ < 150) {
    xf = (xf + xn) / 2;
    hc = Math.max(hcf, 2.38 * Math.pow(Math.abs(100 * xf - taa), 0.25));
    xn = (p5 + p4 * hc - p2 * Math.pow(xf, 4)) / (100 + p3 * hc);
  }
  const tcl = 100 * xn - 273;
  const hl1 = 3.05 * 0.001 * (5733 - 6.99 * mw - pa);
  const hl2 = mw > 58.15 ? 0.42 * (mw - 58.15) : 0;
  const hl3 = 1.7 * 0.00001 * m * (5867 - pa);
  const hl4 = 0.0014 * m * (34 - ta);
  const hl5 = 3.96 * fcl * (Math.pow(xn, 4) - Math.pow(tra / 100, 4));
  const hl6 = fcl * hc * (tcl - ta);
  const ts = 0.303 * Math.exp(-0.036 * m) + 0.028;
  return ts * (mw - hl1 - hl2 - hl3 - hl4 - hl5 - hl6);
}

const ppd = v => 100 - 95 * Math.exp(-0.03353 * v ** 4 - 0.2179 * v ** 2);

function pmvLabel(v) {
  if (v < -1.5) return 'Cold';
  if (v < -0.5) return 'Cool';
  if (v <= 0.5) return 'Neutral';
  if (v <= 1.5) return 'Warm';
  return 'Hot';
}

const gridEF = y => GRID_EF_2025 * Math.pow(1 - GRID_DECLINE, y - 2025);
const pathwayAt = (type, y) => PATHWAYS[type].start * Math.exp(-PATHWAYS[type].rate * (y - 2025));
const trajectory = eui => YEARS.map(y => eui * gridEF(y));

// First year the asset's carbon intensity exceeds its 1.5°C pathway; null = aligned beyond 2050
function strandingYear(type, eui) {
  for (const y of YEARS) if (eui * gridEF(y) > pathwayAt(type, y)) return y;
  return null;
}

const strandLabel = y => (y === null ? '2050+' : y <= 2025 ? 'Now' : String(y));
const strandClass = y => (y === null || y > 2040 ? 'ok' : y <= 2027 ? 'crit' : y <= 2032 ? 'risk' : 'watch');
const STRAND_COLORS = { crit: '#ff4d4d', risk: '#ff9f1c', watch: '#ffd23f', ok: '#3ddc97' };

BUILDINGS.forEach(b => {
  b.allowed = ACTIONS.reduce((m, a, k) => (a.applies(b) ? m | (1 << k) : m), 0);
  b.weight = b.gfa * b.occ; // People Score is weighted by headcount
});

const actionBit = id => 1 << ACTIONS.findIndex(a => a.id === id);

// Mould screening for tropical air-conditioned buildings: high indoor RH, or surfaces cooled below the
// outdoor dew point (humid air leaking in condenses on ducts, diffusers and the inside of the envelope).
const OUTDOOR_DEW_POINT = 24.5; // °C, typical Singapore

function dewPoint(t, rh) {
  const g = Math.log(rh / 100) + (17.62 * t) / (243.12 + t);
  return (243.12 * g) / (17.62 - g);
}

function mouldRisk(ta, rh) {
  const coldSurface = ta - 3; // diffusers, chilled-water pipes and AC-side walls run colder than room air
  const margin = coldSurface - OUTDOOR_DEW_POINT;
  const score = (rh >= 70 ? 2 : rh >= 60 ? 1 : 0) + (margin < -3 ? 2 : margin < 0 ? 1 : 0);
  return {
    level: ['low', 'moderate', 'elevated', 'high', 'high'][score],
    indoorDewPoint: dewPoint(ta, rh), coldSurface, margin,
  };
}

// Evaluate one building with a set of measures (bitmask over ACTIONS).
// ov = optional what-if overrides { setpoint, rh, airSpeed } applied on top of the measures.
function evaluate(b, mask, ov = {}) {
  const p = TYPE_PROFILE[b.type];
  const s = { ta: b.setpoint, vel: 0.1, trDelta: 0.5, co2: b.co2, pulse: b.pulse, occ: b.occ, rh: b.rh };
  let factor = 1, capexPerM2 = 0;
  ACTIONS.forEach((a, k) => {
    if (!(mask & (1 << k))) return;
    factor *= 1 - a.cut(b);
    capexPerM2 += a.capex;
    a.effect(s, b);
  });
  // Each °C of extra cooling costs ~3.5% of energy; each RH point removed ~0.4% (dehumidification)
  if (ov.setpoint != null) { factor *= 1 + 0.035 * (s.ta - ov.setpoint); s.ta = ov.setpoint; }
  if (ov.rh != null) { factor *= 1 + 0.004 * (s.rh - ov.rh); s.rh = ov.rh; }
  if (ov.airSpeed != null) s.vel = ov.airSpeed;
  const eui = b.eui * factor;
  const v = pmv(s.ta, s.ta + s.trDelta, s.vel, s.rh, p.met, p.clo);
  const pd = ppd(v);
  const thermal = clamp(100 - (pd - 5) * 1.6, 0, 100);
  const iaq = clamp(100 - (s.co2 - 600) / 9, 0, 100);
  const pulse = clamp(s.pulse, 0, 100);
  return {
    mask, eui,
    kwh: eui * b.gfa,
    intensity: eui * GRID_EF_2025,              // kgCO2e/m²/yr
    carbon: (eui * b.gfa * GRID_EF_2025) / 1e3, // tCO2e/yr
    capex: capexPerM2 * b.gfa,
    ta: s.ta, vel: s.vel, co2: s.co2, occ: s.occ, rh: s.rh,
    mould: mouldRisk(s.ta, s.rh),
    pmv: v, ppd: pd, thermal, iaq, pulse,
    people: 0.4 * thermal + 0.3 * iaq + 0.3 * pulse,
    strand: strandingYear(b.type, eui),
  };
}

// Precompute every valid measure combination per building (12 × 256) so the optimiser is pure lookups
const CACHE = BUILDINGS.map(b => {
  const arr = new Array(1 << ACTIONS.length);
  for (let m = 0; m < arr.length; m++) if ((m & ~b.allowed) === 0) arr[m] = evaluate(b, m);
  return arr;
});
const BASELINE = CACHE.map(c => c[0]);

function portfolioStats(plan) {
  let carbon = 0, capex = 0, kwh = 0, gfa = 0, pw = 0, pp = 0, stranded = 0;
  plan.forEach((m, i) => {
    const e = CACHE[i][m], b = BUILDINGS[i];
    carbon += e.carbon; capex += e.capex; kwh += e.kwh; gfa += b.gfa;
    pw += b.weight; pp += e.people * b.weight;
    if (e.strand !== null && e.strand <= 2030) stranded++;
  });
  return { carbon, capex, kwh, intensity: (carbon * 1000) / gfa, people: pp / pw, stranded };
}

const BASE_STATS = portfolioStats(BUILDINGS.map(() => 0));
BASE_STATS.savings = 0;
const statsWithSavings = plan => {
  const s = portfolioStats(plan);
  s.savings = (BASE_STATS.kwh - s.kwh) * TARIFF;
  return s;
};
const carbonCut = c => ((BASE_STATS.carbon - c) / BASE_STATS.carbon) * 100;

const fmt = {
  int: v => Math.round(v).toLocaleString('en-SG'),
  money: v => (Math.abs(v) >= 1e9 ? `S$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `S$${(v / 1e6).toFixed(1)}M` : `S$${Math.round(v / 1e3)}k`),
  pct: v => `${(v * 100).toFixed(0)}%`,
};
