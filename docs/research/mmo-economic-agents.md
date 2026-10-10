# Concrete MMO economies and autonomous economic agents

Research date: 2026-10-08. Scope: five substantive cases, separating functioning game economies from demonstrated autonomous economic competence. No experiments, model inference, training, or live-world changes were performed.

## Bottom line

The closest **learned playable-world analogue is Neural MMO**. The clearest **learned production/trade specialization example is the AI Economist's Gather-and-Build**. The strongest **controlled demonstration of economically useful adaptation in this selection is TacTex-05**, which combines explicit forecasting and optimization with authored heuristics rather than learning an entire policy. **EVE and Albion show why demand persists and what to measure, not that their NPCs can run an economy intelligently.**

These cases point to three distinct questions for Prosper:

1. Is there a real opportunity for mutually beneficial specialization after travel, maintenance, risk and liquidity costs?
2. Can an autonomous controller identify and execute that opportunity, including changing purchases, output and prices when conditions change?
3. Does that ability survive new competitors and a changed resource/demand regime, rather than merely producing an attractive aggregate chart?

| Case | Actual actor | Evidence of autonomy | Main boundary |
| --- | --- | --- | --- |
| Neural MMO competition | Learned, imitated and scripted submitted agents | Direct movement, gathering, combat, equipment and market actions in competitive games | Episodic contest, not an indefinite civilian society; market-specific causal evidence limited |
| AI Economist / Gather-and-Build | Recurrent RL workers and RL tax planner | Learned gathering, selling, buying, building and income timing | Small engineered economy with external house demand and calibrated labor costs |
| TAC SCM / TacTex-05 | Forecasting/optimization agent with adaptive components | Procurement, bidding, scheduling and delivery; controlled opponent-change experiment | Substantial authored strategy and exact mechanism knowledge, not end-to-end learned intelligence |
| EVE Online | Predominantly human-player economy in the evidence examined | Production, trade and destruction telemetry | No controlled autonomous-NPC result in this source |
| Albion Online | Human producers/traders plus a rule-driven Black Market buyer | An explicit mechanism linking player crafting to PvE loot demand | Responsive NPC prices are not learned market intelligence |

## 1. Neural MMO: actual autonomous characters with survival, specialization and trade

