# Spike 2: technical and iteration plan

Current implementation and measured limitations: [OVERNIGHT.md](OVERNIGHT.md), [citizen.md](citizen.md), and [README](../../README.md). The architecture/reload sections below remain applicable; the implementation sequence records historical spike planning rather than constraints on the overnight redesign.

## Purpose and authority

Build a small, inspectable simulation with an ergonomic development loop and a game-like browser view. Changing code should not require rebuilding an interesting world or waiting for another live model run to diagnose a failure.

[world.md](world.md) owns the game mechanics. [citizen.md](citizen.md) owns the layered citizen direction. The user explicitly authorized borrowing first-spike ideas and automatic local survival. The current architecture adds a continuous local mind beneath rare, one-shot structured model policies; old per-action planning assumptions are superseded.

Confirmed development behavior:

- Frontend edits update independently of the running simulation.
- Backend edits pause the current run, preserve its state, restart the backend, restore the state and continue if it was previously running.
- Interrupt unfinished citizen reasoning rather than waiting for model turns to finish. Preserve committed effects, goals, memories and physical work.
- The world GUI should look and read like a simple game: identifiable characters, basic animations and clear visual evidence of what is happening.

## 1. Starting stack

| Area | Recommendation | Purpose |
| --- | --- | --- |
| Language | TypeScript across UI, server and simulation | Shared data contracts, safer refactoring and useful editor feedback |
| Frontend | React with Vite | Fast frontend updates, reusable panels and development source maps |
| World rendering | A dedicated 2D SVG scene using small character/building/resource sprites | A game-like small-grid world without adding a game engine; retain inspectable elements |
| Backend | Node with a small explicit HTTP route layer | Straightforward model integration and a single application process |
| Validation | Shared runtime schemas, with explicit game-rule checks | Reject malformed commands and explain valid alternatives; types alone are insufficient |
| Persistence | Versioned checkpoints plus structured per-run diagnostic logs | Restore a run, inspect failures and retain reproducible cases |
| Testing | Vitest for core/scenario tests; Playwright for browser behavior | Fast mechanical checks and verification of the actual user interface |
| Development | One command running Vite, a backend and a reload supervisor | No manual UI rebuild, browser refresh or checkpoint ceremony for routine edits |

Use the repository's pinned Node/package-manager versions and one package initially. No SSR framework, separate Python service, microservices, mandatory database, ECS or full event-sourced architecture is needed for this spike.

SVG is the initial rendering recommendation, not a restriction on game-like presentation. Validate it with animated characters early. Consider PixiJS only if the actual scene or animation requirements justify it; keep the same scene-data boundary and HTML inspection controls if the renderer changes. Do not switch engines merely to obtain basic walking and working animations.

## 2. Architecture and ownership

Keep four logical boundaries in the same repository:

1. **World core:** serializable state, seeded randomness, pathfinding, commands, ticks, action completion and mechanical invariants. It can run headlessly without a browser or model service.
2. **Citizen runner:** observations, fresh turn contexts, memory/goal updates, model transport, tool loop, scheduling and request accounting.
3. **Server/runtime:** the simulation clock, command dispatch, snapshots, diagnostics, persistence and browser APIs.
4. **Browser:** world presentation, controls, inspectors, feeds and local interface preferences. It never owns game rules or authoritative time.

There is one serialized boundary for applying world changes. Tools and server controls submit validated commands through it. Asynchronous provider callbacks do not mutate arbitrary world state directly. Tick/action completion and logical transactions have an explicit ordering.

Keep state as plain data. Persist citizen identity, personality, knowledge, goals, memory, inventory (including automatically selected tools), health/fullness, action queue and progress; deposits, buildings, markets/escrow, bodies/loot, messages, tick, IDs and random-generator state. Persist gameplay-relevant scheduling state explicitly rather than accidentally retaining it in closures.

Promises, sockets, timers, abort controllers and animation objects are runtime objects and are recreated after restore. They do not belong in a checkpoint. Unfinished model transcripts are not resumed after reload. Diagnostic history is stored separately and remains linked to the run.

Use different types/projections for spectator state, citizen observations and diagnostic evidence. A browser's omniscient view must never become citizen knowledge by accident.

## 3. Reload contract

### Frontend

Vite updates UI modules and styles without restarting the backend. Ordinary updates should retain selection, panel layout and open inspection context where possible. Persist these preferences across a full browser refresh; do not rely on HMR alone to preserve them.

