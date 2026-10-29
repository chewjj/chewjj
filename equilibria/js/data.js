// Synthetic portfolio: fictional buildings across Singapore. All figures are illustrative.

const GRID_EF_2025 = 0.412;   // kgCO2e/kWh, Singapore grid average emission factor (EMA)
const GRID_DECLINE = 0.015;   // assumed annual grid decarbonisation
const TARIFF = 0.28;          // S$/kWh commercial electricity tariff
const YEARS = Array.from({ length: 26 }, (_, i) => 2025 + i);

// CRREM-style 1.5°C decarbonisation pathways (illustrative): intensity(y) = start * e^(-rate * (y - 2025))
const PATHWAYS = {
  Office:      { start: 105, rate: 0.075 },
  Retail:      { start: 160, rate: 0.075 },
  'Mixed-use': { start: 120, rate: 0.075 },
  Logistics:   { start: 50,  rate: 0.070 },
};

// Typical occupant clothing (clo) and activity (met) per asset type, used by the PMV model
const TYPE_PROFILE = {
  Office:      { clo: 0.55, met: 1.1 },
  Retail:      { clo: 0.55, met: 1.3 },
  'Mixed-use': { clo: 0.55, met: 1.15 },
  Logistics:   { clo: 0.5,  met: 1.6 },
};

// eui = energy use intensity (kWh/m²/yr), occ = average occupancy, setpoint = °C,
// rh = relative humidity %, co2 = typical peak ppm, pulse = % occupants satisfied (QR pulse survey)
const BUILDINGS = [
  { id: 'MBT', name: 'Meridian Bay Tower',        area: 'Marina Bay',       type: 'Office',    lat: 1.2789, lng: 103.8536, gfa: 68000,  built: 1998, eui: 240, occ: 0.46, setpoint: 22.5, rh: 62, co2: 1180, pulse: 58 },
  { id: 'QEX', name: 'Quayside Exchange',         area: 'Raffles Place',    type: 'Office',    lat: 1.2840, lng: 103.8515, gfa: 82000,  built: 1992, eui: 285, occ: 0.62, setpoint: 22.0, rh: 60, co2: 1050, pulse: 52 },
  { id: 'PGP', name: 'Pagar Point',               area: 'Tanjong Pagar',    type: 'Office',    lat: 1.2765, lng: 103.8455, gfa: 45000,  built: 2008, eui: 205, occ: 0.71, setpoint: 23.0, rh: 58, co2: 920,  pulse: 66 },
  { id: 'FSL', name: 'Fusion Labs',               area: 'one-north',        type: 'Office',    lat: 1.2995, lng: 103.7872, gfa: 38000,  built: 2014, eui: 170, occ: 0.55, setpoint: 23.0, rh: 57, co2: 860,  pulse: 71 },
  { id: 'CIH', name: 'Changi Innovation Hub',     area: 'Changi Biz Park',  type: 'Office',    lat: 1.3343, lng: 103.9636, gfa: 52000,  built: 2004, eui: 155, occ: 0.41, setpoint: 23.5, rh: 63, co2: 780,  pulse: 69 },
  { id: 'JGP', name: 'Jurong Gateway Plaza',      area: 'Jurong East',      type: 'Retail',    lat: 1.3331, lng: 103.7423, gfa: 61000,  built: 2001, eui: 390, occ: 0.78, setpoint: 23.0, rh: 65, co2: 1120, pulse: 61 },
  { id: 'ORG', name: 'Orchard Galleria',          area: 'Orchard',          type: 'Retail',    lat: 1.3040, lng: 103.8318, gfa: 74000,  built: 2009, eui: 340, occ: 0.83, setpoint: 22.5, rh: 61, co2: 990,  pulse: 64 },
  { id: 'LCM', name: 'Lebar Central Mall',        area: 'Paya Lebar',       type: 'Retail',    lat: 1.3177, lng: 103.8926, gfa: 56000,  built: 2015, eui: 300, occ: 0.69, setpoint: 23.5, rh: 60, co2: 900,  pulse: 73 },
  { id: 'TLP', name: 'Tuas Logistics Park',       area: 'Tuas',             type: 'Logistics', lat: 1.3200, lng: 103.6400, gfa: 120000, built: 2006, eui: 95,  occ: 0.88, setpoint: 26.0, rh: 70, co2: 650,  pulse: 62 },
  { id: 'WDH', name: 'Woodlands Distribution Hub', area: 'Woodlands',       type: 'Logistics', lat: 1.4360, lng: 103.7860, gfa: 95000,  built: 2017, eui: 70,  occ: 0.74, setpoint: 26.5, rh: 68, co2: 620,  pulse: 76 },
  { id: 'BGM', name: 'Bugis Mosaic',              area: 'Bugis',            type: 'Mixed-use', lat: 1.3008, lng: 103.8555, gfa: 47000,  built: 2003, eui: 230, occ: 0.58, setpoint: 23.0, rh: 64, co2: 1040, pulse: 60 },
  { id: 'AGW', name: 'Alexandra Green Works',     area: 'Alexandra',        type: 'Mixed-use', lat: 1.2740, lng: 103.8010, gfa: 42000,  built: 2019, eui: 185, occ: 0.52, setpoint: 24.0, rh: 58, co2: 740,  pulse: 78 },
];

