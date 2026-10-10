# Round 2: individual experience that changes decisions

Research date: 2026-10-08. Research only: no experiments, inference calls, training, installations, services or durable-world access. No architecture selected. Read the project guidance, current research brief, README/overnight design, and prior planning, RTS and MMO reports. This document owns only this research branch.

## Finding

Learning need not mean retraining an LLM or a policy network. There is directly relevant economic evidence for updating small predictive models and optimizing decisions against them. There is also evidence for learned resource/trade policies and for accumulating executable skills. These solve different problems:

- **Belief learning:** change a prediction such as “this ask has a 30% probability of filling within 100 ticks.” A fixed optimizer can then choose a different price.
- **Policy/value learning:** update action preferences or expected returns from rewards. An explicit yield/price model need not exist.
- **Memory adaptation:** add/retrieve evidence or instructions while model weights remain fixed. This is useful only if later choices improve because of that retained information.
- **Search:** evaluate alternative future actions under a model. Search alone is not learning; repeat planning with unchanged beliefs is not learning from experience.
- **Lifelong skill acquisition:** retain new executable procedures that work in later situations. Learning another production procedure is different from learning whether using it pays.

**Best immediate research discriminator:** compare adaptation-enabled and frozen versions with identical action authority, information and compute, then change an economically consequential condition. Log the complete chain **experience → changed internal quantity → changed prediction/ranking → committed action → realized consequence**. Neither prose recall nor a changing policy setting establishes the last two links.

No source below proves that a single local 9B model can discover and sustain Prosper's independent economy. Conversely, absence of a neural policy does not make an experience-driven economic optimizer a strategic script.

## 1. Directions derived from the actual problem

These hypotheses were used to choose the sources, rather than beginning with a required hierarchy.

1. **Learn a local opportunity map, not a profession label.** Estimate yield and completion-time distributions conditional on resource patch, tool, route and contention. Ask whether choosing among acquire/sell/consume/invest trajectories needs more than these quantities plus mechanics.
2. **Learn executable liquidity, not an average quoted price.** A high ask can coexist with no buyers. Forecast fill-by-deadline, partial quantity and realized price conditional on the citizen's own proposed order. Buying food and producing food then selling wood must compete on the same time/liquidity basis.
3. **Treat exploration as an economic action.** A short scouting trip or small trial order can be valuable because it changes future choices. A purely greedy estimator may never discover that an abandoned patch or formerly unreliable partner has improved.
4. **Separate stable mechanics from changing conditions.** Known recipe costs need not be rediscovered by reward learning. Travel congestion, depleted locations, demand and behavior of other citizens do. Learn residuals/contextual quantities rather than repeatedly “learning” multiplication by tier.
5. **Ask when reusable procedure learning matters.** A successful gather→convert→craft trace can save repeated deliberation. It must remain conditional on resources and changed opportunity costs, not become a permanent job script.
6. **Consider small direct action-value learners too.** A contextual bandit over short, comparable production trips could avoid modeling every consequence. It is inadequate when an action changes later capabilities or requires multiple investments to pay back; then a semi-Markov value learner or explicit search is a distinct candidate.
7. **Keep the source of experience explicit.** Shared pretrained weights are population knowledge; a citizen's recurrent state/notebook is personal experience. Training on many simulated lives does not demonstrate learning within one life. Shared experience between citizens would be a world/information decision, not a free implementation optimization.

## 2. Five primary-source comparisons

### A. Gjerstad–Dickhaut double-auction traders: learned acceptance beliefs → surplus-maximizing quotes

**Source [1], especially model §2.D and simulations §3.** Four buyers and four sellers each have three induced unit values/costs. Traders know their own values, observe market messages, and do not know others' private valuations. This is genuinely decentralized bidding, but not spatial production or survival.

**What changes:** frequencies of bids, accepted asks and rejected asks in a window covering the last `L` transactions. At candidate ask `a`, the seller forms a monotone belief:

`p(a) = [accepted asks >= a + bids >= a] / [accepted asks >= a + bids >= a + rejected asks <= a]`.

