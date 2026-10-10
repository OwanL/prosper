# RTS economy AI: concrete mechanisms and limits

Research date: 2026-10-08. Scope: Age of Empires, StarCraft and smaller RTS environments with resource collection, investment and production. No architecture selected; no Prosper experiments, training or code changes performed.

## What these comparisons actually concern

These examples primarily control **one player's entire economy and army**, not autonomous villagers with separate wealth, goals and consent. A per-unit output head is not evidence of an independently motivated citizen. This distinction follows directly from the control interfaces in the five sources below. Their useful common ground with Prosper is constrained production over time: resources spent now, delayed outputs, prerequisites, travel, contention and investment versus immediate consumption. Transfer proposals below are hypotheses, not demonstrated Prosper results.

### Broad scan and selection

| Example | Kind of intelligence | Economic/control scope | Reading depth |
| --- | --- | --- | --- |
| AoE II: The Conquerors Expert System | Authored rules plus engine economic controls | Empire-wide gatherer percentages, production and commodity transactions | Historical developer guide, selected detailed sections [A] |
| StarCraft build-order optimization | Explicit model and bounded search | Schedule a supplied production goal | Full six-page primary paper [B] |
| TStarBot1 / TStarBot2 | Learned macro selection / wholly scripted hierarchy | Full player; economic and military macro-actions | Primary paper methods, experiments and discussion [C] |
| AlphaStar | Imitation plus model-free league RL | Full player; production and combat jointly | Primary paper and methods [D] |
| Gym-μRTS PPO | Learned primitive unit actions with masks and shaped rewards | Full player; harvesting through combat-unit manufacture | Primary paper methods, experiments and appendices [E] |
| μRTS observation/action representation study | Learned policies, interface comparison | Resource harvesting and combat | Abstract only; not treated as validated full-game evidence [F] |
| Naive-sampling MCTS / combinatorial bandits | Search over joint unit actions | RTS joint-action branching | Abstract only; promising alternative search lead, no economic benchmark claim here [G] |
| Wargus resource-production planning | Means-end analysis, rescheduling and search | Warcraft-II-like production planning | Secondary coverage within [B], not independently verified |

The five detailed cases deliberately span shipped scripting, model-based planning, learned macro policies and learned primitive control. Combat-only results are not substitutes for economic-production evidence.

## 1. Age of Empires II: actual economic scripting, not learned villagers

**Primary source:** Mario Grimani / Ensemble Studios, *Computer Player Strategy Builder Guide: AI Expert Documentation, Age of Empires II: The Conquerors Expansion* [A]. Historical documentation, not a description of every present-day Definitive Edition implementation.

### Mechanism

The computer player is an expert system. `defrule` tests facts and executes actions; rules remain active until disabled. A rules pass checks the list, potentially several times a second. Facts include own resources, player/opponent information and game conditions; actions include training units, constructing buildings and researching technologies. These are player-level instructions, not each villager inventing a plan. [A, pp. 7–10]

The resource-allocation example is particularly concrete:

- Dark Age, fewer than ten civilians, no special resource need: set **90% food / 10% wood**.
- Same population with a wood need: **80% food / 20% wood**.
- At least ten civilians, no special need: **70% food / 30% wood**.
- At least ten civilians, wood needed: **60% food / 40% wood**.

A separate piece of logic sets the `resource-needed` goal. The policy selects resource percentages; it does not contain an economic optimization algorithm discovering those numbers. [A, p. 92]

The guide also scripts commodity behavior. Its example sells wood above 1,200 when other stocks are low, provided a sale is legal, and releases wood escrow before selling. It buys wood when gold exceeds 1,250, wood is below 1,100 and the quoted buying price is below 50. Thus both inventory thresholds and price sensitivity exist, but the thresholds are authored. [A, pp. 93–94]

### Evidence, cost and failure boundary

This is primary evidence of a shipped game's **control mechanism**, not a controlled win-rate or economic-efficiency study. The inspected guide reports rule-pass frequency, not modern CPU milliseconds, memory or training cost. These rules require no learned-model training. A large number of apparently purposeful villagers is therefore not, by itself, evidence of decentralized reasoning. [A, pp. 7–10, 92–94]

