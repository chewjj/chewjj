// Report diff tab: load two ESG reports and compare them, offline with rules (esgrules.js) by default,
// or with Claude when an API key is connected. Both engines return the same shape, rendered here.

const ReportDiff = (() => {
  const docs = { a: null, b: null };
  const MAX_BYTES = 30 * 1024 * 1024; // the API accepts up to 32 MB per request
  const OUTPUT_TOKENS_GUESS = 6000;
  const PLACEHOLDER = { a: 'Drop or choose the earlier report (e.g. FY2021)', b: 'Drop or choose the later report (e.g. FY2025)' };
  let lastResult = null, running = false;

  const status = html => { $('#diffStatus').innerHTML = html; };
  const badge = (cls, text) => `<span class="dbadge ${cls}">${escapeHtml(text)}</span>`;

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const reader = new FileReader();
      reader.onload = () => resolve({
        name: file.name, size: file.size, kind: isPdf ? 'pdf' : 'text',
        data: isPdf ? reader.result.split(',')[1] : reader.result,
      });
      reader.onerror = () => reject(reader.error);
      if (isPdf) reader.readAsDataURL(file); else reader.readAsText(file);
    });
  }

  async function setDoc(slot, file) {
    if (!file) return;
    if (file.size > MAX_BYTES) { toast('File too large: keep each report under 30 MB'); return; }
    docs[slot] = await readFile(file);
    refresh();
  }

  function renderSlots() {
    ['a', 'b'].forEach(slot => {
      const el = $(`.drop[data-slot="${slot}"]`), d = docs[slot];
      el.classList.toggle('filled', !!d);
      el.querySelector('.drop-name').textContent = d ? d.name : PLACEHOLDER[slot];
      el.querySelector('.drop-meta').textContent = d ? `${d.kind.toUpperCase()} · ${fmt.int(d.size / 1024)} KB` : 'PDF, TXT or MD · up to 30 MB';
    });
    const ready = !running && !!(docs.a && docs.b);
    $('#diffRun').disabled = !ready;
    $('#diffAi').hidden = !AI.enabled();
    $('#diffAi').disabled = !ready;
  }

  async function refresh() {
    if (running) return;
    renderSlots();
    if (!(docs.a && docs.b)) { status('Add both reports. The comparison runs offline in your browser; no API key needed.'); return; }
    if (!AI.enabled()) {
      status('Ready. <b>Compare reports</b> runs offline and free. Optional: <a href="#" class="blink" id="diffConnect">connect Claude</a> for deep analysis of complex or scanned reports.');
      return;
    }
    status(`${TYPING} Counting tokens for the Claude option…`);
    try {
      const tokens = await AI.estimateCompare(docs.a, docs.b);
      const cost = (tokens * 4 + OUTPUT_TOKENS_GUESS * 20) / 1e6;
      status(`Ready. Offline compare is free. Deep analysis with Claude: ≈ <b>${fmt.int(tokens)}</b> input tokens · est. <b>US$${cost.toFixed(2)}</b>`);
    } catch (err) {
      status(`Ready. Offline compare is free. <span class="bad-txt">Claude estimate failed: ${escapeHtml(AI.describeError(err))}</span>`);
    }
  }

  async function run(engine) {
    running = true;
    renderSlots();
    $('#diffResult').innerHTML = '';
    try {
      if (engine === 'claude') {
        status(`${TYPING} Claude is reading both reports…`);
        lastResult = await AI.compareReports(docs.a, docs.b, chars => {
          status(`${TYPING} Claude is comparing the reports · <b>${fmt.int(chars)}</b> characters of analysis written`);
        });
        lastResult.engine = 'claude';
      } else {
        status(`${TYPING} Extracting text and comparing…`);
        lastResult = await EsgRules.compare(docs.a, docs.b);
      }
      render(lastResult);
      status(`<span class="good-txt">Comparison complete (${engine === 'claude' ? 'Claude Opus 5.5' : 'offline rules'}).</span>`);
    } catch (err) {
      const msg = err instanceof SyntaxError ? 'Could not read Claude\'s output. Try again.' : engine === 'claude' ? AI.describeError(err) : err.message;
      status(`<span class="bad-txt">${escapeHtml(msg)}</span>`);
    }
    running = false;
    renderSlots();
  }

  function delta(k) {
    if (k.value_a == null || k.value_b == null || k.value_a === 0) return '–';
    const pct = ((k.value_b - k.value_a) / Math.abs(k.value_a)) * 100;
    return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  const fmtVal = (v, unit) => (v == null ? '<span class="muted">–</span>' : `${v.toLocaleString('en-SG')} <small>${escapeHtml(unit)}</small>`);
  const slug = s => s.replace(/[^a-z]+/gi, '-').toLowerCase();

  function render(r) {
    const kpiCats = [...new Set(r.kpis.map(k => k.category))];
    const count = dir => r.kpis.filter(k => k.direction === dir).length;
    const sev = { high: 0, medium: 1, low: 2 };
    const flags = [...r.red_flags].sort((x, y) => sev[x.severity] - sev[y.severity]);
    const meta = (label, m) => `<div><span>${label}</span><b>${escapeHtml(m.title)}${m.year ? ` · ${m.year}` : ''}</b>
      <em>${escapeHtml(m.frameworks.join(', ') || 'no framework stated')}</em><p>${escapeHtml(m.boundary)}</p></div>`;

    $('#diffResult').innerHTML = `
      <div class="diff-head">
        <div><h3>${escapeHtml(r.organisation)}</h3><p class="muted">Report A → Report B · analysed by ${r.engine === 'rules' ? 'offline rule engine' : 'Claude Opus 5.5'}</p></div>
        ${badge(`v-${slug(r.verdict)}`, r.verdict)}
      </div>
      <p class="diff-headline">${escapeHtml(r.headline)}</p>
      <p class="muted">${escapeHtml(r.verdict_rationale)}</p>
      <div class="diff-meta">${meta('Report A', r.report_a)}${meta('Report B', r.report_b)}</div>
      <div class="diff-counts">
        <div><b class="good-txt">${count('improved')}</b><span>improved</span></div>
        <div><b class="bad-txt">${count('worsened')}</b><span>worsened</span></div>
        <div><b>${count('new')}</b><span>new metrics</span></div>
        <div><b>${count('dropped')}</b><span>dropped</span></div>
        <div><b>${count('not comparable')}</b><span>not comparable</span></div>
        <div><b class="bad-txt">${r.red_flags.length}</b><span>red flags</span></div>
      </div>

      <div class="sub-head"><i>01</i>Red flags</div>
      ${flags.length ? `<ul class="flags">${flags.map(f => `<li>${badge(`s-${f.severity}`, f.severity)}<div><b>${escapeHtml(f.issue)}</b><p>${escapeHtml(f.evidence)}</p></div></li>`).join('')}</ul>` : '<p class="muted">None found.</p>'}

      <div class="sub-head"><i>02</i>KPI changes</div>
      <div class="table-wrap"><table class="mini-table diff-table">
        <tr><th>Metric</th><th>Report A</th><th>Report B</th><th>Δ</th><th>Status</th><th>Note</th></tr>
        ${kpiCats.map(cat => `<tr class="cat"><td colspan="6">${escapeHtml(cat)}</td></tr>
          ${r.kpis.filter(k => k.category === cat).map(k => `<tr>
            <td><b>${escapeHtml(k.name)}</b></td>
            <td title="${escapeHtml(k.as_reported_a)}">${fmtVal(k.value_a, k.unit)}</td>
            <td title="${escapeHtml(k.as_reported_b)}">${fmtVal(k.value_b, k.unit)}</td>
            <td>${delta(k)}</td>
            <td>${badge(`d-${slug(k.direction)}`, k.direction)}</td>
            <td class="note">${escapeHtml(k.comment)}</td></tr>`).join('')}`).join('')}
      </table></div>

      <div class="sub-head"><i>03</i>Targets</div>
      <div class="table-wrap"><table class="mini-table diff-table">
        <tr><th>Topic</th><th>Report A</th><th>Report B</th><th>Change</th><th>Note</th></tr>
        ${r.targets.map(t => `<tr><td><b>${escapeHtml(t.topic)}</b></td><td>${escapeHtml(t.target_a)}</td><td>${escapeHtml(t.target_b)}</td>
          <td>${badge(`t-${slug(t.change)}`, t.change)}</td><td class="note">${escapeHtml(t.comment)}</td></tr>`).join('')}
      </table></div>

      <div class="sub-head"><i>04</i>Methodology &amp; boundary changes</div>
      <ul class="plain">${r.methodology_changes.map(m => `<li><b>${escapeHtml(m.change)}</b><p>${escapeHtml(m.impact)}</p></li>`).join('') || '<li class="muted">None.</li>'}</ul>

      <div class="sub-head"><i>05</i>Disclosures</div>
      <div class="disc">
        <div><span class="good-txt">+ Added in B</span><ul>${r.disclosures_added.map(d => `<li>${escapeHtml(d)}</li>`).join('') || '<li class="muted">None</li>'}</ul></div>
        <div><span class="bad-txt">− Removed in B</span><ul>${r.disclosures_removed.map(d => `<li>${escapeHtml(d)}</li>`).join('') || '<li class="muted">None</li>'}</ul></div>
      </div>
      <div class="chat-actions"><button class="btn ghost sm" id="diffDownload">Download JSON</button>
        <span class="muted">${r.engine === 'rules' ? 'Automated rule-based extraction. Hover a value to see the source line, and check key figures against the reports.'
          : 'AI-generated analysis. Check key figures against the source reports.'}</span></div>`;
  }

  function download() {
    const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'esg-report-comparison.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function init() {
    document.querySelectorAll('.drop').forEach(el => {
      const slot = el.dataset.slot;
      el.querySelector('input').addEventListener('change', ev => setDoc(slot, ev.target.files[0]));
      el.addEventListener('dragover', ev => { ev.preventDefault(); el.classList.add('over'); });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', ev => { ev.preventDefault(); el.classList.remove('over'); setDoc(slot, ev.dataTransfer.files[0]); });
    });
    $('#diffSample').addEventListener('click', () => {
      ['a', 'b'].forEach(slot => {
        const s = SAMPLE_REPORTS[slot];
        docs[slot] = { name: s.name, size: s.text.length, kind: 'text', data: s.text };
      });
      refresh();
    });
    $('#diffRun').addEventListener('click', () => run('rules'));
    $('#diffAi').addEventListener('click', () => run('claude'));
    document.addEventListener('click', ev => {
      if (ev.target.closest('#diffDownload')) download();
      if (ev.target.closest('#diffConnect')) { ev.preventDefault(); switchTab('copilot'); $('#aiKey').focus(); }
    });
    refresh();
  }

  document.addEventListener('DOMContentLoaded', init);
  return { refresh, render };
})();