const SOLAR_SHARE = { Office: 0.03, Retail: 0.05, 'Mixed-use': 0.04, Logistics: 0.25 };

// Decarbonisation measures. cut = fraction of energy saved, capex = S$ per m² GFA,
// effect mutates the indoor state {ta, vel, trDelta, co2, pulse, occ} used by the people models.
const ACTIONS = [
  { id: 'led', name: 'LED + daylight sensors', icon: '💡', capex: 22,
    applies: () => true, cut: () => 0.08,
    effect: s => { s.pulse += 2; },
    note: 'Better light quality and less heat gain' },
  { id: 'temp', name: 'Setpoint 25.5°C + smart fans', icon: '🌀', capex: 14,
    applies: b => b.setpoint < 25, cut: b => 0.035 * (25.5 - b.setpoint) - 0.005,
    effect: s => { s.ta = 25.5; s.vel = 0.25; },
    note: 'Ends over-cooling; gentle air movement keeps people comfortable at 25.5°C' },
  { id: 'dcv', name: 'Demand-controlled ventilation', icon: '🫁', capex: 10,
    applies: () => true, cut: () => 0.06,
    effect: s => { s.co2 = Math.min(s.co2, 720); },
    note: 'CO₂ sensors ventilate only the zones people are actually in' },
  { id: 'chiller', name: 'High-efficiency chiller + AI controls', icon: '❄️', capex: 85,
    applies: b => b.type !== 'Logistics', cut: () => 0.18,
    effect: () => {},
    note: 'Biggest single energy lever, invisible to occupants' },
  { id: 'solar', name: 'Rooftop solar PV', icon: '☀️', capex: 30,
    applies: () => true, cut: b => SOLAR_SHARE[b.type],
    effect: () => {},
    note: 'On-site renewable generation' },
  { id: 'consol', name: 'Hybrid-work floor consolidation', icon: '🏢', capex: 6,
    applies: b => (b.type === 'Office' || b.type === 'Mixed-use') && b.occ < 0.65,
    cut: b => Math.min(0.2, 0.6 * (0.72 - b.occ)),
    effect: (s, b) => { s.occ = b.occ + (0.72 - b.occ) * 0.7; s.pulse -= 4; s.co2 += 40; },
    note: 'Close under-used floors on low-attendance days; teams sit closer together' },
  { id: 'film', name: 'Low-E window film', icon: '🪟', capex: 40,
    applies: b => b.type !== 'Logistics', cut: () => 0.05,
    effect: s => { s.trDelta = 0; s.pulse += 1; },
    note: 'Cuts solar heat and glare for desks near windows' },
  { id: 'engage', name: 'Occupant engagement app', icon: '📱', capex: 1.5,
    applies: () => true, cut: () => 0.03,
    effect: s => { s.pulse += 6; },
    note: 'QR comfort voting + green challenges; occupants feel heard' },
];
