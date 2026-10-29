// Offline ESG report comparison: no AI and no API key. Extracts text (pdf.js for PDFs), pulls KPIs, targets,
// frameworks and disclosures out with rules, then diffs two reports. Returns the same shape as the Claude
// comparison in ai.js, so one renderer serves both. Works best on text-based PDFs with "Metric: value" or table rows.

const EsgRules = (() => {
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  let pdfReady = null;

  const loadScript = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the PDF reader. Check the internet connection.'));
    document.head.appendChild(s);
  });

  function loadPdfJs() {
    if (!pdfReady) {
      pdfReady = (async () => {
        await loadScript(`${PDFJS}pdf.min.js`);
        // Preloading the worker lets pdf.js fall back to the main thread where cross-origin workers are blocked (file://)
        await loadScript(`${PDFJS}pdf.worker.min.js`);
        pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`;
      })();
    }
    return pdfReady;
  }

  async function pdfText(base64) {
    await loadPdfJs();
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const content = await (await pdf.getPage(p)).getTextContent();
      // Group text runs into lines by y position so table rows stay together
      const rows = new Map();
      content.items.forEach(it => {
        if (!it.str.trim()) return;
        const y = Math.round(it.transform[5] / 3);
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push(it);
      });
      pages.push([...rows.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, items]) => items.sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim())
        .join('\n'));
    }
    return pages.join('\n');
  }

  async function textOf(doc) {
    if (doc.text == null) doc.text = doc.kind === 'pdf' ? await pdfText(doc.data) : doc.data;
    return doc.text;
  }

  // ---------- numbers ----------

  const MULT = { thousand: 1e3, million: 1e6, mn: 1e6, billion: 1e9, bn: 1e9 };
  const isYear = s => /^(19|20)\d{2}$/.test(s);

  // First standalone number in s (ignoring parentheses, years and digits inside words like CO2)
  function firstNumber(s) {
    const re = /(?<![A-Za-z\d.])(-?\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|mn|bn)?\b\s*(%)?/gi;
    const clean = s.replace(/\([^)]*\)/g, ' ');
    let m;
    while ((m = re.exec(clean))) {
      if (isYear(m[1]) && !m[2] && !m[3]) continue;
      return parseFloat(m[1].replace(/,/g, '')) * (m[2] ? MULT[m[2].toLowerCase()] : 1);
    }
    return null;
  }

  // ---------- KPI catalogue ----------
  // better: which direction is an improvement (null = neutral). absolute: scales with portfolio size.

  const KPIS = [
    { id: 'scope1', name: 'Scope 1 emissions', category: 'Emissions', unit: 'tCO2e', better: 'lower', absolute: true,
      re: /scope\s*1\b(?!\s*(?:\+|and|&|\/|-)\s*(?:scope\s*)?2)/i },
    { id: 'scope2_location', name: 'Scope 2 emissions (location-based)', category: 'Emissions', unit: 'tCO2e', better: 'lower', absolute: true,
      re: /scope\s*2\b[^:\n]*location/i },
    { id: 'scope2_market', name: 'Scope 2 emissions (market-based)', category: 'Emissions', unit: 'tCO2e', better: 'lower', absolute: true,
      re: /scope\s*2\b[^:\n]*market/i },
    { id: 'scope12', name: 'Scope 1 + 2 emissions', category: 'Emissions', unit: 'tCO2e', better: 'lower', absolute: true,
      re: /scope\s*1\s*(?:\+|and|&|\/)\s*(?:scope\s*)?2/i },
    { id: 'scope3', name: 'Scope 3 emissions', category: 'Emissions', unit: 'tCO2e', better: 'lower', absolute: true, re: /scope\s*3\b/i },
    { id: 'intensity', name: 'Carbon intensity', category: 'Emissions', unit: 'kgCO2e/m²', better: 'lower', re: /(?:carbon|emissions?|ghg)\s+intensity/i },
    { id: 'energy', name: 'Total energy consumption', category: 'Energy', unit: 'GWh', better: 'lower', absolute: true,
      re: /(?:total\s+energy|energy\s+consumption|energy\s+use)(?!\s+intensity)/i },
    { id: 'eui', name: 'Energy use intensity', category: 'Energy', unit: 'kWh/m²', better: 'lower', re: /energy\s+(?:use\s+)?intensity|\bEUI\b/i },
    { id: 'renewable', name: 'Renewable electricity share', category: 'Energy', unit: '%', better: 'higher', re: /renewable\s+(?:electricity|energy)(?!\s+certificate)/i },
    { id: 'water', name: 'Water withdrawal', category: 'Water', unit: 'm³', better: 'lower', absolute: true, re: /water\s+(?:withdrawal|consumption)/i },
    { id: 'water_intensity', name: 'Water intensity', category: 'Water', unit: 'm³/m²', better: 'lower', re: /water\s+intensity/i },
    { id: 'recycled_water', name: 'Recycled water share', category: 'Water', unit: '%', better: 'higher', re: /recycled\s+water|newater|water\s+recycl/i },
    { id: 'waste', name: 'Waste generated', category: 'Waste', unit: 'tonnes', better: 'lower', absolute: true, re: /waste\s+generated|total\s+waste/i },
    { id: 'waste_diversion', name: 'Waste diversion rate', category: 'Waste', unit: '%', better: 'higher', re: /diversion\s+rate|waste\s+diver|recycling\s+rate/i },
    { id: 'green_cert', name: 'Green-certified portfolio', category: 'Buildings', unit: '% of GFA', better: 'higher', re: /green[- ]certified|green\s+building\s+certif|certified\s+green/i },
    { id: 'satisfaction', name: 'Tenant / occupant satisfaction', category: 'People & wellbeing', unit: '%', better: 'higher', re: /(?:tenant|occupant|customer)\s+satisfaction/i },
    { id: 'ltir', name: 'Lost-time injury rate', category: 'People & wellbeing', unit: 'per 1M hours', better: 'lower', re: /\bLTIR\b|lost[- ]time\s+injur/i },
    { id: 'fatalities', name: 'Fatalities', category: 'People & wellbeing', unit: 'count', better: 'lower', re: /fatalit/i },
    { id: 'training', name: 'Training hours per employee', category: 'People & wellbeing', unit: 'hours', better: 'higher', re: /training\s+hours/i },
    { id: 'employees', name: 'Employees', category: 'Governance', unit: 'people', better: null, re: /^(?:total\s+|number\s+of\s+)?employees\b|headcount/i },
  ];

  const TARGET_LINE = /\bby\s+(20\d{2})\b/;

  // Lines that look like data rows (label near the start) win over prose mentions
  function extractKpi(lines, kpi) {
    for (const pass of [0, 1]) {
      for (const line of lines) {
        const m = kpi.re.exec(line);
        if (!m || TARGET_LINE.test(line) || (pass === 0 && m.index > 12)) continue;
        const value = firstNumber(line.slice(m.index + m[0].length));
        if (value != null) return { value, line: line.length > 140 ? `${line.slice(0, 137)}…` : line };
      }
    }
    return null;
  }

  // ---------- qualitative detectors (clause-level, negation-aware) ----------

  const NEGATION = /\b(not|no|no longer|never|replac\w*|previous(?:ly)?|former(?:ly)?|planned|will|intend\w*|aim to|do not|don't)\b/i;
  const clauses = text => text.split(/[.;,\n]+/).map(c => c.trim()).filter(Boolean);
  const mentions = (cls, re) => cls.some(c => re.test(c) && !NEGATION.test(c));

  const FRAMEWORKS = [
    ['GRI', /\bGRI\b/], ['TCFD', /\bTCFD\b/], ['IFRS S2 / ISSB', /IFRS\s*S[12]|\bISSB\b/], ['SASB', /\bSASB\b/],
    ['GRESB', /\bGRESB\b/], ['CDP', /\bCDP\b/], ['SBTi', /\bSBTi\b|science[- ]based\s+targets/i], ['CRREM', /\bCRREM\b/],
    ['TNFD', /\bTNFD\b/], ['EU Taxonomy', /EU\s+Taxonomy/i],
  ];

  const TOPICS = [
    ['Scope 3 emissions', /scope\s*3/i],
    ['Embodied carbon', /embodied\s+carbon/i],
    ['Recycled water', /recycled\s+water|newater/i],
    ['Climate scenario analysis', /scenario\s+analysis/i],
    ['Physical climate risk', /physical\s+(?:climate\s+)?risk|flood/i],
    ['Stranding / transition risk (CRREM)', /\bCRREM\b|stranding/i],
    ['Occupant wellbeing / WELL', /\bWELL\b|wellbeing|well-being/],
    ['Indoor air quality', /indoor\s+(?:air|environmental)\s+quality|\bIAQ\b/i],
    ['Heat-stress protocol', /heat[- ]stress/i],
    ['Green leases', /green\s+lease/i],
    ['ESG-linked executive pay', /(?:remuneration|incentive)[^.]*\bESG\b|\bESG\b[^.]*(?:remuneration|incentive)/i],
    ['Carbon credits / offsets', /carbon\s+credit|offset/i],
    ['Renewable energy certificates', /renewable\s+energy\s+certificate|\bI-?RECs?\b|\bRECs\b/i],
    ['Biodiversity', /biodiversity/i],
    ['Human rights / supply chain', /human\s+rights|supply\s+chain/i],
    ['Third-party assurance', /assurance/i],
  ];

  const TARGET_TOPICS = [
    ['Net zero', /net[- ]?zero/i],
    ['Carbon intensity', /(?:carbon|emissions?|ghg)[^.]*intensity|intensity[^.]*(?:carbon|emission)/i],
    ['Emissions', /emission|carbon/i],
    ['Green certification', /certif|green\s+mark|\bLEED\b|BREEAM/i],
    ['Waste diversion', /waste/i],
    ['Recycled water', /recycled\s+water|newater/i],
    ['Water', /water/i],
    ['Renewable energy', /renewable/i],
    ['Green leases', /green\s+lease/i],
    ['Wellbeing / WELL', /\bWELL\b|wellbeing|health/],
  ];
  const LEVEL_TARGET_KPI = { 'Green certification': 'green_cert', 'Waste diversion': 'waste_diversion', 'Recycled water': 'recycled_water', 'Renewable energy': 'renewable' };

  const COUNTRIES = ['Singapore', 'Malaysia', 'Australia', 'China', 'Hong Kong', 'Japan', 'Korea', 'India', 'Indonesia', 'Thailand', 'Vietnam', 'Philippines', 'United Kingdom', 'United States', 'Germany', 'France'];

  function parseTargets(lines) {
    const out = {};
    lines.filter(l => TARGET_LINE.test(l) && /%|net[- ]?zero|\ball\b/i.test(l)).forEach(line => {
      const topic = TARGET_TOPICS.find(([, re]) => re.test(line));
      if (!topic || out[topic[0]]) return;
      const pct = line.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
      const base = line.match(/(?:against|vs\.?|versus|relative\s+to|from)\s+(?:the\s+|a\s+)?((?:19|20)\d{2})|((?:19|20)\d{2})\s+(?:baseline|base\s+year|levels)/i);
      out[topic[0]] = {
        text: line.replace(/^[-•*\s]+/, ''),
        year: +line.match(TARGET_LINE)[1],
        pct: pct ? +pct[1] : null,
        baseline: base ? +(base[1] || base[2]) : null,
        level: /\bto\s+\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s+of\b/i.test(line),
      };
    });
    return out;
  }

  function scope2Basis(text, k) {
    const line = k.scope12?.line || '';
    if (/market/i.test(line)) return 'market';
    if (/location/i.test(line)) return 'location';
    if (k.scope2_market && !k.scope2_location) return 'market';
    if (k.scope2_location && !k.scope2_market) return 'location';
    if (k.scope2_market && k.scope2_location) return text.search(/market[- ]based/i) < text.search(/location[- ]based/i) ? 'market' : 'location';
    return null;
  }

  function analyse(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const cls = clauses(text);
    const kpis = {};
    KPIS.forEach(k => { const r = extractKpi(lines, k); if (r) kpis[k.id] = r; });
    const head = lines.slice(0, 3).join(' ');
    const yearM = head.match(/(?:FY|financial\s+year\s*|year\s+)(20\d{2})/i) || head.match(/\b(20\d{2})\b/);
    const assets = text.match(/(\d+)\s+(?:commercial\s+)?(?:assets|properties|buildings)\b/i);
    const gfa = text.match(/([\d.,]+)\s*(million)?\s*(?:m2|m²|sq\.?\s*m|square\s+met)/i);
    const baseYear = text.match(/base(?:line)?\s*(?:year)?[^.\n]{0,40}?((?:19|20)\d{2})/i);
    return {
      lines, kpis,
      organisation: (lines[0] || 'Unknown organisation').split(/\s[-–—|:]\s|sustainability|\besg\b|annual\s+report/i)[0].trim(),
      title: (lines[0] || '').slice(0, 80),
      year: yearM ? +yearM[1] : null,
      frameworks: FRAMEWORKS.filter(([, re]) => mentions(cls, re)).map(([n]) => n),
      topics: TOPICS.filter(([, re]) => mentions(cls, re)).map(([n]) => n),
      targets: parseTargets(lines),
      assets: assets ? +assets[1] : null,
      gfa: gfa ? parseFloat(gfa[1].replace(/,/g, '')) * (gfa[2] ? 1e6 : 1) : null,
      countries: COUNTRIES.filter(c => new RegExp(`\\b${c}\\b`).test(text)),
      baseYear: baseYear ? +baseYear[1] : null,
      basis: scope2Basis(text, kpis),
      assurance: (text.replace(/\s+/g, ' ').split(/(?<=[.;])\s+/).find(s => /assurance/i.test(s) && !/\bnot\b|\bno\b/i.test(s)) || '')
        .replace(/^external assurance:?\s*/i, ''),
      offsets: mentions(cls, /carbon\s+credit|offset|carbon[- ]neutral/i),
      certificates: mentions(cls, /renewable\s+energy\s+certificate|\bI-?RECs?\b|\bRECs\b/i),
    };
  }

  // ---------- comparison ----------

  const pctChange = (a, b) => (a ? ((b - a) / Math.abs(a)) * 100 : null);
  const fmtN = v => (v == null ? '–' : v.toLocaleString('en-SG', { maximumFractionDigits: 2 }));

  function compareTexts(textA, textB) {
    const A = analyse(textA), B = analyse(textB);
    const flags = [], methodology = [];
    const gfaGrowth = A.gfa && B.gfa ? pctChange(A.gfa, B.gfa) : null;
    const basisChanged = A.basis && B.basis && A.basis !== B.basis;

    // Boundary, base year, Scope 2 basis, frameworks, assurance
    if ((A.assets && B.assets && A.assets !== B.assets) || (gfaGrowth != null && Math.abs(gfaGrowth) > 5)) {
      const newC = B.countries.filter(c => !A.countries.includes(c));
      methodology.push({
        change: `Reporting boundary changed: ${A.assets ?? '?'} → ${B.assets ?? '?'} assets${gfaGrowth != null ? `, GFA ${gfaGrowth > 0 ? '+' : ''}${gfaGrowth.toFixed(0)}%` : ''}${newC.length ? `, new markets: ${newC.join(', ')}` : ''}`,
        impact: 'Absolute totals are not like-for-like. Compare intensity metrics instead.',
      });
    }
    if (A.baseYear && B.baseYear && A.baseYear !== B.baseYear) {
      methodology.push({ change: `Base year restated: ${A.baseYear} → ${B.baseYear}`, impact: 'Progress is now measured from a different starting point, which can reset or flatter reported reductions.' });
      flags.push({ severity: 'medium', issue: 'Base year restated', evidence: `Targets measured from ${A.baseYear} in Report A but from ${B.baseYear} in Report B.` });
    }
    let locationTotalB = null;
    if (basisChanged) {
      methodology.push({ change: `Scope 2 basis switched: ${A.basis}-based → ${B.basis}-based`, impact: 'Market-based Scope 2 counts renewable energy certificates and green tariffs, so it can fall without any change in energy use.' });
      if (B.kpis.scope1 && B.kpis.scope2_location) locationTotalB = B.kpis.scope1.value + B.kpis.scope2_location.value;
      const like = locationTotalB && A.kpis.scope12 && A.basis === 'location' ? ` On a like-for-like location basis, Scope 1+2 went from ${fmtN(A.kpis.scope12.value)} to ${fmtN(locationTotalB)} tCO2e (${pctChange(A.kpis.scope12.value, locationTotalB) > 0 ? '+' : ''}${pctChange(A.kpis.scope12.value, locationTotalB).toFixed(1)}%).` : '';
      flags.push({ severity: 'high', issue: 'Headline emissions fall may come from an accounting change', evidence: `Scope 2 moved from ${A.basis}-based to ${B.basis}-based reporting.${like}` });
    }
    const fwAdded = B.frameworks.filter(f => !A.frameworks.includes(f)), fwDropped = A.frameworks.filter(f => !B.frameworks.includes(f));
    if (fwAdded.length || fwDropped.length) {
      methodology.push({ change: `Frameworks: ${fwAdded.length ? `added ${fwAdded.join(', ')}` : ''}${fwAdded.length && fwDropped.length ? '; ' : ''}${fwDropped.length ? `no longer ${fwDropped.join(', ')}` : ''}`, impact: 'Disclosure structure and definitions may differ between the reports.' });
    }
    if (A.assurance && B.assurance && A.assurance.toLowerCase() !== B.assurance.toLowerCase()) {
      methodology.push({ change: 'Assurance scope changed', impact: `A: ${A.assurance} → B: ${B.assurance}` });
    }

    // KPIs
    const kpis = [];
    KPIS.forEach(def => {
      const a = A.kpis[def.id], b = B.kpis[def.id];
      if (!a && !b) return;
      let direction, comment = '';
      const d = a && b ? b.value - a.value : 0;
      const rel = a && b ? (a.value ? Math.abs(d / a.value) * 100 : d ? 100 : 0) : 0; // % change, safe from a zero baseline
      if (!a) { direction = 'new'; comment = 'Not reported in Report A.'; }
      else if (!b) { direction = 'dropped'; comment = 'No longer reported in Report B.'; }
      else if ((def.id === 'scope12' || def.id === 'intensity') && basisChanged) {
        direction = 'not comparable';
        comment = `Report A uses ${A.basis}-based Scope 2, Report B ${B.basis}-based.`;
        if (def.id === 'scope12' && locationTotalB) comment += ` Location-based B ≈ ${fmtN(locationTotalB)} tCO2e (${pctChange(a.value, locationTotalB) > 0 ? '+' : ''}${pctChange(a.value, locationTotalB).toFixed(1)}%).`;
        if (def.id === 'intensity' && locationTotalB && B.gfa) {
          const li = (locationTotalB * 1000) / B.gfa;
          comment += ` Location-based B ≈ ${li.toFixed(1)} kgCO2e/m² (${pctChange(a.value, li).toFixed(1)}%).`;
        }
      } else if (!def.better) {
        direction = 'unchanged';
        if (rel >= 1) comment = `${d > 0 ? 'Up' : 'Down'} ${rel.toFixed(0)}% (neutral metric).`;
      } else if (rel < 1) direction = 'unchanged';
      else direction = (d < 0) === (def.better === 'lower') ? 'improved' : 'worsened';
      if (def.absolute && a && b && gfaGrowth != null && Math.abs(gfaGrowth) > 5 && direction !== 'not comparable') {
        comment = `${comment} Portfolio GFA changed ${gfaGrowth > 0 ? '+' : ''}${gfaGrowth.toFixed(0)}%, so absolute totals are not like-for-like.`.trim();
      }
      kpis.push({
        name: def.name, category: def.category, unit: def.unit,
        value_a: a ? a.value : null, value_b: b ? b.value : null,
        as_reported_a: a ? a.line : 'not reported', as_reported_b: b ? b.line : 'not reported',
        direction, comment,
      });
    });

    // Targets
    const targets = [];
    new Set([...Object.keys(A.targets), ...Object.keys(B.targets)]).forEach(topic => {
      const a = A.targets[topic], b = B.targets[topic];
      let change, comment = '';
      if (!a) { change = 'new'; comment = `New target for ${b.year}.`; }
      else if (!b) { change = 'dropped'; comment = 'Target no longer stated in Report B.'; }
      else if (topic === 'Net zero') {
        change = b.year > a.year ? 'weakened' : b.year < a.year ? 'strengthened' : 'unchanged';
        if (change !== 'unchanged') comment = `Net zero date moved ${Math.abs(b.year - a.year)} years ${b.year > a.year ? 'later' : 'earlier'} (${a.year} → ${b.year}).`;
      } else if (a.baseline && b.baseline && a.baseline !== b.baseline) {
        change = 'rebaselined';
        comment = `Baseline ${a.baseline} → ${b.baseline}${a.pct != null && b.pct != null ? `; ambition ${a.pct}% → ${b.pct}%` : ''}${a.year !== b.year ? `; deadline ${a.year} → ${b.year}` : ''}.`;
      } else if (a.pct != null && b.pct != null && (a.pct !== b.pct || a.year !== b.year)) {
        change = b.pct > a.pct && b.year <= a.year ? 'strengthened' : b.pct < a.pct || b.year > a.year ? 'weakened' : 'strengthened';
        comment = `${a.pct}% by ${a.year} → ${b.pct}% by ${b.year}.`;
      } else change = 'unchanged';
      targets.push({ topic, target_a: a ? a.text : 'none', target_b: b ? b.text : 'none', change, comment });
      if (topic === 'Net zero' && change === 'weakened') flags.push({ severity: 'high', issue: 'Net zero deadline pushed back', evidence: comment });
      // Level targets due by Report B's year can be checked against B's reported value
      const kpiId = LEVEL_TARGET_KPI[topic];
      if (a && a.level && a.pct != null && kpiId && B.year && a.year <= B.year) {
        const bv = B.kpis[kpiId];
        if (!bv) flags.push({ severity: 'medium', issue: `${topic} target cannot be verified`, evidence: `Report A targeted ${a.pct}% by ${a.year}, but Report B no longer reports the metric.` });
        else if (bv.value < a.pct) flags.push({ severity: 'medium', issue: `${topic} target missed`, evidence: `Target ${a.pct}% by ${a.year}; Report B shows ${fmtN(bv.value)}%.` });
      }
    });

    // Disclosures and remaining red flags
    const added = B.topics.filter(t => !A.topics.includes(t)), removed = A.topics.filter(t => !B.topics.includes(t));
    removed.forEach(t => flags.push({ severity: 'low', issue: `Disclosure dropped: ${t}`, evidence: 'Present in Report A, absent from Report B.' }));
    if (B.offsets && !A.offsets) flags.push({ severity: 'medium', issue: 'New claims rely on carbon credits or offsets', evidence: 'Report B mentions carbon credits, offsets or carbon neutrality not present in Report A.' });
    if (B.certificates && B.kpis.renewable && (!A.kpis.renewable || B.kpis.renewable.value > A.kpis.renewable.value)) {
      flags.push({ severity: 'medium', issue: 'Renewable share relies on certificates', evidence: B.kpis.renewable.line });
    }
    if (B.kpis.fatalities && B.kpis.fatalities.value > 0) flags.push({ severity: 'high', issue: 'Fatality reported', evidence: B.kpis.fatalities.line });
    if (A.kpis.ltir && B.kpis.ltir && B.kpis.ltir.value > A.kpis.ltir.value) {
      flags.push({ severity: 'medium', issue: 'Safety performance worsened', evidence: `LTIR ${fmtN(A.kpis.ltir.value)} → ${fmtN(B.kpis.ltir.value)}.` });
    }

    // Verdict and headline
    const n = d => kpis.filter(k => k.direction === d).length;
    const high = flags.filter(f => f.severity === 'high').length;
    const found = kpis.filter(k => k.value_a != null && k.value_b != null).length;
    const verdict = found < 3 ? 'insufficient data'
      : n('improved') > n('worsened') * 2 && !high ? 'clear progress'
        : n('worsened') > n('improved') ? 'regression' : 'mixed';
    const topFlags = [...flags].sort((x, y) => ({ high: 0, medium: 1, low: 2 })[x.severity] - ({ high: 0, medium: 1, low: 2 })[y.severity]).slice(0, 2);
    const headline = found < 3
      ? `Only ${found} metric${found === 1 ? '' : 's'} could be matched across both reports. The documents may be scanned images or use unusual layouts; Claude's deep analysis handles those better.`
      : `${n('improved')} of ${found} comparable metrics improved and ${n('worsened')} worsened${n('not comparable') ? `; ${n('not comparable')} cannot be compared like-for-like` : ''}.${topFlags.length ? ` Key concerns: ${topFlags.map(f => f.issue.toLowerCase()).join('; ')}.` : ''}`;

    const meta = R => ({
      year: R.year, title: R.title, frameworks: R.frameworks,
      boundary: [R.assets ? `${R.assets} assets` : null, R.gfa ? `${(R.gfa / 1e6).toFixed(2)}M m² GFA` : null, R.countries.join(', ') || null].filter(Boolean).join(' · ') || 'boundary not detected',
    });
    return {
      engine: 'rules',
      organisation: A.organisation.replace(/\w\S*/g, w => w[0] + w.slice(1).toLowerCase()),
      report_a: meta(A), report_b: meta(B),
      headline, verdict,
      verdict_rationale: `Rule-based extraction found ${kpis.length} metrics, ${targets.length} targets and ${flags.length} red flags. Verify figures against the source documents.`,
      kpis, targets,
      disclosures_added: added, disclosures_removed: removed,
      methodology_changes: methodology,
      red_flags: flags,
    };
  }

  async function compare(docA, docB) {
    const [a, b] = await Promise.all([textOf(docA), textOf(docB)]);
    if (a.trim().length < 200 || b.trim().length < 200) {
      throw new Error('Could not extract enough text. The PDF may be a scanned image; try Claude\'s deep analysis instead.');
    }
    return compareTexts(a, b);
  }

  return { compare, compareTexts, analyse };
})();
