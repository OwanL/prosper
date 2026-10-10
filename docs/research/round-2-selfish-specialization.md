# Round 2: selfish specialization, endogenous demand, and failure regimes

Research date: 2026-10-08. Scope: literature only. No model calls, training, simulations, services, code changes, or durable-world access. Read the project guidance, current design, master research document and prior MMO/economic-agents report. This report does not select an architecture.

## Divergence before selection

Avenues beyond the prior Gather-and-Build/Neural MMO/TacTex pass:

1. **Consumption-driven barter:** can production and exchange benefit the actual agents, without an external house buyer?
2. **Minimal market intelligence:** how much apparent economic competence comes from clearing rules and supplied reservation values rather than learning?
3. **Strategic market power:** can successful independent learning hurt consumers even without communication?
4. **Monetary coordination:** positive physical surplus need not imply an executable sequence of cash-funded trades.
5. **Endogenous institutions and decentralized price beliefs:** Howitt–Clower's shop emergence and Gintis's private-price evolutionary models are promising follow-ups, but their full methods were not examined here.
6. **Learning opportunity costs:** distinguish learning a markup from learning whether to manufacture, consume, store, buy or relocate. Personality might change discounting/risk/consumption preferences, without selecting a profession.

Selected three primary cases: **Fruit Market**, **ZIP with the ZI counterbaseline**, and **Q-learning oligopoly pricing**. They discriminate among successful specialization, cheap but narrow adaptation, and harmful strategic success. Monetary bottlenecks below are explicitly deductions/proposed tests, not an unsupported fourth empirical case.

## Bottom line

Independent learners can discover useful exchange and merchant specialization, but the strongest new example supplies large permanent production/preference asymmetries, carefully engineered barter matching, and very extensive training. It does **not** demonstrate rapid adaptation to unseen shocks or solve finite-gold liquidity.

Cheap online learning can adjust prices after a supply/demand change, but the best clean example is given the hard part: each agent's reservation value and buyer/seller role. Conversely, independent profit learning can discover punishment-supported high prices. Increasing intelligence is not equivalent to improving society.

The missing capability for Prosper is therefore not merely “post adaptive prices.” It includes generating personal marginal values from needs and feasible alternatives, predicting sell-through and time-to-cash, and revising production under changing circumstances.

## 1. Fruit Market: consumption-funded gains, but substantial supplied structure

