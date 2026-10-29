// NSGA-II multi-objective optimiser: minimise portfolio carbon and maximise People Score under a capex budget.
// Genome = one action bitmask per building.

const Optimiser = (() => {
  const N = BUILDINGS.length, K = ACTIONS.length;
  const allowedBits = BUILDINGS.map(b => [...Array(K).keys()].filter(k => b.allowed & (1 << k)));
  const key = ind => ind.genes.join('.');

  function evaluatePlan(genes) {
    const s = portfolioStats(genes);
    return { genes, carbon: s.carbon, people: s.people, capex: s.capex };
  }

  // Drop random measures until the plan fits the budget
  function repair(genes, budget) {
    let ind = evaluatePlan(genes);
    while (ind.capex > budget) {
      const active = [];
      genes.forEach((m, i) => allowedBits[i].forEach(k => { if (m & (1 << k)) active.push([i, k]); }));
      const [i, k] = active[(Math.random() * active.length) | 0];
      genes[i] &= ~(1 << k);
      ind = evaluatePlan(genes);
    }
    return ind;
  }

  // Greedy benefit-per-dollar seed to give the search good starting points
  function greedy(budget, gain) {
    let cur = evaluatePlan(new Array(N).fill(0));
    for (;;) {
      let best = null;
      cur.genes.forEach((m, i) => allowedBits[i].forEach(k => {
        if (m & (1 << k)) return;
        const g = cur.genes.slice();
        g[i] |= 1 << k;
        const c = evaluatePlan(g);
        if (c.capex > budget) return;
        const val = gain(cur, c) / Math.max(1, c.capex - cur.capex);
        if (val > 0 && (!best || val > best.val)) best = { val, c };
      }));
      if (!best) return cur;
      cur = best.c;
    }
  }

  const randomGenes = density => allowedBits.map(bits => bits.reduce((m, k) => (Math.random() < density ? m | (1 << k) : m), 0));

  const dominates = (a, b) =>
    a.carbon <= b.carbon && a.people >= b.people && (a.carbon < b.carbon || a.people > b.people);

  function nonDominatedSort(pop) {
    const fronts = [[]];
    pop.forEach(p => {
      p.S = []; p.n = 0;
      pop.forEach(q => {
        if (dominates(p, q)) p.S.push(q);
        else if (dominates(q, p)) p.n++;
      });
      if (p.n === 0) { p.rank = 0; fronts[0].push(p); }
    });
    for (let i = 0; fronts[i].length; i++) {
      const next = [];
      fronts[i].forEach(p => p.S.forEach(q => { if (--q.n === 0) { q.rank = i + 1; next.push(q); } }));
      fronts.push(next);
    }
    fronts.pop();
    return fronts;
  }

  function assignCrowding(front) {
    front.forEach(p => { p.crowd = 0; });
    ['carbon', 'people'].forEach(obj => {
      front.sort((a, b) => a[obj] - b[obj]);
      const span = front[front.length - 1][obj] - front[0][obj] || 1;
      front[0].crowd = front[front.length - 1].crowd = Infinity;
      for (let i = 1; i < front.length - 1; i++) front[i].crowd += (front[i + 1][obj] - front[i - 1][obj]) / span;
    });
  }

  function select(pop, size) {
    const out = [];
    for (const f of nonDominatedSort(pop)) {
      assignCrowding(f);
      if (out.length + f.length <= size) out.push(...f);
      else { f.sort((a, b) => b.crowd - a.crowd); out.push(...f.slice(0, size - out.length)); break; }
    }
    return out;
  }

  function dedupe(list) {
    const seen = new Map();
    list.forEach(ind => { const k = key(ind); if (!seen.has(k)) seen.set(k, ind); });
    return [...seen.values()];
  }

  function tournament(pop) {
    const a = pop[(Math.random() * pop.length) | 0], b = pop[(Math.random() * pop.length) | 0];
    if (a.rank !== b.rank) return a.rank < b.rank ? a : b;
    return a.crowd >= b.crowd ? a : b;
  }

  function mutate(genes) {
    const g = genes.slice();
    const flips = 1 + (Math.random() < 0.4) + (Math.random() < 0.15);
    for (let f = 0; f < flips; f++) {
      const i = (Math.random() * N) | 0, bits = allowedBits[i];
      if (bits.length) g[i] ^= 1 << bits[(Math.random() * bits.length) | 0];
    }
    return g;
  }

  function create(budget, popSize = 100) {
    const explored = new Set();
    const archive = []; // every unique plan evaluated, for the scatter plot
    const explore = ind => {
      const k = key(ind);
      if (!explored.has(k)) { explored.add(k); archive.push({ x: carbonCut(ind.carbon), y: ind.people }); }
      return ind;
    };

    let pop = [
      evaluatePlan(new Array(N).fill(0)),
      greedy(budget, (a, c) => a.carbon - c.carbon),
      greedy(budget, (a, c) => c.people - a.people),
      greedy(budget, (a, c) => ((a.carbon - c.carbon) / BASE_STATS.carbon) * 100 + (c.people - a.people)),
    ].map(explore);
    while (pop.length < popSize) pop.push(explore(repair(randomGenes(Math.random()), budget)));
    pop = select(dedupe(pop), popSize);
    let generation = 0;

    return {
      archive,
      get generation() { return generation; },
      get explored() { return explored.size; },
      step() {
        const kids = [];
        while (kids.length < popSize) {
          const a = tournament(pop), b = tournament(pop);
          const g = Math.random() < 0.9 ? a.genes.map((x, i) => (Math.random() < 0.5 ? x : b.genes[i])) : a.genes.slice();
          kids.push(explore(repair(mutate(g), budget)));
        }
        pop = select(dedupe(pop.concat(kids)), popSize);
        generation++;
      },
      front() {
        return pop.filter(p => p.rank === 0).sort((a, b) => b.carbon - a.carbon);
      },
    };
  }

  function runAnimated(budget, { generations = 80, onProgress, onDone }) {
    const run = create(budget);
    const tick = () => {
      for (let i = 0; i < 2 && run.generation < generations; i++) run.step();
      onProgress(run);
      if (run.generation < generations) setTimeout(tick, 30);
      else onDone(run);
    };
    setTimeout(tick, 0);
  }

  function runSync(budget, generations = 60) {
    const run = create(budget);
    while (run.generation < generations) run.step();
    return run;
  }

  // weight 0 = all-in on carbon, 1 = all-in on people
  function pick(front, weight) {
    const xs = front.map(p => -p.carbon), ys = front.map(p => p.people);
    const nx = v => (v - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs) || 1);
    const ny = v => (v - Math.min(...ys)) / (Math.max(...ys) - Math.min(...ys) || 1);
    let best = front[0], bestScore = -Infinity;
    front.forEach((p, i) => {
      const score = (1 - weight) * nx(xs[i]) + weight * ny(ys[i]);
      if (score > bestScore) { bestScore = score; best = p; }
    });
    return best;
  }

  return { runAnimated, runSync, pick };
})();
