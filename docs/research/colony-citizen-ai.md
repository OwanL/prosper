# Citizen AI in colony and life simulations

Research date: 2026-10-08. Scope: actual game systems, not a general AI literature survey. Read-only web research; no code changes, experiments, Prosper model-provider calls, or architecture selection.

## Finding in brief

**These games are strong evidence for making many characters behave coherently, but not evidence that independent citizens learn production strategy or discover profitable trades.** The strongest accessible primary cases here are The Sims, Dwarf Fortress, Banished, and Widelands. Their documented mechanisms are authored interaction scoring, needs/state machines, job arbitration, production programs, and logistics. The player or a settlement-wide service supplies much of the strategic coordination. Emergent stories and aggregate production therefore need to be distinguished from strategic intelligence in each individual. [S1–S3, D1–D2, B1–B3, W1–W2]

For Prosper, these are useful comparators and engineering evidence, **not a recommendation to replace its current strategic rules with different strategic rules**. None of the four cases below establishes a learned citizen policy or general long-horizon economic planner. That is a limit of the inspected evidence, not a claim that no version, subsystem, or other game ever uses one.

## Search breadth and evidence grading

| Game/family | Evidence found and inspected | Treatment |
| --- | --- | --- |
| The Sims / The Sims 3 | Programmer's archived implementation explanation; original prototype provenance; AI designer's GDC abstract | Strong primary case, with explicit archive/abstract limits |
| Dwarf Fortress | Tarn Adams interview and Bay 12 developer-talk transcript | Strong primary case; distinguish implemented 2019 loop from earlier proposed redesign |
| Banished | Developer's implementation, performance, and patch articles | Strong primary case, including concrete failures |
| The Settlers-like production economy: Widelands | Official production DSL documentation and open-source economy implementation | Strong primary case; do not attribute its implementation to proprietary Settlers releases |
| RimWorld | Community work/trade documentation; modder ThinkTree tutorial surfaced but fetching failed | Important comparison, lower evidence tier; no claim of primary-source confirmation of internals |
| Oxygen Not Included | Developer interview and community priority documentation surfaced | Secondary comparison/lead; not promoted into a detailed citizen-AI case |
| Stonehearth | Attempted planner-oriented search did not return usable source evidence | Unresolved lead, not evidence for a planning architecture |

Source quality matters: an official forum hosting a modder tutorial does not make that tutorial a developer statement. Search summaries were used to find sources, not treated as proof of implementation. Four primary cases were retained rather than filling a fifth slot with weaker internals claims.

## 1. The Sims: local autonomy through authored object affordances

**Selection mechanism.** Don Hopkins's archived explanation describes objects carrying their own behavior code and advertising possible interactions. Candidate actions are scored for the person, motives, skills, personality, relationships, world state, and distance. Conditional advertisement code checks eligibility, modifies scores, and can generate variants such as friends available to phone. The autonomous selector considers actions across objects, obtains approximately the top five, and chooses among the top candidates randomly. The same advertisement mechanism also supports the player's pie menu for one object. [S1, “How Sims choose what to do,” “Scoring actions,” “Two uses of advertisements”]

**What creates coherence.** A selected interaction has executable object behavior, rather than being only an intention in prose. Persistent preferences can influence later selection: Hopkins gives the example of strengthening a Sim's relationship with a bed through use and decaying it over time. The approximate numbers in that explanation are illustrative, not a recovered version-specific specification. Objects maintain execution stacks; animation and sound can run asynchronously and synchronize through blocking/events. [S1, “Object threads,” “Favorite bed”]

**Where autonomy ends.** Choosing an interaction without a player click is genuine local action autonomy. It is not evidence that the Sim invented its needs, learned a new interaction, searched a production chain, or planned an economic career. The affordances, effects, conditions, and scoring machinery are authored. Even imperfection is intentional: Hopkins says always choosing the optimal action would leave the player unable to improve a Sim's life. Randomized suboptimality is an entertainment/control decision, not a capability result. [S1]

