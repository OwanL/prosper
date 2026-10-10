# Citizen intelligence: working research

Status: Qwen3.5-4B text-only Q4 public live trial ran successfully at the transport/schema level, with three valid commands, but neither short-horizon food objective completed. No resource failure occurred; the earlier 8 GiB host estimate was unnecessarily restrictive. Qwen2B/0.8B remain comparison options. Started 2026-10-08.

## Current direction agreed with the user

This section supersedes earlier suggestions to proceed immediately to a controller shortlist. Broad economic/game research informs the decision problem; the latest implementation-planning direction is recorded below, without claiming an architectural winner.

**Planning checkpoint (2026-10-09):** the user supports composing responsibility-focused decision subtrees, verifying them individually with real-observation-grounded inputs, and progressively composing them for both headless and live execution. Repeated goal selection is allowed; strategies already active in the current ancestor chain are excluded from nested selection. This supersedes a blanket ban on cyclic subtree references. The user also requested stepping and visualization of the tree/subtrees to make execution easy to reason about; the plan proposes distinct structure/execution views and separates decision stepping, world ticks and trace playback. The user subsequently narrowed current planning to `ObtainFood` only and rejected the overall-controller sketch; other trees may be referenced as prerequisites but are not being designed now. See the [composed decision-tree plan](research/decision-tree/plan.md) for recorded decisions, proposed phases and open questions. This request authorizes documenting the plan, not controller implementation or experiments.

**Earlier bounded authorization (2026-10-08):** the user directed proceeding with the discussed bounded tokenizer work, smaller local-model path and evaluator-owned capability fixtures without another approval request. This supersedes the earlier approval checkpoints below for those scopes only. It does not permit bypassing resource gates, package/config/shared-contract changes, accessing durable worlds, stopping unrelated applications or using cloud/shared inference. Exact counts and live results still require eligible execution, not just implementation.

- **Start small, eventually:** the user supports headless, near-instant fixtures with clear beneficial choices before introducing ambiguity, delayed consequences and changing conditions. Exact tests and approaches must be decided before implementing them; the discussion is not blanket authorization to run experiments.
- **Define the path to a good action:** represent personal observations/beliefs and preferences; consider feasible alternatives; predict or estimate consequences; rank and commit; learn from outcomes. This is a functional decomposition, not a required module hierarchy. A chess-engine-like combination of fast estimates and selective search is a useful analogy, not permission to assume exhaustive search is practical.
- **Keep the candidate space broad:** direct policies, learned values, predictive/world models, universal classifiers, LLMs, search, skill retrieval, and traditional execution rules/state machines. A modern/traditional hybrid is the user's leading hypothesis, not an established winner. Execution machinery must not silently contain the strategic answers being tested.
- **Personality is part of the decision problem:** distinguish preferences, risk/time attitudes and decision tendencies from beliefs acquired through experience. Different citizens can rationally choose differently. Do not implement personality as assigned professions or unexplained randomness. Whether preferences are explicit utility parameters, language descriptions or learned conditioning remains open.
- **Local inference is required:** an API-only model may inform research but cannot be an implementation candidate. Separate download/license/runtime feasibility, resident memory, local decision latency/throughput, and acquisition/fine-tuning cost. No hardware performance has yet been measured for the new candidates.
- **Terminology correction:** the user meant Jev by TypeSafe and Laya-style universal classifiers, not JEPA. JEPA was an assistant misunderstanding and is not the subject of the requested classifier investigation.

### Rough design: hierarchical rules plus model-assisted decisions (2026-10-08)

Historical proposal: the [2026-10-09 implementation plan](research/decision-tree/plan.md) updates the composition, testing and cycle-handling direction. The earlier discussion below remains context, not a frozen API or an implementation authorization.

The user's working proposal is one large logical decision tree, implemented as composed classes/components with reusable subtrees rather than one monolithic branch structure. Each decision node can use the right tool: programmatic rules, utility calculations, traditional task-specific ML, universal classifiers or a small local LLM. Known, cheaply computable relationships belong in code; learned predictors can estimate relationships such as yield, travel time, risk or trade success. Mostly deterministic decisions do not automatically require ML. This is a design hypothesis, not a selected winner, production change or authorization to implement/run experiments.

**Example flow:** “Am I in mortal danger?” → programmatic **yes / no / maybe** assessment from forecast food consumption, health, attacks and other known conditions → identify the cause → for hunger, select a feasible remedy such as buying food, finding/gathering food or obtaining accessible loot. Multiple dangers need explicit prioritization by urgency and severity; uncertain forecasts remain estimates rather than guaranteed facts. A model is most useful at an ambiguous strategy-selection node, not for arithmetic or enforcing command legality.

#### Composition and execution

```text
CitizenController
├── HandleImmediateDanger
│   ├── HandleCombat
│   └── HandleCriticalHunger ── references ObtainFood
├── MaintainFoodReserve ─────── references ObtainFood
└── PursueOrdinaryGoals

ObtainFood
├── Assess known sources and feasible alternatives
├── Choose strategy: rules / classifier / small local LLM
└── Execute chosen subtree: buy / gather / accessible loot / other means
```

Prefer composition over a deep inheritance hierarchy. Shared subtree definitions avoid duplicating travel, acquisition and recovery logic; each invocation/citizen has separate execution state. A component reports **running / succeeded / failed**, with explicit entry, completion and interruption conditions. These are behaviour-tree or hierarchical-state-machine semantics, regardless of whether ordinary classes implement them. The illustrative branches/options are authored assistance, not strategies discovered by the model.

A rough control cycle is:

1. **Assess:** compute hunger deadlines, travel/work estimates, affordability and known availability programmatically, using only the citizen's permitted observations and beliefs.
2. **Prioritize:** handle imminent danger, otherwise continue a viable commitment or select a new goal. Personality/preferences can affect trade-offs; their representation remains open.
3. **Select:** reject demonstrably impossible actions, then choose among plausible strategies. Supply numerical consequences and uncertainty to the classifier/LLM; do not treat its classification probability as utility.
4. **Execute:** deterministic substeps dispatch actual validated primitives and monitor confirmed outcomes. No teleporting, guaranteed fills or bypassing physical mechanics.
5. **Reconsider:** at meaningful changes, safe boundaries, lack of progress or higher-priority danger, revise or interrupt the plan. Do not restart selection or replace an unfinished movement every tick.

#### State and memory

Separate **goals, intentions/plans and actions**:

| Level | Example | Lifetime |
| --- | --- | --- |
| Goal | Maintain a food reserve | Long-lived or recurring |
| Intention/plan | Obtain food by buying at market A | Until completed, abandoned or replaced |
| Action | Travel to market A | Until physical completion or failure |

An action failure need not invalidate its plan; a plan failure need not invalidate its goal. An unavailable market calls for reconsidering the means, not forgetting the food need. Durable intentions live outside individual tree branches in explicit per-citizen records. Code owns **goal and rationale, success condition, priority/urgency, strategy, target, phase, deadlines, last confirmed action/result and progress**. Nodes advance that record rather than maintain competing hidden goal state; models receive relevant context and make bounded recommendations, not remember or sustain the commitment themselves.

The goal manager has explicit transitions: **continue** while viable and progressing; **repair** the target/strategy while retaining the goal; **suspend** for a higher-priority interruption and revalidate before resuming; **complete** on confirmed satisfaction; **abandon** when no longer worthwhile or applicable. Reconsider remaining costs, urgency and alternatives, not sunk costs. For example: `goal=obtain-food; strategy=buy; target=market-A; phase=travelling`. Stock loss, changed affordability, stalled progress or a new danger may trigger reconsideration, rather than restarting every tick.

Keep commitments/progress distinct from personal beliefs and learned estimates, bounded recent outcomes/failed attempts, and standing preferences/policies. “Market A was empty yesterday” is dated evidence, not a permanent ban. Cached model choices need explicit invalidation conditions. Reusing a component must not share mutable citizen state; persistent state is serializable data, not live class instances, promises or timers. Interruption must preserve/cancel actual work and reservations through ordinary engine semantics. Memory supports commitment and recovery; learning separately requires demonstrated updates to predictions or choices from outcomes, not simply accumulated prose.