The paper interpolates between observed prices, handles the auction's spread-reduction rule, and selects the ask maximizing `(a - own unit cost) * p(a)`. Buyers analogously maximize `(own value - bid) * q(bid)`. This is explicit **belief learning plus myopic optimization**, not learning a policy by gradients. An expensive rejected ask reduces the expected return of similar asks and can change the next submitted price.

**Evidence:** 100 model simulations and 100 zero-intelligence simulations are compared with seven laboratory markets under the specified supply/demand design. Reported surplus efficiency exceeds 99.9% after several trading periods. A separate illustrated shift raises all unit costs and valuations by 0.50 after period five, testing adjustment toward the new equilibrium. That shift illustration is not a large held-out-opponent benchmark or an individual-profit superiority result.

**Costs/nonstationarity:** no offline neural training; small rolling counts, interpolation and one-dimensional optimization. No portable milliseconds or hardware budget is reported. The chosen memory is `L=5` transactions. The authors report unstable outcomes for `L<=3`; longer windows (`L>=8`) increase computation and slow adjustment after shifts. This is a concrete bias/variance/adaptation trade-off, not “more memory is always better.”

**Transfer limits:** public rejected messages under a spread-reduction auction differ from Prosper's resting/partially filled orders. An outstanding order is not yet a rejection; the paper itself excludes outstanding quotes from the resolved history. Prosper needs a deadline/exposure definition. Known induced costs and redemption values also bypass the difficult question of valuing food, time, tools and inventory. A good marginal quote optimizer cannot by itself learn investment payback or reliability of a named citizen. Counting others' messages is permissible only if those messages are actually observable.

**Discriminator:** compare learned fill likelihood against an observed-price-only decision rule while holding the citizen's valuation fixed. Do not score equilibrium convergence as proof that a particular citizen improved its interests.

### B. TacTex-05: prediction and constrained scheduling, with an adaptive-versus-frozen test

**Source [2], “Predictive Models,” “Decision-Making Modules,” and “Experimental Results.”** Six independent manufacturers procure components, bid for customer orders, manufacture and deliver computers. Supplier/customer mechanisms are given; competing manufacturers change the opportunities.

**Learned/inferred variables and action link:**

- A Bayesian distribution over demand-generator parameters predicts future customer requests.
- Regression on recent own bid prices and acceptance rates supplies an order-winning probability curve for each computer type.
- Supplier quotes, combined with the known supplier pricing equation, update inferred free capacity and future quote predictions.
- Completed-game logs update opening-purchase price predictions and late-game order-acceptance estimates.
- A ten-day greedy production scheduler uses acceptance-weighted orders, expected future requests, available components and factory cycles to choose bids/production. Procurement compares ordering now against later. These are actual outgoing RFQs, bids and production schedules, not advice to an independently committed body.

**Most relevant result:** adaptive and frozen versions begin with the same final-round predictions and face four opponents absent from that final round for 30 games. Under the new opponents, first-day bulk buying is no longer consistently cheapest. The adaptive agent changes ordering, and averages **0.81 million simulated dollars** more than the frozen agent, significant at 95% in the paper's paired t-test. This is much stronger adaptation evidence than the championship ranking alone.

**Credit assignment:** procurement prediction errors have a relatively direct label, while eventual profit includes inventory/storage, scheduling and sales. The paper can isolate a predictive component with ablations. This makes it possible to discover that supplier-model accuracy matters more than extra sophistication in the other two predictors.

**Failure/cost boundaries:** a correctly predicted endgame price premium was underexploited because another inventory-threshold policy left too few components. This is exactly why changing beliefs without sufficient action authority is insufficient. The agent also uses authored thresholds, a fixed planning horizon, special episode-start/end rules and a stationary future ordering-pattern approximation. Fifteen seconds per simulated day motivates greedy scheduling; it is not a measured per-citizen inference latency. No neural-training bill is needed, but model engineering and prior-game data are substantial. Some past-log reconstruction has more information than an individual Prosper citizen would have.