**Social goals.** Richard Evans's official Sims 3 GDC abstract explicitly credits a data-driven social system with “hundreds of interactions, and thousands of production-rules,” authored by producers and designers. It describes in-game visualization tools for testing/refining personality behavior. This supports rich authored social variation, not a claim that those social rules were learned. The abstract alone does not establish the precise planner, scoring formulas, or performance. [S2]

**Failure/evaluation boundary.** The sources document deliberate non-optimal choice and designer-facing behavior visualization, not held-out adaptation experiments or population throughput. The 1997 `Motive.c` artifact is a prototype: Hopkins explicitly warns that shipped code changed, including removal of a stress motive. Its provenance cannot justify attributing the prototype verbatim to released Sims AI. [S3]

**Prosper relevance, by inference.** An action interface whose advertised possibilities correspond to real effects is valuable regardless of whether a script, planner, or learned model selects actions. Copying Sims-style utility scores would still author strategy. Social believability and optimal economic adaptation should remain separate claims.

## 2. Dwarf Fortress: autonomous lives plus settlement-level job arbitration

**Selection and authority.** In the 2019 interview, Tarn Adams describes the player as the “official will of the fortress,” while dwarves retain autonomy outside official duties. In the implemented loop described there, job assignments and job applications are checked every hundred ticks, on staggered schedules. Applications use a “kind of invisible auction” to manage competing priorities. Immediate creature actions, such as movement and workshop work, are advanced elsewhere in the loop. [D1, questions about micro/macro control and the main game loop]

This is an important boundary: **job auction does not mean a money market**. The interview does not establish individual wages, bidding prices, strategic price discovery, or economically independent dwarf businesses. It describes arbitration over work. Nor does it establish that assignment respects a Prosper-like citizen-specific information boundary. [D1]

**Why independent greedy selection is insufficient.** In an earlier Bay 12 talk, Adams says jobs then selected the first nearest qualified dwarf, producing bad matches. Simply reversing the direction would also fail: a dwarf could take a job another dwarf was better suited for. He proposes merging the decisions with a slight delay so matches can resolve together. That passage describes intended work, not proof that the exact proposal shipped; the later interview independently establishes auction-like arbitration. [D2, passage beginning “right now ... the jobs pick the dwarves”]

**What creates coherence.** Assignment coordination, explicit player authority, physical simulation, and separate personal/social activity systems all contribute. The loop schedules taverns, temples, and libraries periodically; activities include dances, martial training, and storytelling. These are concrete simulated activities, but the interview does not establish general social-goal search. Adams explicitly says character motivations and goal-setting still lag stories. [D1]

**Performance and failure.** Staggered frequencies, flags, and skipping unchanged map sections reduce work. Temperature remains “an unfortunately slow process” in that interview. The earlier talk documents poor worker/job matches; the interview documents the difficulty of reconciling urgent player control with dwarf autonomy. Adams also warns that simulated history can be boring without enough dynamics and mechanisms, and that finding interesting moments requires investigation/post-processing. Story density is consequently not a clean measure of actor intelligence. [D1–D2]

**Prosper relevance, by inference.** Multi-agent opportunity allocation is a distinct problem from choosing an individual's next action. A globally informed matcher could improve colony output while violating the desired independent-citizen problem. If used as a comparator, it should be labelled centralized, not credited as citizen reasoning. These sources do not establish an autonomous production-price economy suitable for direct transfer.

## 3. Banished: explicit strategic scripts, with unusually useful failure evidence

**Selection mechanism.** Luke Hodorowicz describes simple actions such as moving, retrieving inventory, depositing inventory, and playing animations. They execute through a FIFO queue; authored chains are called behaviors. When the queue empties, a state machine chooses the next behavior. Needs are prioritized by severity; the published pseudocode checks warmth, doctor, food, health, clothing, and tools in order. If needs cannot be attained, it falls back to work and retries later. Jobs are ranked by urgency and distance; assigned profession/workplace narrows normal work, with general labor when work is unavailable. [B1]