#### Worked decision boundary: market actions

The user highlighted markets as a natural handoff: the tree identifies a goal such as obtaining food before reserves run out, while a model-assisted component judges whether a price is worth paying, whether to place a resting buy order, or whether to pursue another source. The tree need not encode every pricing situation. This remains within the same composed controller, not a separate model that owns its goals.

- **Code supplies facts and constraints:** available cash, protected funds, quantities, personally known offers, current commitments, the hunger deadline and computed travel/work estimates. Offers can become stale; dispatch validates actual affordability, stock and ordinary settlement conditions.
- **The decision component compares:** buy now, place a bid and wait, acquire food elsewhere, or repair the strategy. A price is worth paying relative to urgency, preferences and opportunity cost, not simply because it is below a historical average. An attractive price and an acceptable waiting time are separate questions.
- **Traditional ML can predict:** fill probability or waiting time from observed evidence. Code can compare resulting consequences; a classifier or small LLM can handle less structured trade-offs. Predictions need uncertainty and validation, not assumed reliability.
- **Code executes and owns the lifecycle:** validate/dispatch the choice, track actual fills, funding reservations and remaining demand, then revise or cancel through ordinary mechanics. A cheap bid that never fills cannot remedy imminent starvation; an unfilled order alone does not establish a failed plan.

Illustrative persistent intention: “Seek two food units through a resting bid, preserving protected funds. Reconsider buying immediately or switching sources as the deadline approaches.” Partial fills update remaining need; they do not erase the goal or justify duplicating the full order. Suspend/resume must account for still-live orders and reserved funds. Neither the forecast nor the intention guarantees a fill. The model advises a commitment; the controller maintains and revalidates it.

#### Context and evaluation boundaries

Keep exact numbers **and** programmatically derived meaning, rather than replacing numbers with vague prose. Example: “Food lasts about 12 ticks; gathering takes at least 18 and cannot meet the deadline; buying is estimated to take 4 ticks and is affordable.” The model selects a strategy from supplied consequences instead of doing the arithmetic. These figures are illustrative, not Prosper measurements. Verify that required state/feedback actually reaches each node within its context budget.

A proposed first slice is one complete hunger workflow, including travel, unavailable food, failed acquisition and danger interruption. Compare rules-only selection with classifier-assisted and small-LLM-assisted selection under matched information, alternatives, authority and suitable multi-step horizons. Record model calls, transitions, interruptions, execution failures and task outcomes. This measures the value added by the model **inside an authored controller**, not independent strategic discovery; successful formatting alone is insufficient. The recent three-call primitive probe established integration but had overly short capability horizons and dropped feedback history, so it cannot settle this design question.

### Evidence-led alternatives: modern ML and game AI (2026-10-09)

The user requested concrete research alternatives after finding a heuristic shortlist plus universal classifier unconvincing. Neither that design nor the authored hierarchical tree is selected. The subsequent discussion also considered chess-like selective lookahead; candidate nomination, learned value and actual search are distinct mechanisms, not interchangeable labels.

[Modern ML/game-AI follow-up](research/modern-ml-game-ai-2026-10-09.md) inspects six primary systems, including a revisit of DreamerV3 from the first literature pass:

- **GLIDER (ICML 2025):** learns textual subgoals and their primitive execution through supervised initialization and offline hierarchical RL, rather than authoring each strategic branch. Its same-backbone 8B ScienceWorld hierarchy ablation improves unseen score from 53.94 to 68.34. Temporal termination/interrupt semantics and desktop compute remain insufficiently established.
- **MAV (ICML 2025):** domain-trained language-model transition/legality/action-value predictions guide explicit MCTS. Search improves strength, but even 100 simulations average about 40 seconds, and training uses billions of engine-labelled positions. This is not evidence that a generic local chat model can cheaply rank market futures.
- **DreamerV3 (Nature 2025):** learns recurrent dynamics and trains actor/critic behaviour on imagined futures; live actions require no online lookahead. Separate agents are trained across tasks. Minecraft training took about nine days on one A100 and up to 100 million interactions; small policy inference does not imply cheap acquisition.
- **SIMA 2 (2025 technical report):** trains embodied execution from demonstrations and composes it with slower Gemini Pro deliberation and recurrent summaries. Base Gemini without action training scores only 3.2%/7.0% in its programmatic evaluations. Self-generated practice/task-setting is separate from ordinary live play; its hierarchical demonstration is not proof of autonomous citizen economics or local eligibility.
- **Odysseus (May 2026 preprint):** a Qwen3-VL-8B actor trained through game interaction and a lightweight turn-level critic greatly improves over its base and SFT-only variants. Training-level progress gains, held-out transfer and persistent goal memory are different claims; tens of millions of samples and local compute uncertainty remain material.
- **HiAgent (ACL 2025):** retains detailed active-subgoal history, summarizes completed subgoals and retrieves archived details. Average success improves 21% to 42% in five finite tasks, using GPT-4 Turbo and a 30-step cap. This supports memory-aware decomposition, not indefinite learning or lossless summarization.

The meaningful research comparisons are **learned subgoal execution**, **learned consequences/value with decision-time search**, and **anticipation trained into a cheap recurrent policy**. These are proposed translations, not architecture selection or authorized experiments. Persistent commitments and memory can be tested across them. All need explicit supplied-versus-learned boundaries, real outcome/feedback evidence, suitable horizons, and separate training/transfer/inference costs. None of the reviewed systems establishes independent private-information market competence in Prosper.

### Local typed-decision/classifier evidence (2026-10-08)