**Transfer:** strongest precedent here for small predictors with consequential planning. It does not establish that all such predictors need to be sophisticated, that its particular modular design is mandatory, or that finite-episode buying rules transfer to a persistent town.

### C. AI Economist Gather-and-Build: policy weights learn production/trade choices

**Source [3]: original 2020 v1 preprint, methods/results and Appendix B.** These numbers are version-specific, not claims about every later AI Economist release.

Four workers move, gather wood/stone, trade and build houses. Different building skills give different house incomes; workers maximize changes in concave coin utility minus labor. House income comes from an **external, unsimulated buyer/economy**. This demand closure makes selling inputs to a better builder potentially profitable; it is not equivalent to Prosper's finite citizen gold.

**What learns:** shared recurrent policy and value-network weights, trained with PPO using action/reward trajectories; LSTM hidden states also change within episodes. Immediate reward is the worker's utility difference. Estimated returns/advantages propagate delayed gains or losses back to earlier movement, collection, bids and building. This can learn “sell inputs rather than build” without an explicit acceptance curve or authored occupation selector. It does not yield an interpretable stored variable called “wood-patch yield.” Shared weights are not separately trained individual minds.

**Evidence:** low-building-skill workers gather/sell and high-building-skill workers buy/build; learned behavior also shifts income between tax periods. Policies thus encode economically consequential action patterns, not just completion of assigned production goals. However, much of the response is acquired through repeated training with tax regimes. The paper is not proof that a frozen deployed worker can infer an unseen market regime from a few personal outcomes.

**Data/compute:** the appendix specifies 50 million phase-one steps and 400 million phase-two steps, 60 parallel environment replicas, 15 CPUs and two GPUs; recurrent training chunks are 50 steps. The text distinguishes environment sampling from the multiple worker/planner transitions per step, so these numbers must not be silently multiplied or compared to Prosper ticks as identical units. No runtime estimate on this machine follows. There is no approved budget for reproducing this training.

**Credit/nonstationarity:** long production chains require rewards to propagate through earlier choices. Simultaneously learning workers and tax planner change each other's return landscape; curriculum and entropy regularization address this. Cheap dense reward is not automatically correct: rewarding construction rather than useful consumption or sale would invite useless inventory accumulation. All experiments use the specified map, with randomized skills/starting positions. New production mechanics, depleted markets and held-out rival policies remain important gaps. The human tax-transfer experiment disables trading, so it is not market-transfer evidence.

**Transfer:** direct learned action selection is viable in resource economies, but this is evidence for a substantial acquisition process, not a cheap online learner for each newborn. A much smaller tabular/semi-Markov learner remains worth testing on a restricted diagnostic; this paper does not provide its required sample budget.

### D. Darmok: acquire demonstrated cases, repair execution, but do not confuse repair with online policy learning

**Source [4], plan adaptation and Table 1.** Cases are acquired from goal-annotated Wargus demonstrations. Each contains executable structure, preconditions and ongoing viability conditions; goals have success tests. At runtime the agent retrieves cases, removes now-redundant steps, and inserts subgoals for missing preconditions.

**Concrete action consequence:** if stables already exist, remove townhall-upgrade/stables-construction steps from a knight-production case; if the worker needed for gathering is absent, insert a worker-acquisition subgoal. A repaired plan actually changes commands. These are changes to the current plan, **not demonstrated learning of price/yield beliefs or persistent policy improvement from self-generated outcomes**. In this study the case library comes from demonstrations; do not claim every repair becomes a newly learned skill.

**Evidence/cost:** with two traces, adaptation yields 19 versus 11 wins in 70 games; with six, 18 versus 9 in 70. With one trace, wins stay 14/70 and losses rise from 46 to 50. The striking seven-trace comparison is only five versus one win in ten games. Seven demonstrations are a modest data count but require human play and goal annotation. No numeric per-decision time/hardware result is supplied. Five demonstration maps belong to the evaluation set of ten, so this is not clean held-out-map evidence.

