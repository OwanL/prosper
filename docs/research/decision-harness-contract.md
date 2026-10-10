# Prosper decision harness contract — revised draft v1

**Status: review-ready design only, revised 2026-10-08.** The user chose **direct primitive control in the real Prosper engine** for the first harness. This revision replaces the tiny-world v0 contract in full and supersedes `decision-contract-world-proposal.md`, `decision-contract-agent-proposal.md` and `decision-contract-evaluation-proposal.md`. Those proposals are historical, not additional requirements. Their toy transitions, schemas, bounds, explicit eating, scores and exhaustive-oracle obligations are not adopted.

Approval of this contract and a bounded execution plan is required before implementation or experiments. This document authorizes no inference, downloads, installation, training, paid calls, durable-data changes or production integration.

## 1. Question and scope

Can a candidate choose and compose real citizen commands to achieve a disclosed objective, using only that citizen's observations? Judge committed consequences, not prose, occupations or agreement with a prescribed solution. Trees, rules, classifiers, search, RL and language models can share the same execution boundary; no architecture is selected here.

The environment is **Prosper**, not a second simulator. Use its seeded geography, tiered items, production, travel/work durations, inventory reservations, funded market, combat, reproduction, death settlement, automatic meals and starvation. Fixtures may focus on a small problem without deleting the rest of the world's semantics. A headless runner is scheduling and evaluation infrastructure, not a duplicate mechanics implementation.

The first track is generated direct primitives: one real `Command` or a runner-level no-command decision at a time. No `set_policy`, directive, plan executor, supplied solution or adapter that sells/buys/harvests prerequisites for the candidate. Candidate-private planning is allowed. Menus, forecasts and strategic-policy control would be separately labelled future tracks, not hidden assistance.

## 2. Existing engine boundaries

Source-grounded APIs (mutate the supplied world synchronously):

```ts
// src/world/core.ts
createWorld(options?: {
  seed?: number; scenario?: string; runId?: string;
  population?: number; autonomy?: boolean; maintenance?: boolean;
}): World;
dispatch(world: World, citizenId: string, command: Command): CommandResult;
tickWorld(world: World, count?: number): void;

// src/world/observation.ts
updateKnowledge(world: World): void;
observe(world: World, citizenId: string): CitizenObservation;
validateKnownCommand(world: World, citizenId: string, command: Command): CommandResult;
```

`Command`, `CommandResult`, `CitizenObservation`, `World` and `Inventory` are the existing types in `src/shared/types.ts`, not new harness substitutes. Scenario values currently supported by creation are `village`, `competition`, `progression`. Use existing tier definitions in `src/shared/tiers.ts`, recipes and balance in `src/world/config.ts`, and mechanics in `src/world/{core,market,life,observation}.ts` as authority.

Relevant consequences:

- Market buy/sell is `{type:'order', side:'buy'|'sell', item, quantity, price}`. It is not an order-ID purchase. Matching uses executable opposing prices with price/time/sequence priority, excludes self-trades, can partially fill and leaves funded remainder in escrow. `CommandResult.order` reports synchronous settlement, not future fills.
- Commands do not intrinsically spend a tick. Physical commands start or queue work; acceptance is not completion. Immediate orders can settle before any tick. Cancellation and replacement preserve the core refund/settlement boundaries.
- There is **no eat command**. Each tick drains fullness, may consume one available carried food unit according to tier/deficit, then applies starvation damage or healing and death settlement. Food reserved for work or escrow is not available for eating. Fullness zero is not itself death; health matters.
- `observe` is a pure citizen projection with current sight, dated remembered tiles, public markets and audience-filtered communications/events. It does not grant live whole-map state. Calling it repeatedly does not advance time or commit knowledge.
- Existing queues support `append`/`replace`. Candidate-issued queued commands may execute later through core activation checks; no harness-authored queue or macro is permitted.

## 3. Proposed evaluation control mode (missing engine capability)

**`autonomy:false` is not an isolation switch.** `tickWorld` currently calls reactive autonomy, starts emergency feeding for citizens without autonomy, advances emergencies and can fall through to queues, plans and legacy directives. Removing autonomy alone could give the candidate an automatic rescue strategist.

Add a narrow, explicitly scoped evaluation authority option around existing tick/controller entry points; its exact API placement is an implementation decision after approval. Do not change normal runtime defaults or saved-world semantics. Authority is runner metadata/options, not promises or callbacks stored in `World`.

For a citizen under `direct` authority:

- Suppress `reactAutonomy`, `advanceAutonomy`, emergency initiation/advancement, approved plan advancement, legacy directive advancement and external policy/review commits. This includes reactive defense, autonomous orders, movement, social negotiation and other strategic action selection.
- Preserve already accepted candidate physical work, pathfinding, candidate queues and activation validation, automatic inventory-tool use, combat resolution, joint actions, resource regrowth, claims/alliance expiry, market transfers, death/refunds/loot, and automatic meals/starvation/healing. Incoming harm still applies; the actor is not invulnerable and receives no automatic strategic counterattack.
- Do not erase autonomy data just to suppress its executor: policy constraints/evidence used by existing mechanics remain as declared initial conditions. Gate action selection, not physics. Audit any indirect controller entry points that could issue commands/cancel work for this citizen.
- Start with no action, queue, emergency, plan or legacy strategy unless a fixture explicitly declares valid pre-existing physical work. Initial v1 fixtures use idle actors. Do not discard reserved state by assigning null at runtime; any later authority transition must use established cancellation/refund boundaries and is outside initial scope.

Every other citizen also needs explicit authority; unlisted citizens are a fixture error. Default first fixtures use **passive-body** counterparts: the same strategic suppression, no new commands after initialization, but all normal body mechanics still run. They are real living citizens with funded holdings, not synthetic infinite-liquidity accounts. Their meals, deaths and resulting order cancellation remain relevant.

Optional separately labelled fixtures may use normal Local AI peers or a predeclared fixture command schedule. Record which peers execute, exact schedule/order and authority; never quietly enable emergency feeding for passive peers. Scheduled commands go through the known-command gate and dispatcher. No live model background reviews. Newborns, if possible, inherit the manifest's declared background-authority rule (passive-body by default), not an implicit controller default. Global bookkeeping such as `maintainSociety` continues; no actor-specific strategy may bypass the authority gate.

This tests primitive decision quality under a declared social environment, not the deployed layered policy controller. Normal autonomous-society comparisons are a different track.

## 4. Fixtures and initialization

A manifest declares engine/source version, world seed, creation options (including explicit autonomy and maintenance), actor selection, horizon in simulation ticks, decision cadence, authority policy, objective and resource limits. Seeds and horizon are configurable; there is no tiny eight-tick bound. Select an actor by a declared creation rule, then retain the resolved ID privately for replay.

Initialization sequence:

1. Call `createWorld` in memory with all relevant options explicit. Do not restore any durable world.
2. Apply only manifest-declared **initial overrides**, validated before evaluation: positions in bounds, finite vitals within engine limits, safe nonnegative gold and integer item quantities, valid item/tool tiers, valid entity references/ownership and coherent reservations. Prefer a small allowlist (citizen position/vitals/holdings, deposit stock, valid initial buildings) over an unrestricted state patch. Reject inconsistent fixtures, do not repair them silently.
3. Establish the gold baseline after overrides, including all real holders/escrow/loot as applicable. Adjust `world.initialGold` consistently for authored initial funding. These holdings/buildings/positions are fixture endowments, **not earned history**; do not fabricate trades, harvests, memories or success events. Inventory need not be conserved across authored initialization; creation/endowment provenance must be explicit.
4. Place finite funded market orders using actual `dispatch` order commands from counterpart citizens, after knowledge initialization and `validateKnownCommand`. Never insert order records/escrow directly. Record command results, setup matches and refunds; if setup does not produce the declared starting state, reject the fixture. No replenishment unless a scheduled background command is explicitly part of the fixture.
5. Call `updateKnowledge` after initialization and each committed setup command, seal the exact initialized world and setup log for privileged replay, then obtain the actor's first `observe`. Initial decision is at this state, before any evaluation tick. Initial history is empty except genuine setup effects.

Overrides may create targeted liquidity/deadline/work problems on a real map. They are not proof those conditions naturally arose in normal play. A procedural-world continuation, if later used, must retain its actual generating command/tick history and be labelled separately from an authored initial fixture.

## 5. Headless runner and scheduling

Import core/observation modules, not the production `Runtime`, server, UI, `CitizenRunner` strategic scheduler or persistence/ledger bootstrap. No sockets, background clock or durable checkpoint writes. Output, replay inputs and any isolated provider accounting use uniquely named OS-temp locations; neither `.prosper/` nor `.prosper-v2/` is read or changed. Retention/export requires separate approval.

**Initial default: paused at decision.** Use one decision opportunity per tick; allow an explicitly configured fixed integer cadence for later workloads. The world and all background execution pause during candidate encoding/search/inference/feedback. One outstanding request only. A slower model consumes more wall resources, not additional starvation ticks.

At each opportunity:

1. Capture an immutable `observe(world, actorId)` and pass only it plus public mechanics/objective/cadence/remaining horizon and candidate limits to the candidate.
2. Decode one decision. For a command, check structure first, then `validateKnownCommand`, then call `dispatch` only if the gate accepts. Do not rewrite quantities, repair targets, fill prerequisites or retry. Record gate rejection separately from dispatcher rejection. A runner-level no-command decision invokes no dispatcher; it is not a new world `wait` command.
3. Call `updateKnowledge` after the command boundary, capture its immediate result/observation, then advance the declared cadence (clamped to remaining horizon), always **one `tickWorld(world, 1)` followed by one `updateKnowledge(world)`**. Capture outcomes each tick. Never substitute `tickWorld(world, N)` followed by one knowledge update: travel/visibility/history changes matter.
4. Background scheduled commands, when enabled, execute in a fixed manifest order at declared pre-/post-tick boundaries, with knowledge refreshed after each command. Record ordering relative to the actor; do not use wall-clock arrival order.
5. Deliver committed outcomes and the next citizen observation. Stop at horizon, actor death, declared task termination or budget/runtime/operator failure. Do not fabricate remaining ticks or rewards. Horizon completion may leave work/orders open; report their actual state, no automatic liquidation.

Malformed output or a contained per-decision timeout makes **no command** and advances only that opportunity's normal cadence if budget remains; record candidate failure, not an engine rejection. Exhausted episode budget stops incomplete rather than free-running to horizon. Abort plus request/episode generation checks prevent late decisions from committing. Unsafe/uncontained inference cancellation stops the run and blocks reuse until teardown. Feedback has no execution authority. No simulator handle, alternate-world stepping tool or evaluator query is supplied to the candidate.

A tight in-memory loop runs as fast as the engine and candidate allow, with no real-time sleep. Record achieved ticks/sec and engine/knowledge/trace costs separately from candidate latency. Continuous asynchronous inference, action-on-completion and simulation-time decision deadlines would be a later scheduling track requiring matched baselines; do not mix them into the first comparison.

## 6. Small proposed adapter surface

These are runner-local design types, using existing shared contracts; they are not implemented APIs:

```ts
type PrimitiveDecision =
  | { requestId: string; kind: 'command'; command: Command }
  | { requestId: string; kind: 'advance' };
type DecisionInput = {
  requestId: string;
  observation: CitizenObservation;
  remainingTicks: number;
};
type CommitRecord = {
  requestId: string;
  tick: number;
  decision: PrimitiveDecision | null; // null for candidate failure
  knownResult?: CommandResult;
  dispatchResult?: CommandResult;
  failure?: string;
};
// Candidate lifecycle, not world-state methods:
// reset(public mechanics/objective/limits, candidateSeed)
// decide(DecisionInput, AbortSignal) -> PrimitiveDecision
// feedback(commit and subsequent citizen-visible outcomes)
// close()
```

Pin a strict decoder/schema for the existing command union. All current command kinds may be generated unless a fixture declares a public subset before evaluation: movement, harvest/craft/build/refine, attack/loot, cancel, orders/cancel-order, transfers/gifts, messages/memory/goals, reproduction/consent. The adapter may not expand `advance` into a survival action. Declare queue semantics and limits from the engine. There is no new quantity cap or toy error-precedence contract.

Candidate knowledge includes actual documented mechanics: item/tier syntax, recipes, durations, nutrition/drain/starvation, market funding/matching, visibility, cancellation, automatic use of the highest-tier matching available inventory tool and any retained policy constraints. Tools are ordinary inventory items, usable and tradable without equip/unequip commands or separate equipment state; sell escrow and work reservations are unavailable for tool use. Freeze the supplied manual/source-derived extract and hash it. A generic candidate-side model/search over disclosed mechanics is allowed and charged; fixture-specific lookup solutions are not. No ranked action menu, affordability pruning or exact predicted consequences is supplied in this track.

The candidate never receives the manifest, seed/family/split labels, privileged snapshot, counterpart private holdings/policies, success evaluator internals or reference actions. Public geometry and globally public markets are allowed because `observe` exposes them. Remembered state is dated, not refreshed remotely. Use exactly the existing projection; any future observation change needs shared-contract review.

## 7. Budgets, provenance and trace limits

The approved run configuration must bound per-decision and episode wall time, model calls/tokens if applicable, output bytes, candidate memory, search expansions if applicable, process resources and teardown time. These are resource limits **separate from simulation ticks/horizon**. No fixed toy limits are inherited. Record enforcement methods, actual usage or conservative enforced bounds; unknown usage is not zero. A bounded approved local/provider plan is required before any inference; no download, cloud fallback, retry or paid call is implied by this design.