| Candidate | Evidence inspected | Current disposition |
| --- | --- | --- |
| TypeSafe Jev | [Official models documentation](https://docs.typesafe.ai/models) documents hosted inference; no official local weights/runtime found | Not locally eligible on current evidence; do not claim private self-hosting is impossible |
| Laya | [Upstream runtime](https://github.com/NandhaKishorM/laya), [model card](https://huggingface.co/convaiinnovations/laya): Apache-2.0, 322M/421M checkpoints, typed choice/score/yes-no outputs, Windows and CPU/CUDA instructions | Primary lightweight feasibility candidate |
| imajev | [4B model card](https://huggingface.co/mohit67890/imajev-4b), [runtime](https://github.com/mohit67890/imajev): Apache-2.0 Qwen3.5 adapters plus decision readout, 2B/4B/9B family, local PyTorch/MLX | Larger candidate; base weights must be included in memory/download accounting |
| GLiClass | [Upstream](https://github.com/Knowledgator/GLiClass): local zero-shot classification over supplied labels | Simpler classification comparator; exact checkpoint/license/runtime to verify |
| Kepler 1.2 | [Project](https://www.kyroslabs.tech/) describes local Laya fine-tuning, but inspected [model card](https://huggingface.co/MAKALY/kepler-1.2) is sparse | Lower priority; insufficient evidence to prefer over Laya |

Laya's published T4 timings are 39.5 ms English / 32.8 ms multilingual for one question, and 158.6 / 72.3 ms for ten batched questions. These are project measurements, not our hardware or citizen workload. Its English checkpoint has a 512-token budget including question/options; other checkpoints have larger limits. Its reported typed-decision accuracy changes from 36.2% base English to 76.6% workflow-fine-tuned. These figures establish neither economic reasoning nor reliable calibration on Prosper. Typed outputs prevent malformed prose, not wrong decisions. Classification probability is not expected utility.

Potential diagnostic separation, not an approved experiment plan: (1) choose from raw circumstances, (2) rank the same choices with consequences supplied, (3) reverse an opportunity or preference and check whether the choice appropriately changes. This separates consequence reasoning from preference-sensitive ranking. Supplied candidate lists and consequences must be labelled assistance, not credited as discovered strategy.

### Completed local hardware investigation

[Local classifier hardware fit](research/local-classifier-hardware-fit.md) records read-only hardware/runtime measurements, pinned artifacts, licenses and proposed later smoke tests. Actual hardware: RTX 3070 Ti Laptop with 8 GiB VRAM, Ryzen 6900HX, 15.26 GiB usable physical RAM. At inspection only 467 MiB VRAM and about 1.20 GiB RAM were free; these are transient headroom measurements, not total capacity. No concurrent model load is recommended under that pressure.

**Revised shortlist:** GLiClass edge and one Laya checkpoint are plausible Windows candidates; imajev-2B fits an otherwise available GPU on paper (about 4.30 GiB weights; 5.5–7 GiB planning budget). imajev-4B does not fit its stock GPU configuration: approximately 9.14 GiB weights before activations. Its stock FP32 CPU weights also exceed physical RAM. Quantization/offload is separate, unverified engineering, not assumed support. Existing Ollama Qwen does not implement imajev's custom decision head/runtime. Laya's checkpoint file size is not resident memory: stock FP32 weights are about 1.57 GiB for the English model.

Python 3.12.14 and uv already exist, but the inspected interpreter lacks the required ML packages. The report flags driver/wheel compatibility and shell PATH discrepancies without changing either. No installation, weight download, inference, service startup, production change or durable-data access occurred. Compatibility and memory estimates are not locally verified inference. The investigation is complete; its session is closed after integration.

### Authorized local feasibility experiment: actual results

The user subsequently authorized dependency/model downloads and local inference after stopping Prosper and unloading its model. [Experiment report](research/local-classifier-feasibility.md): GLiClass edge v3 and Laya typed-decisions both ran on the laptop's CUDA GPU using PyTorch 2.7.1+cu126, with actual parameter devices verified and no CPU fallback. No production integration or machine configuration changes were made; inference processes exited.

| Candidate | Correct synthetic cases | Warm in-process end-to-end p50 / p95 |
| --- | --- | --- |
| GLiClass edge v3 | 12/16 | 13.01 / 16.72 ms |
| Laya typed-decisions | 7/16 | 36.67 / 46.78 ms |

Each case was repeated five times (80 timed calls/model), with two prior warmups and CUDA synchronization. The 16 cases include four reordered duplicates; this is not 16 independent samples or a general capability ranking. Inputs were short (79–173 formatted tokens), with two supplied alternatives, and included arithmetic, sequential liquidity, survival deadlines, explicit consequences, preference reversals and negation. No candidate discovery was tested. Laya still failed some choices with inferior consequences explicitly supplied; GLiClass failed both opposing ally-preference cases and a guaranteed-minimum risk objective. Fast inference is established; dependable economic judgment is not. Report contains exact prompts, expected answers, raw-output locations, pins, load times, memory and timing boundaries.

[imajev-2B attempt](research/imajev-2b-feasibility.md) stopped at the resource gate: available RAM was approximately 3.29–3.46 GiB, below its estimated 4.296 GiB weight floor. No imajev setup/download/load/inference occurred. This is a conservative safe-loading decision, not proof that every alternative loading implementation is impossible. Its latency and quality remain unknown. No unrelated applications were killed to force the experiment through.

Temporary isolated environments and raw evidence are retained at report-listed OS-temp paths for reproducibility. No paid APIs, driver upgrades, global installation, services left running or direct durable-world access occurred. These feasibility probes do not select an architecture or authorize production integration.

### Brainstorming checkpoint: alternatives, preferences and experience

Three read-only subagent critiques sharpened the hypotheses without choosing an architecture:

- **Generating alternatives:** forward search composes legal actions but can prune costly investment prefixes; backward prerequisite construction finds means toward desired outcomes but can omit useful opportunities outside the immediate goal. Neither should encode professions. Candidate discovery must be scored separately from ranking supplied plans.
- **Personality-sensitive evaluation:** compare explicit multiattribute preferences/constraints with preference-conditioned learned ranking. Keep predicted consequences fixed when testing preference effects. Distinguish risk from expected loss, time spent from delayed rewards, and preference change from changed beliefs. Dominant opportunities should sometimes make different personalities converge.
- **Fast/slow allocation:** compare evidence-and-stakes admission with rotating deliberation audits, not only confidence gating. A confidently wrong classifier can miss vanished demand; error-triggered reconsideration alone can miss silent improvement elsewhere. Exploration must be a costed alternative.
- **Learning:** private predictors and conditional skill memory can differentiate citizens using shared frozen weights. Distillation copies a teacher, not necessarily competent behavior; retain actual outcomes separately. Shared weight updates may leak private discoveries and require an explicit information policy. Skills can remain executable while becoming economically obsolete.
- **Commitment:** reassess remaining costs and benefits at safe boundaries and consequential changes, rather than thrashing every tick or treating sunk expenditure as a reason to continue.

Three competing hypotheses remain: direct intuition from circumstances/preferences/memory; construct alternatives then predict/evaluate; deliberate on unfamiliar choices then reuse grounded experience. Proposed next design artifact is one worked decision traced through all three, exposing candidate generation, forecasting, ranking, execution and learning. These are conceptual proposals, not authorized implementation or experiments.

## Updated direction: actual-world headless evaluation

The user rejected a separate toy economy and requested faster configurable headless execution and observability of Prosper's actual world. They explicitly selected **direct primitive control** rather than policy revision over the existing controller. The [revised harness contract](research/decision-harness-contract.md) supersedes the earlier tiny-world draft and the historical checkpoint below wherever inconsistent.

The engine already supports synchronous headless construction/ticks. Initial work should add a reusable configured runner, selected-actor controller isolation, validated scenario preparation and incremental traces rather than duplicate mechanics. Preserve actual observations/knowledge gates, market settlement, physical work, automatic eating and starvation. There is no eat command. `autonomy:false` alone does not remove emergency gathering; evaluated actors need explicit suppression of competing strategic controllers. Initial inference scheduling pauses simulation at decision boundaries, with real latency measured separately. Refresh knowledge after each committed command and individual tick. Do not use spectator state as candidate input or bounded event rings as complete history.

### Implemented first slice (2026-10-08)

Three parallel implementation sessions delivered opt-in engine authority, the real-world runner and candidate adapters. [Usage and limitations](research/evaluation-harness-usage.md) documents the runnable CLI (`scripts/evaluate.ts`) and programmatic interfaces. Direct/passive-body authority suppresses competing strategy while preserving physical mechanics and normal defaults. Validated endowments and actual funded setup commands create two development fixture families: buy/automatic-meal and sell/buy/automatic-meal.

The runner advances actual ticks with knowledge updates, checks citizen commands, records privileged bounded traces separately from actor feedback, checks gold and replays initialized state/commands against boundary hashes and final report. It compares a no-command adapter with explicitly authored reference trajectories. References prove the fixture opportunity, not intelligent strategy discovery. That first phase supplied strict real commands, lifecycle/reset, frozen mechanics context and injected mock-only local-model transport, but no actual HTTP model transport, trained learner or generic planner. The later local-transport work is recorded below.

Integration reviews corrected episode-budget exhaustion incorrectly advancing simulation, incomplete replay evidence acceptance, and missing raw-response audits. Raw replies are bounded audit-only evidence; normalized parse errors do not echo response fragments into later prompts. Parent verification passed typecheck and 112 focused engine/candidate/runner tests after integration (12/76/24). No live inference, services, package/driver changes or durable-world access occurred in this implementation phase.

Limits remain explicit: trusted cooperative in-process execution is not hard CPU/memory containment; arbitrary live candidates remain rejected. The subsequently authorized task-owned local development path is described below. Event coverage is bounded-ring, not an exhaustive emission ledger. CLI temporary traces are cleaned; API callers own their temporary artifacts. Held-out capability cases have not been selected/evaluated. No full-world optimality, learned competence or production readiness claim follows from conformance traces.

### Installed-local primitive transport and blocked measurement (2026-10-08)

**Question:** Can an already-installed local model choose actual primitives in the completed paused harness, rather than revise policy over a supplied strategist?

Only `qwen3.5:9b` was installed in Ollama as a local generative model; the other catalog entries were cloud aliases. Read-only `/api/show` metadata identified 9.7B Q4_K_M GGUF, `qwen35` architecture and byte-based GPT2 tokenizer. The previously retained classifiers can rank supplied alternatives but are not drop-in arbitrary primitive generators. No new model/runtime/package was acquired.

Added the actual audited loopback `OllamaTransport`, narrow implementation-identity runner admission and a task-owned Windows Ollama service lifecycle. Transport verifies exact installed digest/size/GGUF/tokenizer before generation, disables cloud/thinking/streaming, bounds input/context/output, checks receipts, and supplies no retry, command repair or prerequisite strategy. HTTP abort alone never establishes stopped inference: the underlying operation remains pending until owned process shutdown is confirmed. Unconfirmed shutdown stops incomplete and forbids reuse. Startup-failure review found and corrected lost service ownership/log cleanup and inspection preventing an owned kill attempt; mock regressions cover both. Resource monitoring/tree shutdown are cooperative safeguards, **not hard CPU/memory containment or an adversarial sandbox**. Actual Windows service execution remains unverified because preflight stopped before startup.

A mock-only request-size probe on the real `sell-buy-meal` observation measured **49,048 bytes** for the first messages-plus-schema request and **69,933 bytes** on the second with default full feedback history. These are bytes, not tokens. The declared development configuration instead uses one 1,024-byte history entry, records omissions and preserves the entire current observation. Conservative byte-based input reservation plus formatting/template overhead requires a **65,536-token context**, rather than pretending a typical bytes/token ratio is a guaranteed bound. The installed model's eight attention layers, four KV heads and 256-dimensional K/V give approximately **2 GiB FP16 KV** at this context, before 6.6 GB weights and other runtime allocation. These are planning estimates, not measured resident peaks.

**Bounded probe:** `npm.cmd exec -- tsx scripts/evaluate-local.ts --confirm-local`, two existing development fixtures, same worlds as no-command/reference, at most three calls, 60,000 input + 256 output reserved tokens/call, 90-second decisions, 120-second episodes, five-minute overall envelope and separate 10-second teardown. Admission requires 6 GiB free RAM and 7 GiB free VRAM; sampled emergency headroom stops are also declared. No hard OS allocation/CPU ceiling is claimed. Unique OS-temp artifacts are cleaned on confirmed ordinary teardown; unresolved owned teardown must be reported rather than concealed by deleting its logs.

**Actual preflight result:** free RAM **1,948,725,248 bytes (1.81 GiB)**, below the **6 GiB** planning gate. Free VRAM **7,721,713,664 bytes (7.19 GiB)** of 8 GiB passed its 7 GiB gate. The run was **blocked before service startup, model loading or generation**. Actual candidate decisions, inference latency, generated tokens and objective outcomes therefore remain **unmeasured**, not zero-performance scores. Generation calls were zero. No failed gate was bypassed, and no unrelated application was stopped to manufacture headroom.

An offline rerun independently confirmed the paired comparator outcomes:

| Development fixture | No-command fullness / success | Privileged reference fullness / success |
| --- | --- | --- |
| Buy / automatic meal, one tick | 79.9 / false | 91.01111111111112 / true |
| Sell / buy / automatic meal, two ticks | 79.80000000000001 / false | 90.91111111111113 / true |

Health remained 100; reference cash ended at zero, and no-command cash at 4/0 respectively. All four episodes passed gold accounting and exact replay. These are authored conformance opportunities and supplied reference actions, **not Qwen evidence**. No held-out fixture was selected or used for candidate/prompt construction or evaluation; sealed evaluation remains separate future work. Mock protocol/admission tests establish integration, not intelligence, generalization or natural-history emergence.

Final verification passed typecheck, production build and 169 focused engine/runner/candidate/transport/service tests across seven files. Those tests use mock HTTP/processes and do not establish actual service or model performance. Read-only acceptance review found no remaining supported issue after the startup fixes.

Next measurement requires a fresh passing resource preflight. A genuinely smaller primitive-generating artifact would require separately authorized acquisition, or exact tokenizer/context work would require a separately scoped implementation decision; neither was silently substituted. No services were started/left running, no experiment artifacts were retained, and neither durable Prosper directory was accessed. See [harness usage](research/evaluation-harness-usage.md) for the reproducible gate and limitations.

### Current small-model options: Qwen comparison (2026-10-08)

The user requested reconsidering newer small models, particularly Qwen, and removing the previous alternative from this working document. This shortlist supersedes the earlier small-model test order. It is a proposed comparison, not a measured quality ranking or a replacement for installed `qwen3.5:9b`.

Qwen released the **Qwen3.5-0.8B, 2B, 4B and 9B** small series on **2026-03-02**, according to the [official release history](https://github.com/QwenLM/Qwen3.5). All use Apache-2.0 licensing and advertise **262,144 native context tokens**. Advertised capacity is not a recommended allocation or proof of GPU fit; measure complete prompts and reserve only a supported covering context without truncation.

| Candidate | Proposed role and rationale | Limits and eligibility checks |
| --- | --- | --- |
| [Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B) | First quality-oriented challenger to the installed 9B. Hybrid layout has eight full-attention and 24 Gated DeltaNet layers. Previously researched text-only Q6_K artifact is about 3.526 GB; publisher BFCL-v4 / TAU2 scores are 50.3 / 79.9. | Disable thinking explicitly; do not download a vision projector for this text task. Pin and verify the exact artifact/template/runtime before loading. Quantized GPU residency, cold host peak and local latency remain unmeasured. |
| [Qwen3.5-2B](https://huggingface.co/Qwen/Qwen3.5-2B) | Second, smaller-footprint comparator. Six full-attention and 18 Gated DeltaNet layers; defaults to non-thinking. Publisher BFCL-v4 / TAU2 scores are 43.6 / 48.8, supporting investigation beyond a syntax-only smoke test. | Exact quantized artifact and resource envelope are not yet selected. Publisher positions it for prototyping/fine-tuning/research and warns of thinking loops; keep thinking off and retain bounded cancellation. |
| [Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B) | Optional speed/footprint baseline, not the leading planning candidate. Defaults to non-thinking. Publisher BFCL-v4 / TAU2 scores are 25.3 / 11.6, substantially below the 2B sibling in the same table. | Intended for prototyping/fine-tuning/research; thinking-loop warning also applies. Exact artifact, memory fit, latency and Prosper behavior remain unverified. |

These publisher agent scores are reported in thinking-mode tables, not our non-thinking, grammar-constrained **256-output-token primitive lane**. Evaluation settings and quantization differ; they do not establish production/trade prerequisite discovery, reliable termination or generalization in Prosper. Release recency and consumer-GPU reputation justify considering candidates, not selecting a winner.

The newer **Qwen3.6 and Qwen3.8** release entries inspected list no model below 9B total parameters: the smallest listed is 27B. The Qwen3.6 35B-A3B option activates about 3B parameters per token but still requires storing the larger total weights; it is not a 3B memory substitute. These are outside the current compact shortlist, not evidence that future smaller releases are impossible.

**Proposed order:** Qwen3.5-4B, then 2B, with 0.8B only as an optional baseline. Subsequent user authorization requested preparing the 4B download/tests while another session handled RAM cleanup. The [prepared Qwen4B public probe](research/qwen4b-local-probe.md) now uses official Ollama text-only **Q4_K_M**, not the previously researched Q6_K artifact. Weights and native renderer/config identity have been verified locally, and the subsequently authorized three-generation public trial is recorded below. The live default remains 9B. Preserve complete public inputs and bounded calls/output/seeds/stopping conditions. Exact rendering/token counts and actual resource peaks remain separate measurements; smaller weights alone do not establish safe host loading.

### Offline prompt representation audit (2026-10-08)

The [context audit](research/primitive-context-audit.md) measured genuine adapter requests through mock transport: 47,380 bytes initially and 64,929 with default committed history in its declared two-tick no-command development setup. These are different probe inputs from the earlier size measurement, not evidence of a production optimization. JSON is already compact. The installed probe's 1,024-byte history cap drops the entire feedback entry, yielding 47,382 bytes on the second request: explicit loss of past evidence, not lossless compression.

The manual repeats the command schema also supplied as native output `format`; removing the manual copy would save 7,000 serialized bytes before replacement prose. However, a grammar/API schema is not established as model-readable instructions, so removal is not a proven information-preserving change. A clearer potential lossless encoding references identical observations retained in the same request, with exact reconstruction of every field and intermediate tick. Neither change was implemented. Exact tokenizer/template measurements, model usability and RAM fit remain unknown; no token reservation or resource gate was lowered.

### Longer real-engine development trajectory (2026-10-08)

The [production/trade probe](research/production-trade-probe.md) adds one explicitly privileged, authored development reference without changing shared mechanics or candidate adapters. Across 320 actual ticks, it travels 22 steps in 44 ticks to a selected generated wood deposit, completes 40 ticks of barehanded harvesting, sells the earned unit for 16 gold into a finite funded bid, buys four food for 16, and receives four automatic meals. Final health/fullness are 100/92.4444; all commands pass validation, total gold remains 16 at every retained boundary, and exact replay succeeds.

The same-world no-command actor ends at health/fullness 100/48, below the fullness objective but not starving or dead. A no-command control endowed with four food reaches the reference's identical final vitals without production or trade. This demonstrates why vital success alone is insufficient: the manifest scores vitals only, while dedicated conformance assertions separately verify actual work and settlement. The generous wood bid and counterpart endowments are authored opportunities, not naturally emerging economics. One selected seed/site and a scripted answer establish feasibility, not intelligence, generalization or optimality. No candidate inference or held-out evaluation occurred.

### Approved implementation progression, verification blocked (2026-10-08)

The user's authorization produced three bounded additions, without selecting a citizen architecture:

- [Vocabulary-only tokenizer probe](research/primitive-tokenizer-probe.md): pinned CPU tokenizer acquisition, source-backed Qwen rendering, complete default-history request capture and sampled child monitoring. Its native Node preflight actually ran and blocked at **14,594,048 free RAM bytes**, before acquisition or vocabulary loading. Installed small-file identity checks passed; full GGUF digest, executable behavior, token counts and measured Ollama equivalence remain unverified. The sizing gate is **2 GiB**, independent of inference admission. Source compatibility is not an exact installed-runtime token count or permission to shrink context.
- Earlier alternate-model probe scaffolding remains in the repository but is not the current candidate plan. The Qwen4B/2B/0.8B challengers above still need artifact-specific integration and resource review; no prior alternate-model envelope should be reused as their admission evidence. Installed Qwen9B's **6 GiB RAM / 7 GiB VRAM** gates are unchanged. Retain full declared history, bounded call/time budgets, raw replies and failed trajectories. No challenger weights, import, service or generation was attempted; this document update changes no implementation.
- Two evaluator-private, fixed real-engine capability fixtures with outcome-only public objectives, production/delivery attribution and separate automatic-meal/market controls. Definitions, reference proofs and traces are withheld from candidate builders. Review corrections bind the initialized world/setup/authority to the canonical manifest and reject relabelled terminal failures. Private feasibility tests and regressions are **authored, not executed evidence**; no held-out candidate result exists.

New focused tests, integrated typechecking and actual import/tokenizer execution remain **unverified**. RAM continued falling to **2,551,808 bytes** in the final parent check, so no test runner, build or live trial was launched. Do not reuse the earlier passing test totals as verification of these additions. No unrelated application was stopped, resource gate lowered, package/config/shared contract edited, cloud inference used or durable world accessed. Task-created work sessions were closed after handoff; no task-owned model service was started.

This was the initial implementation checkpoint; the preparation/verification update below supersedes its outstanding focused-test status, not its evidence limits. Authored fixture feasibility, mocks and model scouting still do not establish intelligence, learning or generalization.

### Qwen4B download and test readiness (2026-10-08)

Initial preparation checkpoint, before the live authorization recorded below.

The [Qwen4B probe report](research/qwen4b-local-probe.md) records the exact artifact, retained OS-temp directory, commands and admission plan. The official text-only Q4_K_M weights (**2,648,593,216 bytes**) and all pinned small blobs passed full SHA-256/length checks; bounded GGUF metadata verification passed. The vision projector was not downloaded, and the shared Ollama store and normal 9B default are unchanged.

The separate runner is offline by default, has an explicit preparation-only mode and consumes the verified reusable private store for confirmed runs. Two public development probes have fixed one-plus-two call allowances, full declared history, thinking disabled, one five-minute service/generation deadline and failure evidence retained before replay. Its source-based 96K planning envelope requires **8 GiB free RAM / 7.25 GiB free VRAM**; these are not measured peaks or hard containment. Prior 9B gates are unchanged.

Focused offline checks passed: **151 tests** covering Qwen preparation, transport, resources, lifecycle and tokenizer, plus integrated typechecking. Evaluator-private suite verification separately passed **13 offline tests**, without exposing its solutions to candidate builders. No test total is a model intelligence result. Preparation caught and fixed exact trailing-newline metadata bytes; reviews/tests also corrected private-store startup layout, Windows canonical-path aliases and confirmed-startup log retention.

No service, weight loading or inference was started. Final free RAM was **3,983,728,640 bytes** (about 3.71 GiB), below 8 GiB, while **8,018 MiB free VRAM** passed GPU admission. The next execution is the bounded public live trial after fresh host/GPU admission; exact token counts, live compatibility, latency and decision quality remain unmeasured. The retained model is ready for that trial, not a replacement for the production controller.

### Authorized Qwen4B live trial (2026-10-08)

The user explicitly requested proceeding despite the unmeasured host planning estimate. Only the 4B admission estimate changed to **2 GiB free host RAM**; 7.25 GiB VRAM admission, 1 GiB RAM/128 MiB VRAM stop floors, model identity checks, call/context/deadline bounds and owned cleanup remain. The 9B default and its gates are unchanged.

Actual installed Ollama is now **0.40.1**, pinned for this lane. Before generation, real integration corrected transient startup readiness handling, exact float32 API representation, installed size including config bytes and retained replay-directory naming. Setup failures/metadata-only diagnostics remain separately audited and produced no model outputs.

The final bounded trial made exactly **three generation requests**, without output retries or fallback. Buy-meal: one valid move, 10,999 input/55 output tokens, 11.08 seconds candidate time, goal not completed in one tick. Sell-buy-meal: two valid moves, 29,096 input/124 output tokens total, 25.18 seconds candidate time, goal not completed in two ticks. Both trajectories replayed; all commands passed schema/dispatch and accounting. These outcomes do not establish general intelligence or inability to succeed with longer horizons.

The model really did run in VRAM: **33/33 layers offloaded**, 96K context retained, logged CUDA allocations about 2,515 MiB weights + 3,072 MiB KV + 50 MiB recurrent state + 160 MiB compute. CUDA-host model/compute buffers were about 497/106 MiB. Load-time free host RAM was about 2.9–3.0 GiB. No resource stop or allocation failure occurred, so the old 8 GiB heuristic was not a demonstrated requirement. Full peak residency was not instrumented.

Limitation: the 32 KB feedback-history cap dropped the previous full entry, leaving **zero history entries** in the two-call probe. Current inputs were complete, but history/learning capability was not tested. Review that sizing before broader capability testing; do not tune against observed authored trajectories. Latest focused regression tests and integrated typecheck pass.

Evidence and limitations: [Qwen4B live probe report](research/qwen4b-local-probe.md), retained run `C:/Users/OwanLazic/AppData/Local/Temp/prosper-qwen4b-evidence-E454DT`. Owned services/runners were confirmed stopped, and pre-existing applications were left alone.

## Historical tiny-world contract convergence (superseded)

User requested parallel contract design and worker/reviewer loops before implementation. The consolidated [tiny decision harness contract](research/decision-harness-contract.md) supersedes three independent world, candidate and evaluation proposals. Independent reviews covered world accounting/timing/oracle and candidate/evaluation boundaries. A concrete ambiguity in non-time budget failure handling was revised and re-reviewed; no outstanding implementation-blocking contradictions were reported. This is documentation review, not executable verification.

Proposed v0 is deliberately narrow: isolated deterministic single-citizen world, finite funded external quotes, explicit buy/sell/eat/wait moves, fully observed decision-relevant conditions, survival-first terminal objective, exact tiny-world reference search and separated unassisted/assisted tracks. No strategic compound actions, automatic eating, unlimited demand or privileged oracle input. Training/personality/uncertainty/production are deferred, not claimed tested by this version. Implementation and experiments have not begun under this contract. See its explicit approval decisions before parallel implementation.

The [local tool-call model investigation](research/local-tool-call-models.md) is also complete. Proposed later candidates: Qwen3-4B-Instruct-2507 Q6, Qwen3.5-4B Q6 and LFM2.5-1.2B-Instruct Q8 against the installed 9B reference. The older LFM2-1.2B-Tool is a specialist alternative; FunctionGemma requires more task specialization for sequential use. Compatibility, template/parser correctness and constrained schema generation must be separated from tool selection, semantic arguments and recovery. These models were researched, not run. Smaller model/classifier coexistence remains an estimate, not measured co-residency.

## Current research checkpoint

### Round 2: goal-driven parallel investigation (complete)

Each session starts from the desired citizen behavior, brainstorms relevant research avenues, and selects sources rather than following a fixed game/paper checklist. Parent integrates reports and closes sessions after completion. Previous research sessions are already closed. No implementation or new experiments in this round.

| Session | Question / completed coverage | Report |
| --- | --- | --- |
| Settlement mechanisms | Completed: local advantage, spatial concentration, dynamic migration and commuting failures | [Report](research/round-2-settlement-mechanisms.md) |
| Selfish economy learning | Completed: learned barter/merchant behavior, online quote adaptation and learned market power | [Report](research/round-2-selfish-specialization.md) |
| Citizen learning design | Completed: acceptance beliefs, predictive planning, policy learning and executable memory | [Report](research/round-2-learning-decisions.md) |
| Citybuilder agent study | Completed: Cities: Skylines I/II, UrbanSim and a qualified GlassBox comparison | [Report](research/round-2-citybuilder-agency.md) |

First completed round-2 branch: [settlement mechanisms](research/round-2-settlement-mechanisms.md). Staying can be justified by local productivity without housing; productive buildings contribute through future services, not money already spent. Remote commodity trade can support dispersed specialists without rewarding proximity to buyers. The report separates staying, commuting and moving, and proposes tests distinguishing useful commitment from artificial immobility. Its evidence spans learned roles, equilibrium theory, estimated human migration and authored game logistics; none alone demonstrates learned citizen settlement.

Second completed round-2 branch: [individual learning](research/round-2-learning-decisions.md). Learning can update small predictions rather than neural weights: Gjerstad–Dickhaut traders estimate acceptance from observed auction events and optimize quotes; TacTex connects updated predictions to procurement. Transfer requires care: resting orders are not rejected quotes, public prices do not guarantee fills, and atomic settlement may remove counterparty-default risk. The report distinguishes population-trained weights, personal belief updates, plan repair and persistent executable skills. Its proposed discriminator traces experience → changed prediction → changed choice → realized outcome, comparing adaptive and frozen versions under changed opportunities. Named-person reliability learning remains unverified.

Third completed round-2 branch: [selfish specialization](research/round-2-selfish-specialization.md). Fruit Market demonstrates consumption-driven learned barter and merchant activity without an external buyer in its ordinary treatments, but supplies permanent skill/preference asymmetries and extensive training; retraining each condition is not within-life shock adaptation. ZIP demonstrates inexpensive within-run pricing adaptation with supplied reservation values, not learning what food/time is worth. Independent Q-learners can sustain high prices that benefit sellers rather than buyers. Conserved gold alone need not prevent trade, but its distribution and funded settlement can block a physically beneficial exchange. Proposed tests separate personal valuation, executable funding and individual-versus-social outcomes.

Fourth completed round-2 branch: [citybuilder agency](research/round-2-citybuilder-agency.md). CS I explicitly decouples worker attendance from production and returns blocked traffic to origin. CS II documents substantive household/company location choices, but also global opportunity signals, authored balancing and external economic flows; launch and Economy 2.0 differ. UrbanSim links location, affordability and durable capital through fitted population models rather than individual experiential learning. These cases provide useful variables and failure controls, not proof of autonomous citizen strategy discovery.

### Round-2 synthesis and unresolved decisions

- **Personal valuation is upstream of pricing.** Learning a markup given a supplied reservation value is easier than deciding what food, time, liquidity and future tools are worth under feasible alternatives. The latter is central to the desired citizen capability.
- **Settlement should have prospective benefits.** Local productivity and continuing services can justify staying; expensive movement alone only proves immobility. Test stay/commute/move separately, including transient versus persistent change. Past spending is not itself a benefit of remaining.
- **Learning can be modest and explicit.** Acceptance, yield and travel predictions can update from actual outcomes and feed a decision evaluator. This remains a candidate, not a selected architecture; direct policies and executable skill memory solve different problems.
- **Separate opportunity, execution and learning.** No funded beneficial sequence means a world/settlement constraint, not necessarily bad judgment. Better predictions without changed actions or better consequences do not establish useful learning.
- **Selfish competence is not social welfare.** Learned strategies may support exchange or market power. Measure individual outcomes and effects on other citizens separately; do not force cooperation through a hidden society-wide objective.
- **The comparison must preserve actual agency.** No undisclosed central job allocation, lucrative-site oracle, successful-work bypass or guaranteed demand should be credited to the citizen. Explicit institutions may be valid world design, but are a separate choice.

All four reports are complete and integrated; research sessions are closed after integration. No round-2 simulation, training or production change was performed. Remaining gaps include named-person reliability learning, endogenous institutions/private valuation, and a matched-authority comparison in Prosper. Next work has not yet been selected or authorized by these reports.

Citybuilders include Cities: Skylines and alternatives as evidence permits. Do not presume their citizen AI is fake: distinguish actual entity state, authored decision rules, aggregate processes and rendering/transport shortcuts by version and source. Reports must include demonstrated mechanisms, limits/counterexamples and proposed discriminating tests, not architectural prescriptions.


### Expanded game-focused research (first parallel pass complete)

The first pass was too generic to answer the design question. Four independent research sessions investigated concrete comparable systems. Their completed reports are linked below. Findings are not recommendations merely because another game uses them; the synthesis distinguishes strategy generation from execution and centralized economies from independent citizens.

| Session | Scope | Findings document |
| --- | --- | --- |
| RTS AI research | Completed: AoE II expert system, StarCraft build-order search, TStarBots, AlphaStar and Gym-μRTS | [Findings](research/rts-economy-ai.md) |
| MMO economy research | Completed: Neural MMO, Gather-and-Build, TacTex-05, EVE and Albion, with evidence tiers distinguished | [Findings](research/mmo-economic-agents.md) |
| Colony citizen research | Completed primary-source pass: Sims, Dwarf Fortress, Banished and Widelands; secondary RimWorld comparison | [Findings](research/colony-citizen-ai.md) |
| Game planning research | Completed: Wargus investment planning, BOSS search, Darmok plan repair and 0 A.D. Petra economic queues | [Findings](research/game-planning-economic-ai.md) |

First completed branch: [colony/life simulations](research/colony-citizen-ai.md). These cases reveal an important comparison boundary: much apparent citizen competence comes from player-authored priorities or settlement-wide allocation. Dwarf Fortress job auctions are not monetary markets; Widelands economy demand is not independent citizen price discovery. Banished's documented travel-cost and assignment failures offer concrete diagnostic cases. This does not select a replacement architecture; learned/planning economic-agent evidence remains the remit of other branches.

Second completed branch: [MMO/economic agents](research/mmo-economic-agents.md). Neural MMO supplies actual learned characters with executable market actions, but market-specific causal evidence is limited. Gather-and-Build demonstrates learned specialization under differentiated skills and an external house buyer; its results cannot be transferred directly to Prosper's finite-gold citizen economy. TacTex-05 supplies a particularly useful adaptive-versus-frozen comparison under changed opponents, using forecasting and constrained scheduling rather than an end-to-end neural policy. EVE/Albion illuminate demand and measurement, not learned NPC intelligence. The report explicitly versions numerical results and distinguishes full-text evidence from the partially accessible Albion source.

Third completed branch: [RTS economic control](research/rts-economy-ai.md). AoE's documented gatherer ratios and trade thresholds are authored player-level policy. StarCraft build-order search demonstrates production scheduling toward externally supplied goals, with simplifying income/travel assumptions. TStarBots, AlphaStar and μRTS demonstrate learned centralized control, not independent citizen economies; their training budgets, opponent/map coverage and supplied execution machinery differ substantially. μRTS's resource-exhausting barracks rebuilding and TacTex's inventory-limited forecasts supply concrete recovery/execution failures to investigate, rather than abstract claims about reasoning.

Fourth completed branch: [game production planning](research/game-planning-economic-ai.md). Wargus explicitly compares whether extra producers repay their investment; BOSS generates production schedules through bounded search; Darmok repairs demonstration-derived plans; Petra allocates resources using authored queue policies. These are materially different mechanisms. Knowing recipe semantics is not the same as scripting strategic choices. The planning examples generate means toward supplied objectives, but do not establish decentralized citizen market competence.

### Provisional synthesis from the game-focused pass

- **The candidate space is broader than rules versus neural models.** Explicit forward models with bounded search can generate investment/production choices without a learned policy or LLM. Their fidelity, uncertainty handling and objectives are unresolved for Prosper.
- **Individual economic agency is the key transfer boundary.** RTS armies and most colony logistics share ownership and central authority. Neural MMO and Gather-and-Build are closer learned-agent examples, but their reward, demand and information assumptions differ from Prosper.
- **Economies need an explanation for profitable specialization.** Comparative advantage, downstream consumption and purchasing power must be demonstrated, not inferred from an order book. External demand in Gather-and-Build and Albion is a world-design mechanism, not proof of actor intelligence.
- **A concrete test of capability is adaptation against a frozen counterpart.** TacTex's changed-opponent comparison is stronger causal evidence than high trade counts. Investment payback, unavailable prerequisites, unfilled trades and recovery after asset loss provide distinct failure probes.
- **No architectural winner yet.** Learned policies, bounded model-based search, demonstration repair and hybrids remain candidates. Authored controllers serve as diagnostic baselines, not the stated end goal. Goal/objective design and prediction uncertainty are still open.

Earlier proposed evidence stage: validate feasible opportunities in Prosper and establish a small held-out adaptation suite before comparing candidate controllers. The current user-aligned direction above first sharpens the decision problem and local modern-model feasibility. No training or production redesign has been authorized or performed by these research branches.

Require actual mechanisms, primary evidence, evaluation, costs and failure modes. Shipped game behavior is not automatically evidence of intelligence; centralized RTS competence is not automatically transferable to independent citizens. No architecture convergence yet.


- [First literature pass: nine primary papers](research/2026-10-08-literature-pass-1.md), covering learned policies, world models, distillation, language agents and generalization evaluation.
- [First headless interface probe](research/2026-10-08-interface-probe.md): reproduced a known-person context/validation mismatch with two synthetic citizens, zero model calls and zero advanced ticks.
- No architecture selected. Classical planning/search and economic-mechanism literature remain under-covered. No learned-policy training or new live-model evaluation has occurred.

Initial synthesis: compact inference is plausible but acquiring capability can be expensive; high-level language behavior is not demonstrated execution; unfamiliar conditions/opponents are essential tests. Interface failures must be separated from agent capability before comparison.

## Research objective

Build genuinely capable agents acting in Prosper's simulated world, whose interesting strategies arise through reasoning or learning rather than authored `when X, do Y` strategic scripts. Observe and evaluate those capabilities through general methods.

Neither a layered architecture nor an LLM is a predetermined answer. Rules → dedicated model → higher-level LLM is one candidate; a dedicated model alone is another. Market competition is a useful diagnostic, not the entire objective. Profit, survival, personality prose and visible activity are not interchangeable with intelligence.

Fixed game mechanics and action validation define the environment. Hard-coded strategic choices define agent behavior. Keep those separate when comparing approaches.

## Clarified behavioral target and research hypotheses

User clarification, 2026-10-08:

- Citizens reason from their own situation, personality and wider known context. Near wood with an urgent food need, buying food rather than searching/gathering it is an example of the desired intuitive opportunity-cost reasoning, not a requested hard-coded rule.
- Citizens should pursue their own interests; a wider economy should emerge from interactions under suitable primitives, rather than central job assignment or an explicit society-wide optimization objective.
- Investigate geographic commitment: useful buildings, houses/rest, crafting facilities, stored possessions and relocation costs might make settlement worthwhile. Higher-tier tools might eventually justify moving toward inner resource bands.
- Learning is particularly important: distinguish actual changes in beliefs, predictions or behavior from accumulating prose memories.
- These are research directions, not authorization to implement buildings, transport restrictions, training or an architecture redesign.

**Do not treat the expected outcomes as automatic.** Buying food is advantageous only when an affordable, available offer beats other feasible options in time/risk/opportunity cost. Nearby wood creates potential advantage, not guaranteed specialization: market access, demand, productivity differences and switching costs matter. Fixed buildings can support settlement but can also trap agents, create repetitive commuting or extinguish trade. Self-interested behavior can generate exchange, monopoly, conflict, coordination failure or collapse depending on institutions and constraints.

### Next broad research questions

1. **Spatial specialization and settlement:** Which mechanisms produce durable but revisable location choices? Examine local productivity, fixed productive capital, storage, transport costs, housing benefits, congestion and agglomeration. Distinguish relocation from commodity delivery; Prosper's current remote market removes much commodity transport friction.
2. **Self-interested exchange:** What conditions produce comparative advantage, funded demand and beneficial trade without a central allocator? Include failure regimes, not just successful equilibrium demonstrations.
3. **Learning from individual experience:** How do agents learn yields, travel times, prices, fill likelihood, other agents' reliability and investment payback? Compare explicit belief/model updates, reinforcement learning and memory-supported language reasoning; test unseen changes rather than only repeated familiar conditions.
4. **Joint world–agent evaluation:** Separate whether an opportunity exists from whether a citizen can recognize and execute it. Avoid adding primitives merely to force the desired result or compensating for bad choices with strategic scripts.

## Diamond-shaped process

### 1. Frame the problem

Separate three possible causes of poor behavior:

- **Agent:** insufficient planning, learning, memory, action authority or adaptation.
- **Interface:** missing information, confusing actions, contradictory validation or poor feedback.
- **World:** incentives or resource dynamics that do not reward the strategies we expect.

Prosper has promising ingredients: scarcity, production, trade, geography and competing agents. Whether its actual incentives support sustained specialization, cooperation and competition remains unverified.

### 2. Diverge: investigate broadly

Survey contrasting approaches before selecting an architecture:

| Research branch | Questions |
| --- | --- |
| Reinforcement learning and multi-agent RL | Can agents learn useful behavior from interaction? What training cost, rewards, generalization and non-stationarity issues arise? |
| Hierarchical RL, options and skill learning | Can reusable temporally extended actions emerge or be learned without scripting strategic choices? |
| Model-based learning, world models and planning/search | Can explicit prediction and counterfactual evaluation support adaptation efficiently? |
| Imitation, distillation and small specialist policies | Where would training examples come from, and how would a student generalize beyond its teacher or fixtures? |
| LLM agents and hybrid architectures | What evidence supports language reasoning, memory and executable skills? When does language add measurable value? |
| Agent-based economics and game environments | Do market rules and incentives support meaningful behavior, and what baselines expose structural failures? |
| Evaluation methodology | How are adaptation, transfer, exploitation, coordination and robustness measured without mistaking benchmark optimization for general capability? |

For each branch, record primary sources, exact evidence, compute assumptions, limitations and relevance to Prosper. Distinguish demonstrated results from plausible transfer. Do not equate financial trading benchmarks with this production economy.

### 3. Test discriminating hypotheses

Use small headless experiments only where they resolve uncertainty. Candidate questions, not yet a committed benchmark suite:

- Does the environment offer profitable, feasible alternatives to repetitive survival work?
- Can an agent exploit an opportunity, then adapt when prices, availability or opponents change?
- Does failure come from strategy selection or from the action/observation interface?
- Does a learned or reasoning-based controller outperform the existing controller under equal information and an explicit compute budget?
- Does improvement transfer to held-out seeds, conditions and opponents rather than one crafted scenario?

### 4. Converge

Compare approaches against observed evidence, not architectural preference. Retain a small shortlist, identify remaining decisive experiments, and select an approach only once the trade-offs are visible. A hybrid must justify each layer; a single-model solution must justify its coverage.

### 5. Validate the choice

Repeat against held-out conditions and longer interacting populations. Record failure cases and conditions that would reverse the decision. Do not infer population-level success from a few valid responses.

## Evaluation principles

The measurement design is itself an open research question.

- Measure outcomes and trajectories, not persuasive explanations or JSON validity alone.
- Keep capability, believable character variation and entertainment value distinct.
- Candidate capability measures: successful adaptation after change, resource efficiency, feasible objective completion, regret where a defensible comparator exists, transfer and robustness.
- Candidate society measures: actual trade and gains from trade, specialization, distribution of resources, survival and interaction patterns. None alone establishes intelligence.
- Record wall time, inference count/latency, training cost and simulation throughput.
- Pair initial states/seeds where appropriate, repeat across conditions, report uncertainty and retain counterexamples.
- Multi-agent A/B comparisons require care: changing one agent changes other agents' opportunities. Distinguish fixed-opponent tests, mixed populations and whole-population comparisons.
- Use scripted policies as explicit diagnostic baselines, not as the intended intelligent-agent solution.
- Do not claim that a valid decision caused improvement without a downstream comparison.

## Experiment permissions and boundaries

The original clarification permitted bounded local-model experiments in isolated headless worlds, but not cloud calls, model downloads or training. Later explicit authorizations are recorded above and in each experiment section; they do not authorize unrestricted acquisition, training or production redesign. Existing live worlds and durable data must remain unchanged.

Before each experiment, specify the hypothesis, comparison, model/call or compute ceiling, seeds, horizon, metrics and stopping condition. Use isolated OS-temporary working data; retain only intentional reports/receipts in an agreed research location. Do not leave experiment services running.

One bounded offline synthetic headless interface experiment has now been conducted; see the linked report. It made zero model calls and advanced zero ticks. No training, model downloads or production changes occurred.

## Findings so far

### Evidence boundary

Read-only inspection of current source and saved run `run-8a355587-1d1c-45a9-b85c-ddb6bf341f66`. Normal app ports 5173/4310/4312 were unreachable during inspection. The saved checkpoint is tick **17,978**; diagnostics continue to tick **41,113**. Those are not interchangeable snapshots. Source has substantial pre-existing uncommitted changes; the run includes backend reloads, so it is not a controlled trial of one immutable implementation.

Evidence files, read-only:

- `.prosper-v2/checkpoint.json`
- `.prosper-v2/diagnostics/run-8a355587-1d1c-45a9-b85c-ddb6bf341f66.jsonl`
- `.prosper-v2/request-ledger.jsonl`
- `.prosper-v2/budget-settings.jsonl`

### Observed architecture

- Most physical choices are made by an ordered local controller. Live Qwen 3.5 9B edits persistent policy in a single structured response while the world continues.
- Written goals/memory feed future model context but are not executable plans for the local controller. `home` is accepted but has no identified local routing/production consumer.
- Market execution is primarily rule-driven; model buy/sell prices are shared T1-base parameters scaled by tier, not individual item/tier strategies.
- Existing production commitments can outlive a livelihood or target-tier change.

Source entry points: `src/world/autonomy.ts`, `src/world/production.ts`, `src/world/society.ts`, `src/citizen/runner.ts`, `src/citizen/strategic-context.ts`, `src/citizen/strategic-tools.ts`.

### Observed run, not causal findings

Deduplicating turn records by turn ID yielded **392 turns**: 233 accepted policy changes, 117 accepted continuations, 34 rejected policies, seven reload interruptions and one final thinking record. Acceptance/change is not a quality score.

All 34 rejections were `unknown-policy-citizen`. Persistent relationship/evidence context can contain people omitted from the validator's known-person sources. Rejected examples include people already named in the supplied relationship context. This supports an interface mismatch; it does not establish that every rejection shares that cause. See `validateAutonomyPolicy` in `src/world/autonomy.ts`.

For turns starting after tick 35,000, 75 had recorded completion duration; 15 were rejected. Median duration was approximately **5.9 seconds**, and their completion timestamps spanned approximately **465 seconds**. This indicates near-continuous population-wide model work during that interval, not one review per citizen every six seconds.

Latest available observations after tick 35,000 covered 57 distinct citizens: 47 had food livelihood, 27 were securing food, 13 were acquiring maintenance supplies and 23 had zero unescrowed gold. These are asynchronous observations, not a census or a controlled explanation of economic failure.

The older checkpoint contains 12 dead citizens, all with starvation recorded as their final result; 11 had parents. Do not extrapolate a final-run death count from this checkpoint.

### Concrete decision examples

- At observation tick 39,333, Galen Ashford's response described moving home for safety, but `home` does not implement movement. It described a wood purchase price while changing a general purchasing parameter. This is a gap between prose and executable semantics.
- Ivo's response at observation tick 38,229 described starving rivals and coordinating raids, while its policy had no rivals, moderate aggression and reproduction set to seek. The prose is not evidence of an executable raid strategy.
- Noel's observation at tick 41,006 included an ask of 96 gold for T5 food. The reply selected `sellPrice:96`, meaning a T1 base and thus a T5 baseline of 1,536 before competitor-price adjustment. Copying the observed quote is a plausible explanation, not proven internal reasoning. Realized sale prices and harm were not measured.
- Both buy and sell orders existed. The user's impression of one-sided orders remains a question about market functioning, not proof that one order type was absent.

### Current interpretation

Evidence supports problems with the decision interface, model judgment and the connection between intent and action. It does not establish which replacement architecture would work, whether more model authority would help, or whether Prosper's incentives are adequate. Increased call frequency alone is not supported as a sufficient remedy.

## Literature register

The initial leads below are preserved for provenance. Voyager and Concordia have now received a methods/results reading in the [first literature pass](research/2026-10-08-literature-pass-1.md), alongside seven additional papers. The hierarchical-RL foundational lead below remains unreviewed. None is an architecture recommendation.

| Source | Potential relevance | Evidence still needed |
| --- | --- | --- |
| [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291) | Automatic curriculum, executable skill library and environment feedback in Minecraft | Read methods, ablations, model/compute assumptions and evaluation limits; assess transfer to multi-agent economics |
| [Generative agent-based modeling with actions grounded in physical, social, or digital space using Concordia](https://arxiv.org/html/2312.03664v2) | Generative social agents and grounded interaction | Separate grounded outcomes from language adjudication; inspect behavioral validation and repeatability |
| [Recent Advances in Hierarchical Reinforcement Learning](https://dl.acm.org/doi/10.1023/A%3A1022140919877) | Temporal abstraction and hierarchical control | Review foundations and newer empirical work; distinguish learned skills from authored strategies |

The first pass broadens coverage to dedicated learned policies, learned world models and multi-agent evaluation. Economic baselines, classical planning/search and hierarchy foundations still need deeper coverage before shortlisting.

## Evidence and decision log

Use this format for additions:

- **Question / hypothesis:**
- **Source or experiment ID:**
- **Method and comparison:**
- **Result:**
- **Limitations / alternative explanations:**
- **Implication, if any:**
- **Next discriminating check:**

### Decisions

- 2026-10-08: Use a divergent research phase followed by evidence-driven convergence.
- 2026-10-08: Do not assume a three-layer architecture, a dedicated model, an LLM, or market optimization is the answer.
- 2026-10-08: Start with bounded, isolated experiments; preserve the current run.
- 2026-10-09: Document the composed-subtree implementation direction for both headless verification and eventual live integration. Ground focused mocks in actual citizen observations; allow repeated goal selection but exclude strategies active in its ancestor chain. Provide stepping and visualization for trees/subtrees, with debugger details still to be chosen. Current planning is restricted to `ObtainFood`; its concrete scope, execution contracts and node-selection methods remain open. See the [implementation plan](research/decision-tree/plan.md).

### Open questions

1. What observable evidence would distinguish genuine adaptation from memorized or scripted competence here?
2. Which opportunities does the existing world actually make feasible and worthwhile?
3. What information and action abstraction allow a fair comparison of candidate agents?
4. What training and inference budgets are acceptable if research points toward a learned policy?
5. Which compact tests predict behavior in a longer, changing multi-agent world?
6. What evidence would justify choosing one architecture and ending the broad search?
