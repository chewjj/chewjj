// UI layer: KPI bar, portfolio map, building twin panel, optimiser, copilot chat, live ops feed and ESG report.

Chart.defaults.font.family = "'JetBrains Mono', ui-monospace, monospace";
Chart.defaults.font.size = 10;

const TILES = {
  dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  light: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
};
let C = {}; // theme colours, read from the CSS custom properties

const currentTheme = () => document.documentElement.dataset.theme;

function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = name => css.getPropertyValue(name).trim();
  C = {
    accent: v('--accent'), red: v('--red'), green: v('--green'), amber: v('--amber'), yellow: v('--yellow'), ink: v('--ink'),
    muted: v('--muted'), grid: v('--line'), marker: v('--marker'), bg: v('--bg'),
    explored: currentTheme() === 'light' ? 'rgba(13,20,24,.14)' : 'rgba(160,175,185,.16)',
  };
  Chart.defaults.color = C.muted;
  Chart.defaults.borderColor = C.grid;
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('eq-theme', theme); } catch (e) { /* storage unavailable */ }
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = document.getElementById('themeLabel');
  if (label) {
    label.textContent = next;
    document.getElementById('themeIcon').setAttribute('href', next === 'light' ? '#i-sun' : '#i-moon');
  }
  readTheme();
  $('#tileName').textContent = theme;
  applyMapTheme(theme);
  if (paretoChart) { styleParetoChart(); paretoChart.update('none'); }
  if (map) { updateMap(); renderDetail(); }
}

const state = { plan: BUILDINGS.map(() => 0), selected: 1, front: null, chosen: null, running: false };
const cur = i => CACHE[i][state.plan[i]];
const $ = sel => document.querySelector(sel);
const getBudget = () => +$('#budget').value * 1e6;
let live = BUILDINGS.map(() => ({ co2: 0, ta: 0, occ: 0 }));
let map, crremChart, paretoChart;

// ---------- shared HTML helpers ----------

function deltaTag(now, base, lowerIsBetter = true) {
  if (Math.abs(now - base) < 1e-6) return '';
  const better = lowerIsBetter ? now < base : now > base;
  return `<span class="delta ${better ? 'good' : 'bad'}">${now < base ? '▼' : '▲'} ${Math.abs(((now - base) / base) * 100).toFixed(0)}%</span>`;
}

function deltaPts(now, base) {
  if (Math.abs(now - base) < 0.05) return '';
  return `<span class="delta ${now > base ? 'good' : 'bad'}">${now > base ? '▲' : '▼'} ${Math.abs(now - base).toFixed(1)} pts</span>`;
}

const strandTag = y => `<span class="strand ${strandClass(y)}">${strandLabel(y)}</span>`;
const actionIcons = mask =>
  ACTIONS.map((a, k) => (mask & (1 << k) ? `<span class="ai" title="${a.name}">${a.icon}</span>` : '')).join('') || '<span class="muted">–</span>';

function planSummaryHTML(genes) {
  const s = statsWithSavings(genes), b = BASE_STATS;
  return `<div class="plan-kpis">
    <div><span>Carbon cut</span><b>${carbonCut(s.carbon).toFixed(1)}%</b><em>−${fmt.int(b.carbon - s.carbon)} tCO₂e/yr</em></div>
    <div><span>People Score</span><b>${s.people.toFixed(1)}</b><em>${deltaPts(s.people, b.people) || 'unchanged'}</em></div>
    <div><span>Capex ${info('capex')}</span><b>${fmt.money(s.capex)}</b><em>${s.savings > 0 ? `payback ${(s.capex / s.savings).toFixed(1)} yrs` : '–'}</em></div>
    <div><span>Stranded by 2030 ${info('stranded')}</span><b>${s.stranded} / ${BUILDINGS.length}</b><em>from ${b.stranded}</em></div>
  </div>`;
}

function planTableHTML(genes) {
  const rows = genes
    .map((m, i) => ({ i, m, e: CACHE[i][m], base: BASELINE[i] }))
    .filter(r => r.m)
    .sort((a, b) => b.base.carbon - b.e.carbon - (a.base.carbon - a.e.carbon));
  if (!rows.length) return '<p class="muted">No measures selected.</p>';
  return `<table class="mini-table">
    <tr><th>Building</th><th>Measures</th><th>tCO₂e/yr</th><th>Stranding</th><th>People</th></tr>
    ${rows.map(r => `<tr>
      <td><a href="#" class="blink" data-building="${r.i}">${BUILDINGS[r.i].name}</a></td>
      <td>${actionIcons(r.m)}</td>
      <td class="good-txt">−${fmt.int(r.base.carbon - r.e.carbon)}</td>
      <td>${strandTag(r.base.strand)} → ${strandTag(r.e.strand)}</td>
      <td>${r.base.people.toFixed(0)} → <b>${r.e.people.toFixed(0)}</b></td></tr>`).join('')}
  </table>`;
}

// ---------- glossary tooltips ----------
// Hover, focus or tap anything with data-term to see a plain-language explanation.

const GLOSSARY = {
  stranded: ['Stranded', 'A building is stranded when its carbon intensity rises above its 1.5°C pathway (CRREM). Stranded buildings risk lower valuations, higher financing costs and tenants leaving. Here, "stranded" means it crosses the pathway by 2027 or is already over it.'],
  'status-crit': ['Stranded', 'Crosses its 1.5°C carbon pathway by 2027, or is already above it. Needs action now.'],
  'status-risk': ['At risk', 'Crosses its 1.5°C carbon pathway between 2028 and 2032.'],
  'status-watch': ['Monitor', 'Crosses its 1.5°C carbon pathway between 2033 and 2040.'],
  'status-ok': ['Aligned', 'Stays within its 1.5°C carbon pathway beyond 2040.'],
  crrem: ['CRREM', 'Carbon Risk Real Estate Monitor: science-based carbon pathways for each building type. The stranding year is the first year a building\'s carbon intensity goes above its pathway. Pathways in this prototype are illustrative.'],
  pathway: ['1.5°C pathway', 'The maximum carbon intensity a building type can emit each year while staying consistent with limiting global warming to 1.5°C. It falls every year.'],
  intensity: ['Carbon intensity', 'Yearly operational emissions per square metre of floor area (kgCO₂e/m²), so buildings of different sizes can be compared.'],
  people: ['People Score', '0–100. 40% thermal comfort (ISO 7730 PMV), 30% indoor air quality (CO₂) and 30% occupant satisfaction from pulse surveys.'],
  pmv: ['PMV', 'Predicted Mean Vote (ISO 7730): how warm or cold people are predicted to feel, from −3 (cold) to +3 (hot). Between −0.5 and +0.5 is comfortable for most people.'],
  eui: ['Energy use intensity', 'Yearly energy use per square metre of floor area (kWh/m²).'],
  mentoring: ['Mentoring access index', 'The chance a senior colleague is in the same place on an early-career employee\'s office day, scaled by in-person time. Higher is better.'],
  belonging: ['Belonging index', 'How often the whole organisation is in one place, local amenities, and enough shared office days. Higher is better.'],
  emissions: ['Operational emissions', 'Yearly carbon from the electricity the buildings use (Scope 2): energy × Singapore grid factor of 0.412 kgCO₂e/kWh. No offsets are counted.'],
  capex: ['Capex', 'Capital expenditure: the upfront cost of retrofit measures, paid once.'],
  payback: ['Payback', 'Simple payback: capex ÷ yearly energy savings. The number of years until the investment pays for itself.'],
  gfa: ['GFA', 'Gross floor area: the total floor area of the building, in m².'],
  setpoint: ['Setpoint', 'The temperature the air-con aims for. Many Singapore offices over-cool at 22–23°C; 25.5°C with gentle fans saves energy and is comfortable for most people.'],
  co2: ['Indoor CO₂', 'A measure of how fresh the air is (ppm). Above about 1,000 ppm people feel drowsy and think less clearly; demand-controlled ventilation keeps it lower.'],
  pulse: ['Occupant pulse', 'Share of occupants who say they are satisfied in quick, anonymous QR surveys.'],
  whatif: ['Retrofit what-if', 'Toggle measures to see their effect on this building\'s energy, carbon, comfort and cost instantly. Changes become part of the portfolio plan.'],
  officedays: ['Office days per week', 'The hybrid policy. It drives desk demand and space, commuting carbon and how much in-person time people get.'],
  anchors: ['Coordinated anchor days', 'Teams come in on the same 2 days, so early-career staff and their mentors overlap. It raises mentoring access but needs more desks on those days.'],
  pods: ['Mentoring & learning pods', 'Small spaces near teams for coaching, pairing and onboarding. Adds about 5% floor area and improves mentoring access.'],
  weights: ['Leadership weights', 'How much each factor counts when ranking scenarios. Only the proportions matter: 50 and 25 means the first counts twice as much.'],
  cost5: ['5-year cost', 'Rent and energy over the 5-year lease term, plus one-off fit-out and moving costs.'],
  desk: ['Desk use on peak days', 'Share of desks occupied on the busiest day. Well below 70% means paying for empty space; near 100% means crowding.'],
  buildingenergy: ['Building energy', 'Carbon from the electricity used by the floors you occupy, at that building\'s energy intensity.'],
  commuting: ['Commuting emissions', 'Staff trips to the office: distance × office days × mode. Public transport 0.04, car 0.17 kgCO₂e per passenger-km.'],
  fitout: ['Fit-out materials', 'Embodied carbon from making and installing new partitions, floors and furniture, spread over the lease term.'],
  carbonsources: ['Carbon by source', 'Building energy (electricity for your floors), commuting (staff trips) and fit-out materials (embodied carbon of new interiors, spread over the lease).'],
  longcommute: ['Commutes over 60 minutes', 'Share of people whose one-way trip takes more than an hour. Long commutes weigh on wellbeing and retention.'],
  juniors: ['Juniors over 1 hour', 'Share of early-career employees (0–3 years in work) whose one-way commute would take more than an hour.'],
  avgcommute: ['Average commute', 'Average one-way door-to-door time across the workforce, by their usual mode, if everyone worked here.'],
  pareto: ['Pareto frontier', 'The set of plans where you cannot cut more carbon without lowering the People Score, or the other way round. Every plan off the line is beaten by one on it.'],
  nsga: ['NSGA-II', 'A genetic algorithm that evolves many candidate plans at once and keeps the best carbon-versus-people trade-offs each generation.'],
  budget: ['Capex budget', 'The most the retrofit plan may spend upfront across all buildings.'],
  priority: ['Priority', 'Chooses a plan on the Pareto frontier: towards Carbon favours bigger carbon cuts, towards People favours occupant wellbeing.'],
  insights: ['Insights generated', 'Alerts and suggestions created from the live sensor stream and occupant votes.'],
  autoresolved: ['Auto-resolved', 'Alerts the system handled by itself, for example boosting ventilation only in the zones that are occupied.'],
  diff: ['ESG report diff', 'Compares two sustainability reports to show what really changed, including accounting or boundary changes that can flatter results.'],
  redflags: ['Red flags', 'Possible greenwashing or weak disclosure: reductions that come from accounting changes, reliance on offsets or certificates, missed targets, or metrics quietly dropped.'],
  notcomparable: ['Not comparable', 'The method or boundary changed between the two reports, so the two numbers cannot be compared directly.'],
  rebaselined: ['Rebaselined', 'The target now starts from a different base year, which can reset or flatter the progress reported.'],
  scope1: ['Scope 1', 'Direct emissions from fuel burned on site, such as gas boilers or generators.'],
  scope2: ['Scope 2', 'Emissions from purchased electricity. Location-based uses the grid average; market-based counts renewable certificates and green tariffs, so it can fall without using less energy.'],
  scope3: ['Scope 3', 'Value-chain emissions, such as purchased goods, and tenants\' energy use in leased space.'],
  greenlease: ['Green lease', 'A lease where landlord and tenant share responsibility for energy, data and retrofits, for example by sharing the savings.'],
  comfortflex: ['Comfort flexibility', 'Carbon saved because occupants accept a slightly wider comfort range, such as 25.5°C with a fan.'],
  brown: ['Brown discount', 'A lower valuation for buildings above their carbon pathway. Illustrative here: up to 12%, scaled by how far above the pathway the building is.'],
};

