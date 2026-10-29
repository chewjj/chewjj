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
  document.querySelectorAll('[data-theme-set]').forEach(b => b.classList.toggle('active', b.dataset.themeSet === theme));
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
    <div><span>Capex</span><b>${fmt.money(s.capex)}</b><em>${s.savings > 0 ? `payback ${(s.capex / s.savings).toFixed(1)} yrs` : '–'}</em></div>
    <div><span>Stranded by 2030</span><b>${s.stranded} / ${BUILDINGS.length}</b><em>from ${b.stranded}</em></div>
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

// ---------- KPI bar ----------

function renderKPIs() {
  const s = statsWithSavings(state.plan), b = BASE_STATS;
  let n = 0;
  const tile = (label, value, extra) => `<div class="kpi"><span data-k="K${++n}">${label}</span><b>${value}</b><em>${extra || '&nbsp;'}</em></div>`;
  $('#kpis').innerHTML = [
    tile('Portfolio emissions', `${fmt.int(s.carbon)} <small>tCO₂e/yr</small>`, deltaTag(s.carbon, b.carbon)),
    tile('Carbon intensity', `${s.intensity.toFixed(1)} <small>kg/m²</small>`, deltaTag(s.intensity, b.intensity)),
    tile('Stranded by 2030', `${s.stranded} <small>/ ${BUILDINGS.length}</small>`, s.stranded < b.stranded ? `<span class="delta good">from ${b.stranded}</span>` : 'CRREM 1.5°C'),
    tile('People Score', `${s.people.toFixed(1)} <small>/ 100</small>`, deltaPts(s.people, b.people)),
    tile('Capex committed', fmt.money(s.capex), s.savings > 0 ? `saves ${fmt.money(s.savings)}/yr` : ''),
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

  map.on('load', () => {
    mapReady = true;
    portfolioView(2600);
    updateMap();
  });
}

function portfolioView(duration = 1200) {
  const bounds = new maplibregl.LngLatBounds();
  BUILDINGS.forEach(b => bounds.extend([b.lng, b.lat]));
  const cam = map.cameraForBounds(bounds, { padding: 40, bearing: PORTFOLIO_VIEW.bearing });
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
      <span class="sec-no">02 /</span><span class="sec-title">Asset spec sheet</span>
      <span class="sec-meta">${b.id} · ${String(i + 1).padStart(2, '0')}/${BUILDINGS.length}</span>
      <span class="live-pill"><i></i>LIVE</span>
    </div>
    <div class="spec-title"><h2>${b.name}</h2></div>
    <p class="coords">${b.lat.toFixed(4)}°N ${b.lng.toFixed(4)}°E · ${b.area}</p>
    <dl class="spec">
      <div><dt>Type</dt><dd>${b.type}</dd></div>
      <div><dt>Built</dt><dd>${b.built}</dd></div>
      <div><dt>GFA</dt><dd>${fmt.int(b.gfa)} m²</dd></div>
      <div><dt>EUI</dt><dd>${e.eui.toFixed(0)} kWh/m²</dd></div>
      <div><dt>Setpoint</dt><dd>${e.ta}°C</dd></div>
      <div><dt>Occupancy</dt><dd>${fmt.pct(e.occ)}</dd></div>
    </dl>
    <div class="metrics">
      ${metric('Carbon intensity', e.intensity.toFixed(0), 'kgCO₂e/m²', deltaTag(e.intensity, base.intensity))}
      ${metric('Stranding year', strandTag(e.strand), '', e.strand !== base.strand ? `<span class="delta good">was ${strandLabel(base.strand)}</span>` : 'vs CRREM 1.5°C')}
      ${metric('Emissions', fmt.int(e.carbon), 'tCO₂e/yr', deltaTag(e.carbon, base.carbon))}
      ${metric('People Score', e.people.toFixed(0), '/100', deltaPts(e.people, base.people))}
    </div>
    <div class="sub-head"><i>02.1</i>Carbon trajectory <span class="hint">kgCO₂e/m² vs 1.5°C pathway</span></div>
    <div class="chart-box"><canvas id="crremChart"></canvas></div>
    <div class="sub-head"><i>02.2</i>People layer <span class="hint">ISO 7730 · IAQ · pulse</span></div>
    <div class="people">
      <div class="pmv">
        <div class="pmv-head"><span>Thermal comfort (PMV)</span><b>${e.pmv >= 0 ? '+' : ''}${e.pmv.toFixed(2)} · ${pmvLabel(e.pmv)}</b></div>
        <div class="pmv-scale"><div class="pmv-comfort"></div><div class="pmv-marker" style="left:${clamp(((e.pmv + 3) / 6) * 100, 0, 100)}%"></div></div>
        <div class="pmv-ticks"><span>Cold</span><span>Cool</span><span>Neutral</span><span>Warm</span><span>Hot</span></div>
        <p class="tiny">${e.ta}°C · air ${e.vel} m/s · ${b.rh}% RH · <b>${e.ppd.toFixed(0)}%</b> predicted dissatisfied</p>
      </div>
      ${mini('CO₂ (live)', '<span id="liveCo2">–</span>', 'ppm', e.iaq)}
      ${mini('Occupancy (live)', '<span id="liveOcc">–</span>', '%', null)}
      ${mini('Occupant pulse', e.pulse.toFixed(0), '% satisfied', e.pulse)}
    </div>
    <div class="sub-head"><i>02.3</i>Retrofit what-if <span class="hint">toggle to simulate</span></div>
    <div class="actions">${ACTIONS.map((a, k) => actionChip(b, e, a, k)).join('')}</div>
    <div class="whatif">
      <div><span>Capex</span><b>${fmt.money(e.capex)}</b></div>
      <div><span>Energy savings</span><b>${fmt.money(savings)}/yr</b></div>
      <div><span>Payback</span><b>${savings > 0 ? (e.capex / savings).toFixed(1) + ' yrs' : '–'}</b></div>
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

function renderTable() {
  $('#tableWrap').innerHTML = `<table class="ptable">
    <tr><th>Building</th><th>Type</th><th>GFA m²</th><th>kgCO₂e/m²</th><th>Stranding</th><th>People</th><th>PMV</th><th>Measures</th><th>Capex</th></tr>
    ${BUILDINGS.map((b, i) => { const e = cur(i); return `<tr data-building="${i}" class="${i === state.selected ? 'sel' : ''}">
      <td><b>${b.name}</b><br><span class="muted">${b.area}</span></td><td>${b.type}</td><td>${fmt.int(b.gfa)}</td>
      <td>${e.intensity.toFixed(0)}</td><td>${strandTag(e.strand)}</td><td>${e.people.toFixed(0)}</td><td>${e.pmv.toFixed(2)}</td>
      <td>${actionIcons(e.mask)}</td><td>${fmt.money(e.capex)}</td></tr>`; }).join('')}
  </table>`;
}

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
  addMessage('bot', `<p>Hi, I'm the <b>Equilibria Copilot</b>. I watch ${BUILDINGS.length} assets and ${fmt.int(1248)} sensors, and I plan decarbonisation
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
    <div><b>${alertCount}</b><span>insights generated</span></div>
    <div><b>${autoResolved}</b><span>auto-resolved</span></div>`;
  const badge = $('#liveBadge');
  if (!$('#tab-live').classList.contains('active')) { badge.textContent = alertCount; badge.hidden = false; }
}

// ---------- ESG report ----------

function openReport() {
  const s = statsWithSavings(state.plan), b = BASE_STATS;
  $('#reportBody').innerHTML = `
    <h1>Portfolio Decarbonisation &amp; Wellbeing Report</h1>
    <p class="muted">Generated by Equilibria · ${new Date().toLocaleDateString('en-SG', { dateStyle: 'long' })} · ${BUILDINGS.length} assets · ${fmt.int(BUILDINGS.reduce((a, x) => a + x.gfa, 0))} m² GFA</p>
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
  updateParetoCurrent();
}

function switchTab(name) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'live') $('#liveBadge').hidden = true;
  if (name === 'diff') ReportDiff.refresh();
  if (name === 'optimiser') paretoChart.resize();
}

function bindEvents() {
  document.addEventListener('click', ev => {
    const chip = ev.target.closest('.chip-action');
    if (chip && !chip.disabled) {
      state.plan[state.selected] ^= 1 << +chip.dataset.k;
      refreshAll();
      return;
    }
    const bl = ev.target.closest('[data-building]');
    if (bl) { ev.preventDefault(); select(+bl.dataset.building); return; }
    const pl = ev.target.closest('[data-plan]');
    if (pl) { applyPlan(Copilot.plans[pl.dataset.plan]); return; }
    if (ev.target.closest('#btnApply') && state.chosen) applyPlan(state.chosen.genes);
    const tab = ev.target.closest('.tabs button');
    if (tab) switchTab(tab.dataset.tab);
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
  $('#btnPrint').addEventListener('click', () => window.print());
  document.querySelectorAll('[data-theme-set]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.themeSet)));
  const views = { portfolio: () => portfolioView(), street: streetView, flat: flatView };
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => mapReady && views[b.dataset.view]()));
}

function init() {
  setTheme(currentTheme());
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