**Failure/credit:** removing a locally unnecessary action can harm a later goal and cause reinsertion. This illustrates structural credit assignment: achieving the immediate subgoal need not preserve future capability. Missing case coverage and inaccurate precondition matching are limitations; repairing a fully instantiated plan does not invent any arbitrarily better high-level strategy. Nonstationary prices can make a still-executable case economically obsolete without violating any precondition.

**Transfer:** executable case reuse is a credible alternative to a full neural policy and to raw prose memory. Prosper would need recorded context, costs, outcomes and applicability tests, then evidence that reusing a case beats re-planning or fixed execution. Case repair alone does not establish a citizen learned from its own life.

### E. Voyager: retained executable skills, not changed LLM weights

**Source [5], §§2–4 and experimental tables.** In Minecraft, GPT-4 proposes tasks and code; execution feedback, interpreter errors and an LLM success critic support iterative revision. Verified code is stored with a description embedding and retrieved for future tasks. It can invoke earlier skills. The pretrained model weights do not change.

**What learns:** a persistent library of executable programs plus completed/failed task history. The consequence link is stronger than “remember to get iron”: later code can call the stored iron-acquisition routine. Success feedback assigns credit at a task/procedure boundary. It is not a learned probability model of mining yield, a causal profitability estimator or an economic utility objective; its overarching goal is diverse discovery.

**Evidence:** the paper reports 63 unique items within 160 prompting iterations; exploration/tech-tree tables use three runs. For transfer it clears inventory, starts a new world and tests four unseen tasks, up to 50 prompting iterations each. Giving the library to AutoGPT also improves it, a useful reuse test. These are narrow new-task/world checks, not shifted recipes or changed multiplayer markets. The no-library ablation and the weaker GPT-3.5 code-generator ablation help distinguish memory from model competence; this is not evidence that any small model plus storage performs similarly.

**Costs:** GPT-4, GPT-3.5 and an embedding API are used; one prompting iteration is not necessarily one model call. Curriculum, code generation/revision and verification can each incur calls. The paper flags substantial API cost, but provides no transferable local 9B latency or cost forecast. It uses high-level Mineflayer APIs rather than learning movement/perception from scratch. Under Prosper's single-concurrency local inference, population acquisition latency is an unresolved bottleneck even if stored procedures execute cheaply.

**Failures:** hallucinated items/APIs, stuck code generation and incorrect success judgments are documented. A library can retain such errors; availability of source code does not guarantee correct applicability or economic value. Open-ended skill acquisition also needs a reliable success test and retention/invalidation policy. This supports investigating grounded procedural memory, not treating a growing prose diary as sufficient learning.

## 3. A concrete experience-to-decision design space

The following are **proposals**, not claims that the papers implement them or that Prosper already exposes the required records. Known mechanics may be used directly; hidden state must not be supplied to a citizen.

| Quantity to learn | Observable evidence and possible update | How it changes an executable choice | Principal trap |
| --- | --- | --- | --- |
| Patch output and availability | Completed work: units, tier, work ticks, tool, patch, observed contention. Online mean/variance or small contextual regression; recency-weight residuals after changes. Separate absent resource from failed access. | Rank feasible gather trips by predicted useful output and completion risk; decide whether to scout elsewhere. | Only visiting the current favorite leaves alternatives unmeasured; tool upgrades can masquerade as location improvement. |
| Travel/completion time | Start/end tick, route, interruption reason, distance and movement conditions. Learn excess time over known routing mechanics, rather than pretending deterministic movement is unknown. | Compare nearer slow yield with farther high yield, deadline feasibility and relocation cost. | Canceled/blocked trips are censored, not fast successful trips; changing danger is not ordinary distance noise. |
| Executable price/fill | Own order price, size, item/tier, book context, exposure, partial fills, cash availability, cancellation and settlement time. Bucketed Beta counts for a fixed fill horizon, or online logistic/hazard prediction; observed trade prices separately. | Price/quantity/wait choices compete on expected proceeds and liquidity delay, not posted ask alone. | An order canceled early cannot be labeled “would not fill by horizon”; repeated observations of one order are not independent examples. |
| Partner reliability | Witnessed commitment, scope/deadline, actual delivery or refusal, ability/opportunity to act. Separate identities and types of interaction; shrink sparse counts toward a disclosed prior, decay evidence when justified. | Choose a partner, smaller exposure, immediate exchange, or solo alternative by expected outcome. | No response before arrival/deadline is not betrayal. Lack of means differs from dishonesty. Atomic market settlement may have no counterparty-default risk to learn at all. |
| Investment return | Actual input spend, tool/station use, incremental output/time savings, upkeep, sale/consumption and liquidation. Compose forecasts of these terms; optionally learn residual realized returns by investment context. | Buy/build only when incremental future utility beats keeping liquidity and the best feasible alternative. Re-evaluate continuation after change. | Gross revenue after buying is not causal investment gain; demand, tool tier and location may change together. Sunk costs should not be charged again when deciding whether to continue. |