A foreseeable limitation of the shown examples is threshold sensitivity: an unanticipated recipe or economic shock need not be handled unless the facts/goals/rules cover it. That is an inference from the examples, not a measured AoE failure rate. Do not cite this guide as proving current AoE AI learns online or that its market is equivalent to Prosper's citizen order book.

**Potential Prosper discriminator:** use an explicit AoE-style inventory/price baseline to ask whether another agent reacts better to an unseen price or resource shock. Also separate the strategic resource choice from allocation/execution supplied by the environment. This is a baseline proposal, not a recommendation to replace reasoning with more thresholds.

## 2. StarCraft build-order planning: real production reasoning with a supplied objective

**Primary source:** Churchill and Buro, *Build Order Optimization in StarCraft*, AIIDE 2011 [B].

### Mechanism

The planner receives a starting state and target units/buildings and minimizes completion time. It **explicitly avoids choosing the strategic goal**. Actions have duration and required, borrowed, consumed and produced resources. A producer building is borrowed while training; minerals, gas and supply are consumed; a finished unit is produced. State records ongoing actions and income. This models concurrent production rather than replaying a fixed build list. [B, pp. 14–16]

Depth-first branch-and-bound is anytime and linear-memory in search depth. It starts with a feasible upper bound, prunes with prerequisite-duration and resource lower bounds, fast-forwards to when an action can begin, and removes duplicate orderings of independent simultaneous actions. Limits on unnecessary producers reduce branching. Hand-authored repeated-action macros reduce search depth, sacrificing strict optimality for tractability. The authors explicitly say these macros were inspected from professional build orders, not learned. [B, pp. 16–17]

The speed depends on major economic simplifications:

- Minerals: **0.045 per worker/frame**; gas: **0.07 per worker/frame**.
- A refinery automatically receives **three workers**.
- Construction adds a constant **four-second** travel allowance.
- Individual map layout, combat and general worker reassignment are not searched.

“Optimal” means optimal within this abstraction. The paper itself notes that fixed gas allocation can be suboptimal and that late-game resource hoarding can matter outside its planning scope. [B, pp. 15–16]

### Evaluation and budget

The authors extracted **520 unique build orders from 100 Protoss replays**, including 35 featuring named professionals; other replays came from high-level tournaments. Extraction stops at 10,000 frames or the first own-unit death, deliberately avoiding ongoing combat. Goals are read from the human's future production, which gives the planner information the human did not necessarily have when choosing earlier actions. The paper acknowledges this comparison is biased against the human because humans may change plans. [B, p. 18]

For the reported 120-second-increment configuration, macro search's **90th-percentile planner/human makespan ratio** is **1.00** for 0–249-second cases and **1.08** for 250–500-second cases. Corresponding **90th-percentile CPU-time/makespan ratios** are **0.02%** and **9.99%**. These are different distributions over short and longer openings, not one universal per-decision latency. Hardware is not identified in the paper. Avoid converting this into a current-machine latency guarantee. [B, Figs. 2–3, pp. 18–19]

The planner was integrated into a playing bot and reportedly defeated some amateurs and the built-in AI, but detailed match results were omitted. That is not evidence of professional-level full-game play. [B, p. 18]

**Potential Prosper discriminator:** given the same explicit production objective, compare time, resource consumption and successful completion against a lower-bound or search comparator. Then separately test whether the agent chooses a worthwhile objective. A capable scheduler does not establish correct specialization or pricing; a fixed income model may be especially wrong when extraction access, depletion, travel or market liquidity changes.

## 3. TStarBots: learned macro choice versus scripted economic management

**Primary source:** Sun et al., *TStarBots: Defeating the Cheating Level Builtin AI in StarCraft II in the Full Game* [C].

### Mechanism and authored boundary

