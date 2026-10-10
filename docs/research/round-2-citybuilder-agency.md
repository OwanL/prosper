# Round 2: citybuilder agency, location, and economic coherence

Research date: 2026-10-08. Scope: literature/web research only. No experiments, training, model-provider calls, services, downloads into the repository, or durable-world access. This report owns no implementation changes. Read the current research objective and prior [colony report](colony-citizen-ai.md); the aim remains intelligent self-interested citizens, not replacement strategic scripts.

## Bottom line

**Citybuilders are useful precisely when we distinguish what their agents actually decide from what the simulation supplies.** Cities: Skylines I has persistent citizens and real route simulation, but its developers explicitly decouple worker attendance from production and return blocked vehicles to their origins. Cities: Skylines II documents substantially richer household and company choices, yet also documents centralized opportunity signals, balancing preferences, administered resource prices, external money flows, and subsequent economic redesign. Neither fact warrants calling the whole simulation “fake.” Neither demonstrates citizens learning profitable strategies. [C1–C2, C3–C7]

The strongest transferable explanation of coherent settlement is a **joint choice over accessible opportunities, recurring expenses, scarce space, and durable capital**, not a particular NPC decision tree. UrbanSim makes those dependencies unusually explicit, including fitted choice probabilities and feedback between demand and rents, while warning that detailed simulated individuals are not individually predictive. That is a useful distinction for Prosper: a convincing city-level distribution is not evidence of capable individual reasoning. [U1–U2]

## First: promising families and selection rationale

Starting from the goal rather than a predetermined game list:

| Family | Why investigate? | Selection/result |
| --- | --- | --- |
| Persistent-citizen citybuilders: Cities: Skylines I/II, Cities in Motion | Home/work identities, route costs, firm location, tension between physical trips and aggregate production | CS I and II retained separately because the mechanisms and versions differ materially |
| Flow-based citybuilders: SimCity 2013/GlassBox; older aggregate SimCity | Can visible individual traffic conceal a building/resource-flow model? Where does state actually live? | GlassBox retained as a bounded comparison; direct author provenance plus contemporary reporting, not a shipped-source audit |
| Planned industrial logistics: Workers & Resources, transport tycoons | Explicit labor delivery, production chains, time budgets, and spatial bottlenecks | Promising but primary implementation evidence was not obtained here; do not promote community timing rules into facts |
| Urban land-use microsimulation: UrbanSim | Household/firm location, housing supply, rents, constrained development, validation | Retained as third substantive primary case; especially relevant to housing/capital commitment |
| Activity-based transport: MATSim | Experienced travel cost and repeated plan adjustment rather than only shortest paths | Useful next lead, but book retrieval exceeded the tool's PDF limit; no detailed mechanism claims based only on search summaries |
| Colony/life simulations | Needs, personal attachments, job arbitration, logistics | Already covered in round 1; not repeated as if they solve independent ownership or learning |

This gives three substantive primary cases (CS I, CS II, UrbanSim), with GlassBox as a fourth, explicitly lower-confidence comparison. Sources were selected for mechanisms and limits rather than mechanically covering every suggested title.

## 1. Cities: Skylines I: persistent identities, selectively physical consequences

### What is genuinely represented

The January 2015 simulation diary says citizens have names, ages, homes, and workplaces, except those too young or studying at university. They travel to work, shops, and leisure. It explicitly trades realistic occupancy counts for individual representation: a visually large high-rise may contain only 12 households. Goods move from industrial buildings to commercial buildings; local industrial inputs are preferred, otherwise imported, with cargo transport contributing traffic. This diary was inspected through a third-party republication; attribution and the original forum location are retained below. [C2]

More decisive is the developer-authored traffic deep dive. Citizens have destination options that can fill up. A trip chooses a route using available modes, congestion, speed limits, and direction. Vehicles normally keep that route unless its path is modified. Thus there is meaningful physical route and capacity behavior, not merely decorative cars. [C1]

### What is abstracted or rescued

The same developers state:

- There is a limit on citizens/vehicles simultaneously on the streets; travel can begin when the limit permits it.
- The design target of up to a million citizens required a worker system where workers **not physically reaching work do not penalize the player**.
- A vehicle unable to find a route returns by teleportation to its **origin**, not successful delivery to its destination.
- Gridlock also triggers return-to-origin teleportation. This was deliberately introduced so jams would not spread until every road appeared blocked, hiding the original bottleneck from less experienced players. [C1]

These are distinct abstractions. Persistent home/work identity does not establish that labor attendance constrains output. Teleporting a failed trip back is not the same claim as teleporting its goods successfully to a buyer. The inspected article does not resolve every cargo-settlement consequence, so this report does not infer one.

### Housing, jobs, prices, and relocation: evidence boundary

The sources establish persistent associations and destination/path selection, not a complete household housing-search algorithm or independent wage negotiation. There is no inspected evidence here of citizens learning job values, retaining production profits, buying productive capital, or negotiating rents. Do not fill this gap with CS II's more detailed economy diary. The player supplies zoning, roads, and services; the first diary explicitly describes automatic local/import input sourcing. [C1–C2]

### Performance, failures, validation

The developers report vehicle motion simulation at roughly four updates per second with rendering interpolation; expensive decisions can update less often. More frequent lane changes had produced blocking and traffic collapse during development, motivating early lane selection. They acknowledge that single-lane queues can look wrong and teleportation reduces challenge. Their reported evaluation is testing and player feedback, not a benchmark validating commuter behavior or a measured million-agent throughput result. The million-citizen figure is a design guideline, not an achieved real-time test. [C1]

**Lesson for Prosper:** simulation frequency can be separated from rendering, but economic consequences must remain explicit. If presence, travel, or access is meant to explain settlement, an attendance bypass can erase the very advantage under study. A successful-looking settlement under such a bypass would not validate location reasoning.

## 2. Cities: Skylines II: household and business optimization inside a designed economy

**Version boundary:** the 2023 feature diaries describe intended launch mechanisms; the Economy 2.0 diaries describe the 2024 redesign. They are developer evidence, not a current 2026 source audit or independent replication. Later fixes may further change behavior. [C3–C7]

### Household home/work choice and time budgets

The original economy diary specifies household housing suitability using combined pathfinding costs to destinations, free time after work/travel, money after expenses, services, and dwelling suitability. Large families prefer larger apartments; households with children value school access. Households unable to afford their dwelling seek alternatives, consider leaving, and can become homeless if unable to secure housing or fund departure. This is substantially more than citizen-shaped visual traffic. [C3]

Workplace search accounts for education and gives a bonus to matching jobs. It also favors companies with fewer employees over nearly full firms to distribute workers more evenly. The latter is an explicitly authored balancing preference, not evidence that a worker personally inferred a higher wage or better career. The sources do not establish employer-worker bargaining or citizen-specific discovery restrictions. [C3]

Route cost combines time, comfort, money, and behavior; age groups place different emphasis on these terms. Fuel/parking fees and public transport enter choices. Routes can react to incidents, unlike CS I's mostly committed path. Service dispatch additionally considers where vehicles will finish existing orders, a useful example of **central fleet coordination**, not individual economic learning. [C4]

The lifepath diary also describes comparing immediate earnings with prospective post-education earnings, moderated by preferences for work. That documents an authored forward-looking trade-off; it is not evidence of online learning or search over arbitrary careers. [C5]

### Companies, productive sites, and trade

Industrial firms evaluate production value at a location, land/rent costs, inputs, workforce education, customers, and transport. Transport cost depends on distance and resource weight; heavy inputs create stronger proximity incentives. Larger facilities incur space costs. Firms periodically adjust employment/production to prices, wages, transportation, fixed expenses, and demand; ordinary firms can fail and buildings become abandoned. Warehouses provide inventory/distribution functions. [C3]