### Updates that are small but substantive

For a numerical forecast, a basic recency update is `m <- m + alpha*(outcome-m)`, with context, count and uncertainty retained. For an observed fixed-horizon binary event, discounted evidence can be `success <- rho*success + y`, `failure <- rho*failure + (1-y)`; combine with a prior to estimate probability. This is an engineering option, not a claim of calibrated Bayesian inference under arbitrary drift. Horizons, context bins and decay must be chosen on development conditions, not retrospectively tuned to held-out shocks.

A decision evaluator could compare finite trajectories with:

`expected utility = consumption/survival value + expected usable terminal assets - effort/risk/upkeep - acquisition costs`,

using **one consistent accounting system**, uncertain fills and alternative use of time. Do not add sale proceeds and the value of the same sold item, count escrow as spendable cash, or mark inventory at an ask nobody pays. A break-even estimate compares *incremental* net output/value against total acquisition cost over feasible use; declining demand can make a productivity upgrade unprofitable. Final preference weights, survival constraints and terminal asset values remain explicit design decisions, not things these sources resolve.

Search can then compare buy, gather, sell, invest, wait and explore trajectories within a disclosed horizon/node budget. It may instead use learned values or retrieved cases. No mandatory hierarchy follows: a flat candidate optimizer, direct recurrent policy, or case selector can each consume experience. A model-free semi-Markov alternative updates `Q(context, action)` toward `cumulative reward + gamma^duration * max Q(next context, ·)` after completed commitments. That is direct return learning, not learning physical yields; its advantage is fewer modeling assumptions, its disadvantage is delayed/confounded reward and weak extrapolation to unseen combinations.

### What makes adaptation credible

- **Retained evidence:** attach actions/orders/investments to eventual outcomes. Attempted, canceled, failed and completed are distinct. Outcomes may arrive after a newer decision; do not attribute them to whichever policy is current at settlement.
- **Prequential scoring:** store a forecast *before* seeing the outcome, then score calibration/error. Better fit to an already-seen log is not evidence of better prediction.
- **Selective observation:** log which contexts were tried and, where a randomized choice is used, its propensity. A rejected route tells nothing about yield behind the obstacle. Counterfactual “what if I had bought?” is not an observed training label.
- **Nonstationarity:** compare fixed windows/discounting with cumulative history; test both abrupt changes and noise. Forgetting can enable recovery or erase valuable rare danger evidence. Maintain uncertainty after change, rather than merely resetting to unwarranted certainty.
- **Persistent memory:** test reuse after a context reset with retained notebook/library, then remove or shuffle that memory. Improvement that survives neither reset nor retrieval is short-context adaptation, not durable learning. A recurrent state can legitimately implement belief updating, but this must be demonstrated, not inferred from the word LSTM.
- **Individual versus societal success:** selfish profits, gains from trade and aggregate welfare are different. One citizen can improve by exploiting others; many independent learners can chase the same apparent profit until it disappears.

## 4. Three small diagnostic experiments for later approval

None is executed or authorized here. Use isolated temporary worlds, legal citizen observations, identical primitive authority and fixed opponents first. Provisional ceilings are intended to make costs reviewable, not claims that enough learning occurs within them. Freeze code, tuning and baseline thresholds before evaluating held-out conditions; retain all seeds, not just successful ones.