**TStarBot1** learns which macro to issue using PPO or Dueling-DDQN, with terminal win/tie/loss reward and a predefined set of **165 macros**. Economic macros include **13 building**, **22 production**, **27 upgrade** and **three harvesting-related** actions. `CollectMinerals` and `CollectGas` assign workers; `InjectLarvas` operates idle queens. A tech-tree component masks unavailable choices. Handwritten worker selection, valid placement, prerequisite knowledge and combat micro implement the macros. The experiment further prunes combat macro choices. Thus the paper is not evidence that a neural policy discovered the entire execution layer from raw inputs. [C, §§3.1–3.2, 4.1]

**TStarBot2** is a wholly expert-scripted macro/micro hierarchy, not a second trained neural policy. Its production controller maintains a build queue, adds missing prerequisites and chooses mineral/gas priority using stock ratios. Its resource controller redistributes workers, transfers **three drones** toward a new base before completion and sends idle workers to a nearby base. It includes authored rush and defend/advanced-army strategies. [C, §§3.3.4–3.3.6]

### Budget and actual result

TStarBot1's study uses a simple MLP on non-spatial features, one macro every **32 frames**, about two game seconds. The reported training envelope is **one GPU plus 3,840 CPUs for roughly one to two days**; rollout uses **1,920 actors over 80 machines**, around **16,000 frames/second**. “One GPU” is therefore an extremely misleading standalone affordability claim. [C, §§3.2.3, 4.1]

Evaluation is **Zerg versus Zerg on AbyssalReef**, not arbitrary races/maps. Learned agents report **over 90%** against built-in levels 1–9 and **over 70%** against level 10, averaged over **200 games** with varied seeds and ties counted as half wins. Fog of war is enabled; upper opponent levels have cheating advantages. TStarBot2 is also reported to beat all built-in levels. Its text says 100 evaluation games while the table caption says 200, so this report does not resolve that denominator discrepancy. [C, §§4.1–4.2, Table 2]

### Failure that matters more than the headline

In informal tests, TStarBot1 exploits TStarBot2 with a Zergling rush because the scripted bot lacks the relevant defense. But a human who recognizes TStarBot1's rush preference can then defeat it consistently. The authors point to limited opponent diversity and insufficient exploration of advanced technology. These observations are qualitative and do not provide a held-out human match-rate estimate. [C, §§4.3–4.4]

**Potential Prosper discriminator:** a learned selector can improve on a fixed recipe while remaining predictably exploitable. Test repeated interaction after a competitor has learned its behavior, not only one-shot success against the same local controller. Attribute success separately to authored macro execution, learned selection and any privileged observations.

## 4. AlphaStar: genuinely learned full-game strategy, expensive capability acquisition

**Primary source:** Vinyals et al., *Grandmaster level in StarCraft II using multi-agent reinforcement learning*, Nature 2019 [D]. This is the final system, not the January demonstration.

### Mechanism relevant to economy

An observation encoder and recurrent LSTM feed autoregressive structured actions. The policy controls the full player, including workers, construction, technology and armies. It is model-free policy learning, not build-order tree search. The network has **139 million weights**, of which **55 million** are needed at inference. [D, Methods: Architecture]

Economic strategy is not learned from blank-slate self-play alone:

- Supervised initialization uses **971,000 human replays**; fine-tuning uses **16,000 high-rated winning games**.
- Strategy statistics encode the **first 20 constructed buildings/units** and cumulative unit/building/upgrade information.
- Training conditions on these statistics and uses build-order edit-distance and cumulative-statistic pseudo-rewards, alongside terminal game outcome and a regularizer toward the supervised policy.
- League training includes main agents and specialist exploiters, with prioritized sampling of difficult opponents and older policies rather than only the current self.

These are explicit mechanisms to acquire production competence and retain strategic diversity. Economic competence is part of the full game; the study does not isolate a citizen-level production/trading score. [D, Methods: Supervised learning; Reinforcement learning; Multi-agent learning]

### Cost: training and deployment are different

Twelve learning setups cover three races and main/exploiter roles. Per learning agent: **16,000 concurrent games**, **16 actor tasks each using an eight-core TPU v3**, and a **128-core TPU learner**. Main-text shorthand is **32 TPU devices per agent over 44 days**. Actor-game CPUs are also substantial: the methods describe roughly 150 processors with 28 physical cores each per setup. This is not the earlier “16 TPUs for 14 days” prototype budget. [D, main text and Methods: Infrastructure]

