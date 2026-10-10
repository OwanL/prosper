# Overnight world and citizen AI investigation, 7–8 October 2026

This is the world worker's research and experiment record. The user's overnight brief supersedes the old spike's restrictions on automatic survival and reusing useful ideas from spike 1. Trials use new in-memory worlds with no provider and never reset/delete/directly edit existing run data. The already-running user dev watcher can indirectly checkpoint/restart after source saves; no durable-directory hash claim is made. These trials demonstrate authored deterministic local behavior and aggregate interactions. They do **not** establish LLM emergence, model quality, or reliable general human simulation.

## Design evidence and decisions

The previous live-run audit recorded 272 provider requests over 235 citizen turns in about 28 minutes, four births, 22 matched fills and no attack attempts. Bram died with 155 gold. Joint reproduction sometimes ran physically while its strategy reported cancellation. These are stronger reasons to change execution and scheduling than simply making the personality text more hostile. The first spike's README also explicitly described layered reasoning, deterministic needs/care, scarce central resource rents and family/community support. Its simpler economy is informative; spike 2's fixed currency, tiers, escrow and equipment progression remain useful foundations.

### Primary research, with concrete consequences

- [Mike Lewis, *Choosing Effective Utility-Based Considerations*, Game AI Pro 3](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf) describes considerations used for Guild Wars 2 characters, including how to choose available inputs and avoid oscillation. Its useful lesson here is to score the actual motives—food runway, travel, hostility, resource scarcity, risk—using cheap observable proxies. Prospectively perfect opponent simulation is unnecessary. Prosper therefore retains recipe projects and current work instead of changing goals on every tick, and considers the cost of pursuing a fight. A scoring framework cannot compensate for unprofitable world incentives.
- [Kevin Dill and Dave Mark, *Improving AI Decision Modeling Through Utility Theory*, GDC 2010](https://www.gdcvault.com/play/1012410/Improving-AI-Decision-Modeling-Through) motivates continuous response curves, population differences and weighted choices instead of brittle yes/no transitions. Prosper currently uses priority bands with scored destination choices, not a complete utility graph. Traits and policy parameters expose aggression, caution, reserve and access demand without requiring a model to select each primitive. The implementation should be described as a utility-informed hierarchical controller, not an implementation of the authors' full system.
- [Namiki et al., *Advanced Real-Time Hierarchical Task Network*, AIIDE 2021](https://cdn.aaai.org/ojs/18910/18910-52-22676-1-2-20211004.pdf) separates longer-term planning from an executor which adapts tasks to real conditions. Frequent whole-plan replacement can destroy purposeful behavior. For Prosper, a compact strategic policy plus retained production subgoals supplies useful intent while a local executor buys prerequisites, gathers known deposits, navigates, responds to attacks and resumes useful work. A fully general HTN search or GOAP domain would add considerable authoring and validation burden to the current small action vocabulary. Recipe decomposition captures the valuable dependency planning first.
- [Robert Zubek, *1000 NPCs at 60 FPS*, Game AI Pro 3](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter34_1000_NPCs_at_60_FPS.pdf) discusses Project Highrise's need to keep economic citizens simulated, separating action selection from action performance with an explicit performance target. Prosper follows that separation and measures 100 actual citizens rather than duplicating sprites. Spatial indexing, bounded notebooks and low-frequency local social/market decisions matter more initially than adding ML inference. The cited game's 60 FPS is not a claimed Prosper benchmark.
- [Anthony Francis, *Overcoming Pitfalls in Behavior Tree Design*](https://research.google/pubs/overcoming-pitfalls-in-behavior-tree-design/) emphasizes modular, explicit behavior components and warns against growing unnecessary architectural machinery. Prosper's modules retain these benefits without introducing a new behavior-tree interpreter or inventing a complete scripting language for the model. The compact policy is deliberately constrained; unsupported free-text goals remain aspirations rather than executable promises.
- [Craig Reynolds, *Steering Behaviors for Autonomous Characters*, GDC 1999](https://www.red3d.com/cwr/steer/gdc99/) distinguishes action selection, steering and locomotion and combines local behaviors such as pursuit, evasion and arrival. The direct consequence is keeping strategic decisions separate from ordinary pathfinding and adding bounded pursuit/territory leashes after experiments showed equal-speed chases. [Reynolds' Boids account](https://www.red3d.com/cwr/boids/) also demonstrates organized group motion from simple neighborhood rules. It supports testing simple interactions, not assuming flocking itself supplies trade, consent or social motives.
- [James Ryan and Michael Mateas, *Simulating Character Knowledge Phenomena in Talk of the Town*](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter37_Simulating_Character_Knowledge_Phenomena_in_Talk_of_the_Town.pdf) distinguishes personally observed and communicated knowledge and tracks evidence source, time and strength. Prosper uses a much smaller digest: local competition, harms, real trade/help receipts and actual negotiation signals. A citizen cannot inspect a visible peer's private strategic policy, private grievances or food inventory. Public territorial announcements carry their geometry; private family/alliance/access signals go only to the recipient. Fallible rumor/secret systems are possible later but must not be confused with currently implemented extortion.
- [Kiran, *Using FLAME Toolkit for Agent-Based Simulation: Case Study Sugarscape Model*](https://arxiv.org/abs/1408.3441) illustrates how initial resource/citizen distributions can substantially affect agent-based outcomes. Prosper therefore tests multiple seeds and horizons, records named trajectories, and calculates carrying capacity before calling a swarm viable. An interesting aggregate is insufficient evidence of a robust design.
- [Park et al., *Generative Agents*](https://arxiv.org/abs/2304.03442) combines memories, reflection and planning for a small simulated community. Prosper borrows the need for persistent salient evidence and longer-term intent, while replacing routine model deliberation with cheap local execution. Rich reflection at every action would defeat the user's token objective. No attempt is made to reproduce that paper's experiments or conclusions.
- Albion's official [guild season guide](https://albiononline.com/news/guide-guild-seasons), [regional economy discussion](https://albiononline.com/news/devtalk-merlyn-economy-changes), and [Foundations overview](https://albiononline.com/update/foundations) tie territorial interests to valuable production, investment, alliances and attackable defenses. Prosper's interpretation is productive contested ground, reciprocal access and credible force. Claims are announcements, never magic collision rights; rent moves existing gold, never mints rewards. Global instant escrow delivery deliberately remains, so geographical power comes mainly from controlling extraction and owned processing rather than hauling routes. Official pages were search-readable but some direct opens returned 403/errors; no claim of having inspected inaccessible figures or complete articles.

### Layers selected

1. **World mechanics:** synchronous authoritative movement, work, inventory, escrow, combat, consent, births and settlement; serializable state only.
2. **Body/reflexes:** meals, starvation avoidance, local self-defense, fleeing and pursuit limits. These continue during model inference or budget exhaustion.
3. **Local economic/social controller:** persistent recipe projects, destination utility, public-market choices, local resource disputes, actual negotiation handshakes, family preparation and provisioning. Different livelihoods and risk traits produce different choices.
4. **Rare strategic policy review:** the model changes compact controls such as livelihood/tier, territory, no-go areas, stance, risk, price/reserve, selected allies/rivals and reproductive intentions. It also receives a bounded digest of what happened during the preceding period. The harness worker owns request timing/transport/token experiments.

A neural low-level policy is not justified yet: there is no demonstrated training objective or stable baseline, and learning could hide accounting and knowledge leaks. It becomes worthwhile once deterministic trajectories expose repeatable tactical failures that hand-authored proxies cannot cheaply address. Neither Conway's local cellular automata nor Boids needs individual semantic deliberation to create patterns; that observation encourages cheap local rules, but cannot establish that any particular rule set yields believable societies.

## World capacity and economics

Initial six-person geography has 23 bare-hand T1 food deposits in ring 2 plus three in ring 1. At one unit per 120 ticks and 100/9 fullness per unit, the 26 bare-hand sites provide about 2.407 fullness/tick ideally, or 24.07 adult equivalents at drain 0.1. Ring-2 supply alone supports about 21.30 before travel and competition. T2 and T3 food raise capacity with equipment progression. These are upper bounds, not guaranteed survival.

For explicitly requested populations above six, map area and deposit counts scale with founder count. A 100-person world is 86×86 and has approximately proportionate outer food supply, retaining a substantial ideal margin while travel, specialization and resource access remain consequential. Its initial specializations are balanced across food, wood and fibre; the old spawn rule alone would accidentally make 98 of 100 citizens food specialists. Newborns mint no gold. Their growth changes per-capita liquidity and resource demand and is measured rather than assumed indefinitely sustainable.

The economic investigation identified two issues needing calibrated follow-up: tier food nutrition grows 3× while initial local prices grew 2×; and permanent equipment/complete death loot can eliminate ongoing wood/fibre demand after everybody is equipped. Refining consumes three lower-tier inputs, so simply making output price exactly 3× still pays nothing for processing labor. Pricing and recurring maintenance experiments must preserve currency conservation and report affordability and material sinks explicitly.

## Experiment log and failed approaches

The current runner saves artifacts under `.experiments/world-ai`; earlier batches used `test-results/world-ai-*` before the cleanup collision documented below. Source runner is `test/autonomy-experiments.ts`. Snapshots contain real mechanic state; reports contain 500-tick named trajectories, aggregate events and outcomes. Parameters evolve between batches. Results from different batches are not paired comparisons unless explicitly marked.

| Batch | Parameters | Observations | Consequence |
| --- | --- | --- | --- |
| First local controller | Six founders, seeds 1/2/42, 6,000 ticks | All founders survived; 115/52/77 fills, 2/0/1 births, 0/24/0 strikes. | Functional economic baseline; no claim that all seeds should fight. |
| Coalition audit | First seed 1 | Global trade trust eventually admitted all six founders to one compact. | Changed to small negotiated compacts and disjoint membership; no universal automatic guild. |
| Long pursuit audit | Seeds 1/2/42, 12,000 ticks | All founders survived; 34/8/77 strikes. seed 42 Dara/Bram and Eli/Faye spent thousands of ticks in equal-speed edge chases, healing without useful work. | Added maximum pursuit duration, lost-contact timeout and stopping enforcement when intruders leave the grounds. No speed cheat. |
| First family waiting fix | Seeds3/4/5,12,000 ticks | 8/13/6 births; seed 5 one starvation death; help, threats and paid access occurred. Old waiting intent could survive cooldown and halt livelihoods. | Clear completed family rendezvous state, expire missed meetings and independently choose partners. |
| Station project trial | Seeds1/2/42,18,000 ticks | 32/28/20 births and 1 death each, but52,777/62,328/68,267 repeated build errors dominated traces. Actors prepared inputs far from their original sites and never returned into inspection range. | Explicitly return to dated build site; recheck local occupation; back off failed commands. These batches are failed controller trials, not final success metrics. |
| First100 stress trial | seed 1,1,200 ticks | All 100 survived, 332 fills, fixed10,000 gold. About91 sec and a 120 MB snapshot. | Investigated rather than accepting headcount as scalability. |
| Pathfinder regression | Early no-wall fast-path experiment | Spreading a Citizen into a Point copied full knowledge into every route node. | Exact existing path test caught it; fixed explicit x/y only. The120 MB artifact is invalid scale evidence. No durable run was written. |
| Spatial/perception iteration | seed 3,100 founders, 1,200 ticks | All 100 survived, 845 fills, 12 compact events, 10,000 gold, 27 sec, 15.1 MB snapshot;13.6 MB was 106,212 dated tiles. | Added local spatial buckets and bounded retention. |
| Bounded-memory100 trial | seed 4,100 founders, 3,000 ticks | All 100 survived, 2,189 fills, 20 compact events, 10,000 gold, 80.5 sec, 9.94 MB authoritative snapshot;512–639 retained tiles per citizen. | Mechanically viable at roughly37 ticks/sec here; browser/network costs owned by presentation/runtime worker. This is not a 60FPS claim. |
| Epistemic review | Direct source audit | Initial negotiation code consulted visible peers' private policy/readiness. | Replaced with bounded delivered offer/accept/ready/access signals; atomic core still validates real prerequisites. Subsequent results must be rerun on this stricter controller. |

The current bounded memory holds24 salient evidence entries, records omitted count, retains up to 64 substantial relationships, and compacts ordinary map memory to 512 tiles with128 growth slack. Current sightings remain authoritative; forgotten empty terrain can be rediscovered. Old non-autonomous checkpoints retain their existing behavior. Claims and communities are public announcements; hidden inventories and unrelated private messages are not.

## Verification and next comparisons

The initial world-only behavior suite checks real market rescue, bare-hand survival, policy-sensitive claims/no-go transit, rejection of parenthood, mutual signal-based reproduction, inheritance, no unilateral alliance, no remote trespass telemetry, atomic local gifts/equipped references and JSON continuation. Existing foundational/life/observation/directive tests also run. A passing mechanical fixture is distinct from an ordinary uncontrived long-run outcome.

Next comparisons should use paired seeds for pricing/maintenance and report stationary versus growing population separately: survival cause, food runway distribution, late-period wood/fibre fills, extraction/refining/crafting/repair counts, currencies and escrow, births, sustained guild membership, justified strikes and displacement, and recurring error counts. Blackmail specifically requires private compromising knowledge and a credible disclosure mechanism; ordinary access demands are extortion and should be labelled that way.

## Reviewed controller and paired maintenance evidence

Independent review added regressions for rejecting rival family offers, revoking
pending courtship after a rival policy revision, nullable policy clearing,
checkpoint continuation, bounded social state, hard no-go work/travel exclusion,
shortest escape from newly forbidden ground, and blocked-survival evidence.
Ordinary autonomous drift remains compatible with an in-flight strategic review;
a newer explicit policy revision supersedes an older response. General text goals
are descriptive; compact supported policy controls are executable.

The chosen recurring sink services handles and straps after 64 assisted tool
harvests or 32 sword strikes, consuming one unreserved T1 wood and one T1 fibre.
Equipment identity is conserved. Service counters belong to the citizen and
equipment kind, not an individual tradable item. Legacy worlds have no ledger.
The distinction is deliberate: per-instance durability would require unique
inventory items and materially complicate escrow, crafting and inheritance.
Service frequency follows actual work, not elapsed time. Actual servicing below
was much less frequent than a continuously harvesting T3 theoretical bound.

Paired trials used identical seeds and code with `maintenance` true versus false,
no provider, six founders and fixed 600 total gold. All founders survived in all
six trials; no gold was minted or lost. Growing populations are not a controlled
stationary-demand experiment, so differences after births include path dependence.

| Seed / horizon | Maintenance on | Maintenance off | Late trade mix and interpretation |
| --- | --- | --- | --- |
| 16 / 12,000 | 94 fills, 1 birth, 0 strikes, 20 services | 121 fills, 1 birth, 0 strikes | Last 6,000: 17 fills each; wood 3 vs 2, fibre 2 vs 2. All founders reached specialty T3. |
| 17 / 12,000 | 74 fills, 1 birth, 61 strikes, 17 services | 66 fills, 0 births, 94 strikes | Last 6,000: 21 vs 14 fills; wood 3 vs 1, fibre 0 each. Maintenance creates a real sink, not a guarantee of greater aggregate trade. |
| 18 / 30,000 | 119 fills, 11 births, 34 strikes, 61 services, 10 gifts | 132 fills, 7 births, 0 strikes, 2 gifts | Both preserve founders and have one isolated error, with named traces retained. More services did not automatically mean more fills. |

Dedicated consequence fixtures additionally establish beg-before-robbery of an
observed unaffordable food seller with actual death/loot settlement, actual allied
intervention against a visible attack, exact maintenance consumption without
escrow spending, and bare-hand recovery while servicing is due. These fixtures
prove mechanic availability, not its frequency in ordinary worlds. Ordinary
seeds can remain peaceful and that is a valid outcome.

The obsolete uninstrumented 100-person seed 5 12,000-tick attempt was stopped after
roughly sixteen minutes, before final output, when it still used earlier expensive
command projections. It has no completed result and is excluded from success
metrics. Replacement trials log progress every 1,000 ticks (population, fills,
births, deaths, strikes, RSS and elapsed time), and stop at ten wall-clock minutes
or 500 living citizens while saving the actual horizon. Full observation
construction was removed from action gating; common harvest/loot gates inspect
only current local position and dated notebook IDs, and empty visible tiles no
longer deep-clone empty arrays. Visibility/aliasing and dated-target regressions
remain required.

Remaining limits: global instant markets weaken geographical cutoff; claims have
credible local enforcement but no walls/gates/hauling strategy; small compacts
have aid and defense but no centralized coalition war planner; text persuasion
does not automatically imply structured consent or secret knowledge. The initial
2x tier asking-price convention still does not reward 3:1 refining labor in a
general market-equilibrium sense. Maintenance addresses permanent-tool demand,
not all stationary economy incentives. Further pricing changes need their own
paired affordability study rather than being declared an improvement from theory.

### Final surplus saturation iteration and artifact provenance

Named seed 18 trajectories showed the demand limitation clearly: Dara accumulated
about 351,000 ticks of food runway while Cora reached zero gold and foraged for
food. The founder compacts created around ticks606 and 800 persisted to 30,000;
Bram and Dara actually intervened against an offspring compact around ticks26,566
and 28,100, while Faye repeatedly paid Dara8 gold for access. This is grounded local
coalition behavior, not a centralized war strategy. Production waste remained a
separate issue from the availability of combat.

A bounded saturation rule now counts own inventory and escrow, raises its buffer
only for funded public buys and actual recent addressed sales, and pauses ordinary
extraction after survival/equipment/maintenance/family alternatives. It retains
trade and local defense, recording a specialization-review signal when warranted.
No spoilage, private demand inference or artificial customers were added. On the
same seed 18, maintenance enabled and 30,000 ticks, the revised controller had29 alive,
23 births, 113 fills, 18 strikes, 10 services, 16 gifts and conserved 600 gold. No founder or
child died. Maximum carried food potential was 900 fullness, versus more than 35,000
for Dara previously. Physical command events fell from 77,245 to 19,368 despite the
larger final population. Late 10,000 ticks still had only 5 fills (1 wood/0 fibre/4 food),
and 20 citizens had0 gold, including Cora and many children. This reduces waste and
leaves the weak stationary specialty demand visible. Four errors were message
rate limits, not looping construction or reproduction failures.

Playwright's configured output-directory cleanup removed earlier files under
`test-results` during concurrent validation. Their metrics and named findings above
were read and recorded before that cleanup; their raw baseline artifacts no longer
survive. Current reports/snapshots are retained under `.experiments/world-ai`,
outside that cleanup boundary. The saturation seed 18 report and snapshots survive
there. This provenance distinction matters: the earlier paired table is a recorded
observation, not a promise that its original JSON is still available.

The instrumented older 100 seed 7 trial reached 4,870 actual ticks before its ten-minute
bound:118 alive, 21 births, 3 starvation deaths, 2,560 fills, 39 strikes, 32 alliance events,
235 claim events and 10,000 gold conserved. Its console summary initially printed the
requested 12,000 horizon; the saved report correctly stores4,870 and the runner has
been corrected. That run predates the final saturation and projection optimizations
and is incomplete as a 12,000-tick acceptance. Its surviving snapshot/report were
copied into `.experiments/world-ai`; a final latest-code 100 trial is tracked separately.

The final policy-ergonomics review also found that declaring an existing ally a
rival did not actually end its pact. An explicit rival revision now withdraws
only the actor from a conflicting alliance, preserving its other members and the
actor's relationship history. It publishes departure, revokes outstanding offers,
waits 500 ticks before a reunion, and rejects indirect rejoining through a third
member while the rival remains. A focused regression checks that clearing rivalry
can later permit independently negotiated realignment. This is a practical control
for strategic policy, not a new diplomacy simulation.

## Final world handoff

The 100-founder seed 9 campaign reached **12,000 actual ticks**, with a serialized
continuation after the ten-minute experiment bound. It ended with 143 living
citizens: all 100 founders survived, 52 children were born and nine children died
of starvation. Combined segments recorded 4,457 fills, 130 strikes, 46 alliance
events and 501 claim events, with exactly 10,000 gold including escrow and loot.
There were 27 living compacts (19 with three members, eight with two), 97 claims,
64 processing stations and four sword-equipped citizens. **85 living citizens
actually had their livelihood's matching T3 tool equipped**, not merely a T3 policy
target. The final notebooks held 81,127 dated tiles, at most 640 per living citizen;
the world retained 500 recent and 256 significant events. The authoritative JSON
was 15.64 MB; spectator projection/runtime/browser sizes are a separate harness/UI
measurement.

The first 10,480 ticks took 600.3 seconds (17.46 ticks/sec); the remaining 1,520
took 61.57 seconds (24.69 ticks/sec). The first collector retained every mundane
event and reached roughly 949 MB RSS; the continuation retained only consequential
events and reached about 512 MB. This is not a controlled profiling comparison:
the segments have different population and collector histories. It does show why
experiment RSS must not be reported as serialized retained-world size. The
continuation used the retained-birth provisioning fix, while the first segment
predated it; no additional deaths occurred in the continuation, which does not
establish that the fix solves offspring provisioning. Final critical-food review
salience and explicit rival-pact renunciation have focused regressions rather than
an additional full 12,000-tick trial.

The first conflict snapshot reveals the user's desperation example in an ordinary
run: Citizen 127626, born at tick 1,899 to Galen 3 and Ada 7, publicly begged at
tick 2,409. At tick 2,531 the starving child attempted to rob Ada 8 after observing
food work or public food goods. Ada 8 was a wood specialist with public food sales;
the child did not inspect private reserves. Ada 8 saw the incoming attack and
defended, landing the first ordinary strike at tick 2,541. The child's intent was
`Desperate food robbery`, Ada 8's was `Defend against Citizen 127626`, and the
child later starved at tick 2,694. Thus ordinary desperation can cause an attempted
robbery without guaranteeing a profitable or victorious fight. The first
territorial warning was Dara 3 warning Ada at tick 279. No ordinary combat kill occurred in this seed;
the separate desperate-robbery fixture proves lethal attack and settlement are
available. All nine dead children had zero gold and empty inventories; most ended
searching for food, and one was fleeing. Newborn discovery/provisioning outside
the food biome remains a concrete failure mode, not a hidden success metric.
Critical unanswered begging records evidence and advances the next policy-review
due time; actual model availability still obeys global concurrency/spending caps.
Navigating to already-public food claim coordinates, or communicating a parent's
dated food waypoints, is a sensible **future experiment**, not implemented here.

Surviving raw paths, relative to the repository root:

- `.experiments/world-ai/world-ai-6-18-maintenance-saturation.json`
- `.experiments/world-ai/world-ai-6-18-maintenance-saturation-snapshot.json`
- `.experiments/world-ai/world-ai-6-18-maintenance-saturation-conflict-snapshot.json`
- `.experiments/world-ai/world-ai-100-7-baseline.json` (incomplete older 4,870-tick trial)
- `.experiments/world-ai/world-ai-100-9-maintenance-saturation.json` (ticks 0–10,480)
- `.experiments/world-ai/world-ai-100-9-maintenance-saturation-conflict-snapshot.json`
- `.experiments/world-ai/world-ai-100-9-maintenance-saturation-continuation.json` (ticks 10,480–12,000)
- `.experiments/world-ai/world-ai-100-9-maintenance-saturation-continuation-snapshot.json`

World-side final focused verification passed **27 tests** across autonomy, social
consequences and both independent-review suites, plus TypeScript checking. The
broader foundation/life/market/observation/directive selection passed 122 tests
before the last two focused regressions were added; the engineering lead owns the
final complete repository verification. All world experiment processes finished;
no provider was called, no durable run was rewritten and no background world trial
was left running. Remaining limitations include weak stationary fibre demand,
unequal/zero newborn liquidity, unprofitable default refining margins, locally
enforced claims without hauling/gates, small compacts without a coalition war
planner, adult-capable newborns without a childhood stage, and no actual secret
or disclosure system for blackmail.

Final scheduler review distinguished intentional saturation from a generic stall:
the controller now records `idleReason: 'surplus'` only while deliberately pausing
extraction. It survives cheap waiting ticks and clears on a new local decision,
active work or explicit policy revision. The harness uses that outcome rather
than parsing intent prose, so surplus does not create pointless repeated reviews.
Focused world tests cover marker persistence and clearing on actual public demand
and policy updates; checkpoint/scheduler coverage is owned by the harness worker.