const info = term => `<button type="button" class="info" data-term="${term}" aria-label="What is ${GLOSSARY[term][0]}?">?</button>`;

function bindTerms() {
  const tip = document.createElement('div');
  tip.className = 'term-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  let current = null;
  const show = el => {
    const t = GLOSSARY[el.dataset.term];
    if (!t) return;
    current = el;
    tip.innerHTML = `<b>${t[0]}</b>${t[1]}`;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - tip.offsetWidth - 8));
    const below = r.bottom + 8 + tip.offsetHeight < window.innerHeight;
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? r.bottom + 8 : r.top - tip.offsetHeight - 8}px`;
  };
  const hide = () => { tip.hidden = true; current = null; };
  document.addEventListener('mouseover', ev => { const el = ev.target.closest('[data-term]'); if (el) show(el); });
  document.addEventListener('mouseout', ev => { const el = ev.target.closest('[data-term]'); if (el && !el.contains(ev.relatedTarget)) hide(); });
  document.addEventListener('focusin', ev => { const el = ev.target.closest('[data-term]'); if (el) show(el); else hide(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') hide(); });
  // Scrolling (including the scroll-into-view when tabbing) follows the term; it only hides once the term is left
  window.addEventListener('scroll', () => {
    if (!current) return;
    if (current.isConnected && (current.matches(':hover') || current.contains(document.activeElement))) show(current);
    else hide();
  }, true);
}

// ---------- overview metric cards ----------

const icon = (name, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function spark(values, label) {
  if (values.length < 3) return ''; // a single building has nothing to compare
  const max = Math.max(...values) || 1;
  return `<div class="spark" title="${label}">${values.map(v => `<i style="height:${Math.max(4, (v / max) * 100)}%"></i>`).join('')}</div>`;
}

// ---------- overview scope: which buildings the Overview page covers ----------

let ovScope = 'all';
const BUILDING_TYPES = [...new Set(BUILDINGS.map(b => b.type))];

function scopeIndices() {
  if (ovScope === 'all') return BUILDINGS.map((_, i) => i);
  if (ovScope.startsWith('type:')) return BUILDINGS.map((b, i) => (b.type === ovScope.slice(5) ? i : -1)).filter(i => i >= 0);
  return [BUILDINGS.findIndex(b => b.id === ovScope)];
}

function scopeName() {
  if (ovScope === 'all') return `all ${BUILDINGS.length} buildings`;
  if (ovScope.startsWith('type:')) return `the ${scopeIndices().length} ${ovScope.slice(5).toLowerCase()} buildings`;
  return BUILDINGS[scopeIndices()[0]].name;
}

function scopeStats(plan, idx) {
  let carbon = 0, capex = 0, kwh = 0, gfa = 0, pw = 0, pp = 0, stranded = 0;
  idx.forEach(i => {
    const e = CACHE[i][plan[i]], b = BUILDINGS[i];
    carbon += e.carbon; capex += e.capex; kwh += e.kwh; gfa += b.gfa;
    pw += b.weight; pp += e.people * b.weight;
    if (e.strand !== null && e.strand <= 2030) stranded++;
  });
  return { carbon, capex, kwh, gfa, intensity: (carbon * 1000) / gfa, people: pp / pw, stranded };
}

function renderScopePicker() {
  const count = t => BUILDINGS.filter(b => b.type === t).length;
  $('#ovScope').innerHTML = `
    <optgroup label="Portfolio"><option value="all">all ${BUILDINGS.length} buildings</option></optgroup>
    <optgroup label="By type">${BUILDING_TYPES.map(t => `<option value="type:${t}">${t.toLowerCase()} buildings (${count(t)})</option>`).join('')}</optgroup>
    <optgroup label="One building">${BUILDINGS.map(b => `<option value="${b.id}">${b.name} · ${b.area}</option>`).join('')}</optgroup>`;
  $('#ovScope').value = ovScope;
}

function setScope(value) {
  ovScope = value;
  const idx = scopeIndices();
  $('#ovScope').value = value;
  $('#ovAssetCount').textContent = `${idx.length} ASSET${idx.length === 1 ? '' : 'S'} · CLICK A ROW TO OPEN`;
  $('#ovVerb').textContent = idx.length === 1 ? 'is' : 'are';
  if (idx.length === 1 && idx[0] !== state.selected) select(idx[0]); // keep the spec sheet and experiences on the same building
  renderKPIs();
  renderTable();
  renderOverview();
  renderOverviewAlerts();
}

function renderKPIs() {
  const idx = scopeIndices();
  const s = scopeStats(state.plan, idx), b = scopeStats(BUILDINGS.map(() => 0), idx);
  s.savings = (b.kwh - s.kwh) * TARIFF;
  const gfa = s.gfa;
  const one = idx.length === 1;
  const years = YEARS.filter((y, k) => k % 2 === 0).slice(0, 12);
  const tonnes = years.map(y => idx.reduce((sum, i) => sum + (CACHE[i][state.plan[i]].kwh * gridEF(y)) / 1000, 0));
  const stranded = years.map(y => idx.filter(i => { const st = CACHE[i][state.plan[i]].strand; return st !== null && st <= y; }).length);
  const pct = (now, base) => Math.abs(((now - base) / base) * 100).toFixed(1);
  const card = (ico, tone, label, value, unit, change, changeTone, sparkVals, sparkLabel) => `
    <article class="metric-card">
      <div class="metric-icon ${tone}">${icon(ico)}</div>
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value} <small>${unit}</small></div>
      <div class="metric-change ${changeTone}">${change}</div>
      ${spark(sparkVals, sparkLabel)}
    </article>`;
  $('#kpis').innerHTML = [
    card('cloud', 'green', `${one ? 'Building emissions' : 'Emissions'} ${info('emissions')}`, fmt.int(s.carbon), 'tCO₂e/yr',
      s.carbon < b.carbon ? `↓ ${pct(s.carbon, b.carbon)}% vs baseline` : 'Baseline · no measures applied', s.carbon < b.carbon ? 'good' : '', tonnes, 'Projected emissions to 2047'),
    card('bolt', 'cyan', `Carbon intensity ${info('intensity')}`, s.intensity.toFixed(1), 'kgCO₂e/m²',
      s.intensity < b.intensity ? `↓ ${pct(s.intensity, b.intensity)}% vs baseline` : 'Scope 2 · SG grid', s.intensity < b.intensity ? 'good' : '', tonnes.map(t => (t * 1000) / gfa), 'Projected intensity to 2047'),
    one
      ? (() => {
        const e = cur(idx[0]), o = BASELINE[idx[0]];
        return card('alert', 'amber', `CRREM stranding year ${info('crrem')}`, strandLabel(e.strand), '1.5°C pathway',
          e.strand !== o.strand ? `was ${strandLabel(o.strand)} at baseline` : STATUS_NAME[strandClass(e.strand)], e.strand === null || e.strand > 2032 ? 'good' : 'bad', tonnes.map(t => (t * 1000) / gfa), 'Projected intensity to 2047');
      })()
      : card('alert', 'amber', `Stranded by 2030 ${info('stranded')}`, s.stranded, `/ ${idx.length} assets`,
        s.stranded < b.stranded ? `↓ from ${b.stranded} at baseline` : 'CRREM 1.5°C pathway', s.stranded < b.stranded ? 'good' : 'bad', stranded, 'Cumulative stranded assets by year'),
    card('users', 'cyan', `People Score ${info('people')}`, s.people.toFixed(1), '/ 100',
      s.people > b.people + 0.05 ? `↑ ${(s.people - b.people).toFixed(1)} pts vs baseline` : 'Comfort · air · satisfaction', s.people > b.people + 0.05 ? 'good' : '', idx.map(i => CACHE[i][state.plan[i]].people).sort((x, y) => x - y), 'People Score by building'),
    card('wallet', '', `Capex committed ${info('capex')}`, fmt.money(s.capex), '',
      s.savings > 0 ? `saves ${fmt.money(s.savings)}/yr` : 'No retrofits committed', s.savings > 0 ? 'good' : '', idx.map(i => CACHE[i][state.plan[i]].capex + 1).sort((x, y) => x - y), 'Capex by building'),
  ].join('');
}

// ---------- 3D map ----------
// Portfolio zoom: each asset is a hex column, height = annual emissions, colour = stranding year.
// Street zoom (≥ STREET_ZOOM): real OpenStreetMap 3D buildings with the asset as a highlighted block.

const STREET_ZOOM = 13.5;
const METRES_PER_TONNE = 0.5;       // column height exaggeration for the portfolio view
const PORTFOLIO_VIEW = { pitch: 50, bearing: 75 }; // look east along the island so it fills the tall panel
const CITY_COLOR = { dark: '#20272c', light: '#d6d9d4' };
let mapReady = false, mapLabel, mapPopup;
let shownHeights = BUILDINGS.map(() => 0);

// Regular hexagon around a point, radius in metres
function hexagon(lng, lat, r) {
  const ring = [];
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    ring.push([lng + (r * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.sin(a)) / 110540]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

const realHeight = b => clamp((b.gfa / (b.type === 'Logistics' ? 9000 : 1600)) * 4.2, 18, 240);

function assetData() {
  const strand = { crit: C.red, risk: C.amber, watch: C.yellow, ok: C.green };
  const features = [];
  BUILDINGS.forEach((b, i) => {
    const props = { i, color: strand[strandClass(cur(i).strand)] };
    features.push({ type: 'Feature', properties: { ...props, kind: 'column', h: shownHeights[i] }, geometry: hexagon(b.lng, b.lat, 260) });
    features.push({ type: 'Feature', properties: { ...props, kind: 'block', h: realHeight(b) }, geometry: hexagon(b.lng, b.lat, 55) });
  });
  return { type: 'FeatureCollection', features };
}

function ringData() {
  const b = BUILDINGS[state.selected];
  const line = (r, scale) => ({ type: 'Feature', properties: { scale }, geometry: { type: 'LineString', coordinates: hexagon(b.lng, b.lat, r).coordinates[0] } });
  return { type: 'FeatureCollection', features: [line(420, 'far'), line(95, 'near')] };
}

function initMap() {
  const theme = currentTheme();
  const raster = url => ({ type: 'raster', tiles: [url], tileSize: 256, maxzoom: 16, attribution: 'Basemap © Esri, HERE, Garmin' });
  const empty = { type: 'FeatureCollection', features: [] };
  map = new maplibregl.Map({
    container: 'map',
    center: [103.82, 1.33], zoom: 9.6, pitch: 0, bearing: 0,
    attributionControl: { compact: true },
    style: {
      version: 8,
      sources: {
        'base-dark': raster(TILES.dark),
        'base-light': raster(TILES.light),
        omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors' },
        assets: { type: 'geojson', data: empty },
        ring: { type: 'geojson', data: empty },
        flows: { type: 'geojson', data: empty },
        homes: { type: 'geojson', data: empty },
      },
      layers: [
        { id: 'base-dark', type: 'raster', source: 'base-dark', layout: { visibility: theme === 'dark' ? 'visible' : 'none' } },
        { id: 'base-light', type: 'raster', source: 'base-light', layout: { visibility: theme === 'light' ? 'visible' : 'none' } },
        { id: 'city', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13,
          filter: ['!=', ['get', 'hide_3d'], true],
          paint: {
            'fill-extrusion-color': CITY_COLOR[theme],
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.9,
          } },
        { id: 'flow-lines', type: 'line', source: 'flows', maxzoom: STREET_ZOOM, layout: { 'line-cap': 'round' },
          paint: { 'line-color': C.accent, 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['get', 'heads'], 0, 0.5, 300, 7] } },
        { id: 'home-dots', type: 'circle', source: 'homes', maxzoom: STREET_ZOOM,
          paint: { 'circle-color': C.accent, 'circle-opacity': 0.25, 'circle-stroke-color': C.accent, 'circle-stroke-width': 1.5,
            'circle-radius': ['interpolate', ['linear'], ['get', 'heads'], 0, 4, 400, 22] } },
        { id: 'ring-far', type: 'line', source: 'ring', maxzoom: STREET_ZOOM, filter: ['==', ['get', 'scale'], 'far'],
          paint: { 'line-color': C.accent, 'line-width': 2, 'line-dasharray': [2, 1] } },
        { id: 'ring-near', type: 'line', source: 'ring', minzoom: STREET_ZOOM, filter: ['==', ['get', 'scale'], 'near'],
          paint: { 'line-color': C.accent, 'line-width': 2.5 } },
        { id: 'asset-columns', type: 'fill-extrusion', source: 'assets', maxzoom: STREET_ZOOM, filter: ['==', ['get', 'kind'], 'column'],
          paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.92 } },
        { id: 'asset-blocks', type: 'fill-extrusion', source: 'assets', minzoom: STREET_ZOOM, filter: ['==', ['get', 'kind'], 'block'],
          paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.95 } },
      ],
    },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.scrollZoom.disable();
  map.on('mousemove', ev => {
    $('#cursorCoords').textContent = `LAT ${ev.lngLat.lat.toFixed(4)}°N · LNG ${ev.lngLat.lng.toFixed(4)}°E · Z ${map.getZoom().toFixed(1)} · PITCH ${map.getPitch().toFixed(0)}°`;
  });

  const assetLayers = ['asset-columns', 'asset-blocks'];
  mapPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'map-pop' });
  map.on('mousemove', assetLayers, ev => {
    map.getCanvas().style.cursor = 'pointer';
    const i = ev.features[0].properties.i, b = BUILDINGS[i], e = cur(i);
    mapPopup.setLngLat(ev.lngLat).setHTML(`<b>${b.name}</b><br>${fmt.int(e.carbon)} tCO₂e/yr · ${e.intensity.toFixed(0)} kg/m²<br>
      Strands ${strandLabel(e.strand)} · People ${e.people.toFixed(0)}`).addTo(map);
  });
  map.on('mouseleave', assetLayers, () => { map.getCanvas().style.cursor = ''; mapPopup.remove(); });
  map.on('click', assetLayers, ev => select(ev.features[0].properties.i));

  const el = document.createElement('div');
  el.className = 'map-label';
  mapLabel = new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 14] });

  map.on('mousemove', 'flow-lines', ev => {
    const p = ev.features[0].properties;
    mapPopup.setLngLat(ev.lngLat).setHTML(`<b>${p.from} → ${p.to}</b><br>~${fmt.int(p.heads)} people (office-day weighted)<br><span class="muted">${p.scenario}</span>`).addTo(map);
  });
  map.on('mousemove', 'home-dots', ev => {
    const p = ev.features[0].properties;
    mapPopup.setLngLat(ev.lngLat).setHTML(`<b>${p.name} region</b><br>~${fmt.int(p.heads)} of your people live here<br><span class="muted">aggregated, groups under ${K_MIN} merged</span>`).addTo(map);
  });
  ['flow-lines', 'home-dots'].forEach(l => map.on('mouseleave', l, () => mapPopup.remove()));

  map.on('load', () => {
    mapReady = true;
    if (currentPage === 'portfolio') { mapFramed = true; portfolioView(2600); }
    updateMap();
    if (pendingFlows) setCommuteFlows(...pendingFlows);
  });
}

// Commute flows for the Workplace Scenario Studio: curved lines from home regions to the scenario's sites
let pendingFlows = null;

function setCommuteFlows(flows, scenarioName) {
  if (!mapReady) { pendingFlows = [flows, scenarioName]; return; }
  const arc = (a, b) => {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const cx = mx - (b[1] - a[1]) * 0.25, cy = my + (b[0] - a[0]) * 0.25;
    return Array.from({ length: 21 }, (_, k) => {
      const t = k / 20;
      return [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * cx + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * cy + t * t * b[1]];
    });
  };
  const lines = flows.filter(f => f.heads >= 1).map(f => {
    const r = REGION_BY_ID[f.region], s = buildingById(f.site);
    return { type: 'Feature', properties: { heads: f.heads, from: r.name, to: s.name, scenario: scenarioName },
      geometry: { type: 'LineString', coordinates: arc([r.lng, r.lat], [s.lng, s.lat]) } };
  });
  const homes = REGIONS.map(r => ({
    type: 'Feature', properties: { name: r.name, heads: flows.filter(f => f.region === r.id).reduce((s, f) => s + f.heads, 0) },
    geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
  })).filter(f => f.properties.heads > 0);
  map.getSource('flows').setData({ type: 'FeatureCollection', features: lines });
  map.getSource('homes').setData({ type: 'FeatureCollection', features: homes });
}

function portfolioView(duration = 1200) {
  const bounds = new maplibregl.LngLatBounds();
  BUILDINGS.forEach(b => bounds.extend([b.lng, b.lat]));
  const cam = map.cameraForBounds(bounds, { padding: 40, bearing: PORTFOLIO_VIEW.bearing });
  if (!cam) return; // map is on a hidden page; framed when the page opens
  map.flyTo({ ...cam, zoom: cam.zoom + 0.25, ...PORTFOLIO_VIEW, duration, essential: true });
}

function streetView() {
  const b = BUILDINGS[state.selected];
  map.flyTo({ center: [b.lng, b.lat], zoom: 15.8, pitch: 62, bearing: map.getBearing() - 35, duration: 2600, essential: true });
}

function flatView() {
  map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
}

// Animate column heights towards current emissions so applying a plan visibly shrinks the towers
function updateMap() {
  if (!mapReady) return;
  const target = BUILDINGS.map((b, i) => cur(i).carbon * METRES_PER_TONNE);
  const from = shownHeights.slice(), t0 = performance.now();
  cancelAnimationFrame(updateMap.raf);
  const frame = now => {
    const k = Math.min(1, (now - t0) / 900), ease = 1 - Math.pow(1 - k, 3);
    shownHeights = from.map((h, i) => h + (target[i] - h) * ease);
    map.getSource('assets').setData(assetData());
    if (k < 1) updateMap.raf = requestAnimationFrame(frame);
  };
  updateMap.raf = requestAnimationFrame(frame);
  map.getSource('ring').setData(ringData());
  const b = BUILDINGS[state.selected];
  mapLabel.getElement().innerHTML = `<i>${b.id}</i> ${b.name}`;
  mapLabel.setLngLat([b.lng, b.lat]).addTo(map);
}

function applyMapTheme(theme) {
  if (!mapReady) return;
  map.setLayoutProperty('base-dark', 'visibility', theme === 'dark' ? 'visible' : 'none');
  map.setLayoutProperty('base-light', 'visibility', theme === 'light' ? 'visible' : 'none');
  map.setPaintProperty('city', 'fill-extrusion-color', CITY_COLOR[theme]);
  map.setPaintProperty('ring-far', 'line-color', C.accent);
  map.setPaintProperty('flow-lines', 'line-color', C.accent);
  map.setPaintProperty('home-dots', 'circle-color', C.accent);
  map.setPaintProperty('home-dots', 'circle-stroke-color', C.accent);
  map.setPaintProperty('ring-near', 'line-color', C.accent);
}

// ---------- building digital twin panel ----------

const metric = (label, value, unit, extra) =>
  `<div class="metric"><span>${label}</span><b>${value} <small>${unit}</small></b><em>${extra || '&nbsp;'}</em></div>`;

const mini = (label, value, unit, score) => `<div class="mini">
  <span>${label}</span><b>${value} <small>${unit}</small></b>
  ${score === null ? '' : `<div class="bar"><i style="width:${score}%;background:${score > 70 ? 'var(--green)' : score > 45 ? 'var(--amber)' : 'var(--red)'}"></i></div>`}