**Authority and coherence.** The character executes and locally selects from authored routines; profession/workplace and available town jobs structure production. The article's example of fetching food from storage or a market is logistics, not evidence of purchases with individualized price negotiation. Children depend on parents stocking the home. The author explicitly says everyone is a well-behaved, hardworking citizen in this design and describes richer personality as a possible extension. [B1]

This is the clearest example of the approach the user does **not** want as Prosper's strategic end state. The developer's own summary calls it a combination of state machines, FIFOs, priority queues, and conditionals that looks alive when run across hundreds of people. Visible busyness therefore cannot establish learned or reasoned strategy. [B1]

**Documented failure: a valid route to the wrong destination.** Choosing destinations by straight-line distance sent citizens to apparently nearby workplaces or supplies across rivers, requiring long trips to bridges. This affected work, food, firewood, schools, markets, and production inputs. Full pathfinding for every candidate was reportedly too expensive: the developer says it would yield single-digit frame rates. Coarse regions plus connectivity and short-lived distance caching supplied better travel estimates; A* on the coarse graph was reported as 60–100 times faster than the fine-grained version for that calculation. This is a developer report, not a controlled whole-game speedup or a prediction for Prosper. [B2]

**Documented failure: local work constraints create delays.** A later patch removed distance/time constraints for laborers because distant jobs waited too long. Other professions retained local preferences unless a job was old and unclaimed, to avoid specialists crossing the map for one item while their actual workplace needed them. This is authored policy repair around a real coordination trade-off, not emergent strategic learning. [B3]

**Evaluation.** Evidence consists of implementation explanations, diagnosed examples, and beta feedback requests, not a formal generalization benchmark. The examples still expose an important causal distinction: poor-looking behavior can come from a bad travel-cost model or job-selection interface, even when the underlying action executor works. [B1–B3]

## 4. Widelands: a production economy coordinated above individual workers

**Production selection.** Official documentation defines production sites through Lua programs whose `main` program repeats. Programs contain ordered calls, sleeps, worker actions, input consumption, and output production. The example `return=skipped unless economy needs snack` gates a recipe using settlement-economy demand. This is an authored program querying an economy service, not a worker discovering demand by trading. [W1, introductory example and `return`]

**Coordination and information.** The inspected `Economy` implementation maintains stock/target quantities and request/supply structures. `needs_ware_or_worker` uses economy-level targets; `process_requests` finds candidate supplies and computes priorities using estimated fulfillment cost; `balance_requestsupply` consumes priority-queue pairs to start transfers, checking that requests/supplies remain valid. The queue has an explicit tie-breaker because system-dependent ties can cause multiplayer desynchronization. This is centralized per-economy logistics over known requests and supplies, not merely independent workers noticing local opportunities. [W2, named functions and `RequestSupplyPair`]

**Prices, jobs, and social goals.** Those source paths show resource demand, worker requests, transfer cost, and allocation priorities. They do **not** show citizens setting prices, retaining trading profits, or selecting social ambitions. A route's `cost` here is not evidence of a monetary quote. This finding is intentionally about the inspected logistics subsystem, not a claim that every Widelands feature lacks trade. [W1–W2]

**Documented failure and evaluation.** The production documentation explicitly says input selection uses a greedy algorithm without backtracking, which may fail even when a valid combination exists. With inputs `a:1,b:1`, consuming `a,b:1 a:1` may fail, whereas ordering the constrained requirement first (`a:1 a,b:1`) succeeds. Authored recipe order is compensating for limited search. The same documentation distinguishes `completed`, `failed`, and `skipped`: skipped production is excluded from productivity statistics. An idle building with demand already met is therefore different from one blocked by missing inputs. No population throughput benchmark was obtained. [W1, `consume` and `return`]

