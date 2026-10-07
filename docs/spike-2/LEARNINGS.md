# Spike 2: implementation decisions and learnings

## 2026-10-07: first integrated implementation

### What exists

The new branch starts from `main`, not the old spike's mechanics. TypeScript world, citizen runner and runtime share serializable contracts. React/Vite presents an animated SVG world with normal HTML inspectors and controls. The mechanical rules in world.md are implemented, including markets, walls, combat, death/loot and joint reproduction. Scripted mode is the default and is always labelled; recorded and live modes are explicit.

The first spike and its original designs are preserved in commit `da9425f` on `spike/citizen-sandbox`. Design documents were backed up outside the checkout before branching, then copied into `docs/spike-2/` so work no longer requires branch switching. Old `.prosper/` data was not touched. Spike 2 uses `.prosper-v2/`.

### Decisions made while building

- **Queues:** replace by default, append explicitly. Inputs reserve when an action starts, not while queued. Invalid replacements retain valid current work. Queued actions revalidate on activation; failed queued actions report their error and allow following entries to try.
- **Sight:** Manhattan radius 3, centrally configured; walls are transparent. Other citizens' private plans/inventory remain private. Physical entity targets need current sight; travel to dated coordinates first. Public markets/messages and addressed owner alerts remain explicit exceptions.
- **Construction:** visible site required when work starts, including queued activation. While an accepted build detours outside sight, it does not probe remote occupancy. Dynamic prerequisites are checked again when visible and before completion.
- **Physical time:** one authoritative tick loop, separate from reasoning and animation. Browser refresh, reload downtime and animation frame rate never advance the world.
- **Reproduction:** explicit consent to each other, expiring after 100 ticks; both parents occupied for 24 ticks. Each pays 3 T2 food, requires health 75 and receives a 1,000-tick cooldown on completion. Cancellation returns each parent's unconsumed reservation. New citizens start health 100/fullness 60 with no holdings or minted gold. See `src/world/config.ts` for current balance authority.
- **Continuity:** durable goals, bounded dated notes, execution/queue and last result; fresh model context each turn, without carrying a hidden reasoning transcript. Context includes parents and consent/cooldown state. More elaborate memory is not justified yet.
- **Reload:** an independent supervisor and stable API proxy coordinate checkpoint acknowledgement before child termination. Aborting requests alone is insufficient: generations/run/turn identity block late commands. The checkpoint retains runtime intent, fixture consumption and world state; a resumed clock starts a new interval with no catch-up.
- **Accounting:** independent append-only request/token ledger, reservation persisted before transport, uncertain requests still charged. This is not a verified dollar budget. Old reference USD prices were deliberately not reused.
- **Timeouts:** bounded live-request deadlines release stuck thinking slots while preserving uncertain charges and physical work. Default is 120 seconds; late usage receipts may reconcile accounting but cannot apply commands.
- **Rendering:** SVG was sufficient for the implemented scene. Shared-tile offsets, distinctive sprites, motion/work cues, a roster and normal HTML dossiers provide useful readability and automation. No game engine was needed.

### Concrete problems found and corrected

1. **A stale deposit is not a live target.** The initial scripted planner repeatedly attempted to harvest a remembered deposit outside sight. It now travels to the dated location before trying, and explores unexplored frontiers rather than bouncing along the map boundary.
2. **Validation can leak knowledge.** An unseen wall construction request initially exposed whether another citizen occupied/reserved the tile. Visibility gating and deferred out-of-sight revalidation now prevent that tool path from disclosing remote activity.
3. **Historical citizens are not permanent corpses.** Keeping dead citizens for history initially left a second visible entity after loot collection. Living projections and separate body/loot records now reflect disappearance correctly while retaining dossiers.
4. **Noncooperative requests need a local deadline.** An ignored abort or hung provider must not occupy every citizen reasoning slot forever. Deadline tests cover slot release and late-response rejection without stopping the world.
5. **SVG browser focus behavior matters.** Chromium's default large SVG focus outline obscured the scene. Explicit keyboard focus styling retains accessibility without covering the map.

### Evidence collected

- Core tests exercise tier progression, travel/work reservations, cancellation, owner-only processing, exact escrow settlement, destruction, death loot, consent and joint-action cancellation.
- Runtime tests exercise actual child IPC handoff, corrupt/incompatible restore refusal, partial work and paired-action restoration, no downtime catch-up, repeated saves and late provider responses.
- Headless browser tests exercise selection/dossiers, play/pause/step, knowledge mode, camera controls, keyboard/reduced motion, selection persistence and actual backend restart with run identity preserved.
- Image-capable browser inspection found recognizable humanoid characters, distinct resources and readable work progress/dossiers. Names are small at full-map scale; zoom and roster are the available alternatives. Mobile layout avoids horizontal overflow.
- A scripted `progression`, seed 1, 360-tick trial kept all 3 citizens alive, completed 20 harvests and 2 crafts, and preserved all 300 gold. Three depleted-deposit command errors were reported rather than hidden.
- A scripted `village`, seed 1, 1,200-tick trial kept all 6 citizens alive, completed 255 harvests and 36 crafts (including higher-tier equipment), and preserved all 600 gold. Forty depleted-deposit errors show contention remains useful diagnostic evidence; no provider requests were made.

These scripted trials demonstrate mechanics and iteration tools, not spontaneous cooperation, trade, reproduction or conflict. The scripted planner currently does not construct stations or exercise every implemented rule.

### Remaining empirical questions

- Ollama's local catalog is reachable and includes `deepseek-v4.1-flash:cloud`. No inference was performed during implementation. Actual cloud access, high-reasoning/tool compatibility, usage reporting and live citizen behavior remain unverified.
- Request/token limits are conservative accounting controls, not verified billing prices or a dollar spending cap.
- Recorded fixtures can reproduce tool-response sequences with no paid calls. They are not an automatic exact historical replay across asynchronous timing or changed mechanics. Diagnostic command ordering/ticks provide evidence for constructing retained cases.
- Memory effectiveness, observation size, spatial competence and review cadence need short live trials. Start with observed failures and completed work, not more systems or prompt complexity.
- Checkpoints persist on coordinated reload or explicit save. Abrupt crashes do not recover every unsaved tick; no crash-proof event-sourced guarantee is claimed.

## Next experiment

Start the app, inspect the scripted run, then deliberately enable a small live run once cloud access and the desired spending policy are confirmed. Keep the existing limits conservative. Retain diagnostic evidence of the first lost intention, bad coordinate or rejected action, and reproduce that case before changing prompts or memory architecture.
