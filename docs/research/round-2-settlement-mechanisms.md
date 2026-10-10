# Round 2: settlement, specialization and revisable location choices

Research date: 2026-10-08. Research only: no code, training, model experiments, services or durable-world access. Proposals below are not approved changes. Read the working research checkpoint and prior colony/MMO reports; revisited primary evidence rather than treating their conclusions as new measurements.

## Result

**Productive local advantage can justify staying; settlement does not require a compulsory home. Fixed capital can strengthen that advantage, but cannot by itself explain a town, profitable specialization, or sensible relocation.** The strongest evidence separates four mechanisms:

1. Different opportunity costs plus funded demand can produce learned specialization without assigned jobs (Gather-and-Build).
2. Scale economies plus geographically costly trade can produce self-reinforcing concentration, but zero commodity transport cost removes that particular proximity advantage (Krugman's model).
3. Continuing local returns, uncertain alternatives and moving costs support durable yet reversible residence (Kennan–Walker). Return moves can be rational learning, not necessarily indecision.
4. Home/work mismatches can destroy production; buildings and sticky jobs can create the very endless commuting they were meant to prevent (Banished).

These are not four demonstrations of learned settlement. Only the first directly demonstrates learned production roles; the second is equilibrium theory, the third an estimated dynamic-choice model of humans, and the fourth authored game logistics. No inspected case establishes the full Prosper target of independently learning citizens settling and later moving inward in a finite-gold remote-market economy.

## Initial competing explanations and search choices

Before selecting cases, the plausible explanations were:

- **Local productivity, not housing:** a renewable nearby patch makes returning work profitable. Resource exhaustion, tool improvements or competitors change the best patch. Relevant domains: foraging/search, spatial economics, survival games.
- **Investment payback:** site-specific equipment lowers future production cost, so its prospective service value favors staying. Relevant domains: factory games, capital investment and real-options theory.
- **A local network advantage:** nearby buyers, suppliers, shared services or information improve individual returns. Relevant domains: economic geography, MMO logistics and urban economics. This explanation is weakened by remote commodity settlement unless another local benefit actually exists.
- **Household logistics:** shelter, recovery and stocks reduce survival costs, but separated work and residence impose repeated trips. Relevant domains: colony games and residential/job location models.
- **Information and option value:** staying may exploit a known good site; moving may discover a better match; waiting may avoid premature irreversible investment. Relevant domains: migration search and decision theory.
- **False settlement:** immobility may instead be starvation risk, lack of liquidity, an unusable move action, a centrally fixed job, or ignorance. Relevant domains: agent-simulation diagnostics and planning interfaces.

Selected four cases cover learned specialization, spatial concentration, dynamic relocation and a concrete commuting failure. Dixit's real-options article was a useful additional lead, but full text was inaccessible through the fetch tool; it is not promoted to a fully reviewed fifth case. Attractive screenshots or numbers of houses were never treated as causal evidence.

## First separate the spatial costs

| Quantity | What it changes | What it does not imply |
| --- | --- | --- |
| Commodity delivery cost | Delivered input/output prices and access to buyers | That a citizen must move residence when a shipment moves |
| Work travel | Time/risk to reach extraction or a station | That commodities purchased remotely must be hauled |
| Household/capital relocation | One-time interruption, rebuilding, moving possessions, loss of access to existing services | A recurring tax on every trade |
| Local congestion/depletion | Future accessible output per worker | A universal benefit from clustering |
| Local services or shared facilities | A possible recurring benefit from living/working nearby | That houses should receive an arbitrary stickiness bonus |

Prosper's remote escrow market removes much commodity-delivery friction, not necessarily travel to harvest or operate owned stations. Consequently, a wood specialist could rationally remain near wood and buy food remotely. It need not cluster with the food seller. Conversely, a remote buyer cannot make inaccessible inward resources extract themselves. This distinction follows from the stated mechanics, not a new audit of every action.

A diagnostic comparison is `value(move to B) - value(stay at A)`, using prospective consumption/production benefits, feasible purchases, travel, hazards, upkeep, relocation cost and remaining planning horizon. A third alternative, **stay at A and commute**, must be evaluated explicitly. So must selling/renting/rebuilding capital if those actions exist. Past building expenditure is sunk: charging it again as a reason never to leave is a sunk-cost error. The remaining service value, resale value and actual replacement cost can legitimately differ between alternatives.

## Case 1: Gather-and-Build, learned roles without learned residence

**Primary source:** Zheng et al., original 2020 preprint, [The AI Economist: Improving Equality and Productivity with AI-Driven Tax Policies](https://arxiv.org/html/2004.13332), §§2.2–2.3, Fig. 4, §4 and Appendix A. The retrieved text identifies the original version; do not transfer its numerical setup to the expanded 2022 article.

**Mechanism.** Four individually rewarded workers gather clustered wood/stone, trade inputs and build houses for coin. Building returns differ across workers (11.3, 13.3, 16.5, 22.2 coins in this setup). Movement, gathering, trading and building incur calibrated labor costs. Low-building-skill workers learn to sell inputs; high-building-skill workers learn to buy and build. The paper explicitly says these roles were not imposed directly. The profitable exchange depends on differences in opportunity costs, not on assigning occupational titles.

**Critical demand closure.** House revenue comes from an external economy not modeled in the simulation. A house is paid production output here, not evidence of a household choosing a useful place to sleep. The source does not establish that houses caused residence, reduced commuting, or induced a later migration. Prosper cannot import the result without identifying who buys its output and how they can keep paying.

**Knowledge/learning.** Recurrent RL policies receive local spatial observations, own public/private state including skill/labor, full market state and tax rates. Workers share network weights during training but do not share all individual observations or hidden state. Roles arise through individual utility optimization over experience, not learned discovery of the mechanics themselves from prose. Knowing prices is insufficient: useful behavior requires a relation between own productivity, effort, likely sale/purchase and eventual consumption value.

**Measurement.** Fig. 4 reports an example trajectory's labor, money, utility and net trading flows, alongside the authors' statement that the role pattern is typical. Main tax experiments compare productivity/equality across schemes; these are not an isolated causal ablation of geography, buildings or transport. Episodes are 1,000 steps on one specific map with randomized skill/location assignment; the prior report records the substantial RL sample budget. This is neither indefinite settlement nor demonstrated zero-shot economic adaptation.

**Counterconditions.** The paper describes taxes changing the willingness of lower-skilled agents to gather, forcing a high-skilled builder toward self-supply. Thus downstream specialization can disappear when upstream incentives change. Equalized opportunity costs, unfunded buyers or depleted resources would also weaken the proposed Prosper transfer; those are hypotheses, not reported ablations here.

**Confidence:** high for learned specialization under the specified institutions; low for settlement/relocation transfer. It supports first proving surplus, not first adding houses.

## Case 2: Krugman, why proximity can matter and when it does not

**Primary source:** Paul Krugman (1991), [Increasing Returns and Economic Geography](https://pr.princeton.edu/pictures/g-k/krugman/krugman-increasing_returns_1991.pdf), *JPE* 99(3), pp. 483–499; §§I–II assumptions, §III/Fig. 1 equilibrium dynamics, §IV/eq. 26/Figs. 2–3 concentration conditions. PDF text downloaded to OS temporary storage and extracted after the web reader returned only a stub.

**Mechanism.** Manufacturing has fixed/variable production costs and increasing returns; agricultural land and its workers are immobile. Firms prefer larger markets to save transport costs; manufacturing workers also create demand and value access to cheaper manufactured goods. This supply/demand feedback can sustain a concentration without a central allocator. It is not a generic magical productivity bonus for being near other people.

**Conditions and counterexample.** In the numerical example with manufacturing expenditure share 0.3 and substitution elasticity 4, shipment survival fraction 0.5 gives convergence, whereas 0.75 gives divergence. The fraction is an iceberg transport parameter, not a household moving fee. High transport costs can favor dispersed producers close to dispersed buyers rather than one city. Stronger scale economies and a larger manufacturing expenditure share favor concentration. Crucially, §IV states that at **zero transport costs, location is irrelevant** in this model. Reducing a positive transport cost and removing it altogether are not equivalent claims about spatial advantage.

The paper also distinguishes whether an equal split is unstable from whether complete concentration is an equilibrium. It does not prove that every initial state produces one city, or that concentration is the best welfare outcome.

**Knowledge/choice versus learning.** Firms optimize profits under modeled demand/cost conditions; workers relocate in response to real wage incentives. Learning unknown yields or prices is not demonstrated. Prosper agents would need to estimate actual recurring local savings, accessible demand, competing supply and congestion rather than infer value from population density. The model contains no Prosper survival loop or independently owned household workshops.

**Measurement.** Analytical equilibrium conditions and numerical comparative statics establish a mechanism within assumptions. This is not a measured intervention on real cities and not an agent-training result. The introductory discussion of labor pooling, specialized inputs and information spillovers identifies other possible mechanisms; the paper deliberately does not use them as its explanation.

**Prosper implication.** Remote markets weaken this model's buyer/supplier proximity channel. They do not abolish geography for extraction, station access, safety or nontradable services. Before considering delivery friction, ask whether the target is actually dispersed specialized settlements rather than one dense city. New local services would be separate hypotheses, not justified by this paper merely mentioning cities.

**Confidence:** high for the model's conditional mechanism and zero-cost boundary; limited external/Prosper validity. It directly counters “more transport friction always creates better settlements.”

## Case 3: Kennan–Walker, settlement as a good match with a reversible exit

**Primary source:** John Kennan and James R. Walker (2011), [The Effect of Expected Income on Individual Migration Decisions](https://users.ssc.wisc.edu/~jfkennan/research/ECTA4657.pdf), *Econometrica* 79(1), pp. 211–251. Read §§1–4.1 (decision/knowledge model), §§6.4–6.4.1 (fit and failures), §8 (conclusion); inspected section/table locations for the remaining empirical analysis. PDF text obtained through OS-temporary extraction.

**Mechanism.** Migration is sequential search among many locations, not a once-for-life choice. People know location-level wage distributions and amenities; visiting reveals individual location-match values. Utility includes expected future income, amenities and moving costs. A favorable current match supports staying; an unfavorable one increases the attraction of searching elsewhere. Previously visited places remain useful alternatives, so return migration need not be a policy oscillation bug.

**What is imposed.** The estimated specification includes a home preference, distance/fixed moving costs and lower cost of returning to a previous location. These are model primitives/estimated preferences, not discovered household institutions. They must not be cited as proof that building a home automatically creates attachment. The paper models individual interstate moves, not transport of commodities, actual household possessions or a coupled two-career family.

**Knowledge/learning.** The decision rule comes from dynamic programming with uncertain location-specific match draws. Visiting changes what is known; this is explicit information acquisition, not neural-policy training. To control the state-space explosion, the approximation keeps information from only a limited number of recent locations. It is not evidence that an unconstrained optimal planner is cheap for Prosper. A corresponding citizen would need dated local yield/travel observations, uncertainty about alternatives, ability to compare return locations and a feasible way to pay the transition cost.

**Measurement.** Estimated on NLSY white male high-school graduates, with a narrow demographic and interstate spatial scale. §6.4 compares simulated migration histories against data and a constant-probability binomial benchmark: approximately 83.9% never move in the model versus 83.6% in the data; repeat moves among movers are overpredicted (64.5% versus 56.3%). §6.4.1 reports reasonable return-pattern fit but overprediction of returns home from a non-home initial location. The authors note that their model fails to capture attachment increasing with duration. These are structural fit results, not randomized proof that moving costs cause particular real behavior.

**Important limits.** The benchmark assumes constant marginal utility of income and unrestricted borrowing/lending, so assets do not determine migration. It assumes a stationary environment and restricts wage dynamics. Prosper's food buffer, liquidity and unpredictable competitors can make a profitable destination temporarily infeasible. Conversely, the model's requirement to visit for a match draw should not become an arbitrary rule preventing remote information in Prosper.

**Prosper implication.** Measure stable productive residence and adaptation together. Do not reward zero moves. Lower uncertainty, cheaper reversible exploration and a credible large improvement can justify moving; short-lived noisy advantages may not. An inward tool upgrade is a reason to recompute alternatives, not an instruction to relocate: net higher-tier output might still be inferior after costs or lack of buyers.

**Confidence:** high for the documented decision model/fit; moderate evidence for the importance of expected income under structural assumptions; low for numerical calibration to Prosper.

## Case 4: Banished, buildings can create endless commuting

**Primary developer sources:** Luke Hodorowicz, [“Why am I doing more than just fixing bugs?” (7 Nov 2013)](https://shiningrocksoftware.com/2013-11-07-why-am-i-doing-more-than-just-fixing-bugs/) and [“More Bugs: Pathfinding Problems” (21 Nov 2013)](https://shiningrocksoftware.com/2013-11-21-more-bugs-pathfinding-problems/). Full article text read; no screenshot interpretation.

**Failure and mechanism.** Early fixed lifetime jobs made a married couple with workplaces at opposite ends of the map live between them and spend most of their time walking. Town growth reduced output. Testers improved matching by clearing and reassigning jobs. The developer then automatically optimized jobs relative to homes/workplaces and reported significantly increased production on most test maps. Adding homes near distant work also helped. This is direct implementation/failure evidence that homes plus occupational stickiness do not ensure useful settlement.

A second failure used straight-line distance to choose homes, workplaces and supplies. Rivers produced very long real routes to apparently nearby destinations. A coarse connectivity graph and cached travel estimates improved choice. The author describes citizens reconsidering homes and moving after a new bridge changes travel cost.

**Authority/learning boundary.** The assignment optimization and periodic reconsideration are authored mechanisms in a centrally directed town. They are not citizens negotiating independent jobs or learning relocation strategy. The developer's solution would violate Prosper's target if copied as a global job allocator. The transferable finding is the cost-model/alternative-selection failure, not that allocator.

**Measurement.** Developer-reported production improvement, debugging maps and a path visualization tool, not randomized tests or published output totals. The coarse path calculation's reported 60–100× speedup concerns that calculation, not total simulation speed or economic welfare. No learned-agent evaluation.

**Prosper implication.** Any proposed home/rest/storage feature must be tested against the three alternatives stay, commute and relocate. Measure actual repeated travel and time lost to restoring needs, not just distance from a home marker. A citizen that predicts paths badly may appear indecisive even with a good high-level objective. A family constraint can create genuinely conflicting interests; it should not be silently solved by a central reassignment.

**Confidence:** high for the developer's described failure/design changes; moderate for qualitative production improvement; none for learned independent settlement.

## Synthesis: what is worth learning

A useful citizen needs evidence about **actionable returns**, not a prose memory saying “this town is good”:

- Own output per unit time at candidate sites, including tools, resource regeneration/depletion, access and hazard.
- Real travel/queue times and repeated survival/refill overhead; straight-line distance is inadequate when routes differ.
- Executable market depth, funded demand, fill probability and latency, not merely posted prices or an assumed sale of all future output.
- Continuing station/service benefits, upkeep, remaining stock, feasible liquidation and actual relocation/rebuild interruption.
- Persistence and uncertainty of opportunities: one good harvest or quote is not a stable expected income stream.
- Alternative destinations and the value of returning; useful changes in beliefs should predict changed action and improved downstream outcomes.

The most defensible sequence is to establish a feasible benefit of local specialization, then test revisable commitment, then investigate any missing local network benefit. None of these sources establishes housing/rest/storage as necessary. Likewise, a manufactured relocation fee can lower move counts while making every citizen worse off.

## Three falsifiable hypotheses and smallest discriminating experiments

**Proposed only.** No experiment was run. Begin with tiny isolated fixtures and a transparent feasible-action planner as an *opportunity comparator*, not the intended citizen controller. Hold rewards, knowledge and action authority fixed between candidate controllers. First compare fully known mechanics, then hide only the quantity whose learning is under test. Avoid training a new population or adding several world primitives together.

### H1. A stable local productive advantage can sustain specialization without a home

**Prediction:** with remote settlement, two citizens near complementary resource patches can gain from specializing and trading when both have funded recurring needs and a positive feasible surplus. Housing is not required for persistent local work.

**Smallest test:** two patches, two citizens, current actions only, one fixed horizon covering at least several survival/production cycles. Establish by feasible enumeration that each citizen can do better than self-supply after travel and purchased inputs. Compare paired trade-enabled and no-trade runs with identical inventories/seed. Swap starting positions or relative productivity in a held-out condition. If suitable recurring funded demand cannot be demonstrated, stop: that is a world-opportunity result, not an agent failure.

**Measure:** each citizen's survival/consumption, net physical stock, realized purchases/sales, productive versus travel time, and repeated work locations. Value terminal stock conservatively; unsold posted inventory is not realized profit. A gain for one citizen only is not mutual advantage.

**Discriminator/falsifier:** a verified surplus that an informed comparator cannot realize exposes the supposed opportunity or interface; a comparator succeeding while the candidate fails isolates capability. Lack of mutual gain after all costs falsifies the proposed specialization opportunity. Clustering is neither required nor scored.

### H2. Continuing site value, not sunk expenditure, creates useful commitment

**Prediction:** a genuinely productive fixed station can make staying worthwhile, yet a sufficiently persistent improvement elsewhere should justify moving. A zero-benefit building or a home marker should not improve the economic opportunity set. Short noisy shocks and lasting improvements should produce different choices when reversibility matters.

**Smallest test:** one citizen, two work sites, fixed funded counterpart offers to isolate location choice. Compare no station, a useful current-site station, and the same site's station with its continuing benefit removed; hold past construction expense equal where applicable. Use existing station semantics first. Any non-existing salvage/relocation variation requires separate approval as an experimental mechanic, not a production addition. Apply one transient and one permanent productivity shock, then separately a tool upgrade. Enumerate stay/commute/move outcomes over a disclosed horizon.

**Measure:** net attainable consumption/output, work-site dwell duration, repeated commute time, move count, adaptation delay, and regret against feasible alternatives. Report resource buffers and transition feasibility.

**Discriminator/falsifier:** persistent residence only under a zero-benefit relocation penalty supports artificial immobility, not useful settlement. Continuing to commute when a feasible move repays all transition costs indicates planning/execution failure. Immediately moving on every noisy advantage suggests insufficient horizon or uncertainty handling. Failure to move inward is not failure if the comparator says staying is better.

### H3. Productive residence is not the same as agglomeration under remote trade

**Prediction:** with identical extraction opportunities and no local service or threat advantage, putting buyers physically near a worker should not improve that worker's remote trading returns. Buyer proximity alone therefore cannot explain settlement clusters.

**Smallest test:** two otherwise identical tiny spatial fixtures with fixed counterpart orders/wealth; relocate only buyers while preserving their market access and all path obstacles. Keep worker sites and offers fixed. This invariance check needs no new mechanic. Only if actual clustering remains a desired separate outcome, propose a second approved test adding one measurable local facility benefit, not a proximity reward and transport restriction together.

**Measure:** feasible worker utility/output and identical-order trade outcomes first, then any actual action differences. Do not infer causality from spatial density.

**Discriminator/falsifier:** a changed feasible payoff in the pure remote-market control reveals an overlooked existing geographic channel. If outcomes change only through a candidate agent's belief that buyers must be nearby, that is a mistaken strategy, not evidence for beneficial clustering. A later local facility that raises density but lowers individual realized returns fails its proposed purpose.

## Evidence limits and open leads

- [Dixit (1992), “Investment and Hysteresis”](https://www.aeaweb.org/articles?id=10.1257/jep.6.1.107), abstract read; [full-text endpoint](https://pubs.aeaweb.org/doi/pdf/10.1257/jep.6.1.107) returned 403. Search-visible primary text identifies sunk cost, uncertainty, gradual information and the ability to wait. This suggests a future investment/option-value comparison but is not a reviewed quantitative fifth case.
- Storage, rest and family commitments could produce real individual benefits; no source reviewed here identifies their optimal form for Prosper. Housing dependence must not be introduced solely to force a daily route.
- Congestion, property transfer, depletion and risk may reverse agglomeration incentives. They are plausible missing variables, not measured causal effects in this report.
- Strongest next decision: determine whether current mechanics contain feasible local-specialization and relocation opportunities. Only then choose whether the missing component is learning/planning, interface authority or a world incentive. No architectural or building redesign follows automatically from this research.