**Prosper relevance, by inference.** This is a strong inspectable baseline for coherent production and accounting, but a misleading template for claiming independent economic intelligence. It also demonstrates that a generic bounded constraint solver could improve an executor without scripting a new strategic response. That would be a mechanics/execution improvement, not proof of strategic planning.

## RimWorld and adjacent comparisons: useful, but lower confidence here

RimWorld's community documentation describes player-authored work priorities: enabled categories, numbered priority 1–4, then left-to-right ordering for ties. Its trade documentation describes prices derived from market value with buying/selling multipliers, difficulty/storyteller settings, and negotiator modifiers. These describe player-directed colony labor and a parameterized trade interface, **not autonomous colonists competing to quote prices in a shared order book**. [R1–R2]

The ThinkTree → JobGiver → job execution account is a plausible implementation lead surfaced in a modder tutorial, but that page could not be fetched during this pass. It is therefore not used here to claim a verified current internal algorithm. No developer-backed learning, planning, performance, or failure-evaluation result was obtained for RimWorld. [R3]

For Oxygen Not Included, the developer interview is valuable context on layered simulation challenges, while community priority documentation describes player-configured task preferences. That is a lead for a later primary-source chore-scheduler investigation, not sufficient evidence for a detailed architecture claim. Stonehearth remains an unresolved lead for actual planning-oriented colony AI; no planning claim is made from its name or reputation. [O1–O2]

## Cross-case implications and unresolved questions

The following are **inferences for research framing**, not implementation recommendations:

1. **Separate action autonomy from strategic authorship.** An NPC can choose actions autonomously while almost all strategic alternatives and preferences remain authored. Sims affordances and Banished needs exemplify this; thousands of social rules do not change that distinction. [S1–S2, B1]
2. **Locate the planner outside the character before crediting the character.** Player priorities, economy-wide matching, and global demand targets can produce coherent settlement output. Independent Prosper citizens operating on personal knowledge have a materially harder information/coordination problem. [D1–D2, W1–W2, R1]
3. **Do not equate job auctions, transfer priorities, or market-value multipliers with price discovery.** None of the inspected strong cases demonstrates citizens learning production specializations and competing through individualized bids/asks. That portion of Prosper still needs separate evidence. [D1, W2, R2]
4. **Distinguish navigation search, executable behavior chains, constraint solving, and strategic planning.** Banished's A* finds routes; its behavior queue executes authored sequences. Widelands exposes a local constraint-selection failure. Neither establishes counterfactual search over alternative careers, investments, trades, or alliances. [B1–B2, W1]
5. **Preserve failure categories.** Unreachable opportunity, misestimated travel time, bad job match, insufficient ingredients, and satisfied demand are different explanations for nonproduction. Comparing learned/planning agents without separating them risks measuring the interface rather than reasoning. [B2–B3, D2, W1]
6. **Believability and capability can conflict.** Sims deliberately permits suboptimal choice; Dwarf Fortress emphasizes narrative and player authority. Those are valid game goals, but neither establishes the adaptive intelligence Prosper now seeks. [S1, D1]

These cases justify diagnostic scripted/centralized baselines and better attribution of outcomes. They do not select between learned policies, model-based search, or language agents. Missing evidence includes actual learned/planning citizen systems in comparable production worlds, matched-information comparisons against authored baselines, long-horizon adaptation after economic shocks, and compute/throughput under multi-agent load. No such experiment was conducted in this research branch.

## Sources and inspection limits

All links accessed or attempted 2026-10-08. Historical descriptions are not asserted to describe every current release. Mutable source/docs are identified as such rather than treated as pinned artifacts.