Evaluation runs each player policy on **one high-end consumer GPU**. Observed frame-to-action delay is about **110 ms**, including transport/processing/inference, plus a separately selected delay until the next observation averaging **370 ms**. These are not measurements for 100 concurrent citizens. [D, Methods: Game and interface; Evaluation]

### Evaluation and limits

Final ratings are **6,275 Protoss / 6,048 Terran / 5,835 Zerg MMR**, above **99.8%** of roughly 90,000 ranked active European players. Final evaluation adds **30 games per race** from the midpoint rating; the preceding midpoint had 60 games per race. Matches are anonymous against opt-in ladder players. The authors explicitly say this estimates approximately stationary strength, **not susceptibility to exploitation under repeated play**. [D, Empirical evaluation; Methods: Evaluation]

The final evaluation uses **four already-known maps retained in the ladder pool**, not newly added maps requiring an untested transfer claim. Action limits are **22 nonduplicate actions per five seconds** and the interface has camera constraints, though it is not identical to a human interface. [D, Methods: Game and interface; Evaluation]

Ablations supply stronger evidence than anecdotes: ordinary self-play can be more forgetful; human data and exploiter roles materially affect performance. However, those ablations use a reduced **single-map Protoss-versus-Protoss** setup and must not be reported as equally broad validation over the entire game. [D, Fig. 3]

**Potential Prosper discriminator:** a small deployed policy can embody expensive prior capability acquisition. Account for demonstration creation, simulation throughput and adversarial training, not merely runtime parameter count. A policy trained with privileged critic observations must still be evaluated using only the information its deployed citizen may know. Neither AlphaStar's win objective nor centralized resource ownership demonstrates independently rational traders.

## 5. Gym-μRTS: smaller-scale learned production, revealing failures

**Primary source:** Huang et al., *Gym-μRTS: Toward Affordable Full Game Real-time Strategy Games Research with Deep Reinforcement Learning* [E].

### Mechanism

PPO observes **27 binary feature planes** and outputs primitive actions: move, harvest, return, produce, attack or no-op, with directions, produced unit type and targets. Unlike an assisted harvesting macro, this interface requires ongoing worker movement and return commands. UAS chooses unit actions sequentially; Gridnet predicts actions across map cells together. Both still implement one player's policy. Invalid-action masks cover source selection and action parameters; full masking improves learning much more than merely masking action types. [E, §§IV–V]

The shaped economic reward is explicit: **+1 resource harvested, +1 worker, +0.2 building, +4 combat unit**, plus **+1 valid attack**, and **+10/0/−10 win/draw/loss**. Rewards occur when events initialize, not complete. Reported game success instead uses sparse win/draw/loss. This makes “built something” and “won” different quantities by design. [E, §IV-D]

### Cost, evaluation and failures

The best agent trains for **63 hours**; most experiments take **37–117 hours**, normally **3 vCPUs, one GPU and 16 GB RAM**. Appendix D separately describes four-CPU cloud machines and roughly **6,000 CPU/GPU hours** across the ablation effort. Thus a single successful run is not the complete discovery cost. [E, §VI; Appendix D]

Ablations use **four seeds**. Best seeds are selected by sparse return, then evaluated against **11 previous competition bots plus two testing baselines**, **100 games per opponent**, with a 4,000-tick evaluation horizon. The best configuration reports **91% cumulative win rate**. That is a selected best-agent result, not a four-seed mean or unseen-map score. Training episodes are capped at 2,000 ticks. [E, §§V–VI]

Important concrete failures:

1. Training only against strong CoacAI can still lose to simple WorkerRush. Opponent diversity helps. [E, §V-C]
2. Against Droplet, the first barracks is destroyed; repeated rebuilding drains resources and leaves the opponent producing more workers. This is an economic commitment/recovery failure, not merely an invalid action. [E, §VI]
3. Gridnet harvests/builds more and can earn more shaped reward without correspondingly higher win return. Similar shaped scores across seeds can conceal very different game outcomes. [E, §VI]
4. The principal result is **one map and one starting side**; stochasticity and partial observability are not studied. Multi-map generalization remains future work. The HTML extraction corrupts the map's name/dimensions in some locations, so no map-size-dependent claim is made here. [E, §§II, V–VII]

**Potential Prosper discriminator:** record sunk-cost recovery after a production asset is lost, not just uninterrupted production success. Track resource efficiency and the actual objective separately from convenient shaping counters. A population repeatedly rebuilding an unprofitable station could look busy while making the same kind of mistake as the barracks loop.

## Cross-case questions worth testing, not an architecture decision

These are proposed checks motivated by the sources, not authorized or completed experiments:

- **Allocation versus execution:** hold primitives/macro implementations fixed when comparing decision makers. AoE and TStarBots show how much competence can reside below the selector. [A, C]
- **Choosing versus attaining goals:** measure production-plan completion separately from selecting a profitable/survivable objective. Build-order search addresses attaining a supplied production target, not selecting the strategically worthwhile target. [B]
- **Unseen economic disruptions:** change extraction access, production capacity or a key price, then measure recovery and waste. Static income assumptions and repeated rebuilding are concrete threats exposed by [B, E].
- **Opponent adaptation:** include simple rush/exploitation policies, held-out strategies and repeated interaction, not only average success against the training opponents. [C, D, E]
- **Whole-cost accounting:** report training/demo/search cost, inference latency and world throughput separately. Cheap deployment does not imply cheap acquisition. [B–E]
- **Decentralization:** none of these five studies establishes that replacing a player with many self-interested citizen policies yields stable specialization, bargaining or welfare. That transfer remains an open empirical question rather than a conclusion from RTS success.

## Source register and audit notes

- **[A]** Ensemble Studios / Mario Grimani. *Computer Player Strategy Builder Guide*, AoE II: The Conquerors. Historical developer documentation mirrored by UserPatch: https://userpatch.aiscripters.net/CPSB.pdf . Relevant pp. 7–10, 92–94. Primary authorship, third-party hosting. Read extracted text, not a search summary alone.
- **[B]** Churchill & Buro (2011). *Build Order Optimization in StarCraft*. Publisher: https://ojs.aaai.org/index.php/AIIDE/article/view/12435 ; full paper: https://ai.dmi.unibas.ch/research/reading_group/churchill-buro-aiide2011.pdf . Full text examined.
- **[C]** Sun et al. (2018). *TStarBots*. https://arxiv.org/abs/1809.07193 ; readable full text: https://arxiv.org/html/1809.07193 . Methods and results extracted with source-local querying; exact table cells unavailable in extraction are deliberately not reconstructed.
- **[D]** Vinyals et al. (2019). *Grandmaster level in StarCraft II using multi-agent reinforcement learning*. DOI https://doi.org/10.1038/s41586-019-1724-z ; full-paper mirror: https://gwern.net/doc/reinforcement-learning/model-free/alphastar/2019-vinyals.pdf . Main results and methods inspected in extracted PDF text.
- **[E]** Huang et al. *Gym-μRTS*. https://arxiv.org/abs/2105.13807 ; https://arxiv.org/html/2105.13807 . Methods, results and appendices examined using source-local extraction. Implementation lead: https://github.com/Farama-Foundation/MicroRTS-Py . Repository not audited in this pass.
- **[F]** *Comparing Observation and Action Representations for Deep Reinforcement Learning in μRTS*. https://arxiv.org/abs/1910.12134 . Abstract-level lead only.
- **[G]** Ontañón. *Combinatorial Multi-armed Bandits for Real-Time Strategy Games*. https://arxiv.org/abs/1710.04805 ; https://www.jair.org/index.php/jair/article/view/11053 . Abstract-level lead only.

Research limitation: online extraction omits some tables and can corrupt PDF/HTML layout. This report retains only directly supported numerical claims and marks missing denominators, hardware and generalization tests rather than inventing them. No new game performance was measured here.