### Experiment 1: does an experience-based opportunity model change the right trip?

**Hypothesis:** learned yield/travel predictions improve location choice and recover after a change, rather than simply selecting a pre-authored nearest-resource rule.

- One evaluated citizen, two accessible resource options, same starting liquidity/needs; ten paired seeds, at most 30 completed decision opportunities per seed. Introduce a change after opportunity 15. Permit at most two explicit scouting attempts per segment and charge their time.
- Arms: cumulative/frozen-after-warmup beliefs; recency-updated beliefs; small direct trip-value learner. Same feasible options/execution for all. An oracle predictor is evaluation-only and a separate upper-bound arm, never leaked into observations.
- Development uses yield changes; withheld evaluation changes travel/access or tool-conditioned yield instead, plus unchanged noisy controls. Include a previously inferior option becoming good, not only the current favorite becoming bad.
- Log prediction error, useful output per elapsed tick, unmet food needs, exploration loss and opportunities until a changed preference. If frozen and adaptive arms make the same choices despite prediction differences, inspect action authority/ranking before claiming learning worked.
- Ceiling: no LLM calls, no neural training, at most 1,000 candidate evaluations per decision and a preapproved 15-minute wall-time cap for the diagnostic. Stop on cap, record truncation rather than excluding slow/failing seeds. Tiny-state oracle regret only if the comparator's information advantage is clearly labeled.

### Experiment 2: can learned liquidity overturn a superficially attractive production/investment choice?

**Hypothesis:** an acceptance/time model plus a bounded evaluator beats price-only or frozen beliefs when downstream demand changes.

- One evaluated producer with a feasible consume/gather/buy alternative; fixed buyers with disclosed-to-evaluator budgets, not disclosed private future behavior. Ten paired seeds, at most 40 order/production decisions, change after decision 20.
- Compare price-only estimates, adaptive fill predictions, and the same evaluator with predictions frozen at the change. Include short/long use horizons for a single tool investment; verify offline that at least one feasible trajectory really pays back. No additional authored “switch profession” rule after observing results.
- Withhold the demand-shock direction/magnitude and buyer composition. Include unchanged quoted prices with reduced funded demand, and a rival undercutter absent from development.
- Score realized consumption and cash flows, funded obligations, unsold stock, time-to-fill calibration/Brier score, waste, investment regret versus a tiny evaluator oracle, and recovery delay. Trace which changed prediction reversed which action ranking. Treat canceled early orders as censored.
- Ceiling: no LLM/neural training; at most 2,000 candidate evaluations per decision and 15 minutes total, pending approval. Run adaptive/frozen citizens in paired separate worlds first; do not silently treat interaction in one shared market as independent samples.

### Experiment 3: is retained procedure memory useful beyond belief learning?

**Hypothesis:** retaining grounded successful procedures improves later execution, but stale procedures should be rejected when costs or prerequisites change.

- Three small acquisition/production tasks, two discovery seeds and four held-out task/world variants; at most 12 trials per arm. Give all arms identical primitives and success tests.
- Compare bounded from-scratch search, an executable trace library with applicability/repair, and an optional LLM with either structured outcome memory or equal-length prose summaries. For each memory arm include retained versus removed/shuffled-memory conditions. Mark demonstration-provided procedures separately from self-acquired ones.
- Withhold a missing intermediate facility and a cheaper acquisition route. Success requires adapting or declining an obsolete procedure, not merely executing it without validation errors. Measure task cost, failures/retries, reuse benefit after context reset and whether new procedures transfer without rewriting them for the held-out test.
- Non-LLM portion: no training, 15-minute cap, same fixed search budget. Optional local-model extension requires separate approval: **24 total inference calls maximum across all arms**, concurrency one, fixed context/output budgets, no retries outside the cap. This is only a feasibility diagnostic, not a powered model ranking. Do not replace it with paid calls if local inference fails.