</div>`;

function actionChip(b, e, a, k) {
  const ok = b.allowed & (1 << k), on = e.mask & (1 << k);
  return `<button class="chip-action ${on ? 'on' : ''}" data-k="${k}" ${ok ? '' : 'disabled'} title="${ok ? a.note : 'Not applicable to this asset'}">
    <span class="ico">${a.icon}</span>
    <span class="nm">${a.name}</span>
    <span class="meta">${ok ? `−${(a.cut(b) * 100).toFixed(0)}% energy · ${fmt.money(a.capex * b.gfa)}` : 'not applicable'}</span>
  </button>`;
}

function renderDetail() {
  const i = state.selected, b = BUILDINGS[i], base = BASELINE[i], e = cur(i);
  const savings = (base.kwh - e.kwh) * TARIFF;
  $('#detail').innerHTML = `
    <div class="sec-head">
      <span class="sec-no">02</span><span class="sec-title">Asset spec sheet</span>
      <span class="sec-meta">${b.id} · ${String(i + 1).padStart(2, '0')}/${BUILDINGS.length}</span>
      <span class="live-pill"><i></i>LIVE</span>
    </div>
    <div class="spec-title"><h2>${b.name}</h2></div>
    <p class="coords">${b.lat.toFixed(4)}°N ${b.lng.toFixed(4)}°E · ${b.area}</p>
    <dl class="spec">
      <div><dt>Type</dt><dd>${b.type}</dd></div>
      <div><dt>Built</dt><dd>${b.built}</dd></div>
      <div><dt>GFA ${info('gfa')}</dt><dd>${fmt.int(b.gfa)} m²</dd></div>
      <div><dt>EUI ${info('eui')}</dt><dd>${e.eui.toFixed(0)} kWh/m²</dd></div>
      <div><dt>Setpoint ${info('setpoint')}</dt><dd>${e.ta}°C</dd></div>
      <div><dt>Occupancy</dt><dd>${fmt.pct(e.occ)}</dd></div>
    </dl>
    <div class="metrics">
      ${metric(`Carbon intensity ${info('intensity')}`, e.intensity.toFixed(0), 'kgCO₂e/m²', deltaTag(e.intensity, base.intensity))}
      ${metric(`Stranding year ${info('crrem')}`, strandTag(e.strand), '', e.strand !== base.strand ? `<span class="delta good">was ${strandLabel(base.strand)}</span>` : 'vs CRREM 1.5°C')}
      ${metric('Emissions', fmt.int(e.carbon), 'tCO₂e/yr', deltaTag(e.carbon, base.carbon))}
      ${metric(`People Score ${info('people')}`, e.people.toFixed(0), '/100', deltaPts(e.people, base.people))}
    </div>
    <div class="sub-head"><i>02.1</i>Carbon trajectory <span class="hint">kgCO₂e/m² vs 1.5°C pathway</span></div>
    <div class="chart-box"><canvas id="crremChart"></canvas></div>
    <div class="sub-head"><i>02.2</i>People layer <span class="hint">ISO 7730 · IAQ · pulse</span></div>
    <div class="people">
      <div class="pmv">
        <div class="pmv-head"><span>Thermal comfort (PMV) ${info('pmv')}</span><b>${e.pmv >= 0 ? '+' : ''}${e.pmv.toFixed(2)} · ${pmvLabel(e.pmv)}</b></div>
        <div class="pmv-scale"><div class="pmv-comfort"></div><div class="pmv-marker" style="left:${clamp(((e.pmv + 3) / 6) * 100, 0, 100)}%"></div></div>
        <div class="pmv-ticks"><span>Cold</span><span>Cool</span><span>Neutral</span><span>Warm</span><span>Hot</span></div>
        <p class="tiny">${e.ta}°C · air ${e.vel} m/s · ${b.rh}% RH · <b>${e.ppd.toFixed(0)}%</b> predicted dissatisfied</p>
      </div>
      ${mini(`CO₂ (live) ${info('co2')}`, '<span id="liveCo2">–</span>', 'ppm', e.iaq)}
      ${mini('Occupancy (live)', '<span id="liveOcc">–</span>', '%', null)}
      ${mini(`Occupant pulse ${info('pulse')}`, e.pulse.toFixed(0), '% satisfied', e.pulse)}
    </div>
    <div class="sub-head"><i>02.3</i>Retrofit what-if ${info('whatif')} <span class="hint">toggle to simulate</span></div>
    <div class="actions">${ACTIONS.map((a, k) => actionChip(b, e, a, k)).join('')}</div>
    <div class="whatif">
      <div><span>Capex</span><b>${fmt.money(e.capex)}</b></div>
      <div><span>Energy savings</span><b>${fmt.money(savings)}/yr</b></div>
      <div><span>Payback ${info('payback')}</span><b>${savings > 0 ? (e.capex / savings).toFixed(1) + ' yrs' : '–'}</b></div>
    </div>`;
  drawCrrem(b, base, e);
  updateLiveFields();
}

function drawCrrem(b, base, e) {
  if (crremChart) crremChart.destroy();
  const strandPoint = (eui, y) => YEARS.map(yr => (yr === y ? eui * gridEF(yr) : null));
  const datasets = [
    { label: '1.5°C pathway', data: YEARS.map(y => pathwayAt(b.type, y)), borderColor: C.accent, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0 },
    { label: 'Baseline', data: trajectory(base.eui), borderColor: C.red, borderWidth: 1.5, pointRadius: 0 },
  ];
  if (e.mask) datasets.push({ label: 'With retrofits', data: trajectory(e.eui), borderColor: C.green, backgroundColor: 'rgba(61,220,151,.10)', fill: 1, borderWidth: 2, pointRadius: 0 });
  if (e.strand !== null) datasets.push({ label: 'Stranding', data: strandPoint(e.eui, e.strand), showLine: false, pointRadius: 5, pointStyle: 'rect', pointBackgroundColor: C.ink, borderColor: C.accent, borderWidth: 2 });
  crremChart = new Chart($('#crremChart'), {
    type: 'line',
    data: { labels: YEARS, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { align: 'start', labels: { boxWidth: 12, boxHeight: 2 } },
        tooltip: { filter: it => it.raw !== null, callbacks: { label: it => `${it.dataset.label}: ${it.raw.toFixed(1)} kgCO₂e/m²` } },
      },
      scales: {
        y: { beginAtZero: true, grid: { color: C.grid } },
        x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } },
      },
    },
  });
}

function select(i) {
  state.selected = i;
  updateMap();
  renderDetail();
  renderTable();
  $('#xpTarget').textContent = BUILDINGS[i].name;
  if (!mapReady) return;
  if (map.getZoom() >= STREET_ZOOM) streetView();
  else map.easeTo({ center: [BUILDINGS[i].lng, BUILDINGS[i].lat], duration: 900 });
}

// ---------- optimiser ----------

function initPareto() {
  paretoChart = new Chart($('#paretoChart'), {
    type: 'scatter',
    data: { datasets: [
      { label: 'Explored plans', data: [], borderWidth: 0, pointRadius: 1.6, pointHoverRadius: 2 },
      { label: 'Pareto frontier', data: [], showLine: true, borderWidth: 1.5, pointRadius: 3, pointHoverRadius: 6 },
      { label: 'Current portfolio', data: [], borderWidth: 0, pointRadius: 7, pointStyle: 'rectRot' },
      { label: 'Selected plan', data: [], borderWidth: 2, pointRadius: 9, pointStyle: 'crossRot' },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      onClick: (_, els) => {
        const el = els.find(x => x.datasetIndex === 1);
        if (el && state.front) choosePlan(state.front[el.index]);
      },
      plugins: {
        colors: { enabled: false },
        legend: { align: 'end', labels: { boxWidth: 8, boxHeight: 8 } },
        tooltip: { callbacks: { label: it => `${it.dataset.label}: ${it.raw.x.toFixed(1)}% cut · People ${it.raw.y.toFixed(1)}` } },
      },
      scales: {
        x: { title: { display: true, text: 'X · CARBON REDUCTION VS BASELINE (%)' }, min: 0 },
        y: { title: { display: true, text: 'Y · PORTFOLIO PEOPLE SCORE' } },
      },
    },
  });
  styleParetoChart();
  updateParetoCurrent();
}

function styleParetoChart() {
  const [explored, front, current, selected] = paretoChart.data.datasets;
  explored.backgroundColor = C.explored;
  front.borderColor = front.backgroundColor = C.accent;
  current.backgroundColor = C.red;
  selected.backgroundColor = C.ink;
  selected.borderColor = C.accent;
  const { options } = paretoChart;
  options.plugins.legend.labels.color = C.muted;
  ['x', 'y'].forEach(ax => {
    options.scales[ax].grid = { color: C.grid };
    options.scales[ax].ticks = { color: C.muted };
    options.scales[ax].title.color = C.muted;
  });
}

function updateParetoCurrent() {
  if (!paretoChart) return;
  const s = portfolioStats(state.plan);
  paretoChart.data.datasets[2].data = [{ x: carbonCut(s.carbon), y: s.people }];
  paretoChart.update('none');
}

function frontPoints(front) {
  return front.map(p => ({ x: carbonCut(p.carbon), y: p.people }));
}

function runOptimiser() {
  if (state.running) return;
  state.running = true;
  const btn = $('#btnRun');
  btn.disabled = true;
  btn.textContent = '◌ Optimising…';
  const generations = 80;
  Optimiser.runAnimated(getBudget(), {
    generations,
    onProgress: run => {
      const front = run.front();
      paretoChart.data.datasets[0].data = run.archive;
      paretoChart.data.datasets[1].data = frontPoints(front);
      paretoChart.data.datasets[3].data = [];
      paretoChart.update('none');
      $('#optStatus').innerHTML = `<div class="progress"><i style="width:${(run.generation / generations) * 100}%"></i></div>
        Generation <b>${run.generation}/${generations}</b> · <b>${fmt.int(run.explored)}</b> plans explored · <b>${front.length}</b> Pareto-optimal`;
    },
    onDone: run => {
      state.running = false;
      state.front = run.front();
      btn.disabled = false;
      btn.textContent = '↻ Re-run optimiser';
      $('#optStatus').innerHTML += ` · <span class="good-txt">done</span>`;
      choosePlan(Optimiser.pick(state.front, +$('#priority').value / 100));
    },
  });
}

function choosePlan(p) {
  state.chosen = p;
  paretoChart.data.datasets[3].data = [{ x: carbonCut(p.carbon), y: p.people }];
  paretoChart.update('none');
  $('#optPlan').innerHTML = `${planSummaryHTML(p.genes)}${planTableHTML(p.genes)}
    <div class="chat-actions"><button class="btn" id="btnApply">Apply plan to portfolio</button>
    <span class="muted">Tip: click any green point on the frontier to inspect that trade-off.</span></div>`;
}

function applyPlan(genes) {
  state.plan = genes.slice();
  refreshAll();
  toast('Plan applied: map, twin and KPIs updated');
}

// ---------- portfolio table ----------

const STATUS_NAME = { crit: 'Stranded', risk: 'At risk', watch: 'Monitor', ok: 'Aligned' };

function renderTable() {
  $('#tableWrap').innerHTML = `<table class="ptable dtable">
    <thead><tr><th>Asset</th><th>Type</th><th>GFA m²</th><th>Carbon <small>kgCO₂e/m²</small></th><th>vs base</th><th>People score ${info('people')}</th><th>PMV ${info('pmv')}</th><th>CRREM status ${info('crrem')}</th><th>Measures</th><th>Capex</th><th></th></tr></thead>
    <tbody>${scopeIndices().map(i => {
      const b = BUILDINGS[i], e = cur(i), o = BASELINE[i], cls = strandClass(e.strand), d = (e.intensity / o.intensity - 1) * 100;
      return `<tr data-building="${i}" class="${i === state.selected ? 'sel' : ''}">
        <td><strong>${b.name}</strong><span>${b.area} · ${b.id}</span></td><td>${b.type}</td><td>${fmt.int(b.gfa)}</td>
        <td>${e.intensity.toFixed(0)}</td><td class="${d < -0.5 ? 'good-txt' : 'muted'}">${d < -0.5 ? `${d.toFixed(1)}%` : '—'}</td>
        <td><div class="occ"><i style="--fill:${e.people.toFixed(0)}%"></i><span>${e.people.toFixed(0)}</span></div></td>
        <td>${e.pmv.toFixed(2)}</td>
        <td><span class="status-pill" data-term="status-${cls}"><i class="st-${cls}"></i>${STATUS_NAME[cls]} · ${strandLabel(e.strand)}</span></td>
        <td>${actionIcons(e.mask)}</td><td>${fmt.money(e.capex)}</td><td><span class="row-btn">›</span></td></tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ---------- overview panels ----------

let ovHorizon = 2040;

function renderOverviewPerf() {
  const years = YEARS.filter(y => y <= ovHorizon);
  const idx = scopeIndices();
  const gfa = idx.reduce((s, i) => s + BUILDINGS[i].gfa, 0);
  const series = plan => years.map(y => idx.reduce((sum, i) => sum + CACHE[i][plan[i]].kwh * gridEF(y), 0) / gfa);
  const actual = series(state.plan), base = series(BUILDINGS.map(() => 0));
  const target = years.map(y => idx.reduce((s, i) => s + pathwayAt(BUILDINGS[i].type, y) * BUILDINGS[i].gfa, 0) / gfa);
  const W = 760, H = 220, L = 46, R = 16, T = 10, B = 26;
  const yMax = Math.ceil(Math.max(...base, ...target) / 20) * 20;
  const x = y => L + ((y - years[0]) / (years.at(-1) - years[0])) * (W - L - R);
  const y = v => T + (1 - v / yMax) * (H - T - B);
  const path = s => s.map((v, k) => `${k ? 'L' : 'M'}${x(years[k]).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const step = ovHorizon - 2025 > 15 ? 5 : ovHorizon - 2025 > 8 ? 2 : 1;
  const ticks = years.filter(yr => (yr - 2025) % step === 0 || yr === years.at(-1));
  const gap = actual.at(-1) - target.at(-1);
  $('#ovPerf').innerHTML = `
    <div class="chart-summary">
      <div><span>Intensity ${years[0]}</span><strong>${actual[0].toFixed(1)} <small>kgCO₂e/m²</small></strong></div>
      <div><span>Intensity ${ovHorizon}</span><strong>${actual.at(-1).toFixed(1)} <small>kgCO₂e/m²</small></strong></div>
      <div><span>vs 1.5°C pathway ${info('pathway')}</span><strong class="${gap > 0 ? 'bad-txt' : 'good-txt'}">${gap > 0 ? '+' : '−'}${Math.abs(gap).toFixed(1)}</strong></div>
      <div class="legend"><span><i class="line-key"></i>Current plan</span><span><i class="line-key base"></i>Baseline</span><span><i class="line-key dash"></i>1.5°C pathway</span></div>
    </div>
    <div class="ov-chart"><svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="Portfolio carbon intensity against the 1.5°C pathway to ${ovHorizon}">
      ${[0, 0.25, 0.5, 0.75, 1].map(f => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(yMax * f)}" y2="${y(yMax * f)}"/><text class="axis" x="${L - 8}" y="${y(yMax * f) + 4}" text-anchor="end">${Math.round(yMax * f)}</text>`).join('')}
      ${ticks.map(yr => `<text class="axis" x="${x(yr)}" y="${H - 6}" text-anchor="middle">${yr}</text>`).join('')}
      <path class="area" d="${path(actual)}L${x(years.at(-1))},${y(0)}L${x(years[0])},${y(0)}Z"/>
      <path class="base" d="${path(base)}"/><path class="target" d="${path(target)}"/><path class="actual" d="${path(actual)}"/>
      ${ticks.map(yr => { const k = years.indexOf(yr); return `<circle cx="${x(yr)}" cy="${y(actual[k])}" r="3.5"/>`; }).join('')}
      ${years.map((yr, k) => `<rect class="hov" x="${x(yr) - (W - L - R) / years.length / 2}" y="${T}" width="${(W - L - R) / years.length}" height="${H - T - B}" data-tip="${yr} · plan ${actual[k].toFixed(1)} · baseline ${base[k].toFixed(1)} · pathway ${target[k].toFixed(1)} kgCO₂e/m²"/>`).join('')}
    </svg></div>`;
}

function renderOverviewHealth() {
  const idx = scopeIndices();
  const s = scopeStats(state.plan, idx);
  const classes = idx.map(i => strandClass(CACHE[i][state.plan[i]].strand));
  const count = c => classes.filter(x => x === c).length;
  const label = s.people >= 85 ? 'Excellent' : s.people >= 75 ? 'Good' : s.people >= 65 ? 'Fair' : 'Needs attention';
  $('#ovHealth').innerHTML = `
    <div class="health-visual">
      <div class="donut" style="--pct:${s.people.toFixed(0)}%"><div><strong>${s.people.toFixed(0)}</strong><span>/ 100</span></div></div>
      <div class="health-copy"><span>${idx.length === 1 ? 'Building' : 'Portfolio'} People Score ${info('people')}</span><strong>${label}</strong>
        <p>Comfort, air quality and satisfaction${idx.length === 1 ? '' : ', weighted by headcount'}. ${s.stranded} of ${idx.length} asset${idx.length === 1 ? '' : 's'} strand${idx.length === 1 ? 's' : ''} by 2030.</p></div>
    </div>
    <div class="health-breakdown">
      ${['ok', 'watch', 'risk', 'crit'].map(c => `<div class="score"><div><span data-term="status-${c}"><i class="st-${c}"></i>${STATUS_NAME[c]}</span><strong>${count(c)}</strong></div>
        <div class="score-track"><i class="st-${c}" style="width:${(count(c) / idx.length) * 100}%"></i></div></div>`).join('')}
    </div>`;
}

function renderOverviewWork() {
  if (typeof Studio === 'undefined' || !Studio.state.results.length || !$('#ovWork')) return;
  const rs = [...Studio.state.results].sort((a, b) => a.rank - b.rank), top = rs[0], p = Studio.state.policy;
  $('#ovWork').innerHTML = `<div class="ov-work">
    <div class="ov-work-top"><strong>${top.sc.icon} ${top.sc.name}</strong>
      <span>recommended · ${p.days} office days${p.anchors ? ' · anchor days' : ''}${p.pods ? ' · mentoring pods' : ''} · lease ends ${ORG.leaseExpiry}</span></div>
    <div class="ov-row head"><span>#</span><span>Scenario</span><span>Score</span><span>5-yr cost</span><span>tCO₂e/yr</span><span>Juniors &gt;1 h ${info('juniors')}</span></div>
    ${rs.map(r => `<div class="ov-row" data-go="workplace"><span>${r.rank}</span><b>${r.sc.name}</b>
      <div class="bar"><i style="width:${Math.round(r.score * 100)}%"></i></div><span>${fmt.money(r.cost5)}</span><span>${fmt.int(r.annualT)}</span>
      <span>${Math.round(r.cohorts.early.longShare * 100)}%</span></div>`).join('')}
  </div>`;
}

function renderOverviewAlerts() {
  const idx = scopeIndices();
  const items = [...$('#feed').children].filter(li => idx.includes(+li.querySelector('[data-building]').dataset.building));
  $('#ovAlertCount').textContent = `${items.length} ACTIVE`;
  $('#ovAlerts').innerHTML = (items.length ? '' : '<p class="muted ov-empty">No live alerts for this selection right now.</p>') + items.slice(0, 3).map(li => {
    const sev = li.classList.contains('warn') ? 'warn' : li.classList.contains('good') ? 'good' : 'info';
    const body = li.querySelector('p').textContent;
    return `<div class="ov-alert"><time>${escapeHtml(li.querySelector('.time').textContent.slice(0, 5))}</time><i class="${sev}"></i>
      <div><strong>${escapeHtml(li.querySelector('b').textContent)}</strong><span>${escapeHtml(body.length > 92 ? `${body.slice(0, 90)}…` : body)}</span></div>
      <button class="row-btn" data-building="${li.querySelector('[data-building]').dataset.building}" aria-label="Open building">›</button></div>`;
  }).join('');
}

function renderOverview() {
  renderOverviewPerf();
  renderOverviewHealth();
  renderOverviewWork();
}

// Shared hover tooltip for inline SVG charts (elements with data-tip)
function bindVizTips(root) {
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

// ---------- building search (top bar dropdown) ----------

let searchHi = 0;

function searchMatches(q) {
  const t = q.trim().toLowerCase();
  return BUILDINGS.map((b, i) => ({ b, i })).filter(({ b }) => !t || [b.name, b.area, b.type, b.id].some(s => s.toLowerCase().includes(t)));
}

function renderSearchList() {
  const items = searchMatches($('#searchInput').value);
  searchHi = clamp(searchHi, 0, Math.max(0, items.length - 1));
  $('#searchList').innerHTML = items.length
    ? items.map(({ b, i }, k) => {
      const cls = strandClass(cur(i).strand);
      return `<li role="option" id="searchOpt${k}" data-pick="${i}" class="${k === searchHi ? 'hi' : ''}" aria-selected="${k === searchHi}">
        <i class="st-${cls}"></i><span><b>${b.name}</b><small>${b.area} · ${b.type}</small></span><em data-term="status-${cls}">${STATUS_NAME[cls]}</em></li>`;
    }).join('')
    : '<li class="empty">No building matches</li>';
  $('#searchInput').setAttribute('aria-activedescendant', items.length ? `searchOpt${searchHi}` : '');
  const hi = $('#searchList .hi');
  if (hi) hi.scrollIntoView({ block: 'nearest' });
}

function openSearch(open) {
  $('#searchBox').hidden = !open;
  $('#searchInput').setAttribute('aria-expanded', String(open));
  if (open) {
    $('#searchInput').value = '';
    searchHi = 0;
    renderSearchList();
    $('#searchInput').focus();
  }
}

function pickBuilding(i) {
  openSearch(false);
  select(i);
  showPage('portfolio');
}

// ---------- pages ----------

const PAGES = { overview: 'Overview', workplace: 'Workplace studio', portfolio: 'Portfolio twin', optimise: 'Retrofit optimiser', live: 'Live operations', copilot: 'Copilot', reports: 'Reports', experiences: 'Experiences' };
let currentPage = 'overview', mapFramed = false;

function showPage(name) {
  if (!PAGES[name]) name = 'overview';
  currentPage = name;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${name}`));
  document.querySelectorAll('.nav-item[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  $('#crumb').textContent = PAGES[name];
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  window.scrollTo(0, 0);
  if (name === 'portfolio' && map) {
    requestAnimationFrame(() => {
      map.resize();
      if (crremChart) crremChart.resize();
      if (mapReady && !mapFramed) { mapFramed = true; portfolioView(1800); }
    });
  }
  if (name === 'optimise' && paretoChart) requestAnimationFrame(() => paretoChart.resize());
  if (name === 'live') $('#liveBadge').hidden = true;
  if (name === 'reports') ReportDiff.refresh();
}

