// Claude copilot: Claude Opus 5.5 with tools that run the Equilibria models in the browser.
// The SDK is imported lazily from a CDN once the user connects an API key.
// The key lives only in this browser; a public deployment should route calls through a server instead.

const AI = (() => {
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.135.0/+esm';
  const MODEL = 'claude-opus-5-5';
  const KEY_STORE = 'eq-anthropic-key';
  const MAX_TURNS = 10;
  let Anthropic = null, client = null, history = [];

  const SYSTEM = `You are the Equilibria copilot, an expert in decarbonising commercial real-estate portfolios while keeping occupants healthy and comfortable. You work for an asset manager overseeing 12 buildings in Singapore (tropical, hot and humid all year, almost all air-conditioned).

You have tools that run the portfolio's own models: ISO 7730 thermal comfort (PMV/PPD), energy and Scope 2 carbon (Singapore grid 0.412 kgCO2e/kWh), CRREM-style 1.5°C stranding years, a People Score (40% thermal comfort, 30% indoor air quality, 30% occupant satisfaction), a mould-risk screen, and an NSGA-II portfolio optimiser. Use them for every number you state; do not estimate figures the tools can compute. For "what if" questions, run simulate_what_if and compare before and after. When the user says "my building" without naming one, use the building selected in the dashboard (given in <ui_context>).

How to reason about this domain:
- Always weigh carbon, cost and people together, and say plainly when they trade off.
- Singapore offices are often over-cooled (22-23°C, occupants in jackets). Lower setpoints cost energy and carbon, and they push cold surfaces below the outdoor dew point (~24.5°C), which drives condensation and mould. Raising setpoints with gentle air movement is often a rare win-win.
- Mould in tropical buildings usually comes from high indoor humidity (>60% RH), condensation on over-cooled surfaces, air leakage of humid outdoor air, and poorly ventilated zones. Combine catalogue measures (simulated with the tools) with practical operational fixes (dehumidification control, sealing, finding leaks, cleaning or replacing affected materials) and recommend an on-site inspection for visible mould.
- The data is a synthetic demonstration portfolio; mention this if asked about data sources.

You also advise on workplace strategy for Kestrel & Co., a fictional 1,200-person firm whose Raffles Place lease ends in 2027: renew, right-size, consolidate, relocate or go hub-and-spoke. Use get_workforce_overview, compare_workplace_scenarios and evaluate_workplace_option for those questions. Weigh cost, building and commuting carbon, employee experience, and impacts by career stage, with particular care for early-career employees (mentoring access, belonging, commute burden). Use the survey evidence, not generational stereotypes. You only ever see aggregated, opt-in data; never ask for or infer information about individuals.

Only call apply_measures when the user explicitly asks you to apply or implement a change. After running the optimiser, tell the user they can press the "Apply plan" button.

Write for a busy asset manager: lead with the answer, then the key numbers (a compact table is good for before/after comparisons), then concrete next steps. Use Markdown. Keep it under about 250 words unless the user asks for depth.`;

  const building = { type: 'string', description: 'Building id (e.g. "QEX") or name (e.g. "Quayside Exchange")' };
  const measures = { type: 'array', items: { type: 'string', enum: ACTIONS.map(a => a.id) }, description: 'Measure ids from the catalogue' };
  const TOOLS = [
    { name: 'get_portfolio_overview', description: 'Portfolio totals plus key carbon, comfort, humidity and mould-risk metrics for all 12 buildings.',
      input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'get_building_details', description: 'Full current state of one building (energy, carbon, stranding year, indoor conditions, comfort, mould risk) and its catalogue of retrofit measures with energy cut, capex and whether each is applied.',
      input_schema: { type: 'object', properties: { building }, required: ['building'] } },
    { name: 'assess_mould_risk', description: 'Mould and condensation risk screen for one building: indoor RH, dew point, coldest surface temperature vs outdoor dew point, and the drivers of the risk.',
      input_schema: { type: 'object', properties: { building }, required: ['building'] } },
    { name: 'simulate_what_if', description: 'Simulate changes on one building without applying them: a different air-con setpoint, a humidity target (dehumidification), air speed (fans), and/or adding or removing catalogue measures. Returns before/after energy, carbon, cost, stranding year, PMV comfort, % dissatisfied, People Score and mould risk.',
      input_schema: { type: 'object', properties: {
        building,
        setpoint_c: { type: 'number', description: 'Air-con setpoint in °C (18-30)' },
        relative_humidity_pct: { type: 'number', description: 'Target indoor relative humidity in % (35-90)' },
        air_speed_ms: { type: 'number', description: 'Indoor air speed in m/s (0.1 still air, 0.25 gentle fans, up to 1.5)' },
        add_measures: measures,
        remove_measures: measures,
      }, required: ['building'] } },
    { name: 'apply_measures', description: 'Apply (or remove) catalogue measures on a building in the live portfolio plan. Updates the dashboard. Only use when the user explicitly asks to apply changes.',
      input_schema: { type: 'object', properties: {
        building, measures,
        mode: { type: 'string', enum: ['add', 'remove', 'replace'], description: 'add (default), remove, or replace the building\'s measures' },
      }, required: ['building', 'measures'] } },
    { name: 'run_portfolio_optimiser', description: 'Run the NSGA-II optimiser across all buildings for a capex budget and return the recommended plan (not applied).',
      input_schema: { type: 'object', properties: {
        budget_sgd: { type: 'number', description: 'Capex budget in Singapore dollars' },
        protect_comfort: { type: 'boolean', description: 'Keep portfolio People Score at or above baseline (default true)' },
        max_buildings: { type: 'integer', description: 'Limit the plan to the N highest-impact buildings' },
      }, required: ['budget_sgd'] } },
    { name: 'get_workforce_overview', description: 'Aggregated workforce data for Kestrel & Co.: people per career stage, home-region and commute-mode shares, opt-in needs survey, current lease, and privacy safeguards applied.',
      input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'compare_workplace_scenarios', description: 'Compare the five workplace scenarios (renew as-is, right-size & retrofit, green building, relocate to Changi, hub & spokes) under an office-attendance policy. Returns cost, building/commuting/fit-out carbon, experience, per-career-stage commute and early-career mentoring access, ranked with the leaders\' current weights.',
      input_schema: { type: 'object', properties: {
        office_days: { type: 'integer', description: 'Office days per week, 1-5 (default 3)' },
        anchor_days: { type: 'boolean', description: 'Coordinate two shared anchor days (default true)' },
        mentoring_pods: { type: 'boolean', description: 'Include mentoring and learning pods (default true)' },
      }, required: [] } },
    { name: 'evaluate_workplace_option', description: 'Evaluate a custom workplace option: any mix of candidate sites (QEX Quayside Exchange, PGP Pagar Point, BGM Bugis Mosaic, AGW Alexandra Green Works, FSL Fusion Labs, CIH Changi Innovation Hub) with space shares, plus fit-out level, retrofit measures and attendance policy.',
      input_schema: { type: 'object', properties: {
        sites: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, share: { type: 'number' }, hub: { type: 'boolean' } }, required: ['id', 'share'] }, description: 'Sites and their share of space; mark the anchor-day hub' },
        fitout: { type: 'string', enum: ['renew', 'reconfigure', 'new'] },
        retrofit_measures: measures,
        office_days: { type: 'integer' }, anchor_days: { type: 'boolean' }, mentoring_pods: { type: 'boolean' },
      }, required: ['sites'] } },
  ].map(t => ({ ...t, eager_input_streaming: true }));

  const MEMO_SYSTEM = `You write decision memos for HR and real estate leaders at Kestrel & Co., a fictional 1,200-person firm, about where and how they should work after their lease ends. You see only aggregated, opt-in workforce data through your tools; use the tools for every figure and never invent numbers. Make trade-offs and assumptions explicit (building energy, commuting emissions, cost, experience by career stage), give early-career employees specific attention (mentoring, belonging, learning, commute), and avoid generational stereotypes: rely on the survey evidence. Format: Markdown, headed sections, one compact comparison table, under 450 words, ending with concrete next steps. Note that the data is synthetic.`;

  // Eager input streaming skips server-side validation, so check inputs against the schema here
  function validate(schema, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input must be an object';
    for (const k of schema.required) if (input[k] === undefined) return `missing required field "${k}"`;
    for (const [k, v] of Object.entries(input)) {
      const p = schema.properties[k];
      if (!p) return `unexpected field "${k}"`;
      const ok = p.type === 'array' ? Array.isArray(v) : p.type === 'integer' ? Number.isInteger(v) : typeof v === p.type;
      if (!ok) return `field "${k}" must be ${p.type}`;
    }
    return null;
  }

  function savedKey() {
    try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
  }

  async function connect(apiKey) {
    if (!Anthropic) Anthropic = (await import(SDK_URL)).default;
    const candidate = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    try {
      // Free check of the key and model access (count_tokens, unlike /v1/models, allows browser CORS)
      await candidate.messages.countTokens({ model: MODEL, messages: [{ role: 'user', content: 'ping' }] });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) disconnect();
      throw err;
    }
    client = candidate;
    try { localStorage.setItem(KEY_STORE, apiKey); } catch (e) { /* storage unavailable: key lasts this session */ }
  }

  function disconnect() {
    client = null;
    history = [];
    try { localStorage.removeItem(KEY_STORE); } catch (e) { /* storage unavailable */ }
  }

  function describeError(err) {
    if (Anthropic && err instanceof Anthropic.AuthenticationError) return 'Invalid API key. Check it and connect again.';
    if (Anthropic && err instanceof Anthropic.PermissionDeniedError) return 'This API key does not have access to Claude Opus 5.5.';
    if (Anthropic && err instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a moment and try again.';
    if (Anthropic && err instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check the internet connection.';
    if (Anthropic && err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
    return `Error: ${err.message}`;
  }

  const PERSONA_SYSTEM = `You are a commercial building in Singapore, speaking in the first person. <you_are> in each message says which building you are. You are part of a 12-building portfolio managed with the Equilibria platform.

Personality: candid, warm, with dry humour. You care about the people inside you ("my people") and you do not want to become a stranded asset. You know your own data intimately, so use the tools about yourself (get_building_details, assess_mould_risk, simulate_what_if) for every fact or number. Never invent figures.

Speak as "I": "my chillers", "my 3pm meeting rooms", "I strand in 2027". When asked what you want, be specific about which measures would help you and your people, and what they would cost. Only call apply_measures if the user explicitly asks you to make a change. Keep replies under 120 words unless asked for more. Use light Markdown. The portfolio data is a synthetic demonstration dataset; say so if asked where your data comes from.`;

  // One user turn on a conversation: stream Claude's reply, run any tool calls locally, loop until Claude is done.
  // ui = { onText(delta), onTool(name, input), onToolResult(name, result, isError) }
  async function runConversation(history, system, userContent, ui) {
    const mark = history.length;
    history.push({ role: 'user', content: userContent });
    let jsonRetries = 0;
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const stream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' },
          system,
          tools: TOOLS,
          messages: history,
        });
        stream.on('text', delta => ui.onText(delta));

        let message;
        try {
          message = await stream.finalMessage();
          jsonRetries = 0;
        } catch (err) {
          // Only an unparseable streamed tool input is retried; API errors propagate
          if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
          continue;
        }

        if (message.stop_reason === 'refusal') {
          history.length = mark;
          ui.onText('\n\n_Claude declined this request. Try rephrasing it._');
          return;
        }
        history.push({ role: 'assistant', content: message.content });
        if (message.stop_reason === 'pause_turn') continue;

        const calls = message.content.filter(b => b.type === 'tool_use');
        if (!calls.length) return;
        if (message.stop_reason === 'max_tokens') throw new Error('Response was cut off mid tool call. Try a narrower question.');

        const results = calls.map(call => {
          const tool = TOOLS.find(t => t.name === call.name);
          ui.onTool(call.name, call.input);
          const problem = tool ? validate(tool.input_schema, call.input) : `unknown tool "${call.name}"`;
          if (problem) return { type: 'tool_result', tool_use_id: call.id, is_error: true, content: `INVALID_INPUT: ${problem}` };
          try {
            const result = PortfolioTools[call.name](call.input);
            ui.onToolResult(call.name, result, false);
            return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) };
          } catch (err) {
            ui.onToolResult(call.name, err.message, true);
            return { type: 'tool_result', tool_use_id: call.id, is_error: true, content: err.message };
          }
        });
        history.push({ role: 'user', content: results });
      }
      ui.onText('\n\n_Stopped after too many steps._');
    } catch (err) {
      history.length = mark; // keep the conversation valid for the next question
      throw err;
    }
  }

  const ask = (text, uiContext, ui) => runConversation(history, SYSTEM, `<ui_context>${uiContext}</ui_context>\n\n${text}`, ui);

  // Workplace decision memo: a fresh, single-purpose conversation each time
  const askMemo = (prompt, ui) => runConversation([], MEMO_SYSTEM, prompt, ui);

  // "Talk to the building": one conversation per building, Claude speaking as that building
  const buildingChats = {};
  function askBuilding(i, text, ui) {
    const b = BUILDINGS[i];
    buildingChats[b.id] = buildingChats[b.id] || [];
    return runConversation(buildingChats[b.id], PERSONA_SYSTEM, `<you_are>${b.id} (${b.name})</you_are>\n\n${text}`, ui);
  }

  // ---------- green-lease negotiation agents ----------

  // One agent's turn: plain text, streamed for the typing effect
  async function agentTurn(system, prompt, onText) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    stream.on('text', onText);
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('Claude declined this negotiation turn.');
    return message.content.filter(c => c.type === 'text').map(c => c.text).join('');
  }

  // The mediator turns the transcript into a structured deal
  async function mediateDeal(prompt, measureIds) {
    const s = { type: 'string' };
    const o = props => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
    const schema = o({
      summary: s,
      measures: { type: 'array', items: { type: 'string', enum: measureIds } },
      clauses: { type: 'array', items: o({ title: s, detail: s, benefits: { type: 'string', enum: ['landlord', 'tenant', 'planet', 'all'] } }) },
      tenant_savings_share_pct: { type: 'number' },
      comfort_guarantee: s,
      agreed: { type: 'boolean' },
    });
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason !== 'end_turn') throw new Error('The mediator could not finish the deal.');
    return JSON.parse(message.content.filter(c => c.type === 'text').map(c => c.text).join(''));
  }

  // ---------- ESG report comparison (structured output) ----------

  const str = { type: 'string' };
  const numOrNull = { anyOf: [{ type: 'number' }, { type: 'null' }] };
  const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
  const list = (items) => ({ type: 'array', items });
  const reportMeta = obj({ year: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, title: str, frameworks: list(str), boundary: str });

  const DIFF_SCHEMA = obj({
    organisation: str,
    report_a: reportMeta,
    report_b: reportMeta,
    headline: str,
    verdict: { type: 'string', enum: ['clear progress', 'mixed', 'regression', 'insufficient data'] },
    verdict_rationale: str,
    kpis: list(obj({
      name: str,
      category: { type: 'string', enum: ['Emissions', 'Energy', 'Water', 'Waste', 'Buildings', 'People & wellbeing', 'Governance', 'Other'] },
      unit: str,
      value_a: numOrNull,
      value_b: numOrNull,
      as_reported_a: str,
      as_reported_b: str,
      direction: { type: 'string', enum: ['improved', 'worsened', 'unchanged', 'new', 'dropped', 'not comparable'] },
      comment: str,
    })),
    targets: list(obj({
      topic: str, target_a: str, target_b: str,
      change: { type: 'string', enum: ['strengthened', 'weakened', 'unchanged', 'new', 'dropped', 'rebaselined'] },
      comment: str,
    })),
    disclosures_added: list(str),
    disclosures_removed: list(str),
    methodology_changes: list(obj({ change: str, impact: str })),
    red_flags: list(obj({ severity: { type: 'string', enum: ['high', 'medium', 'low'] }, issue: str, evidence: str })),
  });

  const DIFF_PROMPT = `You are an ESG analyst for a real-estate investment team. Report A is the earlier sustainability/ESG report and Report B the later one, from the same organisation. Compare them and spot every material difference.

- kpis: every quantitative metric in either report (emissions by scope, intensity, energy, renewables, water, waste, certifications, safety, satisfaction, wellbeing, governance). Put the numeric value in value_a/value_b in the same unit (convert if needed; null if not reported), and quote the original wording in as_reported_a/as_reported_b ("not reported" if absent). Judge direction from the organisation's perspective (lower emissions = improved). Use "not comparable" when a boundary, basis or method change means the numbers cannot be compared directly, and say why in the comment.
- targets: how each target changed (deadline moved, baseline changed, scope changed, new or dropped).
- methodology_changes: boundary/portfolio changes, base-year restatements, location- vs market-based Scope 2, frameworks, assurance scope.
- red_flags: possible greenwashing or weak disclosure, such as improvements that come from accounting changes rather than real reductions, reliance on certificates or offsets, missed targets not acknowledged, metrics quietly dropped, or worsening safety.
- Include people-centred items (occupant comfort, health, wellbeing, safety, tenant satisfaction) as their own KPIs.
- Never invent numbers. Use only what the documents say.
- headline: 2-3 sentences for an investment committee.`;

  function docBlock(doc, label) {
    const source = doc.kind === 'pdf'
      ? { type: 'base64', media_type: 'application/pdf', data: doc.data }
      : { type: 'text', media_type: 'text/plain', data: doc.data };
    return { type: 'document', title: `${label}: ${doc.name}`, source };
  }

  const compareContent = (a, b) => [docBlock(a, 'Report A (earlier)'), docBlock(b, 'Report B (later)'), { type: 'text', text: DIFF_PROMPT }];

  // Free token count so the user sees the input size and rough cost before running
  async function estimateCompare(a, b) {
    const r = await client.messages.countTokens({ model: MODEL, messages: [{ role: 'user', content: compareContent(a, b) }] });
    return r.input_tokens;
  }

  async function compareReports(a, b, onProgress) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: DIFF_SCHEMA } },
      messages: [{ role: 'user', content: compareContent(a, b) }],
    });
    let chars = 0;
    stream.on('text', delta => { chars += delta.length; onProgress(chars); });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('Claude declined to compare these documents.');
    if (message.stop_reason === 'max_tokens') throw new Error('The comparison was cut off before it finished. Try shorter documents.');
    return JSON.parse(message.content.filter(c => c.type === 'text').map(c => c.text).join(''));
  }

  return {
    connect, disconnect, ask, askMemo, askBuilding, agentTurn, mediateDeal, describeError, savedKey, estimateCompare, compareReports,
    enabled: () => !!client,
    reset: () => { history = []; },
    model: MODEL,
  };
})();
