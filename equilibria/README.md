# Footfall: Right spaces, right places, lower carbon

Workforce planning, employee experience and real estate decisions are usually made separately. Footfall connects them:
an AI-assisted scenario tool that compares **renewing, right-sizing, consolidating, relocating or going hub-and-spoke**
on cost, carbon (building energy **and** commuting **and** fit-out), employee experience, and impacts on each career
stage, with particular care for early-career employees. Underneath, a building layer models energy, comfort and
CRREM stranding for every candidate site.

## Navigating
The left sidebar holds eight pages: **Overview** (metric cards, carbon pathway, asset health, workplace decision, live alerts, asset table),
**Workplace studio**, **Portfolio twin** (3D map + asset spec sheet), **Retrofit optimiser**, **Live operations**, **Copilot**, **Reports**
(ESG report + report diff) and **Experiences**. Each page has a deep link, e.g. `index.html#workplace`. The top bar has building search,
the alerts bell and the light/dark switch; the gear icon opens the Claude connection.

## How it answers the brief
| Brief asks for | Where it is |
|---|---|
| Compare renew / consolidate / relocate with headcount, lease, occupancy and commuting data | **01 Workplace scenario studio**: 5 scenarios, hybrid-policy levers, leadership weights, side-by-side trade-offs |
| Cost, employee experience and carbon trade-offs visible | Trade-off table (★ best per row), carbon by source chart, "Who wins, who pays" panel |
| Building energy *and* commuting emissions | Carbon split into building energy, commuting and fit-out materials; commute flows drawn on the 3D map |
| Multigenerational workforce, early-career impacts, mentoring, belonging, wellbeing | Modelled by **career stage** (generation as a label only): commute by stage, mentoring access index, belonging index, building comfort; safeguards suggested automatically |
| Evidence, not stereotypes | Opt-in survey needs chart ("needs overlap more than they differ"); evidence notes in Assumptions |
| Protect employee data | Aggregated inputs only, groups under 10 merged (k-anonymity), AI sees aggregates only; **Data & privacy** page |
| Show assumptions clearly | **Assumptions** page lists every coefficient; all data synthetic and labelled |
| Use AI | Claude decision memo for HR & real estate leaders and copilot, both calling the scenario model as tools; offline fallbacks throughout |

## Run
- **Quick:** double-click `index.html`. Needs internet for map tiles, fonts and libraries. No build step.
- **For the live audience vote:** run `node serve.js` in this folder and open the dashboard from the **Network** address it prints
  (e.g. `http://192.168.1.20:8080`). The QR code then points judges' phones at your laptop. Phones must be on the same Wi-Fi.
  Allow Node through the Windows firewall if asked.

## Experiences (the bar under the header)
| Experience | What happens | Without Claude |
|---|---|---|
| ◉ **Live audience vote** | Judges scan a QR code and become occupants of over-cooled Quayside Exchange. They vote on how they feel and whether they'd accept 25.5°C + a fan for a carbon cut. Votes appear live; the model's predicted discomfort is compared with the real room; **Apply the audience's decision** changes the building and its 3D column shrinks. | Works (votes relay through ntfy.sh). **Simulate judges** button if phones can't connect. |
| 💬 **Talk to the building** | The selected building speaks in the first person about its own data ("I'm 34, I'm already over my carbon budget, and my people are cold"). Ask it anything. | Offline voice built from the models; Claude adds open conversation using the portfolio tools. |
| 🤝 **Green-lease negotiation** | Landlord, Tenant and Planet agents negotiate a retrofit-and-comfort deal; a mediator writes the clauses; **Sign & apply** updates the portfolio. | Scripted negotiation using the same model numbers (labelled). Claude runs live agents. |
| ▶ **A day in 2035** | Scroll story: the same Tuesday in two futures (do nothing vs retrofit): comfort, air, mould, bills, valuation, lease renewal. | Fully offline. |