**Primary source:** Johanson et al., *Emergent Bartering Behaviour in Multi-Agent Reinforcement Learning* (2022), [full text](https://arxiv.org/html/2205.06760), especially §§3–6 and Appendix A. Full-text methods/results extraction was examined. Numeric claims here belong to this source, not the AI Economist.

### Primitives, incentives, and what is learned

Agents move, harvest, eat and propose local barter exchanges of apples and bananas. Unlike Gather-and-Build, ordinary trade needs no external output buyer: another agent eats the fruit. However, utilities are still authored. Eating preferred fruit yields **8 reward**, other fruit **1**; hunger gives **−1/timestep** at zero satiation, movement **−0.25/tile**. Constant consumption rewards do not constitute learned preferences or general wealth utility.

Permanent roles are supplied: an Apple Farmer harvests apples with **100% success per timestep**, bananas with **5%**, but prefers eating bananas; Banana Farmers have the reverse structure. Agents learn executable harvesting/consumption/exchange behavior, not the role's productivity advantage. This is a sharper limitation for the user's desired unassigned citizens than the word “emergent” suggests.

Trading is not unconstrained negotiation. There are **18 offer actions**, using quantities 1–3; persistent local offers are automatically matched and atomically exchanged. Compatibility, dominance filtering and matching tie-breaks are supplied by the environment. Only held inventory can be offered. No currency is supplied or emerges. Prices are fruit-exchange ratios, bounded by the offer vocabulary, not gold prices.

Independent V-MPO recurrent agents learn from their own experience **without parameter sharing**. The normal population has 16 agents, ten sampled per episode, with 800 parallel environments and 1,000-step episodes. Training reaches approximately **800 million steps per agent**. Hardware/wall time was not established in the examined material. Small deployed networks do not make this a cheap learning recipe for Prosper.

### Positive evidence

- Increasing apple abundance while holding bananas fixed changes dominant barter ratios: equal abundance eventually gives 3 apples:3 bananas; doubling apple tree probability gives 3:2 (§5.1).
- Regional production and restricted movement create geographically different prices. In a scarce central region, some agents become merchants, purchasing and transporting/reselling rather than mainly harvesting (§5.5).
- At central abundance ×0.25, two established Apple Merchants obtain **52% and 53%** of apples through purchase. Their mean episodic reward is **945.2 versus 776.1** for comparison Apple Farmers; Banana Merchants average **1237.1 versus 934.1** (Table 9). These are observed role/outcome comparisons, not randomized causal assignment of merchant behavior.

This is real self-interested exchange and an emergent activity niche, not a central production optimizer. It is also not evidence that agents spontaneously invented all their underlying economic motives.

### Counterevidence matters more than the attractive story

- **Each experimental condition trains a fresh population.** Supply/demand curves are comparative statics across training runs, not a trained society adapting to a surprise. Sudden/gradual changes are future work (§§3.3–3.4, 7).
- Production reacts weakly to several incentive changes. Raising only Banana Farmers' apple-consumption reward does not deliver the predicted high-reward price/production increase (§5.2).
- Removing hunger almost eliminates exchange; inventory stays below one unit of each fruit on average. Removing off-role production as well restores trade (§6.1). A plausible efficiency story alone does not guarantee exploration will discover it.
- Raising movement penalty to −1 without a marketplace largely eliminates trade (§6.2). An A2C alternative fails to learn trade (§6.3).
- Exact-inverse matching produces four of fourteen conditions with zero/near-zero trade. Dynamic offers support trade in only four of fourteen. An explicit acceptance variant produces offer-maker-favoring prices in all fourteen runs, with a single-run-per-condition caveat (§6.4). Action/settlement design materially changes outcomes.
- Merchant behavior is absent under several less-scarce central-region settings. With no walls and low central resources, regional prices differ but no merchants appear; the authors cannot establish that this is suboptimal (§5.5.3).
- Separate **marketplace experiments** use artificial fixed-offer entities that can supply/sink effectively unlimited fruit (§5.3). Do not present those treatments as closed-economy evidence.

**Prosper transfer boundary:** physical consumption can supply downstream utility without a money faucet. But Prosper has funded remote markets, so transporting fruit between local exchange zones is not an available merchant advantage in the same sense. Geography primarily affects extraction/production/travel to facilities, not remote commodity delivery. No finite-money circulation result follows from barter.

## 2. ZIP versus zero intelligence: cheap adaptation, supplied valuation

**Primary source:** Cliff and Bruten, *Zero is Not Enough: On the Lower Limit of Agent Intelligence for Continuous Double Auction Markets*, HPL-97-141, November 1997, [full report](https://shiftleft.com/mirrors/www.hpl.hp.com/techreports/97/HPL-97-141.pdf), §§2–4, pp. 3–8 and 20–30. Extracted full text examined. Gode and Sunder (1993) is discussed through this report; direct PDF extraction of the original failed. Do not describe the original as independently full-text verified here.

### What is supplied versus learned

Buyer/seller status, trade entitlements and per-unit reservation/limit prices are assigned. The supply/demand schedules are constructed by those assignments and renewed trading entitlements. These agents do not decide whether food is worth buying rather than gathering, nor create demand through their own survival/production needs.

ZI-C traders randomly quote within a no-loss bound. The often-called “budget constraint” means not buying above a supplied value or selling below a supplied cost. It is **not a demonstration of finite cash-on-hand liquidity**. As recounted by Cliff–Bruten, Gode–Sunder's ZI-C mean allocative efficiency was 98.7%, versus 97.9% for humans. That is an important warning: high surplus extraction can arise with no learning.

Cliff–Bruten explicitly preserve that allocative-efficiency insight while challenging a different claim, price convergence. With asymmetric supply/demand, random quotes can yield systematic prices away from theoretical equilibrium. Do not falsely summarize the critique as “ZI markets are always inefficient.”

ZIP agents maintain a profit margin, adapting it from the last quote's price, side and acceptance/rejection, plus whether the agent can still trade. A Widrow–Hoff delta rule with momentum moves quotes toward stochastically perturbed targets (§4.2). The direction of margin adjustment is **authored bargaining logic** (§4.1, Figure 27). What is learned is a numeric margin, not a general economic strategy or utility model.

### Controlled adaptation evidence

With the same parameter distributions across four markets and averages over **50 runs**, ZIP prices track equilibrium better than ZI-C. Two conditions converge typically within four trading days; box-design conditions approach more slowly and are extended to thirty days (§4.3). Aggregate allocative efficiency remains high for both, while profit dispersion differentiates them.

In §4.4, after ten trading days, the experiment either adds **$0.50** to each buyer's limit (equilibrium $2.00 → $2.25) or subtracts **$0.50** from each seller's limit ($2.00 → $1.75), then continues five days. Fifty-run averages show adjustment to the new equilibrium. This is actual within-run adaptation, unlike Fruit Market's retraining comparisons, but own changed limits are supplied directly and only auction pricing is tested.

**Cost:** a few scalar updates per observed market event, no offline neural training required. No portable measured runtime is claimed. All-to-all event dissemination can still cost population-wide work. This is a useful low-cost diagnostic baseline, not a proposed replacement citizen architecture.

**Prosper implication:** independently adaptive prices do not solve independently generated valuations. Feeding ZIP an omniscient reservation price would conceal exactly the opportunity-cost reasoning the user wants. A fair test must mark that assistance explicitly.

## 3. Selfish Q-learning can learn market power rather than social efficiency

**Primary version examined:** Calvano, Calzolari, Denicolò and Pastorello, *Artificial Intelligence, Algorithmic Pricing and Collusion*, **April 2019 working paper**, [FTC-hosted PDF](https://www.ftc.gov/system/files/documents/public_events/1494697/calzolaricalvanodenicolopastorello.pdf), §§4–6, pp. 16–35. Later [AER 2020 publication](https://pubs.aeaweb.org/doi/10.1257/aer.20190623) exists; numeric findings below are from the 2019 version, not silently attributed to the final paper.

Firms independently choose prices to maximize discounted profit. Consumers are a **supplied logit demand function**, not autonomous citizens with conserved cash and survival. Costs are supplied and production/inventory constraints are not Prosper-like. Each learner observes recent prices; no communication or instruction to collude is required.

The baseline has two firms, fifteen prices and one-period memory, giving **3,375 Q entries per agent**. The allowed price interval is itself constructed using calculated competitive and monopoly prices. Initial Q values use a specified hypothetical rival distribution; the study also tests alternate initialization. Thus “from scratch” does not mean an unrestricted economic world without modeling choices.

### Evidence beyond merely high prices

The paper perturbs converged policies by forcing one agent to undercut, then observes retaliation and subsequent recovery (§5.6.2). Temporary price punishment wipes out the deviator's immediate gain; prices gradually return. Memoryless controls have profit gains below 5% in the paper's normalized competitive-to-monopoly metric. This separates strategically sustained high prices from a learner simply failing to locate competitive prices.

A representative experiment has **85% of the competitive-to-monopoly profit gap**, not an 85% increase in social welfare or raw profits (§5.5). Greater cost asymmetry reduces this normalized gain but does not remove it (§6.2). The paper cautions that external validity needs further work. These outcomes do not prove Prosper citizens will collude.

### Costs and adaptation boundary

Each parameter setting uses **1,000 independent sessions**. Typical convergence ranges from roughly **400,000 to over 2.5 million periods**, averaging **850,000** at one reported setting. The stopping criterion is 100,000 periods without a changed greedy strategy, with a billion-period cap (§§4.4–5.2). The paper reports average convergence under one CPU-minute per session, demonstrating how tiny games permit huge sample counts. That is not a feasible sample-throughput estimate for a spatial survival simulation.

Forced deviations test learned contingent behavior, not rapid relearning of a new production economy. More firms and alternative costs/demand are robustness conditions; they should not be advertised as zero-shot cross-economy transfer.

**Prosper implication:** measure buyer outcomes and distribution, not seller profit alone. Better independent learning can reduce buyer welfare. Concentrated tier access or facilities may create market power even without explicit cartels; territory violence adds mechanisms absent here.

## What the evidence supports about prerequisites

These are necessary questions, not sufficient conditions or prescribed architecture:

- **Real use value:** someone must gain from consuming/using the output. An order book and nominal inventory appreciation do not create final demand. Food consumption, maintenance, equipment productivity and personal preferences can ground value, but their marginal benefit must be quantified.
- **Relative opportunity cost:** nearby wood only matters relative to feasible alternatives, expected sale proceeds, survival timing and inputs. A resource advantage with no funded buyer is not current income.
- **Executable exchange:** mutually beneficial bundles can fail because of matching vocabulary, inventory timing or inability to fund the next leg. Fruit Market directly demonstrates sensitivity to the first two, not gold liquidity.
- **Information and feedback:** observe attempted as well as completed trades, offer age, inventory and personal outcomes. A non-fill can mean bad price, missing demand, missing purchasing power or latency, not simply “lower price.”
- **Revisability:** success on one learned equilibrium is weaker than switching production, spending or investment after a new local condition.
- **Independent objectives are not independent training automatically:** population sampling and extensive simulation can support learning even without shared parameters. Record both deployment information and acquisition cost.

### Finite gold: useful deductions, not empirical claims from these papers

Conserved money is compatible with sustained consumption and production: the same gold can circulate repeatedly. **Finite supply alone is not a proof of a liquidity trap.** Distribution, circulation and settlement timing matter.

A useful diagnostic counterexample: A has food, B has wood; both value the other's goods more, but neither has spendable gold, which is held by an inactive C. Positive barter surplus exists, but neither can initiate a positive-price funded purchase. Escrow can cause a temporary analogous bottleneck. Better price intelligence alone cannot make an unaffordable order executable. This does not authorize adding barter, credit or a faucet.

Likewise, hoarding can be rational insurance against uncertain food access, or failed valuation of excess stock. Missing bids can reflect genuine saturation, an impoverished customer, or insufficient exploration. Production-chain coordination can fail when an intermediate producer needs future demand to finance inputs while the buyer waits for finished goods. These causes need distinct interventions; more specialization is not always the right outcome.

## Three hypotheses and small proposed experiments

**Proposals only; none executed.** First use bounded fixtures and current mechanics. Controllers, reward weights and experiment code require separate approval. No primitive should be added simply to make a favored controller succeed.

### H1: the hard bottleneck is personal valuation, not quote adjustment

Create paired two-citizen opportunities with known wood/food yields, starting inventories and funded orders. Compute a small omniscient feasible-plan benchmark outside the actor; never expose it as ordinary citizen information. Compare candidates with identical observations against (a) fixed-price behavior and (b) a supplied-reservation-value adaptive quote baseline, clearly labeled privileged.

Hold out crossed conditions: cheap/expensive food, affordable/unaffordable food, wood buyer present/absent, and short/long survival runway. A capable agent should buy in some conditions and gather in others, not follow “near wood means sell wood.” Record personal consumption/survival, time costs, completed cash legs, unsold stock and regret only where the comparator's objective is defensible. Prediction: price-only adaptation succeeds when gifted correct values but not when production/need trade-offs must be discovered.

### H2: some specialization failures are funding failures rather than cognition

Use an enumerated positive-surplus pair plus a third cash holder. Preserve total gold, geography, needs and productivity; vary initial gold distribution and spendable-versus-escrowed balances. Include no-trade and executable-plan controls. Do not introduce credit or alter exchange primitives.

Prediction: some distributions remove all feasible beneficial trade sequences before starvation, even though physical/barter surplus remains. Measure reachable funded sequences, time-to-first-fill, survival, gold circulation and each party's benefit relative to autarky. If a feasible sequence exists but controllers miss it, the diagnosis shifts back toward agents/interface. If cash redistribution changes incentives as well as funding, report that confound rather than calling it a pure liquidity effect.

### H3: learning that helps one seller can hurt the population

Start with a verified useful production opportunity, then vary supplier concentration and an unannounced supply/maintenance-demand change. Compare continued adaptation with a frozen copy of the same learned state, and separate one focal agent against fixed opponents from all agents adapting.

Measure post-change recovery time, output/consumption, buyer survival, individual returns, fill probability calibration, price dispersion and failed purchases. If high prices arise, test a bounded forced price deviation and competitor response before calling the result collusion. Prediction: adaptation can increase focal profit while worsening buyer access; price convergence and trade count alone will miss this.

**Suggested bounded first pass for each approved fixture:** 12 paired seeds, at most 1,000 ticks per branch, at most 30 wall minutes per experiment, zero live model calls/training. Stop at the first accounting invariant failure or compute cap and retain incomplete results. This is a screening ceiling, not a statistical power claim. Record per-decision time and total simulation throughput; an oracle search must have a node/time cap and report failure to establish feasibility rather than declare no opportunity. Broader learning comparisons require a separately authorized acquisition budget.

## Uncertainty and next discriminating evidence

No examined case simultaneously demonstrates unrestricted self-selected production, endogenous need-based valuations, finite-money circulation, spatial capital investment, fast online adaptation and modest acquisition cost. Fruit Market is the strongest new positive example but has the most consequential training/role caveats. ZIP supplies useful narrow online adaptation; collusion supplies a warning that successful selfish learning is not a welfare guarantee.

Before choosing a mechanism, establish at least one opportunity in Prosper that benefits both parties under existing funded settlement and survival constraints, then remove or reverse its advantage. The observation of correct reversal, with beliefs/predictions and realized outcomes recorded, would be more discriminating than another long run containing many trades.