Freeze artifact/model IDs, prompts, adapters, decoding, RNG and initial private memory. Record acquisition/training provenance and candidate-owned learned skills. Default first evaluation resets candidate state between episodes, with no training/parameter changes, skill writes or cross-episode memory; ordinary episode history and planning scratch are allowed. Learning is a later declared experiment.

Write trace records incrementally at initialization, every decision/command and every single tick:

- Source/contract/manifest/initialized-world hashes, setup/endowment provenance, engine and candidate seeds, authority/cadence, objective, candidate version/artifact/prompt and resource configuration.
- Exact citizen observations delivered, raw candidate output (or bounded size/hash on oversized output), decoded decisions, request IDs, gate/dispatch results, immediate settlement and later work/death outcomes.
- Privileged per-boundary state hashes and evaluator state/deltas, ordered background commands, tick numbers, emitted events where available, candidate wall/token/call/memory/search usage and completion/failure reason.

Keep candidate-visible feedback distinct from evaluator-only audit records. Privileged health, holdings, reservations, orders, loot and event data can score and diagnose the run; they cannot become candidate hints. Record a no-command baseline and reference trajectories with the same initialization, authority and cadence.

**Current observability limits:** `World.events` is capped at 500; consequential history is also bounded (256 total/64 per kind). Telemetry/history is sampled and retained, not an exhaustive ledger. `lastResult` can be overwritten. A market result aggregates synchronous fills; it does not list every counterparty settlement or certify later fills. Meal events identify a tier, not a complete lifetime consumption account. An accepted physical action does not prove completion. Final rings/snapshots cannot establish total fills, meals, damage, births or cancellations.

Collect after each command/tick rather than relying on final buffers. If a single boundary can overflow a ring, mark missing event coverage; state deltas/hashes do not reconstruct an exact intra-boundary sequence. Where complete events are essential for a chosen metric, the minimal additional change is a passive evaluator event/settlement sink at the existing emission boundary, without adding/reordering world effects or leaking it to the actor. Do not claim exhaustive trajectories until that coverage is verified. Replay the same initialized state, authority, ordered command stream and one-tick knowledge updates; compare boundary hashes/results within explicitly documented numeric tolerances for reported floating-point vitals. Record mechanics/accounting/replay failures as harness invalidity, not poor candidate judgment.

## 8. Objectives, generalization and interpretation

Each fixture supplies a disclosed objective and evaluator definition before running. First development problems should include survival/food liquidity and production/trade opportunities; choose horizons long enough for actual travel/work and meal thresholds. Define concrete success (e.g. actor alive at horizon plus a declared health/fullness floor, or completion of an actual production outcome while surviving), and report components: health/fullness, death tick, cash/escrow, carried/reserved inventory, completed work, actual settlements, failures and resource costs. Do not assign inventory an invented liquidation value, equate order acceptance with delivery, or make a desired occupation the success criterion.

Validate positive fixtures with replayable real-engine reference trajectories, not authored success labels alone. Include no-command and a declared simple primitive baseline to expose automatic meals/endowment advantages. Use genuinely constrained negative/control cases when useful, without assuming every real-world failure has a proof of impossibility. Reference performance is a comparator/lower bound, **not an exhaustive full-world optimum**. No exact regret, optimal-first-action certificate or exhaustive Prosper search is required. Success establishes the disclosed task under this authority mode, not global optimality, spontaneous model intelligence or production readiness.

Separate development fixtures from sealed held-out fixtures. Development traces/manuals support debugging. Held-out cases vary combinations of funding, quotes/volume, food tiers/vitals, geometry/work access, reservations and horizons; use source-valid mechanics and knowledge restrictions, not new shocks or invented items. Test joint combinations, not merely renamed examples. Background controller/maintenance variants are labelled so results are not pooled as one environment.

Freeze candidates, objectives, limits and fixture selection before held-out evaluation. Keep held-out manifests/reference traces outside candidate-accessible prompts/retrieval/training. Retain every scheduled outcome, timeout, incomplete and invalid run; no best-seed selection. Pair candidates on identical initialized worlds and predeclared candidate repeats, reporting repeats separately from independent fixtures. A revision informed by held-out results turns that split into development and requires new held-out cases. Report success rates, outcome components, baseline differences, coverage/failures and cost distributions; broad strategy/generalization claims require more than these diagnostic fixtures. Concrete suite size and capability gates belong in the bounded run plan, not an obsolete toy certificate requirement.

## 9. Real-engine reference traces