Commercial sites balance access to customers and suppliers. Crucially, the diary says that when a neighborhood lacks a grocery store and households face high travel costs, **the simulation marks nearby areas as lucrative for grocery stores**. That is an opportunity signal computed by the simulation. It cannot be silently transferred to Prosper as if a citizen discovered unseen unmet demand. New industrial companies also receive a preference for underused resources. [C3]

Not all depicted production is equally embodied: office output consists of immaterial goods sold wirelessly, and specialized extraction uses vehicles restricted to generated internal paths. Specialized industries are explicitly exempt from bankruptcy in the original design, shrinking instead. The player places extraction hubs/areas and provides zoned development opportunities. These qualifications matter when interpreting emergent company locations. [C3]

### Prices, money, and the 2024 redesign

The launch diary says base resource prices are constant, with availability contributing transport costs and margins; it also describes cheaper commercial products with improving efficiency/sales. This is not a documented decentralized bid/ask market. The simulation includes imports, exports, tourists, government support, and money sinks/sources, including redistribution of player spending. It is not a finite-gold closed economy like Prosper. [C3]

Economy 2.0 must not be collapsed into that launch description:

- City-budget government subsidies were removed because they muted consequences; **this does not mean all household government support vanished**. The same diary retains time-limited unemployment support.
- Household consumption must account for rent and garbage fees first. Company types are more closely tied to consumed products; production work requirements were made preconfigured and rebalanced.
- Resource pricing was revised into industrial discounted and commercial normal components; wages were increased. No documented endogenous citizen order-book price discovery follows from these changes.
- The virtual landlord was removed; upkeep is shared among renters. Rent is described by `Rent = (LandValue + (ZoneType * Building Level)) * LotSize * SpaceMultiplier`.
- High-rent warnings changed from a balance-oriented issue to income affordability: households reduce consumption first, then seek cheaper housing or leave if income cannot cover rent. Building condition rises or falls with upkeep payment. [C6–C7]

This is valuable failure evidence supplied by the developers themselves: extensive hidden safeguards and price/production calibration can make a city prosper while weakening the causal effect of decisions. The redesign was explicitly intended to restore consequences. It is not evidence that all earlier choices were nonexistent.

### Scale and validation

The traffic diary claims multicore execution and no hard limit on moving agents, with hardware the practical limit. These are developer architectural claims, **not independently measured simulation throughput**. Economy 2.0 describes extensive internal testing and anticipated transition effects in existing saves, including changed unemployment and housing demand. No held-out citizen-learning evaluation, error bars, or controlled business-location validation was found. [C4, C6–C7]

Community reports of disconnected factories and cargo teleportation were surfaced but not independently reproduced or established from inspected primary implementation evidence. They are hypotheses for version-pinned tests, not grounds to label every CS II transaction fake.

**Lesson for Prosper:** household affordability and firm unit economics supply useful candidate variables and counterfactuals. Global “lucrative area” flags, forced worker spreading, bankruptcy exemptions, and external demand/support can do much of the coordination. Those must either be explicit world institutions or excluded from claims about independent-agent discovery.

## 3. UrbanSim: fitted individual choices, scarce locations, and slow supply response

### What is modeled

UrbanSim's own documentation describes persons/households, jobs/firms, real estate, and developers, at parcel, block, or zone resolution. Parcel models can represent individual buildings and housing units; coarser versions aggregate built space. Simulation advances **annually**, with each year's result becoming the next starting point. This is land-use microsimulation, not second-by-second embodied work or crafting. [U1]

Households trade off housing cost, accessibility, dwelling/neighborhood amenities, household attributes, and tenure. The model represents moving and selecting a new location; businesses make location choices and developers assess building/redevelopment opportunities constrained by zoning. Parcel development uses pro-forma feasibility: construction and other costs against expected sales or discounted rental revenues. Scarce fixed sites and slowly changing supply create path dependence rather than a fresh unconstrained assignment every moment. [U1]

### Choice, information, prices, and learning