The browser remains open during backend reload. Keep the last snapshot visible with a clear reconnecting/reloading indicator, disable unavailable controls and replace it with a fresh authoritative snapshot after reconnection.

### Backend

A small development supervisor debounces saves and coordinates a controlled restart. A watcher that immediately kills the process is not sufficient.

1. Stop ticking and dispatching new citizen turns at a command/tick boundary.
2. Invalidate the active turn generation and abort unfinished model/tool work. Complete any already-entered synchronous transaction before checkpointing; reject subsequent calls from the invalidated generation.
3. Save a consistent, atomic checkpoint before replacing the process. Already-committed messages, trades, memory updates and other effects remain committed. Preserve physical queues, input reservations and partial work.
4. Restart the backend, validate the checkpoint version and restore it.
5. Recreate runtime resources and schedule fresh citizen turns from persisted state.
6. Continue automatically only if the run was running before reload and restoration succeeded. A previously paused run stays paused.

Do not wait for the remote provider to finish processing an aborted request. Cancellation does not guarantee cancellation of billing. Paid usage and outstanding reservations remain durably accounted for, including conservative accounting when actual usage is unavailable. Do not replay a committed command or silently refund spending because a turn was interrupted.

Late responses must not modify the restored world. Carry explicit run/turn/generation identities through requests and command submission; abort signals alone are not the correctness boundary.

Time spent reloading does not advance hunger, resource regeneration or physical work. Rebase the runtime clock after restore; do not catch up elapsed wall-clock time. The browser also rebases presentation from the restored tick instead of extrapolating through the outage.

If checkpointing, startup or restoration fails, retain the last recoverable checkpoint and show the failure. Do not fall back to an empty world. If the old process is still available, leave it paused rather than resuming an uncoordinated experiment.

### Other edit types

| Edit | Expected behavior |
| --- | --- |
| UI/component/style | Frontend update; no simulation interruption |
| Prompt or nonstructural tuning | New turns/actions use a clearly versioned update at an explicit boundary; each active turn keeps consistent guidance |
| Backend mechanics/tools | Coordinated checkpoint/restart/restore |
| State schema | Explicit migration or visible refusal to restore; no silent reset |

Checkpoint compatibility is a development contract for spike 2, not an implicit promise to import spike 1 worlds. Preserve existing experiment data and spending records. An old-world importer is separate work if needed.

## 4. Game-like world GUI

### Presentation target

A top-down 2D world with readable tiles, recognizable citizens, resource deposits, stations, walls and bodies. Start with a small coherent placeholder sprite set. Visual clarity is required; bespoke art, 3D, complex animation systems and a polished asset pipeline are not prerequisites.

Characters should have a consistent silhouette, stable individual color/appearance and a selectable name/identity. Resources and station types need distinct shapes, with tier and stock/condition readable on selection. Do not rely on color alone. Render the center and rings distinctly without obscuring terrain or activity.

### Minimum animations and cues

| Situation | Visual evidence |
| --- | --- |
| Movement | Smooth movement between committed orthogonal steps, facing direction and a simple walking cycle |
| Harvesting | Repeated working gesture at the correct deposit, resource-specific icon and progress |
| Crafting/refining | Working gesture, item/station indicator and progress; success cue only after completion |
| Construction | A visible in-progress footprint that becomes the completed building when the world commits it |
| Attack/damage | Brief strike and target hit feedback; health/damage changes reflect committed outcomes |
| Depleted/regrowing deposit | Clearly different appearance; no claim of guaranteed future stock from an uncertain citizen memory |
| Eating, death, loot and birth | Brief committed-event cues, with bodies/loot remaining visible as required by the rules |
| No physical task or failed work | Distinguish idle/blocked from working, with a concise reason available on selection |

Reasoning is an independent status indicator, not an idle animation: citizens can think while physical work continues. Remote market settlement and global communication can appear in a feed or notification, but do not animate fictional meetings, couriers or hauling. Newborn citizens are immediately adult-capable; do not introduce a childhood presentation that suggests missing mechanics.

Multiple citizens can share a tile. Provide stable visual offsets and a selectable occupant list rather than overlapping indistinguishable characters. Offsets are presentation only and do not change coordinates or adjacency. Walls block movement but do not create sight occlusion.

### Making the world understandable