- **S1 — Don Hopkins, archived 7 November 2006 implementation explanation.** [Developer-maintained archive](https://github.com/SimHacker/WillWrightShowForFood/blob/main/characters/will-wright/sources/2006-11-06-thesims-ai-test/don-reply-to-mats-knutsen.md). Read the full fetched text. The page says it is excerpted and includes editorial summaries; it is not an unedited email or a complete shipped-source audit.
- **S2 — Richard Evans, “Modeling Individual Personalities in The Sims 3,” GDC 2010.** [Official talk abstract](https://www.gdcvault.com/play/1012804/Modeling-Individual-Personalities-in-The). Read the full abstract. Slide PDF retrieval returned 403; no claim to have reviewed the full talk/slides.
- **S3 — Don Hopkins, “The Soul of The Sims, by Will Wright.”** [Prototype provenance](https://donhopkins.com/home/images/Sims/). Read the introductory text; did not interpret the scanned code images. Explicitly a January 1997 prototype, not current game source.
- **D1 — Tarn Adams developer interview, 2019, “Q&A: Dissecting the development of Dwarf Fortress with creator Tarn Adams.”** [Game Developer](https://www.gamedeveloper.com/design/q-a-dissecting-the-development-of-i-dwarf-fortress-i-with-creator-tarn-adams). Retrieved article; inspected passages on autonomy, goal-setting, history, and the main loop. First-person implementation account hosted by a publication.
- **D2 — Bay 12, Dwarf Fortress Talk #22.** [Developer transcript](https://www.bay12games.com/media/df_talk_22_transcript.html). Inspected job-selection, prioritization, and economy passages. Contains future intentions as well as descriptions of then-current behavior; those are separated above.
- **B1 — Luke Hodorowicz, 19 April 2013, “Tech Stuff #2: AI.”** [Shining Rock Software](https://shiningrocksoftware.com/2013-04-19-tech-stuff-2-ai/). Read full fetched article, including pseudocode.
- **B2 — Luke Hodorowicz, 21 November 2013, “More Bugs: Pathfinding Problems.”** [Shining Rock Software](https://shiningrocksoftware.com/2013-11-21-more-bugs-pathfinding-problems/). Read full article text; numerical performance is the developer's report, not independently reproduced.
- **B3 — Luke Hodorowicz, 31 May 2014, “Laborer Update...”** [Shining Rock Software](https://shiningrocksoftware.com/2014-05-31-laborer-update/). Read full article text. Beta-specific behavior.
- **W1 — Widelands official trunk documentation, “Productionsite Programs.”** [Documentation](https://www.widelands.org/documentation/autogen_tribes_productionsite_programs/). Inspected introduction and `return`, `callworker`, `consume`, `produce`, and worker-related sections. Mutable trunk docs.
- **W2 — Widelands source, `src/economy/economy.cc`.** [Source](https://github.com/widelands/widelands/blob/master/src/economy/economy.cc), [raw fetched file](https://raw.githubusercontent.com/widelands/widelands/master/src/economy/economy.cc). Retrieved file; inspected named stock/target, supply/request, queue, and balance functions. Mutable `master`, not a commit-pinned reproduction.
- **R1 — RimWorld community wiki, “Work.”** [Documentation](https://rimworldwiki.com/wiki/Work). Secondary source, not a developer implementation contract.
- **R2 — RimWorld community wiki, “Trade.”** [Documentation](https://www.rimworldwiki.com/wiki/Trade). Inspected trade-price section. Secondary source; no assumption of equilibrium or learned pricing from the term “market value.”
- **R3 — “[Tutorial](Alpha 12d) How to make pawn do job. From ThinkTree to Toil.”** [Ludeon forum](https://ludeon.com/forums/index.php?topic=16405.0). Search lead only; fetch returned 403. Old modder tutorial, not verified current internals.
- **O1 — “Layering challenges in Klei's survival sim Oxygen Not Included.”** [Developer interview](https://www.gamedeveloper.com/design/layering-challenges-in-klei-s-survival-sim-i-oxygen-not-included-i-). Retrieved as a breadth lead; not used to establish citizen scheduler internals.
- **O2 — Oxygen Not Included community wiki, “Priority.”** [Documentation lead](https://oxygennotincluded.wiki.gg/wiki/Priority). Search result only; not promoted into primary findings.