These tests intentionally separate statistical learning, planning quality and procedural reuse. A direct policy may later compete in the same suite, but approving neural training first requires measured environment throughput, a sample/compute ceiling, reward specification and held-out evaluation contract. There is no justified training-budget estimate for Prosper yet.

## 5. Decision implications and gaps

- **Keep small online predictors plus bounded evaluation on the shortlist.** GD supplies a concrete learned acceptance-to-action link; TacTex supplies changed-opponent/frozen comparisons and shows where model accuracy actually matters. This is the most inspectable route to a first individual-learning diagnostic, not a selected production architecture.
- **Keep direct return learning as a real alternative.** It could outperform misspecified models in short repeated decisions. Long investment horizons, sparse rewards and changing rivals make extrapolating from a successful bandit to a complete citizen unjustified.
- **Treat memory and skill libraries as representations with tests, not intelligence guarantees.** Darmok repairs means using provided cases; Voyager acquires reusable executable procedures with strong pretrained models and repeated feedback. Neither demonstrates economically correct use of skills under changing prices.
- **Do not hide strategic authority below the learner.** If it cannot choose the specific patch, route, order/quantity, investment and cancellation being tested, the experiment is evaluating a settings tuner over the old controller. Broader authority is a proposed interface change requiring approval, not permission granted by this report.
- **Reliability remains a material evidence gap.** None of these five establishes learning named citizens' trustworthiness in Prosper-like consent/territory relationships. The proposed conditional evidence model is plausible engineering, not validated by a market acceptance curve. Likewise, no source validates the entire coupled location→investment→market→social learning loop at Prosper's population and inference limits.

## Source register and reading boundary

1. Gjerstad & Dickhaut (1998), *Price Formation in Double Auctions*, Games and Economic Behavior 22, 1–29. [Primary-author manuscript, revised April 1997](https://econwpa.ub.uni-muenchen.de/econ-wp/mic/papers/0302/0302001.pdf); [publisher DOI](https://doi.org/10.1006/game.1997.0576). Read extracted model equations/definitions and simulation methods/results. Manuscript page numbers differ from journal pagination. Numeric claim is the authors' bounded simulation result, not a convergence theorem for arbitrary markets.
2. Pardoe & Stone (2006), *TacTex-05: A Champion Supply Chain Management Agent*. [Author-hosted full paper](https://www.cs.utexas.edu/~pstone/Papers/bib2html-links/AAAI06-tac.pdf). Full six-page text inspected, especially predictor definitions and controlled experiment. Also cross-checked against the prior MMO report; not relying on its summary alone.
3. Zheng et al. (2020 v1), *The AI Economist: Improving Equality and Productivity with AI-Driven Tax Policies*. [Primary preprint](https://arxiv.org/html/2004.13332). Read retrieved methods, utility/reward definition, experimental setting and Appendix B training settings. Hardware and phase-one counts above add detail to the prior report; they are not inferred from tutorial infrastructure. This fetch resolves to v1 content.
4. Sugandh, Ontañón & Ram (2008), *On-Line Case-Based Plan Adaptation for Real-Time Strategy Games*. [AAAI full paper](https://cdn.aaai.org/AAAI/2008/AAAI08-112.pdf). Read extracted adaptation, execution and evaluation sections/Table 1, alongside the prior [planning report](game-planning-economic-ai.md).
5. Wang et al. (2023), *Voyager: An Open-Ended Embodied Agent with Large Language Models*. [Primary paper](https://arxiv.org/html/2305.16291); [project PDF](https://voyager.minedojo.org/assets/documents/voyager.pdf). Retrieved v2 text; methods, evaluations, ablations and limitations inspected. No independent reproduction and no direct image interpretation.

Additional context: [research brief](../citizen-intelligence-research.md), [prior RTS report](rts-economy-ai.md), [prior MMO report](mmo-economic-agents.md). ZIP auction learning was also searched as a potential alternative, but not promoted to a sixth case without a comparable full-text audit. PDF extraction may disrupt mathematical typography; formulas above were checked against their accompanying definitions. No claims depend on uninspected chart pixels or unrun source code.