- Select a citizen to see name, activity, destination/target, progress, health/fullness and recent outcomes.
- Keep an optional activity label/icon close to each character; offer labels and overlays without permanently covering the map.
- Highlight the selected citizen's route/target, ownership and relevant work site. Label intended routes separately from completed movement.
- Support pan/zoom, follow selected citizen, pause/play, speed and tick stepping.
- Distinguish actual actions from model intentions. Goals and dialogue are not proof of work or completed exchanges.
- Offer spectator truth and a clearly labelled citizen-knowledge view. The latter renders only current sightings and dated memories; animations must not reveal unseen movement, work or stock changes. Public markets/messages and owner alerts follow the explicit exceptions in world.md.
- Keep an event feed for consequential outcomes, not every animation frame or routine movement step.

React owns panels and controls. A dedicated scene renderer owns presentation transforms/animation, driven by authoritative snapshots and identified events. Browser frame rate never controls mechanics. Deduplicate completion effects by event identity across reconnects; do not play the whole history again after restore.

Provide reduced-motion behavior and readable nonanimated status. At high simulation speeds, coalesce cosmetic effects rather than queuing an ever-growing animation backlog. Pausing freezes world motion; diagnostic stepping updates the displayed tick explicitly.

### Playwright access

Use normal HTML controls and inspectors with accessible labels and stable selectors. SVG entities should be selectable by stable entity identity; provide a roster and tile/occupant inspector as alternative access. Tests must not depend solely on sprite pixels or animation timing.

Expose application-ready/reload state and displayed run/tick identity. Playwright verifies visible behavior and controls. Direct APIs load fixtures, step time and fetch diagnostic detail, so agents do not need hundreds of browser clicks to reproduce a mechanical failure.

## 5. Debugging and evidence

Make the following available from the first vertical slice:

- Named scenarios and checkpoints: load an interesting situation rather than waiting for it to emerge again.
- Pause and advance one tick or a chosen number of ticks. World mechanics run with an injected clock; tests need no real-time sleeps.
- Live, scripted and recorded-response citizen modes behind the same interface. Only live runs evaluate live model behavior.
- A citizen inspector showing the exact observation/request, tool calls and results, goals/memory, action execution, scheduling reason, and acceptance/rejection reasons. Diagnostic evidence is not additional citizen knowledge.
- Correlated structured logs with run ID, tick, citizen, turn/request/command ID, code/config version and outcome. Retain committed commands and their application order/ticks for reproduction.
- Clear provider/validation failures. Fail open for citizen-planner faults: retain valid physical work and surface the failure. Accounting corruption or an invalid world invariant is not permission to continue unsafe mutations or spending.
- Development source maps and small modules that can be debugged directly, without chasing one generated bundle.

A seed alone cannot reproduce asynchronous live reasoning. Recorded responses plus command timing/order can reproduce a retained case under compatible code. Changing mechanics can intentionally change replay outcomes; do not claim exact historical replay across arbitrary code versions.

Log projected requests and receipts without credentials. Hidden provider reasoning is not required for diagnosis and should not be copied into public state. Record explicit omissions and retain recoverable detail where logs/results are bounded. Spending accounting remains independent of resets, checkpoints and diagnostic-log retention.

Start with a simple snapshot protocol and ordered, identified diagnostic events. HTTP commands plus snapshot polling are sufficient initially; use SSE if one-way updates simplify the UI. Reconnect always obtains a fresh snapshot. Do not make WebSockets or delta synchronization prerequisites for a smooth small-world scene.

## 6. Implementation sequence and acceptance gates

### Phase A: iteration foundation and visual proof

Build a tiny seeded world with a few identifiable characters, one timed action and a scripted/delayed planner. Establish the module boundaries, browser scene, controls, checkpoint format and development supervisor before implementing the whole economy.

Acceptance:

- A UI/style edit appears without restarting or resetting the world.
- A backend edit restores the same run/tick, inventory, reserved inputs and partial action progress, then continues.
- Reload during reasoning is quick independently of provider latency, rejects late commands and does not duplicate committed effects.
- Spending records survive interrupted reasoning.
- A paused world remains paused after reload, with no elapsed-time catch-up.
- Broken startup/incompatible restore leaves a recoverable checkpoint and a visible error, not a new world.
- A viewer can identify which character is moving, working or blocked. Playwright can select it and read its state.

### Phase B: mechanical world

Implement world.md using centralized, documented balance settings. Add resource/tool/station progression, physical action reservation and cancellation, markets, combat/death/loot, hunger and reproduction in scenario-tested slices. The current local controller may automatically manage survival, prerequisite production and social reactions under its policy.

