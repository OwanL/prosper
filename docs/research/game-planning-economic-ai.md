# Concrete production-planning game AI: four systems

Research date: 2026-10-08. Scope: alternatives to the false choice between an LLM and model-free RL, specifically executable resource acquisition, investment and production. No architecture selected; no Prosper experiments, model inference, training or runtime-data access performed.

## Bottom line

There is strong, concrete precedent for **computing economic action sequences rather than authoring every strategic sequence**. Wargus online production planning and StarCraft build-order search choose investment and production schedules using explicit action models. They do not learn their own ends, and neither demonstrates an autonomous society or a competitive market. Darmok adds demonstration reuse and online repair, with measurable but uneven improvements. Petra supplies a useful counterexample: capable-looking economic adaptation can come from explicitly authored queue priorities and recovery rules, not search or learned reasoning.

The important distinction is not “rules versus no rules.” It is **mechanics/model + objective + generated choices**, versus **mechanics + prewritten choices**. A planner may legitimately know that making an axe consumes materials without being told when to become a woodworker. Conversely, giving an agent a target occupation and a fixed dependency recipe leaves much of the strategy authored even if the executor is called GOAP.

| System | What actually changes at runtime | Where goals come from | Decision owner | Main evidence |
| --- | --- | --- | --- | --- |
| Wargus online production planner, Chan et al. 2007 | Investment in extra workers/buildings; action ordering and concurrency | Supplied final resource quantities; intermediate investments generated and compared | One centralized player economy | Executed resource goals, human comparisons, timing |
| StarCraft build-order optimization / BOSS | Production sequence, worker/building counts within allowed bounds | Supplied unit/building target set | One centralized player economy | 520 replay-derived production goals; public implementation |
| Darmok plan adaptation, Sugandh et al. 2008 | Recombination, removal and insertion of demonstrated plan components | Win-game root; annotated demonstration subgoals; repair goals from unmet preconditions | One centralized RTS player | Adaptation on/off match outcomes and documented regressions |
| 0 A.D. Petra | Resource reservation, gather-rate requests, priorities and recovery | Authored managers, targets and thresholds | One centralized faction; workers execute assignments | Actual source inspected; no controlled performance benchmark in this pass |

These are four systems, not four independent demonstrations of general intelligence. In particular, the two Wargus systems use the same game but substantially different decision mechanisms.

## 1. Wargus: online means–ends planning plus investment search