The common choice model is multinomial logit: utility's systematic component is a fitted function of observed features, then alternatives receive choice probabilities. Outcomes are sampled rather than always taking the maximum; the documentation explains that maximum-only choice would eliminate less frequent alternatives such as transit. Choice sets themselves can be sampled for tractability. [U1]

Parameters are estimated by the modeler from revealed/stated preference data. **That is statistical learning of a population choice model, not each simulated household learning from its own experience.** Accessibilities come from an external transport model, including congested times, generalized costs, and composite utilities. Regional population and sectoral employment assumptions also enter exogenously. This is not a population of independent agents discovering all opportunities and generating its own macro growth. [U1]

An optional market-clearing choice algorithm sums choice probabilities into submarket demand, compares with supply, adjusts prices iteratively, and updates choices. This explains why excess demand can increase rents and redirect households, but it is a model-level price adjustment mechanism, not landlords and tenants independently negotiating funded offers. It is particularly important not to equate “market” in the documentation with Prosper's actual settlement protocol. [U1]

### Coherence, failure regimes, scale, and validation

The documentation identifies slow housing additions versus changing demand as a source of vacancy/price dynamics. It warns that behavior is assumed relatively stable and fitted within observed conditions: a dramatic fuel-price shock can invalidate patterns. It explicitly rejects interpreting the predicted development of a particular parcel decades later as reliable, recommending aggregation and/or repeated runs. Boundary effects with neighboring regions are omitted. [U1]

Operational applications span regions stated to contain 100,000–9.6 million people. This demonstrates use at metropolitan scale, not real-time embodied simulation at that scale. No transferable tick-throughput figure was obtained. The parcel documentation says calibration normally uses a longitudinal dataset **separate from validation**, often at coarser spatial resolution to avoid over-constraining sensitivities. That is a stronger validation principle than visual plausibility, but the inspected documentation does not itself supply predictive accuracy for a particular region. [U1–U2]

**Lesson for Prosper:** durable settlement can come from recurring location benefits and slow/expensive changes in capital supply. Compare choices and outcomes across shocks and spatial scales, but do not copy centralized accessibility matrices or price clearing into the citizen's private information. A household-based decision unit also presupposes shared budget/authority; Prosper would need to define that institution rather than silently merging citizens' assets.

## 4. SimCity 2013 / GlassBox: useful contrast, narrower evidential confidence

Andrew Willmott's own archive confirms the provenance of his GDC 2012 architecture talk: a simulation engine originally aimed at possible mobile games and redirected toward SimCity. The accessible contemporary talk report describes resources in capacity-limited bins; units such as houses/factories with bin state; spatial maps of resources/land value; globals; and scripted rules that move/convert resources. Mobile agents carry resources between units and do not execute these rules themselves, keeping them cheap for a **target** of 10,000+ simultaneous agents. [S1–S2]

This distinguishes **a detailed flow simulation from an intelligent persistent person**. A house's people/food inventories and a car carrying workers can make coherent neighborhood flows without modeling an owner choosing investments or learning a commute. Zonal development examples are rule-driven sampling over suitable sites. The talk is pre-release engine architecture, not proof every example survived into the released game. [S2]

Contemporary reporting quotes lead designer Stone Librande saying Sims take the nearest available job and closest vacant home, so neither need persist across days. The direct article fetch failed; this exact release-behavior claim is therefore retained only as a **reported developer quotation surfaced in search**, not equal to the fully inspected CS I developer article. Do not infer that CS I/II share this rule, or generalize it to every SimCity version. [S3]

The closest-vacancy rule, if applied as reported, would explain location coherence as slot filling rather than personal housing investment. A rigorous comparison would require tracking identity, home, job, wealth, and completed trips over multiple days, not following one named visual agent once. No full release algorithm, individual rent/price model, or controlled throughput/validation result was obtained here. This case is an architecture contrast, not evidence for a learned economic-agent solution.

## Cross-case synthesis under Prosper's constraints