Acceptance: initial survival and supply are viable; progression has no circular recipe requirements; inventory/gold/escrow are conserved according to the rules; concurrent harvesting, fills, death and loot cannot duplicate assets. Animate only implemented actions and committed effects.

### Phase C: citizen harness

Use rare, single-response structured policies over the continuous local controller. Default optional inference is local Qwen 3.5 9B with thinking disabled; exact configured cloud models are explicit alternatives. Preserve physical work during inference/failure, enforce finite durable budgets and global wall/hour admission, and never add correction calls merely to obtain valid output.

Compare compact dated symbolic known-world summaries and retained personal evidence on unfinished goals, changing relationships and interrupted work. Record whole-request size, acceptance, meaningful policy changes, downstream outcomes, latency and actual usage. Distinguish authored-rule aggregate emergence from model competence; a valid no-op policy is not a strategic improvement.

### Phase D: integrated observation

Complete the game-like action cues, market/message panels and linked diagnostic inspector. Run short live trials and retain replayable failures. Measure responsiveness, time from intention to action, lost/duplicated work, survival, progression, completed exchanges and spending. Fix diagnosed executor/tool/observation issues before adding more mechanics or broader prompts.

## 7. Implementation-time decisions

Scouting identified details to settle while implementing, not reasons for another planning phase. Start Phase A now. Choose the simplest workable approach for each slice, test it and revise from concrete failures. No broader architecture or game-engine survey is needed.

The fixed boundaries are the agreed mechanics, state preservation, no duplicated effects, durable spending accounting and citizen knowledge limits. Decide the implementation details at the point of use; verify recovery and accounting before relying on them with valuable runs or live requests.

The existing code supports these cautions: scheduling state lives partly in closures in [simulation.mjs](https://github.com/OwanL/prosper/blob/da9425f/lib/simulation.mjs); [checkpoint-run.mjs](https://github.com/OwanL/prosper/blob/da9425f/scripts/checkpoint-run.mjs) waits for reasoning to drain, which is not the chosen reload behavior; [resume-run.mjs](https://github.com/OwanL/prosper/blob/da9425f/scripts/resume-run.mjs) restores world data into a fresh runtime; and existing UI activity cues partly depend on status text rather than an explicit scene contract. These are references to learn from, not requirements to carry the old implementation forward.

| Implementation slice | Decision to make and verify within the slice |
| --- | --- |
| Phase A checkpoint/restore | Choose the versioned envelope, run identity, RNG/ID state and persisted scheduling fields. Test preservation of reservations/progress, round trips and incompatible restore behavior. |
| Phase A reload supervisor | Implement the handoff and acknowledgements. Test repeated saves, failed checkpoints, broken startup and recovery while the backend is absent. Use a transition table only if it clarifies the implementation. |
| Phase A request accounting | Link reservations to durable run/turn identity and handle interrupted usage conservatively. Test with fake requests before live spending; eventual usage receipts must not gain world-mutation authority. Verify provider pricing rather than inheriting assumptions. |
| Phase A scene and browser controls | Choose the small slice's snapshot/event fields, stable selection and reconnect behavior. Test readability, shared-tile selection, reduced motion and displayed run/tick identity. |
| Phase B actions and reproduction | Choose append/replace/continue semantics, queue reservation timing and failure behavior as those actions are built. Implement/test authoritative consent, cancellation and joint completion; text alone remains insufficient consent. |
| Delayed-planner slice, then Phase C tools | Choose turn overlap, review triggers and stale-command checks as needed. Implement coordinate queries/destination resolution without leaking remote truth. Reload invalidation does not replace ordinary live-turn validation. |
| Phase C continuity | Start with simple durable goals/execution and bounded notes. Test delivery of outcomes and unfinished intent across fresh turns; compare last-response retention or more elaborate memory only when evidence warrants it. |
| Phase C/D live trials | Choose a small common set of cases as comparisons are run. Record configuration, ordering, latency and spending; distinguish correctness/competence from observed emergence without requiring particular citizen strategies. |

Balance values explicitly delegated by world.md remain implementation choices too. Keep them centralized and check survival, supply, progression and conservation mechanically.

Record short decisions when they change observable semantics or affect recovery. Put game/citizen decisions beside their owning sections in world.md and citizen.md, and technical decisions here. No separate planning pass or new collection of research documents is required. Ask only if implementation would materially change agreed mechanics or scope. Investigate another renderer only if the visual proof exposes a concrete limitation.