// Older code and copilot links still ask for the former tab names
const TAB_PAGES = { optimiser: 'optimise', copilot: 'copilot', live: 'live', table: 'overview', diff: 'reports' };
const switchTab = name => showPage(TAB_PAGES[name] || name);

// ---------- copilot chat ----------

function addMessage(who, html) {
  const log = $('#chatLog');
  const div = document.createElement('div');
  div.className = `msg ${who}`;
  div.innerHTML = html;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const scrollChat = () => { $('#chatLog').scrollTop = $('#chatLog').scrollHeight; };
const TYPING = '<span class="typing"><i></i><i></i><i></i></span>';

// Minimal Markdown for Claude's replies (headings, emphasis, code, lists, tables). Input is escaped first.
function renderMarkdown(md) {
  const inline = s => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:])/g, '$1<i>$2</i>');
  const isRow = l => /^\s*\|.*\|\s*$/.test(l);
  const isItem = l => /^\s*([-*•]|\d+\.)\s+/.test(l);
  const lines = escapeHtml(md).split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isRow(line)) {
      const rows = [];
      while (i < lines.length && isRow(lines[i])) rows.push(lines[i++]);
      const body = rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      const cells = r => r.trim().slice(1, -1).split('|').map(c => inline(c.trim()));
      if (body.length) {
        out.push(`<table class="mini-table"><tr>${cells(body[0]).map(c => `<th>${c}</th>`).join('')}</tr>${body.slice(1)
          .map(r => `<tr>${cells(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`);
      }
    } else if (isItem(line)) {
      const tag = /^\s*\d+\./.test(line) ? 'ol' : 'ul';
      const items = [];
      while (i < lines.length && isItem(lines[i])) items.push(inline(lines[i++].replace(/^\s*([-*•]|\d+\.)\s+/, '')));
      out.push(`<${tag}>${items.map(x => `<li>${x}</li>`).join('')}</${tag}>`);
    } else if (/^#{1,4}\s/.test(line)) {
      out.push(`<h4>${inline(line.replace(/^#{1,4}\s+/, ''))}</h4>`);
      i++;
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line) || !line.trim()) {
      i++;
    } else {
      const para = [inline(lines[i++])];
      while (i < lines.length && lines[i].trim() && !isRow(lines[i]) && !isItem(lines[i]) && !/^#{1,4}\s/.test(lines[i])) para.push(inline(lines[i++]));
      out.push(`<p>${para.join('<br>')}</p>`);
    }
  }
  return out.join('');
}

let aiBusy = false;

function setAiBusy(busy) {
  aiBusy = busy;
  $('#chatInput').disabled = busy;
  $('#chatForm button').disabled = busy;
}

async function askCopilot(text) {
  if (!text.trim() || aiBusy) return;
  addMessage('user', escapeHtml(text));
  if (!AI.enabled()) {
    const thinking = addMessage('bot', `${TYPING} analysing portfolio…`);
    setTimeout(() => { thinking.innerHTML = Copilot.ask(text); scrollChat(); }, 650);
    return;
  }

  const box = addMessage('bot ai', '');
  const b = BUILDINGS[state.selected];
  setAiBusy(true);
  await streamClaude(box, ui => AI.ask(text, `Selected building in the dashboard: ${b.id} (${b.name}).`, ui), scrollChat);
  setAiBusy(false);
}

// Streams a Claude tool-use run into a chat bubble: tool steps, live Markdown, plan buttons, errors
async function streamClaude(box, run, scroll) {
  box.innerHTML = `<div class="ai-steps"></div><div class="ai-text">${TYPING} thinking…</div>`;
  const steps = box.querySelector('.ai-steps'), out = box.querySelector('.ai-text');
  const planIds = [];
  let md = '', queued = false;
  const paint = () => { queued = false; if (md) out.innerHTML = renderMarkdown(md); scroll(); };
  try {
    await run({
      onText: d => { md += d; if (!queued) { queued = true; requestAnimationFrame(paint); } },
      onTool: (name, input) => {
        if (md && !md.endsWith('\n')) md += '\n\n';
        const args = Object.entries(input || {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('+') : v}`).join(' · ');
        steps.insertAdjacentHTML('beforeend', `<div class="ai-step"><i>⚙</i>${name}<span>${escapeHtml(args)}</span></div>`);
        scroll();
      },
      onToolResult: (name, result, isError) => {
        if (isError) { steps.lastElementChild.classList.add('err'); return; }
        if (name === 'run_portfolio_optimiser') planIds.push(result.plan_id);
        if (name === 'apply_measures') toast(`Claude applied measures to ${result.building}`);
      },
    });
    paint();
    planIds.forEach(id => box.insertAdjacentHTML('beforeend', `<div class="chat-actions"><button class="btn sm" data-plan="${id}">Apply plan</button></div>`));
  } catch (err) {
    paint();
    if (!md) out.innerHTML = '';
    box.insertAdjacentHTML('beforeend', `<p class="bad-txt">${escapeHtml(AI.describeError(err))}</p>`);
  }
  scroll();
}

// ---------- experiences: shared full-screen modal ----------

const xpHandlers = { onClose: null };

function openXp(title, html, full = false) {
  if (xpHandlers.onClose) xpHandlers.onClose();
  xpHandlers.onClose = null;
  $('#xpTitle').textContent = title;
  $('#xpBody').innerHTML = html;
  $('#xpModal').classList.toggle('full', full);
  $('#xpModal').hidden = false;
  $('#xpBody').scrollTop = 0;
  return $('#xpBody');
}

function closeXp() {
  if (xpHandlers.onClose) xpHandlers.onClose();
  xpHandlers.onClose = null;
  $('#xpModal').hidden = true;
  $('#xpBody').innerHTML = '';
}

function renderAiStatus() {
  const on = AI.enabled();
  $('#aiStatus').innerHTML = on ? '<i class="on"></i>Claude Opus 5.5 · live · tool use' : '<i></i>Offline · rule-based';
  $('#aiKeyForm').hidden = on;
  $('#aiDisconnect').hidden = !on;
}

function welcomeMessage() {
  addMessage('bot', `<p>Hi, I'm the <b>Footfall Copilot</b>. I watch ${BUILDINGS.length} assets and ${fmt.int(1248)} sensors, and I plan decarbonisation
    that keeps people comfortable. Ask me anything about the portfolio, or pick a suggestion below.</p>
    <p class="muted">${AI.enabled() ? 'Claude is connected: I can reason freely and run the portfolio models as tools.'
      : 'Running offline rules. Connect an Anthropic API key above to let Claude answer open questions.'}</p>`);
}

async function connectAi(key) {
  const btn = $('#aiKeyForm button');
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  try {
    await AI.connect(key);
    toast('Claude connected');
  } catch (err) {
    toast(AI.describeError(err));
  }
  btn.disabled = false;
  btn.textContent = 'Connect Claude';
  renderAiStatus();
}

// ---------- live ops (simulated IoT stream) ----------

function tickLive() {
  const t = Date.now() / 1000;
  live = BUILDINGS.map((b, i) => {
    const e = cur(i);
    return {
      co2: e.co2 + 110 * Math.sin(t / 9 + i) + (Math.random() - 0.5) * 70,
      ta: e.ta + 0.3 * Math.sin(t / 13 + i),
      occ: clamp(e.occ + 0.06 * Math.sin(t / 11 + i * 2) + (Math.random() - 0.5) * 0.03, 0.05, 1),
    };
  });
  updateLiveFields();
  $('#lastSync').textContent = new Date().toLocaleTimeString('en-SG', { hour12: false });
  if (Math.random() < 0.45) makeAlert();
}

function updateLiveFields() {
  const l = live[state.selected];
  if (!l || !l.co2 || !$('#liveCo2')) return;
  $('#liveCo2').textContent = fmt.int(l.co2);
  $('#liveCo2').className = l.co2 > 1000 ? 'bad-txt' : '';
  $('#liveOcc').textContent = Math.round(l.occ * 100);
}

let alertCount = 0, autoResolved = 0;

function makeAlert() {
  const candidates = [];
  BUILDINGS.forEach((b, i) => {
    const e = cur(i), l = live[i];
    const level = `L${((i * 7 + alertCount) % 28) + 3}`;
    if (l.co2 > 1000 && !(e.mask & actionBit('dcv')))
      candidates.push({ i, sev: 'warn', title: `CO₂ ${fmt.int(l.co2)} ppm · ${b.name} ${level}`,
        body: 'Above 1,000 ppm, cognitive performance drops measurably. Ventilation boosted in occupied zones only. Permanent fix: demand-controlled ventilation (−6% energy).', auto: true });
    if (e.pmv < -0.4)
      candidates.push({ i, sev: 'info', title: `${8 + ((alertCount * 3) % 17)} “too cold” votes · ${b.name}`,
        body: `PMV ${e.pmv.toFixed(2)} at ${e.ta}°C, so occupants are over-cooled. 25.5°C + smart fans would cut ~${fmt.pct(ACTIONS[1].cut(b))} energy <b>and</b> improve comfort.` });
    if (l.occ < 0.55 && !(e.mask & actionBit('consol')) && b.allowed & actionBit('consol'))
      candidates.push({ i, sev: 'info', title: `Floors ${level.slice(1)}–${+level.slice(1) + 2} at ${Math.round(l.occ * 100)}% occupancy · ${b.name}`,
        body: `Hybrid-work pattern detected. Consolidating today saves ~${fmt.int((e.kwh / 365) * ACTIONS[5].cut(b))} kWh.` });
    if (e.pmv > 0.7)
      candidates.push({ i, sev: 'warn', title: `Heat-stress risk · ${b.name}`,
        body: `PMV +${e.pmv.toFixed(2)} in pick zones. Shifting heavy tasks before 11am and deploying HVLS fans in hot aisles.`, auto: true });
    if (e.mask && e.people > BASELINE[i].people + 1 && e.carbon < BASELINE[i].carbon)
      candidates.push({ i, sev: 'good', title: `Retrofit win · ${b.name}`,
        body: `People Score ${BASELINE[i].people.toFixed(0)} → ${e.people.toFixed(0)} while emissions fell ${fmt.pct(1 - e.carbon / BASELINE[i].carbon)}.` });
  });
  if (!candidates.length) return;
  const c = candidates[(Math.random() * candidates.length) | 0];
  alertCount++;
  if (c.auto) autoResolved++;
  const li = document.createElement('li');
  li.className = `alert ${c.sev}`;
  li.innerHTML = `<span class="time">${new Date().toLocaleTimeString('en-SG', { hour12: false })}</span>
    <div><b>${c.title}</b><p>${c.body}</p></div>
    <button class="btn sm ghost" data-building="${c.i}">View</button>`;
  const feed = $('#feed');
  feed.prepend(li);
  while (feed.children.length > 30) feed.lastChild.remove();
  $('#liveStats').innerHTML = `
    <div><b>${fmt.int(1248 + (alertCount % 5))}</b><span>sensors online</span></div>
    <div><b>${fmt.int(312 + alertCount * 2)}</b><span>occupant votes today</span></div>
    <div><b>${alertCount}</b><span>insights generated ${info('insights')}</span></div>
    <div><b>${autoResolved}</b><span>auto-resolved ${info('autoresolved')}</span></div>`;
  if (currentPage !== 'live') $('#liveBadge').hidden = false;
  renderOverviewAlerts();
}

// ---------- ESG report ----------

function openReport() {
  const s = statsWithSavings(state.plan), b = BASE_STATS;
  $('#reportBody').innerHTML = `
    <h1>Portfolio Decarbonisation &amp; Wellbeing Report</h1>
    <p class="muted">Generated by Footfall · ${new Date().toLocaleDateString('en-SG', { dateStyle: 'long' })} · ${BUILDINGS.length} assets · ${fmt.int(BUILDINGS.reduce((a, x) => a + x.gfa, 0))} m² GFA</p>
    <h2>Executive summary</h2>
    <p>The recommended plan reduces operational emissions by <b>${carbonCut(s.carbon).toFixed(1)}%</b> (${fmt.int(b.carbon - s.carbon)} tCO₂e/yr)
      for <b>${fmt.money(s.capex)}</b> capex, saving <b>${fmt.money(s.savings)}/yr</b> in energy${s.savings > 0 ? ` (simple payback ${(s.capex / s.savings).toFixed(1)} years)` : ''}.
      Assets stranded by 2030 fall from <b>${b.stranded}</b> to <b>${s.stranded}</b>, while the headcount-weighted People Score moves from
      <b>${b.people.toFixed(1)}</b> to <b>${s.people.toFixed(1)}</b>.</p>
    ${planSummaryHTML(state.plan)}
    <h2>Asset register</h2>
    <table class="mini-table">
      <tr><th>Asset</th><th>Type</th><th>kgCO₂e/m² (base → plan)</th><th>Stranding</th><th>People</th><th>Measures</th><th>Capex</th></tr>
      ${BUILDINGS.map((x, i) => { const e = cur(i), o = BASELINE[i]; return `<tr><td>${x.name}</td><td>${x.type}</td>
        <td>${o.intensity.toFixed(0)} → <b>${e.intensity.toFixed(0)}</b></td><td>${strandTag(o.strand)} → ${strandTag(e.strand)}</td>
        <td>${o.people.toFixed(0)} → <b>${e.people.toFixed(0)}</b></td><td>${actionIcons(e.mask)}</td><td>${fmt.money(e.capex)}</td></tr>`; }).join('')}
    </table>
    <h2>Methodology</h2>
    <ul class="method">
      <li><b>Carbon:</b> operational Scope 2 = energy use × Singapore grid emission factor (${GRID_EF_2025} kgCO₂e/kWh, EMA), with ${GRID_DECLINE * 100}%/yr grid decarbonisation assumed.</li>
      <li><b>Stranding:</b> first year asset intensity exceeds an illustrative CRREM-style 1.5°C pathway for its asset type.</li>
      <li><b>Thermal comfort:</b> ISO 7730 Predicted Mean Vote (PMV) and Predicted Percentage Dissatisfied (PPD).</li>
      <li><b>People Score:</b> 40% thermal comfort, 30% indoor air quality (CO₂), 30% occupant pulse survey, weighted by headcount.</li>
      <li><b>Optimisation:</b> NSGA-II multi-objective genetic algorithm (minimise carbon, maximise People Score) under a capex constraint.</li>
      <li><b>Data:</b> synthetic portfolio for demonstration purposes.</li>
    </ul>`;
  $('#reportModal').hidden = false;
}

// ---------- misc ----------

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function refreshAll() {
  renderKPIs();
  updateMap();
  renderDetail();
  renderTable();
  renderOverview();
  updateParetoCurrent();
}

function bindEvents() {
  bindTerms();
  document.addEventListener('click', ev => {
    if (ev.target.closest('button.info')) { ev.preventDefault(); ev.stopPropagation(); return; } // info buttons only explain
    const chip = ev.target.closest('.chip-action');
    if (chip && !chip.disabled) {
      state.plan[state.selected] ^= 1 << +chip.dataset.k;
      refreshAll();
      return;
    }
    const bl = ev.target.closest('[data-building]');
    if (bl) {
      ev.preventDefault();
      select(+bl.dataset.building);
      if (currentPage !== 'portfolio' && !bl.closest('.modal')) showPage('portfolio');
      return;
    }
    const pl = ev.target.closest('[data-plan]');
    if (pl) { applyPlan(Copilot.plans[pl.dataset.plan]); return; }
    if (ev.target.closest('#btnApply') && state.chosen) applyPlan(state.chosen.genes);
    const go = ev.target.closest('[data-go]');
    if (go) { showPage(go.dataset.go); return; }
    const nav = ev.target.closest('.nav-item[data-page]');
    if (nav) { showPage(nav.dataset.page); return; }
    const sug = ev.target.closest('#chips .suggestion');
    if (sug) askCopilot(sug.textContent);
  });

  $('#btnRun').addEventListener('click', runOptimiser);
  $('#budget').addEventListener('input', () => {
    $('#budgetVal').textContent = `S$${$('#budget').value}M`;
    if (state.front) $('#optStatus').innerHTML = '<span class="bad-txt">Budget changed. Re-run the optimiser.</span>';
  });
  $('#priority').addEventListener('input', () => {
    const w = +$('#priority').value;
    $('#priorityVal').textContent = w < 35 ? 'Carbon-first' : w > 65 ? 'People-first' : 'Balanced';
    if (state.front && !state.running) choosePlan(Optimiser.pick(state.front, w / 100));
  });
  $('#chatForm').addEventListener('submit', ev => {
    ev.preventDefault();
    askCopilot($('#chatInput').value);
    $('#chatInput').value = '';
  });
  $('#aiKeyForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const key = $('#aiKey').value.trim();
    $('#aiKey').value = '';
    if (key) connectAi(key);
  });
  $('#aiDisconnect').addEventListener('click', () => { AI.disconnect(); renderAiStatus(); toast('Claude disconnected; key removed from this browser'); });
  $('#aiNewChat').addEventListener('click', () => { AI.reset(); $('#chatLog').innerHTML = ''; welcomeMessage(); });
  $('#xpClose').addEventListener('click', closeXp);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !$('#xpModal').hidden) closeXp(); });
  const experiences = { audience: () => Audience.open(), talk: () => Talk.open(), negotiate: () => Negotiation.open(), story: () => Story.open() };
  document.querySelectorAll('[data-xp]').forEach(b => b.addEventListener('click', () => experiences[b.dataset.xp]()));
  $('#btnReport').addEventListener('click', openReport);
  $('#btnReset').addEventListener('click', () => { state.plan = BUILDINGS.map(() => 0); refreshAll(); toast('Portfolio reset to baseline'); });
  $('#btnCloseReport').addEventListener('click', () => { $('#reportModal').hidden = true; });
  $('#dataBtn').addEventListener('click', () => { $('#dataModal').hidden = false; $('#dataClose').focus(); });
  $('#dataClose').addEventListener('click', () => { $('#dataModal').hidden = true; });
  $('#dataModal').addEventListener('click', ev => { if (ev.target.id === 'dataModal') $('#dataModal').hidden = true; });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') $('#dataModal').hidden = true; });
  $('#btnPrint').addEventListener('click', () => window.print());
  $('#themeBtn').addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  $('#bellBtn').addEventListener('click', () => showPage('live'));
  $('#settingsBtn').addEventListener('click', () => { showPage('copilot'); if (!AI.enabled()) $('#aiKey').focus(); });
  $('#searchBtn').addEventListener('click', () => openSearch($('#searchBox').hidden));
  $('#searchInput').addEventListener('input', () => { searchHi = 0; renderSearchList(); });
  $('#searchInput').addEventListener('keydown', ev => {
    const items = searchMatches($('#searchInput').value);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      searchHi = (searchHi + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length);
      renderSearchList();
    } else if (ev.key === 'Enter' && items[searchHi]) {
      pickBuilding(items[searchHi].i);
    } else if (ev.key === 'Escape') {
      openSearch(false);
    }
  });
  // mousedown so the pick happens before the input loses focus
  $('#searchList').addEventListener('mousedown', ev => {
    const li = ev.target.closest('[data-pick]');
    if (li) { ev.preventDefault(); pickBuilding(+li.dataset.pick); }
  });
  document.addEventListener('mousedown', ev => {
    if (!$('#searchBox').hidden && !ev.target.closest('#searchBox, #searchBtn')) openSearch(false);
  });
  $('#ovHorizon').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-h]');
    if (!btn) return;
    ovHorizon = +btn.dataset.h;
    $('#ovHorizon').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    renderOverviewPerf();
  });
  window.addEventListener('hashchange', () => showPage(location.hash.slice(1)));
  const views = { portfolio: () => portfolioView(), street: streetView, flat: flatView };
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => mapReady && views[b.dataset.view]()));
}

function init() {
  setTheme(currentTheme());
  const hour = new Date().getHours();
  $('#greeting').textContent = hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.';
  renderScopePicker();
  $('#ovScope').addEventListener('change', ev => setScope(ev.target.value));
  showPage(location.hash.slice(1) || 'overview');
  bindVizTips($('#page-overview'));
  initMap();
  initPareto();
  bindEvents();
  $('#chips').innerHTML = Copilot.suggestions.map(s => `<button class="suggestion">${s}</button>`).join('');
  renderAiStatus();
  welcomeMessage();
  $('#xpTarget').textContent = BUILDINGS[state.selected].name;
  const savedKey = AI.savedKey();
  if (savedKey) connectAi(savedKey);
  tickLive();
  refreshAll();
  for (let k = 0; k < 4; k++) makeAlert();
  $('#liveBadge').hidden = true;
  setInterval(tickLive, 2500);
  setTimeout(() => map.resize(), 200);
}

document.addEventListener('DOMContentLoaded', init);