## Features
| Feature | Tech |
|---|---|
| 3D portfolio twin: emission columns (height = tCO₂e/yr, colour = stranding year) that shrink when a plan is applied; "Street 3D" flies into the real Singapore skyline | MapLibre GL (WebGL), OpenFreeMap / OSM 3D buildings, CRREM-style 1.5°C pathways |
| Building twin: carbon trajectory vs pathway, stranding year | Chart.js, grid decarbonisation model |
| People layer: thermal comfort, air quality, occupant pulse → People Score; mould-risk screen | ISO 7730 PMV/PPD implemented in JS; dew-point condensation model |
| Retrofit what-if: toggle 8 measures, instant capex / savings / payback | 3,072 precomputed scenarios |
| Multi-objective optimiser with animated Pareto frontier | NSGA-II genetic algorithm (from scratch) |
| Copilot: open questions ("my building has mould, what do you propose?", "what if I lower the aircon to 22°C?") answered by calling the portfolio models as tools; offline rules without a key | Anthropic SDK in the browser, streaming tool loop (`js/ai.js`, tools in `js/tools.js`) |
| ESG report diff: two reports (PDF or text) → KPI changes, target changes, methodology shifts, greenwashing red flags | Offline pdf.js + rule engine (`js/esgrules.js`); optional Claude deep analysis (structured output) |
| Live ops: simulated IoT stream and real-time insights; one-click ESG report | Sensor simulation, rule engine |

## Code map (for splitting work)
- `js/workforce.js`: workforce data (aggregated, synthetic), workplace scenarios and the scenario model
- `js/studio.js`: Workplace Scenario Studio UI, privacy and assumptions pages, decision memo
- `js/data.js`, `js/engine.js`, `js/optimizer.js`: building data and models
- `js/tools.js`: model functions exposed to Claude and the offline copilot
- `js/ai.js`: all Claude calls (copilot, building persona, negotiation agents, report diff)
- `js/audience.js` + `vote.html` + `serve.js`: live audience vote
- `js/talk.js`, `js/negotiate.js`, `js/story.js`: the other experiences
- `js/app.js`: dashboard UI · `css/style.css`: styling

## 4-minute demo script
1. **The decision (60s):** "Our lease at Quayside Exchange ends in 2027. Renew, consolidate or relocate?" In the Studio's first panel, pick the current office and tick candidate buildings from the portfolio (or click them on the map); the scenarios are generated from that selection, with the current office kept as the hub and spokes picked to minimise commuting. Options that stay in the current building are ranked first as **Plan A**; relocations are grouped as **Plan B**, the fallback. Then point at the cards:
   relocating to the green building cuts building energy, but **early-career commutes over an hour jump from 17% to 39%**, because juniors live further out
   and rely on public transport. Hub & spokes cuts commuting carbon and long commutes to 0%.
2. **The policy lever (40s):** Untick *Coordinated anchor days*: hub & spokes' mentoring access collapses (73 → 20) and the safeguard appears.
   *"The same building choice is good or bad for juniors depending on the hybrid policy, so HR and real estate have to decide together."*
3. **Trust (30s):** Open **Data & privacy** (aggregated, k ≥ 10, opt-in, AI sees aggregates only) and **Assumptions**.
4. **AI memo (40s):** **Write decision memo**; Claude calls the scenario model and writes the memo for HR and real estate leaders.
5. **The room (40s):** Live audience vote: judges become occupants; their votes decide the building's setpoint.
6. **Close (30s):** *A day in 2035* for the chosen site, scrolling to the lease-renewal scene.
7. **If asked:** green-lease negotiation, talk to the building, portfolio optimiser, ESG report diff.

## Claude
Paste an Anthropic API key into the Copilot tab. It is checked with a free token-count call, then stored in this browser's localStorage and sent only to `api.anthropic.com`. That is fine for a hackathon demo; a public deployment should call Claude from a small server so the key is not exposed. Every feature has an offline mode.

## Assumptions
Synthetic data. Singapore grid factor 0.412 kgCO₂e/kWh (EMA) with 1.5%/yr decarbonisation. The pathways are illustrative CRREM-style curves, not official CRREM data.
The 2035 story's carbon price (S$80/t), brown discount (up to 12%) and asset values are illustrative. Live votes are anonymous and pass through the public ntfy.sh relay on a random session topic.
