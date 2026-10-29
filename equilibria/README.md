# Equilibria: People-Centred Low-Carbon Portfolio Copilot

Cutting carbon in buildings usually costs people something: warmer offices, closed floors, stale air.
Equilibria optimises **carbon and human wellbeing together** across a whole real-estate portfolio, and puts the
people in the room into the decision.

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
- `js/data.js`, `js/engine.js`, `js/optimizer.js`: data and models
- `js/tools.js`: model functions exposed to Claude and the offline copilot
- `js/ai.js`: all Claude calls (copilot, building persona, negotiation agents, report diff)
- `js/audience.js` + `vote.html` + `serve.js`: live audience vote
- `js/talk.js`, `js/negotiate.js`, `js/story.js`: the other experiences
- `js/app.js`: dashboard UI · `css/style.css`: styling

## 4-minute demo script
1. **Open with the room (60s):** Slide 1 = the Live audience vote QR. "You are now occupants of Quayside Exchange. It's 22°C. Vote."
   Show the bars filling: "Our model predicted 20% uncomfortable; you say 64%." Then: "Would you trade 25.5°C and a fan for 1,100 tonnes of CO₂?"
   Press **Apply the audience's decision**: the dashboard opens on Quayside and its carbon column shrinks. *"That carbon only exists because people said yes."*
2. **Talk to the building (40s):** "Why do people complain about you?", then "What would it take to get you on the 1.5°C pathway?"
3. **Negotiate (50s):** Run the green-lease negotiation for Meridian Bay Tower; land on the comfort guarantee clause; **Sign & apply**.
4. **Portfolio (40s):** Optimiser at S$15M → Pareto frontier → apply → stranded assets 8 → 2, People Score up ~9 points. Street 3D fly-in.
5. **Close with 2035 (30s):** Open *A day in 2035* for a red building and scroll to the valuation and lease-renewal scenes.
6. **If asked:** ESG report diff on the `samples/` PDFs; copilot mould question.

## Claude
Paste an Anthropic API key into the Copilot tab. It is checked with a free token-count call, then stored in this browser's localStorage and sent only to `api.anthropic.com`. That is fine for a hackathon demo; a public deployment should call Claude from a small server so the key is not exposed. Every feature has an offline mode.

## Assumptions
Synthetic data. Singapore grid factor 0.412 kgCO₂e/kWh (EMA) with 1.5%/yr decarbonisation. The pathways are illustrative CRREM-style curves, not official CRREM data.
The 2035 story's carbon price (S$80/t), brown discount (up to 12%) and asset values are illustrative. Live votes are anonymous and pass through the public ntfy.sh relay on a random session topic.
