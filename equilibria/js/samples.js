// Two fictional sustainability reports for demoing the report comparison. Not real company data.

const SAMPLE_REPORTS = {
  a: {
    name: 'Harbourline_Sustainability_Report_FY2021.txt',
    text: `HARBOURLINE PROPERTY TRUST - SUSTAINABILITY REPORT FY2021
[Fictional sample document created for the Footfall hackathon demo. Not real company data.]

1. ABOUT THIS REPORT
This report covers the financial year 1 January to 31 December 2021. It has been prepared with reference to the GRI Standards 2016 and the recommendations of the Task Force on Climate-related Financial Disclosures (TCFD).
Reporting boundary: 18 commercial assets (11 offices, 5 retail malls, 2 business parks) under Harbourline's operational control in Singapore and Malaysia, totalling 1.42 million m2 gross floor area (GFA).
Base year for environmental targets: 2019.
External assurance: limited assurance over Scope 1 and Scope 2 emissions by an independent assurance provider.

2. CHAIRMAN'S MESSAGE
2021 was a year of resilience. We remain committed to achieving net zero operational carbon across our portfolio by 2040, ten years ahead of most of our peers.

3. ENVIRONMENTAL PERFORMANCE (FY2021)
Scope 1 emissions: 4,210 tCO2e
Scope 2 emissions (location-based): 96,480 tCO2e
Total Scope 1 + 2 emissions: 100,690 tCO2e
Carbon intensity (Scope 1+2): 70.9 kgCO2e/m2 GFA
Scope 3 emissions: not reported
Total energy consumption: 236.4 GWh
Energy use intensity: 166 kWh/m2
Renewable electricity: 2.1% of electricity consumption (on-site solar)
Water withdrawal: 1.92 million m3
Water intensity: 1.35 m3/m2
Recycled water (NEWater) share: 14% of total water use
Waste generated: 8,940 tonnes
Waste diversion rate: 34%
Green-certified portfolio (Green Mark Gold Plus or above): 61% of GFA
Embodied carbon: we measure and disclose embodied carbon for all new developments and major refurbishments. FY2021 embodied carbon of completed projects: 38,200 tCO2e.

4. TARGETS
- Net zero operational carbon (Scope 1 and 2) by 2040.
- Reduce Scope 1+2 carbon intensity by 30% by 2030 against the 2019 baseline.
- 80% of portfolio GFA green-certified (Gold Plus or above) by 2025.
- Increase waste diversion to 50% by 2025.
- Increase recycled water to 20% of total water use by 2025.

5. PEOPLE AND COMMUNITY
Employees: 412
Average training hours per employee: 22
Lost-time injury rate (LTIR, per 1 million hours worked): 0.42
Fatalities (employees and contractors): 0
Tenant satisfaction survey: 78% satisfied
We do not currently run occupant wellbeing or indoor environmental quality programmes.

6. GOVERNANCE
A Sustainability Committee chaired by the CEO meets quarterly. Executive remuneration is not currently linked to ESG performance.

7. CLIMATE RISK (TCFD)
We have identified flood risk at 2 coastal assets and are assessing physical climate risks across the portfolio. Scenario analysis is planned for FY2022.`,
  },
  b: {
    name: 'Harbourline_Sustainability_Report_FY2025.txt',
    text: `HARBOURLINE PROPERTY TRUST - SUSTAINABILITY REPORT FY2025
[Fictional sample document created for the Footfall hackathon demo. Not real company data.]

1. ABOUT THIS REPORT
This report covers the financial year 1 January to 31 December 2025. It is prepared in accordance with the GRI Standards 2021 and IFRS S2 Climate-related Disclosures (ISSB), which replaces our previous TCFD reporting. We participated in GRESB for the first time and received a 4-star rating.
Reporting boundary: 24 assets (11 offices, 5 retail malls, 2 business parks and 6 logistics warehouses acquired in 2023) in Singapore, Malaysia and Australia, totalling 1.86 million m2 GFA.
Base year: restated to 2022 to reflect portfolio changes.
Scope 2 emissions are now reported on a market-based basis, in line with industry practice. Location-based figures are available in Appendix C.
External assurance: limited assurance over Scope 1, Scope 2 and selected Scope 3 categories.

2. CEO'S MESSAGE
We are proud to report that our corporate offices are now carbon neutral, achieved through the purchase of verified carbon credits. Our carbon intensity has fallen by 30% since 2021, and we have set a science-aligned 2030 target.

3. ENVIRONMENTAL PERFORMANCE (FY2025)
Scope 1 emissions: 3,880 tCO2e
Scope 2 emissions (market-based): 88,950 tCO2e
Total Scope 1 + 2 emissions (market-based): 92,830 tCO2e
Carbon intensity (Scope 1+2, market-based): 49.9 kgCO2e/m2 GFA
Scope 3 emissions (categories 1, 3 and 13 - downstream leased assets): 412,600 tCO2e
Total energy consumption: 271.8 GWh
Energy use intensity: 146 kWh/m2
Renewable electricity: 18% of electricity consumption (14% renewable energy certificates, 4% on-site solar)
Water withdrawal: 2.31 million m3
Water intensity: 1.24 m3/m2
Waste generated: 11,860 tonnes
Waste diversion rate: 29%
Green-certified portfolio (Green Mark Gold Plus or above): 74% of GFA

Appendix C - Scope 2 (location-based): 104,300 tCO2e

4. TARGETS
- Net zero Scope 1 and 2 emissions by 2050, aligned with Singapore's national net zero target.
- Reduce Scope 1+2 carbon intensity by 42% by 2030 against the 2022 baseline (science-aligned; SBTi validation pending).
- 100% of new leases to include green lease clauses by 2027.
- WELL Health-Safety rating for all office assets by 2027.

5. PEOPLE, HEALTH AND WELLBEING
Employees: 538
Average training hours per employee: 31
Lost-time injury rate (LTIR, per 1 million hours worked): 0.55
Fatalities: 1 contractor fatality at a development site in Malaysia. An investigation has been completed and corrective actions implemented.
Occupant satisfaction survey (expanded to include indoor comfort and air quality questions): 81% satisfied
WELL Health-Safety rating achieved at 9 assets.
Real-time indoor air quality (CO2, PM2.5, temperature, humidity) monitoring installed in 15 assets.
Heat-stress protocol introduced for workers at logistics warehouses.

6. GOVERNANCE
The Board ESG Committee oversees sustainability. 10% of executive short-term incentives are linked to ESG KPIs (carbon intensity, green certification and safety).

7. CLIMATE RISK (IFRS S2)
Scenario analysis under 1.5C and 3C pathways completed. Physical risk assessment identified 4 assets with high flood exposure; adaptation capex of S$18 million is planned to 2030. Transition risk: 7 assets at risk of stranding under CRREM 1.5C pathways before 2030.`,
  },
};