**Primary source:** Hei Chan, Alan Fern, Soumya Ray, Nick Wilson and Chris Ventura, [Online Planning for Resource Production in Real-Time Strategy Games](https://cdn.aaai.org/ICAPS/2007/ICAPS07-009.pdf), ICAPS 2007, pp. 65–72. Full extracted paper read, including Algorithms 1–3 and Tables 1–2. Original implementation not inspected.

### Actual mechanism

State aggregates counts of gold, wood, supply, peasants, townhalls, barracks and footmen, plus actions in progress. Operators explicitly distinguish resources that are **required**, **borrowed**, **consumed**, and **produced**. Harvesting borrows a worker; training borrows a production building; materials are consumed. This captures opportunity costs and concurrency much better than a Boolean `hasWood` flag.

At each decision epoch:

1. Means–ends analysis recursively adds actions needed to achieve the supplied quantities.
2. A heuristic scheduler moves actions earlier where prerequisites and resources permit concurrency.
3. The planner also constructs alternatives that first obtain additional renewable production capacity, such as another peasant or barracks, before reaching the final goal.
4. It compares makespans and executes only actions due now from the best candidate. It replans from actual state at the next epoch rather than committing to the whole old plan.

The central economic choice is genuinely evaluated: spending resources on another producer may make a distant goal faster, but makes a small goal slower. The authors explicitly contrast collecting a large gold target with one worker against paying for more workers first. This is not a fixed “always produce workers” rule.

### Authored versus generated

Authored: action semantics/durations, final goal, candidate class of intermediate investments, and expert-written allocation of concrete workers to tasks. Generated: how many investments are worthwhile through repeated replanning, dependencies, scheduling and current action selection. The candidate investment search is bounded and domain-specific, not unrestricted invention of subgoals.

This is **not an HTN requirement**. It is a relatively direct online planner with scheduling. There is no neural policy or LLM. The low-level allocation procedure is separate because the planner intentionally treats units of the same type as interchangeable.

### Evidence and cost

All experiments start with one peasant, one townhall and one supply; planning is invoked every five game cycles. Table 1 compares one experienced human's manual play and written plans; manual results report best/worst over five trials.

- Goal 1,000 wood: planner **14,985 cycles**, best manual human **16,320**, best human plan **16,170**. The planner keeps one peasant, recognizing that extra capacity does not pay back for this goal.
- Goal ten footmen: planner **24,185 cycles**, best manual human **24,640**, best human plan **26,560**; planner reports nine peasants.
- It does not uniformly win: 10,000 gold takes planner **22,500 cycles**, versus best manual **21,480**; 2,000 wood takes **19,980**, versus best manual **19,320**.
- Table 2: ten footmen takes planner **24,185** versus **45,900** for both LPG-td and SGPlan in the tested encoding. The latter failed to invest in extra renewable resources.
- For a 30-footman goal, plans have roughly **300 actions**, with each plan, including intermediate-goal alternatives, generated within about **0.02 seconds**. This is the paper's measurement, not a modern-machine or complete population-throughput estimate. Hardware is not specified in the inspected paper text.

### Limits and relevant failures

The efficiency argument relies on strong structure: one producing action per resource, no unit destruction in scenarios, enough raw resources, and special dependency properties. Constant action durations abstract travel. The small search can miss **threshold investments**: one extra producer may be bad while a larger package is good. Aggregate units lose individual location, ownership and condition.

**Prosper relevance:** a compelling production/investment baseline, not a drop-in planner. Prosper offers multiple acquisition routes (gather, buy, convert, potentially loot), depletion, decay/maintenance, private ownership and other agents. Those break assumptions underlying the especially cheap means–ends step. A fair experiment must expose the alternatives rather than encode one privileged route in the planner.

## 2. StarCraft: anytime build-order optimization and BOSS

**Primary paper:** David Churchill and Michael Buro, [Build Order Optimization in StarCraft](https://ai.dmi.unibas.ch/research/reading_group/churchill-buro-aiide2011.pdf), AIIDE 2011, pp. 14–19. Full extracted text, algorithms and figure captions read.

**Source implementation inspected:** [BOSS `DFBB_BuildOrderStackSearch.cpp`](https://github.com/davechurchill/BOSS/blob/master/src/search/DFBB_BuildOrderStackSearch.cpp), fetched 2026-10-08. GitHub contents API reported file blob SHA `29cd102e12add2b030372a12bd175ab0bfd32b27`. This is a later public implementation, **not asserted to be the exact experimental 2011 artifact**.

### Actual mechanism

A forward simulator models available resources, production in progress, worker income and build prerequisites. Depth-first branch-and-bound searches schedules, retains an incumbent solution and prunes candidates using lower bounds. Prerequisite chains and required resource accumulation provide bounds on remaining completion time.

Two particularly transferable reductions:

- **Event-time simulation:** for a proposed action, advance directly to its earliest feasible start, rather than branching on every tick of waiting.
- **Concurrent-action equivalence:** avoid considering every permutation of independent actions that can start together.

Worker income is abstracted into rates; building travel is approximated. Count bounds and optional repeated-action macros reduce the search further. The 2011 macros are explicitly **hand-created**, not learned skills.

Actual source confirms that this is search rather than a scripted build order: `generateLegalActions`, `getRepetitions`, `whenCanBuild`, `Tools::GetLowerBound`, state copying plus `doAction`, and `updateResults` participate in exploration. `setTimeLimit` accepts milliseconds; timeout is checked every 200 expanded nodes, so the limit is not a hard per-node deadline. The implementation also contains optional `m_useAlwaysMakeWorkers`, supply bounding and goal maximums. These are behavioral/search restrictions whose settings must be disclosed in any comparison; merely saying “BOSS uses search” conceals significant prior knowledge.

### Authored versus generated; goal adaptation boundary

The paper states explicitly: **“Avoiding the interesting and ambitious task of selecting good build order goals, in this paper we assume that they are given to us.”** Search discovers the means to those targets, including economic investments. It does not decide whether the army is strategically appropriate, invent a livelihood or maximize welfare.

A new goal or state can be replanned, but that is different from independently deciding to change goals. The actor is a whole RTS player controlling the economy, not a worker with its own resources and preferences.

### Evidence and cost

- 100 Protoss replays, including 35 featuring named professionals and the remainder from high-level tournaments; **520 unique build orders** extracted every 500 frames until 10,000 frames or first unit death.
- Goals come from those replays. Figure 3's early-game 90th-percentile planner/professional makespan ratio is **1.00**. For early-midgame goals, the 90th percentile is **1.09 without macros / 1.08 with macros** in the reported 120-second-increment condition.
- Figure 2 reports early-game 90th-percentile CPU/makespan ratios of **1.50% without macros / 0.02% with macros**; corresponding early-midgame values are **17.86% / 9.99%**. These are amortized compute ratios, **not per-action millisecond guarantees**.
- The evaluation describes both time-limit and incremental planning parameters; hardware is not identified in the inspected paper. Do not translate its “real-time” label into a promise that hundreds of Prosper citizens can independently run this search every tick.
- Integration into an actual bot is reported, including wins against some amateurs and built-in AI, but match details are omitted. That is not a controlled whole-game strength result.

### Limits and relevant failures

Replay comparison favors the planner because the human may change objectives while the planner is handed the resulting goal. No combat loss, trading, private information or adversarial resource contention is modeled in the production search. Income assumes fixed rates, and gas reassignment is simplified. Optimality is within the abstract model; macro restrictions sacrifice it further.

**Prosper relevance:** a flat bounded forward search is a real alternative to a hierarchy. It could compare “buy food now,” “gather food,” or “invest in tool then produce” using the same utility objective, if those actions and uncertain outcomes are modeled. A learned value estimate or proposal ordering could later accelerate that search, but neither is necessary to establish the initial capability, and neither hybrid is demonstrated by this paper. Crucially, **waiting must remain an option in Prosper**: market information, future prices and other agents can make waiting valuable, unlike the fixed build-goal setting used to justify earliest-action search.

## 3. Darmok: demonstration-derived plans with online structural repair

**Primary source:** Neha Sugandh, Santiago Ontañón and Ashwin Ram, [On-Line Case-Based Plan Adaptation for Real-Time Strategy Games](https://cdn.aaai.org/AAAI/2008/AAAI08-112.pdf), AAAI 2008, pp. 702–707. Full extracted paper read, especially Figures 4–5 and Table 1. Implementation not inspected. This is the 2008 adaptation study, not a claim about every later Darmok version.

### Actual mechanism

An experienced player records demonstrations and **annotates the goals** of actions. Cases contain goal, preconditions, ongoing “alive” conditions and executable sequences/parallel actions/subgoals. Runtime retrieves cases to expand an initially `win game` plan, executes ready actions and reopens failed goals.

The adaptation contribution has two parts:

1. Construct a dependency graph from action preconditions and success conditions; remove actions no longer contributing to an unmet goal.
2. When execution is blocked by an unmet precondition, insert a subgoal to satisfy it and retrieve another case for that subgoal.

Concrete production example: a knight plan harvests gold and wood, upgrades a townhall, builds stables and trains a knight. If stables already exist, upgrade/build steps are removed while harvesting/training remain. If workers are missing, `HavePeasant` repair subgoals are inserted before harvesting.

This is genuinely more adaptable than replaying a demonstration verbatim. It is also **not open-ended planning from mechanics alone**: success depends on case coverage, annotations and condition matching. The condition matcher uses domain rules and deliberately overapproximates dependencies to avoid deleting necessary actions.

### Authored versus learned; individual versus central

The behavior library is acquired from demonstrations rather than writing each full procedure directly. However, goal annotation, action representation, success tests, matching rules and the win-game root remain human supplied. This is a non-neural learning/planning hybrid. Runtime plans have an HTN-like tree, but that is a property of Darmok, not evidence that Prosper must adopt a hierarchy.

The agent commands the entire faction. Units do not privately bargain, set personal ambitions or choose their own plans.

### Evaluation and cost

Ten variants of “Nowhere to Run, Nowhere to Hide” maps; seven demonstrations, five on maps from the evaluation set and two on another map family. Demonstrator was **experienced but non-expert** despite the paper's generic “expert demonstration” terminology. This is not a clean wholly held-out-map test.

Adaptation on/off wins:

| Demonstration traces available | Games per condition | With adaptation | Without adaptation |
| --- | ---: | ---: | ---: |
| 1 | 70 | 14 | 14 |
| 2 | 70 | 19 | 11 |
| 3 | 70 | 22 | 21 |
| 6 | 70 | 18 | 9 |
| 7 | 10 | 5 | 1 |

The attractive “10% to 50%” headline is **one versus five wins out of ten**, not a large robust estimate. These are whole-match outcomes, not production efficiency or market adaptation measurements. The paper argues that search-free structural repair is efficient enough online, but provides no numerical per-decision latency or hardware benchmark in the inspected text.

### Observed failures

With one trace, adaptation sometimes deleted actions that appeared unnecessary locally but mattered later, then had to reinsert them. Wins did not increase and losses increased from 46 to 50. Three traces showed only a small win difference. Adaptation requires a fully instantiated plan; it cannot freely repair high-level structure while partially expanded. General merging of multiple plans is future work in this paper.

**Prosper relevance:** storing actual successful executable traces and repairing them is an alternative to both policy training and prose memory. But if cases encode “be farmer” and no alternatives, retrieval preserves the authored strategy ceiling. A discriminating test would supply identical action authority to a trace-repair controller and a from-scratch planner, then remove an intermediate resource/station or introduce a cheaper acquisition route absent from demonstrations. Measure whether it merely retries cases or actually exploits the alternative.

## 4. 0 A.D. Petra: inspectable economic control, not inferred intelligence

**Primary implementation:** archived GitHub mirror of 0 A.D., fetched 2026-10-08:

- [`queueManager.js`](https://github.com/0ad/0ad/blob/master/binaries/data/mods/public/simulation/ai/petra/queueManager.js), full file inspected.
- [`headquarters.js`](https://github.com/0ad/0ad/blob/master/binaries/data/mods/public/simulation/ai/petra/headquarters.js), relevant worker-production, gather-rate and update sections inspected.

These mutable branch URLs identify what was accessed, not a pinned current upstream release. No game run, profile or win-rate evaluation was performed.

### Actual mechanism

`wantedGatherRates` derives resource demand from pending plans. It treats the first queued item as a 30-second need, the second as a 60-second need and not-yet-ready items as 300-second needs. Current stock offsets needs; remaining quantities divided by their windows give desired gather rates. HQ compares wanted/current rates to identify resources needing workers.

`distributeResources` assigns resource accounts across queues according to priority. Accounts are capped at costs for the first item plus **60% of the next**, and a queue's priority for a resource is halved once that first item's need is funded. `switchResource` can compact accounts from lower-priority queues to help a higher-priority item finish funding. `startNextItems` checks affordability and actual ability to start, then checks cost again because the start check may change it.

`checkPausedQueues` explicitly pauses and clears selected reservations when worker numbers fall, favoring economic recovery. It also has exceptions for food-producing facilities. HQ staggers activities such as worker training and house building across played turns.

### What is and is not emergent

Observed stock and losses change allocations, but queue priorities, desired worker targets, temporal windows and emergency responses are authored. These inspected routines do not search counterfactual production chains, learn goals or optimize a future utility function. Production managers provide plans to a resource allocator. A sequence that looks economically responsive on screen is insufficient evidence of reasoning.

This is centralized faction control with shared stocks. It should not be copied as if each Prosper citizen could reserve every other citizen's resources.

### Cost and failure evidence

There is no trustworthy numerical throughput or strength result in the inspected material. Structural cost is bounded by queues/resources; `switchResource` compares queue pairs, and scheduling across turns avoids running every HQ operation every turn. Those observations suggest inexpensive control, not a measured performance claim.

The queue-manager header itself warns of **fragmented reservations**: all queues may hold 70% of what they need so nothing starts, or food stays assigned to a queue waiting for wood. It specifically says losing workers makes the problem worse. The same inspected file contains account release, resource switching and emergency pause/reset mechanisms, so the old header must not be presented as proof those failures are completely unhandled in this revision. The accurate conclusion is that reservation deadlock/fragmentation was an explicit design concern and mitigations exist; their effectiveness is unmeasured here.

**Prosper relevance:** strong diagnostic baseline and useful accounting lesson. It can show whether a much more expensive decision system beats transparent demand/rate control. It does not satisfy the user's desired strategy-generation outcome by itself.

## Comparison: what these sources do not establish

### GOAP is a search formulation, not a source of motivation

These studies provide the economically important pieces commonly hidden by the word GOAP: numeric resources, time, shared production capacity, opportunity cost and investment search. A Boolean prerequisite planner with an externally selected `GetFood` goal does not automatically optimize production, choose profitable specialization or respond to demand. Likewise, HTN improves search by constraining decomposition but can encode the exact strategies we wanted agents to discover. Neither term settles the architecture question.

### Goal adaptation has three different meanings

1. **Repair means:** replace an unavailable prerequisite or reuse an existing building. Darmok directly demonstrates this.
2. **Generate instrumental goals:** buy/build another producer because it improves the final objective. Wargus directly demonstrates this.
3. **Revise final preferences or strategy:** change occupation, accept risk, cooperate or compete because the situation changed. None of these four establishes autonomous citizen-level competence at this level.

A fixed objective can still produce changing strategies. Maximizing a defined future utility over action sequences does not require an authored menu of occupations or a goal-selection hierarchy. However, choosing that objective and supplying a predictive model are substantial engineering commitments, not solved details.

### Production is not a market

RTS players generally own all their producers, directly command them and turn raw resources into army value. Prosper citizens own separate inventory, share a changing environment and rely on other agents' willingness/ability to transact. A posted ask is not a guaranteed purchase; a bid is not guaranteed future income. Treating either as deterministic conversion operators would produce plans that are internally valid but economically fictitious.

## Small discriminating checks for later approval

These are proposals, not completed or authorized implementation work.

1. **Investment payback:** same citizen and mechanics, short versus long horizon, with gather/buy/tool-invest alternatives. Ask whether a planner changes investment at a defensible break-even point. Compare with an exhaustive tiny-state oracle where feasible, not only survival.
2. **Novel route substitution:** keep primitives/objective fixed, change relative acquisition costs or remove a station. Compare flat forward search, trace repair and explicit queue/utility baseline. No new hand-coded strategy after seeing the test.
3. **Threshold investment:** create a setting where a package of two improvements pays off but either alone does not. This directly probes the Wargus planner's admitted small-search failure.
4. **Prediction-versus-decision audit:** log forecast resource/time trajectories and actual execution. Separate poor model fidelity from a bad search choice. Include a failed trade rather than assuming every market action fills.
5. **Population budget:** first establish one-citizen planning value, then measure p50/p95 decision time, expanded states, replan frequency and total simulation throughput under fixed per-population budget. Do not extrapolate the papers' centralized-player timings to 100 independent planners.
6. **Decentralization check:** use only each citizen's legal observation and owned resources, plus explicitly modeled contracts. Compare fixed-opponent, mixed-population and all-planner conditions separately. Never let the search simulator access hidden full-world knowledge by accident.

The most defensible next shortlist from this branch is **bounded forward production/utility search**, **demonstration-derived case repair**, and **transparent economic queue/utility control as a diagnostic baseline**. A learned model/value hybrid remains a plausible accelerator, not something these sources prove necessary. No evidence here justifies selecting a mandatory rules → small model → LLM hierarchy.

## Evidence receipt and gaps

- Primary PDFs read in full through tool-generated OS-temp text extraction; headline results checked against tables/captions rather than search summaries.
- Actual BOSS search and Petra allocation code inspected. No repository clone, compilation or execution of third-party code.
- Search/fetch used for research; one attempted Banished developer URL returned 404 and was not used as evidence. This report therefore retains four investigated systems rather than padding the comparison with an unverified citizen-game example.
- No dedicated citizen/settlement planner with demonstrated independent personal economic objectives was validated in this pass. The centralized-to-individual transfer gap is material.
- No source in this report establishes market profitability, social intelligence, personal goal discovery, or downstream improvement in Prosper.