These are proposed conformance fixtures, not retained experimental evidence or candidate prompt solutions. Use direct actor/passive-body counterpart authority, idle citizens, no work-reserved actor items, valid nearby coordinates and explicit initial holdings (including any carried tools). There is no equipment state; any declared inventory tools are automatically used by highest matching available tier, excluding escrow and work reservations. Other counterpart bodies remain healthy/fed across these short traces. Setup posts orders via the real command gate/dispatcher before tick 0; no setup tick is consumed. Numbers below use current `BALANCE` (`fullnessDrain=0.1`, T1 nutrition `100/9`) and must be checked against the pinned implementation.

**Buy → automatic meal.** Actor starts gold 4, no food, fullness 80, health 100. Counterpart has food and posts `{type:'order',side:'sell',item:'food:1',quantity:1,price:4}`, removing that unit into escrow.

| Boundary | Actor command/effect | Actor state |
| --- | --- | --- |
| tick 0 decision | `{type:'order',side:'buy',item:'food:1',quantity:1,price:4}` fully matches at resting price 4 | gold 0; food 1; fullness still 80; result reports paid 4/fill 1 |
| tick 1 | `tickWorld(1)` then `updateKnowledge` | drain to 79.9, automatic T1 meal consumes food, fullness ≈91.011111; health 100 |

Seller receives 4 gold; no extra food unit exists. Buying does not itself eat, and no candidate `eat`/rescue command is inserted. If initial fullness were near 100, that food could remain carried until the deficit reaches nutrition; a successful purchase is not evidence of an immediate meal.

**Sell → buy → automatic meal.** Actor starts gold 0, wood:1 quantity 2, no food, fullness 80, health 100. A real buyer starts with enough gold and posts a funded buy for two wood:1 at 2; a seller posts one food:1 at 4. Initial setup escrows buyer gold 4 and seller food 1.

| Boundary | Actor command/effect | Actor state |
| --- | --- | --- |
| tick 0 decision | order sell wood:1 q2 price2; fully matches funded bid | gold 4; wood 0; fullness 80 |
| tick 1 | single tick + knowledge update | fullness 79.9; no meal; food 0 |
| tick 1 decision | order buy food:1 q1 price4; fully matches ask | gold 0; food 1; fullness 79.9 |
| tick 2 | single tick + knowledge update | drain to 79.8, meal consumes food; fullness ≈90.911111; health 100 |

Buyer receives two wood, food seller receives four gold; initial total gold including escrow remains unchanged. Actor ordering buy first would be rejected for insufficient unreserved gold. A sale never automatically selects a purchase. The runner cadence creates the intervening tick, not the market command. Longer deadline fixtures must account for gradual health damage at zero fullness, not the removed toy rule of instant starvation death.

Before comparison, implement conformance tests for these traces, no-strategist leakage at critical hunger, candidate work/queue completion, rejection timing, partial/resting fills, background authority, cancellation/refunds/death, knowledge refresh during movement, deterministic replay and late inference containment. Broader mechanics are already engine-owned; reuse relevant existing tests rather than reinventing a parallel world.

## 10. Minimal implementation and parallel ownership after approval

Only these missing pieces are proposed:

1. **World-control owner:** narrowly scoped direct/passive authority gating in the existing core/controller entry points, retaining body semantics and default runtime behavior; targeted control/conformance tests. Own only agreed world files. Any shared-contract/API signature change is coordinated by the orchestrator.
2. **Runner/evaluation owner:** headless creation/validated fixture initialization, setup commands, one-tick/knowledge loop, scheduling/generation containment, budget enforcement, incremental privileged traces/replay, development/held-out fixture separation and outcome reporting. Own new runner/evaluation files/tests, not core mechanics or production persistence. Coordinate any passive trace sink with the world-control owner; do not edit the same emitter concurrently.
3. **Candidate owner:** replaceable primitive adapter, strict output decode against real commands, frozen mechanics context, candidate lifecycle/history and measured decision resources. Own candidate-specific files/tests; consume the agreed runner interface, never alter fixtures/evaluator or execute commands independently.

Freeze runner-local interfaces and authority behavior first, then these owners can proceed in parallel with non-overlapping file ownership. Package/config/shared type edits require explicit orchestrator ownership; no installs or model calls are implied. Integration review checks observation privilege, absent competing strategists, unchanged mechanics, setup funding, scheduling, trace coverage and replay before any capability run.

Still requiring a bounded approved plan: concrete objectives/fixtures/horizons/cadence, candidate artifact/hardware/provider authorization, enforceable resource envelopes, held-out suite size and output retention. None requires choosing a second world, an explicit meal command or a full-world oracle. Until approval, this remains design only.