| Mechanism explaining coherent locations | What survives independent agency? | What must not be smuggled in |
| --- | --- | --- |
| Cost of reaching work, inputs, customers, services | Citizens may estimate time/risk from observed journeys and known alternatives | Full-city demand/location knowledge or free access to every candidate |
| Recurring rent/upkeep versus dwelling/workplace benefits | Compare affordable streams of costs/benefits and preserve execution/accounting | Automatic shared household budget, compulsory job assignment, virtual profit rescue |
| Fixed productive capital and slow supply | Owned stations, storage, moving/rebuilding costs can create revisable commitment | A requirement to stay put merely to produce a visually pleasing settlement |
| Demand raises attractiveness/prices | Actual messages, posted offers, realized fills, unmet known demand can convey signals | A global service telling an agent exactly where an unseen profitable shop belongs |
| Diversity of household/site preferences | Heterogeneous objectives and uncertainty can produce differentiated choices | Randomized choices credited as learning, or statistical population fit credited as individual competence |
| Lower-frequency decisions with physical accounting | Stagger strategic search and cache estimates while preserving action consequences | Attendance bypass or teleporting successful outcomes that cancels meaningful travel costs |

Prosper's documented remote market means commodity delivery distance currently does **not** supply CS II-style freight localization. Proximity to resources/owned stations can still matter. Housing or storage would require a demonstrated marginal benefit, not an assumption that physical buildings automatically create worthwhile settlement. This is an inference from the current research framing/README, not a new source audit or implementation proposal.

## Three falsifiable hypotheses and small proposed tests

**No tests were run; these require parent/user scope approval, especially any new world primitive.** Each separates an available opportunity from the agent's ability to recognize it. Use paired seeds, equal personal observations/action interfaces, matched decision budgets, retained failures, and scripted/centralized comparators only as labelled diagnostics.

1. **Experienced travel estimates improve location decisions after network/access change.** Construct a tiny fixture with two known productive sites, unequal reachable travel costs, identical nominal straight-line proximity, and a reversal after an access change. Compare the same candidate controller with updated travel beliefs versus frozen initial beliefs. Measure prediction error, realized net output per elapsed time, failed journeys, survival, and adaptation delay. Falsify if updated beliefs improve estimates but not decisions/outcomes, or if the supposedly superior site never yields an actual advantage. Use no global route/opportunity oracle in the tested agents; an oracle may establish feasibility separately.

2. **Recurring benefits plus moving costs create stable but revisable settlement, not permanent trapping.** If an isolated housing/storage prototype is approved, vary one recurring benefit and one move/rebuild cost in a two-site fixture. Give a temporary opportunity shock and a persistent shock with independently calculated break-even horizons. Compare a reasoning/learning controller against its frozen counterpart. Measure residence duration, net benefit, unnecessary moves, abandoned capital, and failure to relocate after sustained advantage. Prediction: commitment resists a short shock but yields to a long profitable one. Falsify if agents never move, oscillate, or clustering occurs only under prohibitive movement costs. Do not count mere clustering as success.

3. **Private evidence can support profitable specialization without a global demand flag.** Use two resource areas and funded buyers with shifting needs; retain Prosper's remote trading explicitly. Compare updated private estimates of yields, achievable prices/fill probabilities, and capital payback against frozen estimates, with the same controller and observations. Separately use an omniscient diagnostic to establish whether positive-payback opportunities exist. Measure realized rather than quoted margins, unfilled orders, liquidity exhaustion, specialization persistence, and response to demand reversal. Falsify if “specialization” only increases inventory, if there is no funded demand, or if a global lucrative-site signal is necessary for success. No external guaranteed buyer should be introduced without labelling that institutional change.

### What not to transfer

Do not copy citybuilder strategic scripts as the intended intelligence; generic cost/constraint representations are a different matter. Do not import hidden macro subsidies, immortal businesses, global worker spreading, free opportunity maps, automatic market clearing, or successful-work attendance bypasses into a test of self-interested independent citizens. Do not equate sampled utility choices, named agents, busy roads, stable city totals, or developer feature prose with learned adaptation. Keep outside demand, price setters, ownership, information access, and failure settlement explicit before evaluating the mind.