**Primary sources:** [2022 competition report, published 2023](https://arxiv.org/html/2311.03707v1), especially §§3.3, A.2–A.4 and B.0.1–B.0.4; [Neural MMO 2.0](https://arxiv.org/html/2311.03736v1), §§3–6 and reproducibility checklist. Do not mix their version-specific results.

### What agents actually control

The 2022 contest places 128 agents in 16 teams of eight on procedurally generated maps. Agents forage, fight, acquire/use equipment and buy/sell items in a global market. Equipment and skill levels create progression; restricted inventory makes selling unwanted supplies useful. This is substantially closer to Prosper than a stock-price trading benchmark: survival, spatial opportunities, rivals and equipment affect the value of goods.

A qualification matters: the report's baseline aggregates information from the team into a joint policy. It explicitly says its approach does not strictly conform to independent MARL within each team. Team competence is therefore not evidence that eight separately informed citizens spontaneously negotiated coordination.

### Method, results and behavior

The baseline encodes tabular self/enemy/environment/market features with MLPs and spatial maps with a CNN, with attention used for action-relevant entities and market items. Curriculum training first teaches basic gathering, attacks and avoiding the shrinking danger area. Subsequent reward/penalty changes produce different aggression/cooperation styles. Those styles are learned responses to designed incentives, not spontaneous personalities without behavioral shaping.

The competition reports 475 registrations, 134 team registrations and 1,651 submissions. Only the top three participants beat the harder RL-based built-in opponents. Appendix B reports that scripted policies started effectively but became over-adapted to qualification opponents; RL ultimately performed better, and an imitation-learning submission placed fifth. This is a competition observation, not a controlled, equal-budget algorithm comparison.

**Concrete market observations:** agents retained weapons/restoration potions more than they sold them; inventory pressure encouraged liquidation; offers for desirable weapons generally rose with level; some very high-level tool offers were reduced when apparently too expensive to sell. These are evidence of nontrivial economic behavior in autonomous populations. However, the report largely describes aggregate offer/item statistics. It does not isolate a learned pricing policy with a no-adaptation ablation or demonstrate counterfactual gains from trade. Its wording about what agents “realize” should not be promoted to proof of internal reasoning.

**Concrete strategic failure of an intuitive incentive:** many entrants favored survival because survival points appeared safely attainable. The winning aggressive policy exploited conservative competitors and became stronger for the eventual fights. Maximizing apparent short-term safety was not robust to opponent composition. Prosper's survival controller could analogously look successful alone while leaving citizens exploitable in mixed populations.

### Evaluation and cost

Evaluation deliberately changes opponents: scripted PvE, harder learned PvE, then other contestants. Daily PvP evaluations ran 100 matches; weekly evaluations ran 1,000. This is more informative than replaying one friendly seed.

The **separate 2.0 paper** reports about 3,000 agent-steps per CPU core per second, measured with random actions and mortality disabled to avoid inflated throughput from dead agents. Its checklist says individual models are trainable in eight A100-hours; that is not a documented training bill for the 2022 champion or proof of strong economic behavior after exactly that budget. The 2.0 paper presents an environment/baseline release and defers fuller competition statistics; it is not itself a comprehensive market-agent success study. No dollar cost or transferable Prosper throughput follows from these figures.

### What transfers, and what does not

Transferable: direct executable authority; explicit equipment/consumable demand; meaningful inventory limits; held-out opponents; trajectory and market evaluation together. Not established: sustained profitable specialization in a peaceful persistent town, multigeneration behavior, autonomous negotiation, or policy transfer to Prosper without retraining.

**Discriminating Prosper check:** change rival policies while preserving map and starting wealth. Report survival, actual acquired equipment, realized trade surplus and changes in prices/output, not only aggregate gold or win rate. Separate team-shared information from individual knowledge.

## 2. AI Economist / Gather-and-Build: learned specialization with a real explanation

**Primary methods/results source read:** [Zheng et al., original 2020 preprint, “Improving Equality and Productivity with AI-Driven Tax Policies”](https://arxiv.org/html/2004.13332), §§2–5. The fetched text identifies v1 and the 2020 title. **All numerical experimental claims below refer to that version**, not automatically to the expanded [2022 Science Advances paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC9067926/), whose full text could not be retrieved in this pass. Implementation cost context: [authors' two-level RL tutorial](https://github.com/salesforce/ai-economist/blob/master/tutorials/two_level_curriculum_learning_with_rllib.md).

### World and autonomous action scope

Four workers in a spatial world collect wood/stone, submit resource bids/asks, and combine one wood with one stone to build a house. Houses generate coins according to individual building skill. Workers choose movement, gathering, trade and building through recurrent learned policies, observing local space, their state, full market state and taxes. The planner periodically sets tax brackets and redistributes revenue. Workers maximize concave utility of money minus accumulated labor; they are not directly rewarded for following an assigned profession.

**Crucial economic assumption:** the house payment comes from an external economy that is not simulated. Agents do not have to persuade another citizen to want the house. This is an explicit demand/money source, unlike Prosper's finite-gold exchange between citizens. The paper also calibrates labor costs to make choices strategically meaningful.

### Why specialization emerges

Building payoffs differ: 11.3, 13.3, 16.5 and 22.2 coins per house in the reported setup. Resource distribution and starting positions also differ. Lower-building-skill agents learn to gather and sell inputs; the highest-skilled worker mainly buys inputs and builds; an intermediate worker can build early and switch to gathering/selling later.

The mechanism is not “LLMs understand economics.” A buyer can pay more than a gatherer's opportunity cost while still earning more from its own high-value building time. Distinct opportunity costs plus transferable resources and an output buyer create gains from trade. Roles arise from optimizing utility under those mechanics, though the asymmetries enabling those roles are designed.

### Evidence of adaptation and incentive failure

The preprint compares no tax, a US schedule, a Saez-style policy and a learned planner. Its learned policy improves the equality-times-productivity objective by 16% over Saez in that setup. It reports variation over the final 20 million training steps across ten seeds. This is a welfare-policy result, **not a 16% proof of superior individual trading intelligence**.

More useful for Prosper are the behavioral explanations:

- Under one tax regime low-skilled gatherer/sellers work less. The high-skilled builder must gather more itself, reducing specialization and total building income. An apparently redistributive rule changes upstream supply and downstream opportunity cost.
- Agents learn to alternate high- and low-income tax periods instead of smoothing income, reducing effective tax. They discover a temporal response to the mechanism rather than merely repeating a job.
- Simultaneously changing workers and planner create an unstable reward landscape. Curriculum and entropy regularization matter; introducing strong taxes before workers learn useful behavior can impede learning.

These findings are stronger evidence of learned strategic response than prose about intentions. They still concern training inside the specified distribution, not broad zero-shot adaptation to arbitrary new economies.

### Cost and evaluation limitations

The preprint uses 1,000-step episodes, 60 parallel environment replicas, PPO/recurrent policies and **400 million phase-two samples**, additional to initial skill learning. That is substantial data generation for four workers. Do not interpret a compact deployed network as cheap capability acquisition. The authors' public tutorial describes a 16-CPU, 60-GB Google Cloud machine with 15 rollout workers and one trainer; it does not establish a universal training duration or dollar bill for the paper.

The preprint's human transfer experiment disables trading because usable trade interfaces were not achieved. It therefore cannot validate human-like resource-market behavior by transfer. The main experiments also use a fixed world map with randomized skill/location assignments. An economic equilibrium learned there is weaker evidence than held-out maps, production recipes and rival policies.

**Discriminating Prosper check:** first quantify a feasible specialization pair, including travel, upkeep and funded demand. Then swap relative production advantages or remove the downstream buyer. A competent agent should change output/purchases; a society that keeps manufacturing unsellable goods is not demonstrating successful specialization.

## 3. TAC SCM / TacTex-05: concrete procurement intelligence without a general neural policy

**Primary source:** [Pardoe and Stone, AAAI 2006, full six-page paper](https://www.cs.utexas.edu/~pstone/Papers/bib2html-links/AAAI06-tac.pdf), especially “Predictive Models,” “Adaptation over a Series of Games,” and “Experimental Results.” [Author publication record](https://www.cs.utexas.edu/~pstone/Papers/bib2html/b2hd-AAAI06-tac.html).

### Actual autonomy and method

Six autonomous computer manufacturers buy components, bid on customer requests, schedule constrained factories and deliver products under deadlines and late penalties. Games last 220 simulated days, with **15 seconds per day**. Suppliers/customers are environment mechanisms; rival manufacturers are autonomous submitted agents.

TacTex separates demand and supply planning but coordinates them through projected inventory, component use and replacement costs:

- Bayesian demand forecasting models the server's demand-generation parameters.
- Regression on recent bids and acceptance rates estimates probability of winning a customer order at a proposed price.
- A supplier model infers committed production capacity from observed quote prices, using known pricing mechanics.
- A greedy scheduler chooses profitable bids and production over ten days, including simulated future requests so today's orders do not consume every future opportunity.
- Procurement compares buying now with waiting, using projected needs and supplier prices.

This is neither a fixed “always craft X” script nor end-to-end learned strategy. It contains genuine prediction, online adaptation and constrained optimization, **plus substantial authored choices**: inventory thresholds, planning horizons, a stationary-price-pattern assumption and special opening/endgame logic. It is a useful alternative evidence class, not something to relabel as autonomous learned strategy discovery.

### Concrete successful adaptation

In the competition final, prior-game logs indicated unusually favorable first-day component prices. TacTex increased opening purchases toward nearly all expected requirements for the first 80 days. It accepted higher near-term costs/less flexible requests to gain lower later component costs. It won with average profit $4.7 million versus $1.6 million for second place; these are **simulated currency**, not compute costs.

The more persuasive result is a controlled follow-up: 30 games with four different opponents, comparing an adaptive version against a version frozen to final-round price predictions. Early buying was no longer consistently best. The adaptive version cut first-day purchases to about 20,000 components and averaged about 22,000 second-day purchases. Its score exceeded the fixed version by **$0.81 million**, significant at 95% using a paired t-test.

That is a direct answer to “can an agent recognize that the old market strategy no longer works and improve its outcome?” The result is bounded to the mechanism and opponent set, but considerably more concrete than observing many trades.

### Failures, costs and why this matters

Endgame forecasts correctly anticipated higher prices when competitors ran out of stock, yet the agent lacked enough components to fully exploit the opportunity. An independent inventory-threshold policy undermined good prediction. Prosper has the analogous risk that a sensible strategic decision cannot override the physical controller's commitments.

The paper reports supplier-model accuracy mattered more than sophistication in demand or bid-acceptance models; replacing some predictors with simple heuristics barely changed outcomes. More elaborate reasoning everywhere was not justified. Waiting to order could also be valuable because later information improved procurement, even at somewhat higher component prices.

Compute evidence is the 15-second decision deadline and use of greedy rather than globally optimal scheduling. The paper does not provide a portable hardware/training-dollar budget. Known supplier equations and past-game logs make inference much easier than discovering unknown rules. Opening/endgame tactics also rely on finite episodes, not persistent-world stationarity.

**Discriminating Prosper check:** give controllers identical observations and action authority; perturb input prices or rivals' purchasing behavior; compare realized profit net of unsold inventory and unmet survival/maintenance obligations. Include an adaptive-versus-frozen-controller comparison and track whether downstream execution defeats the chosen plan.

## 4. EVE Online: excellent economy instrumentation, not an NPC intelligence demonstration

**Primary source read:** [CCP, January 2025 Monthly Economic Report](https://www.eveonline.com/news/view/monthly-economic-report-january-2025), with downloadable raw data linked by CCP. Only the article text was examined; chart images/raw ZIP were not analyzed here.

This is a real persistent game economy with human production and trading decisions. The report distinguishes mining quantities, mining value, production value, destruction, regional trade, money supply, sinks/faucets and price indices. That distinction is essential: a nominal-value increase need not represent more useful goods or more efficient agents.

**Concrete observation:** January's average daily mining value increased 24.8%, while ore volume increased 7.6% and gas volume 9.2%; ice volume fell 25.4% after an event ended. Production value increased only 1.3%. The mineral price index rose 7.7% month-on-month, with CCP attributing much of it to Morphite prices. These are operator telemetry and interpretation, not randomized causal results.

Why relevant: demand, resource access and event timing can move at different rates. A citizen selling at a high price may be benefiting from scarcity rather than demonstrating better reasoning; rising wealth/value charts can hide falling physical throughput. Separately measuring production and destruction is a way to investigate whether persistent replacement demand exists, not proof that destruction alone guarantees a healthy economy.

**Autonomy/cost boundary:** this source supplies no learned NPC controller, training cost, inference latency or controlled NPC baseline. Human time, knowledge and coordination supply much of the decision-making capability. Prosper cannot cite EVE's market sophistication as evidence that a small policy model can reproduce it.

**Discriminating Prosper check:** report physical units produced/consumed/lost, actual completed trades, inventories and real purchasing power separately from nominal wealth. Use exogenous supply/demand shocks to test controllers, while labeling whole-economy changes separately from individual-policy gains.

## 5. Albion Online: a designed NPC buyer that sustains player production

**Primary source identified through search:** [Sandbox Interactive's Black Market feature explanation](https://albiononline.com/news/video-black-market-feature). Direct retrieval returned HTTP 403; the mechanism below is supported by search-accessible text from the official article, not a full methods/results reading. Treat this case as lower-confidence mechanism evidence, not a quantitative evaluation.

The Black Market links player-crafted equipment to loot demand. Mob kills can generate demand/orders for equipment; unsatisfied orders cause the offered price to rise until players supply items. The article explicitly distinguishes this from fixed NPC prices and unlimited demand. Thus a crafter/trader can respond to unmet loot demand rather than rely solely on another player personally wanting to equip the item immediately.

**Why incentives can work:** the buyer converts gameplay activity into demand for manufactured goods, and its rising offer provides a signal/incentive for suppliers. This is a deliberately authored feedback mechanism. A trader still needs to judge sourcing costs and the executable opportunity, but the NPC buyer does not need a learned valuation model or a simulated personal biography.

**Why this is not evidence of competent learned NPCs:** a demand counter plus a price-increase rule can create responsive prices. Interesting aggregate economics can result from simple institutional rules plus intelligent human suppliers. It does not establish learned bargaining, comparative-advantage discovery or independent planning by NPC citizens. Nor does the source establish quantified welfare improvements, exploit resistance or an optimal pricing rule.

**Costs and limits:** no training is implied by the described mechanism; runtime implementation costs and economic evaluation are unreported in the accessible material. This source alone does not quantify how item destruction, resale and loot recycling balance over time. Do not import a claim that every market price or all demand is fully endogenous.

**Discriminating Prosper check:** make the demand closure explicit. Who ultimately wants each crafted good, in what quantity, and with what purchasing power? If repeat demand requires an NPC institution, document it as a world rule, not as evidence of citizen intelligence. Adding such a buyer would be a design decision requiring approval, not a conclusion of this research.

## Cross-case implications, without selecting an architecture

1. **Separate mechanism competence from agent competence.** Albion demonstrates useful institutional feedback; EVE demonstrates a measurable human economy. Neural MMO and Gather-and-Build demonstrate learned executable behavior; TacTex demonstrates bounded predictive adaptation. These are different achievements.
2. **Demand and opportunity costs explain specialization.** Gather-and-Build supplies a downstream buyer and skill differences. Neural MMO supplies survival/combat utility and inventory scarcity. Prosper needs its own demonstrated explanation; “agents can trade” is insufficient.
3. **Adaptation requires a changed opportunity plus a comparison.** TacTex's adaptive/frozen experiment is a strong template. More trades or profit on an unchanged seed can be produced by a memorized policy.
4. **Cheap deployment does not imply cheap acquisition.** Neural MMO's compact policies still require training/evaluation infrastructure; Gather-and-Build uses hundreds of millions of samples. TacTex shifts cost toward explicit models and engineering. None proves an economical Prosper solution without a local budget and capability measurement.
5. **Preserve failures in the evidence.** Conservative Neural MMO policies become exploitable; taxes can collapse specialization; good TacTex forecasts can be defeated by inventory policy. Economic intelligence is a closed-loop execution property, not just selecting a plausible price or explaining a plan.

### Smallest useful follow-up research questions

- Is there a provably feasible positive-surplus specialization/trade opportunity in the existing mechanics, without adding currency or demand?
- Can a controller reverse its procurement/output decision after an input-price or rival-policy change, with equal information and an explicit compute budget?
- Does the advantage remain with held-out maps/opponents, and do physical execution commitments preserve or erase it?

These are proposed discriminating checks only. This document authorizes no code changes, training, services or experiments.