## Sources and inspection limits

Accessed 2026-10-08. Primary means developer/author documentation, not necessarily independently verified shipped behavior. No images were interpreted and no game was run.

- **C1 — Colossal Order's Antti Lehto, Damien Morello, Karoliina Korppoo, developer-authored traffic deep dive (CS I, 2015 era).** [Full article](https://www.gamedeveloper.com/design/game-design-deep-dive-traffic-systems-in-i-cities-skylines-i-). Inspected full extracted text, especially What/Why/How/Results. Strongest evidence here for origin teleportation, nonphysical worker attendance, and update rates.
- **C2 — Karoliina Korppoo, January 7, 2015, Dev Diary 7: Simulation.** [Original forum location](https://forum.paradoxplaza.com/forum/threads/cities-skylines-dev-diary-7-simulation.828492/); [inspected republication](https://sims4network.wixsite.com/sims4network/single-post/2015/01/07/cities-skylines-dev-diary-7-simulation). Full republished text inspected; original forum not successfully extracted. Primary-authored content through a secondary mirror.
- **C3 — CS II Feature Highlight #9: Economy & Production, 2023.** [Official diary](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/economy-production). Inspected household, company, production, pricing and external-flow passages. Descriptive developer design, not source-code verification.
- **C4 — CS II Feature Highlight #2: Traffic AI, 2023.** [Official diary](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/traffic-ai). Inspected routing costs, dispatch, adaptation and performance passages. Performance claims not benchmarked here.
- **C5 — CS II Feature Highlight #11: Citizen Simulation & Lifepath, 2023.** [Official diary](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/citizen-simulation-lifepath). Inspected activity, education and employment passages; no inference of learned behavior from lifepath narration.
- **C6 — CS II Economy 2.0 Part 1, 2024.** [Official diary](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-economy-part-one). Inspected subsidies, demand, household spending, work, pricing and production revisions.
- **C7 — CS II Economy 2.0 Part 2, 2024.** [Official diary](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-economy-part-two). Full text inspected, including rent formula and expected transition/failure effects.
- **U1 — UrbanSim Cloud Platform 3.13.1, UrbanSim overview.** [Official documentation](https://cloud.urbansim.com/docs/general/documentation/urbansim.html). Inspected full fetched text, including assumptions, annual model, discrete-choice equations, sampling and optional market-clearing variant. Configurable model family, not a single universal city specification.
- **U2 — UrbanSim parcel model data overview.** [Official documentation](https://cloud.urbansim.com/docs/general/documentation/urbansim%20parcel%20model%20data.html). Inspected calibration/validation passage; not a regional validation-results paper.
- **S1 — Andrew Willmott, Inside GlassBox.** [Author's talk archive](https://www.andrewwillmott.com/talks/inside-glassbox). Inspected author provenance/overview. Slides/videos linked but not inspected; no claim to have reviewed the complete talk.
- **S2 — Contemporary GDC 2012 talk report.** [Game Developer](https://www.gamedeveloper.com/design/gdc-2012-breaking-down-em-simcity-em-s-glassbox-engine). Full report inspected, including rule examples and mobile-agent limits. Secondary reporting of developer architecture, not shipped source.
- **S3 — March 15, 2013, reported Stone Librande traffic explanation.** [GameSpot](https://www.gamespot.com/articles/simcity-traffic-problems-being-fixed-says-maxis/1100-6405369/). Search-exposed developer quotation only; full fetch returned 403. Release home/job assignment remains lower-confidence in this report.
- **Unpromoted leads:** [Workers & Resources publisher-hosted wiki](https://wiki.hoodedhorse.com/Workers_Resources_Soviet_Republic/Units) surfaced work/return-teleport descriptions, but full fetch returned 403 and authorship was not established as developer implementation evidence. [MATSim book Part I](https://matsim.org/files/book/partOne-latest.pdf) exceeded fetch size; no detailed results attributed to an unread book. Community CS II disconnection tests remain unverified/version-sensitive, not findings of this pass.
