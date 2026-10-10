# Real-world headless evaluation: first vertical slice

This is a direct-primitive track in the actual Prosper engine. It imports core and observation modules, not Runtime, CitizenRunner, persistence, UI or a server. It starts fresh in memory. It does not read either durable Prosper directory or install/download anything. The default CLI remains offline; a separately gated development probe can use the already-installed local Qwen model.

## Offline conformance probe

```powershell
npm.cmd exec -- tsx scripts/evaluate.ts
npm.cmd exec -- tsx scripts/evaluate.ts --fixture sell-buy-meal --seed 7 --horizon 2 --cadence 1 --max-decisions 10 --decision-timeout-ms 1000 --episode-timeout-ms 30000
```

Supported fixtures: `buy-meal`, `sell-buy-meal`, `both` (default). Every invocation pairs the actual no-command adapter with the **privileged authored development reference**, on the same manifest. Each run is replayed and gold-accounting checked. JSON lines report actual results. Changing horizon/cadence may make even the reference miss the disclosed objective; the harness does not repair its actions.

The CLI writes incrementally to unique OS-temp directories and removes its owned outputs after reporting/replay, including on ordinary exceptions. It is not an evidence-export tool. No permanent retention/export option is included.

The default one-/two-tick fixtures are diagnostic conformance checks, not strategic capability trials. Authored endowments and resting funded quotes create the starting opportunity. The reference buys food, or sells its authored stock before buying, and the engine automatically eats it. Its success is a reference lower bound, not an intelligent candidate result or full-world optimum. No-command fails the disclosed fullness floor in these cases. There is no eat command or harness rescue action.

## Programmatic runner

Imports:

- `src/evaluation/runner.ts`: `runEpisode`, `replayEpisode`, `DEFAULT_LIMITS`.
- `src/evaluation/fixtures.ts`: strict `fixtureSchema`, `developmentFixture`, `initializeFixture`.
- `src/evaluation/contracts.ts`: runner-local candidate lifecycle using actual shared `Command` and `CitizenObservation`.
- `src/evaluation/candidates/index.ts`: actual no-command and replaceable local-model adapters. `src/evaluation/candidates/ollama-transport.ts` supplies the separately admitted task-owned local transport.

```ts
import { rmSync } from 'node:fs';
import { runEpisode, replayEpisode } from './src/evaluation/runner.ts';
import { developmentFixture } from './src/evaluation/fixtures.ts';
import { createNoCommandCandidate } from './src/evaluation/candidates/index.ts';

const report = await runEpisode(developmentFixture('buy-meal'), createNoCommandCandidate, {
  candidateSeed: 1,
  limits: { maxDecisions: 10, decisionTimeoutMs: 1000, episodeTimeoutMs: 30000 },
});
try {
  const replay = replayEpisode(report.outputDirectory);
  console.log(report.status, report.success, replay);
} finally {
  rmSync(report.outputDirectory, { recursive: true, force: true });
}
```

The API caller owns cleanup. Temporary artifacts remain until that cleanup; retaining/exporting them outside this lifecycle requires separate approval. Replay only accepts harness-named OS-temp directories and requires identical source and normative contract hashes. It replays real setup gates/dispatches, then every command and single tick plus knowledge update, checking exact world JSON hashes and command results. Replay requires an initialization record, an ordered decision/tick stream and completion record, reconciles decision counts/final state with `report.json`, and rejects empty/truncated traces. Explicitly incomplete episodes remain replayable through their actual retained termination boundary. No float tolerance is used to hide divergence. This is deterministic reproduction of retained boundaries, not a reconstructed exhaustive event ledger.

## Initialization and authority

Manifests explicitly set seed, scenario, population, autonomy, maintenance, actor creation index, authority for every created citizen, newborn authority, horizon, cadence, public objective, setup and endowment provenance. Supported authority is one direct actor and passive-body peers. Newborns default explicitly to passive-body. Engine control options are runner-owned metadata passed at every dispatch/tick, not added to World.

The initial override allowlist is deliberately small: citizen coordinates, health/fullness, safe integer gold and carried resource/equipment inventories with valid tiers and nonnegative safe integer quantities. Unknown fields, duplicate/unknown citizens, out-of-map coordinates, zero-health actors, incoherent equipment and nonidle strategy/work state are rejected. No building/deposit/reservation/equipment mutation API is offered yet. Creation endowments are not earned history. Gold baseline is recomputed after endowments, including real holders/escrow/loot.

Setup permits only counterpart orders. Each goes through strict structural validation, `validateKnownCommand`, real `dispatch`, then `updateKnowledge`. Each must remain wholly resting with the declared quantity; unintended setup matches or insufficient funding reject initialization. No order/escrow record is inserted by the harness and no liquidity is replenished. Local-AI peers and scheduled backgrounds are intentionally not implemented in this slice.

## Decisions and privilege

A fresh factory instance resets each episode with public mechanics/objective/cadence/horizon/limits and a candidate seed. Each decision receives a detached recursively frozen citizen observation and request ID. The candidate receives no manifest, world seed, split label, evaluator state, counterpart private holdings or reference actions. Public market quotes and geometry are the existing observation projection, not an evaluator menu. The frozen public manual is source-derived and hashed; both adapters use that same extract.

World bodies pause during reset/decide/feedback. The strict runner independently decodes one real command or runner-level advance, checks request ID and any public command subset, then performs the knowledge gate and dispatcher. It does not repair, retry, insert prerequisites or convert advance into work. Knowledge refresh follows each command boundary. Cadence advances one tick followed by one knowledge refresh at a time, clamped to the remaining horizon and stopped on actor death or exhausted runtime budget.

Malformed/contained decision timeouts make no command and consume only normal cadence while episode budget remains. Gate rejection and engine rejection are distinct. Immediate observation, command result and subsequent per-tick observations are feedback; privileged audit records are never feedback. Acceptance is not completion. Orders/work remain open at horizon; there is no liquidation or invented inventory valuation.

## Resources and supported execution

Defaults: 1,000ms per lifecycle hook, 30,000ms episode wall budget, 100ms teardown, 1,000 decisions, 16,384 output bytes, zero model calls/tokens. Numeric model ceilings and optional per-decision ceilings are configurable. Actual wall/candidate/engine/knowledge/trace elapsed costs, output bytes and achieved ticks/sec are recorded for the post-initialization loop. Initialization/source hashing and observation projection are not separate performance benchmark measurements.

Only **audited cooperative in-process** candidates, injected **mock** transports and the actual audited `OllamaTransport`/`LocalModelCandidate` implementation are admitted. Arbitrary live metadata or an injected transport declaring `local` does not grant admission. The local path additionally requires explicit positive call/token ceilings and an exclusively task-owned lifecycle controller; it is not adversarial containment. A mock candidate must expose cumulative accounting and enforce reservations before transport calls. The shipped adapter reserves its configured input+output token bound, reconciles valid mock receipts, and retains conservative charges for missing/invalid/late usage. Injected mock counters are not provider evidence. The audited local transport verifies exact installed GGUF identity/digest/size and byte-based tokenizer metadata before every generation, bounds response bodies, disables thinking/streaming, sets deterministic decoding and context/output limits, and reconciles actual Ollama receipts. Its conservative input bound counts UTF-8 messages plus schema and template bytes with generous formatting overhead; it does not assume an average bytes/token ratio or silently prune the current observation. The runner checks episode and per-decision deltas before any execution. Candidates signal an unaffordable next episode reservation with `CandidateBudgetFailure('episode', message)`; the runner stops incomplete before cadence even when reconciled usage is below the nominal ceiling. A per-decision reservation refusal with otherwise available episode funding is a contained no-command failure, not episode exhaustion. Unknown usage is not zero and stops incomplete. Unsupported usage/capability and accounting errors are not candidate judgment scores.

Abort deadlines revoke authority to commit; no asynchronous callback can dispatch a late result. The runner waits boundedly for hook settlement. Underlying operations must also be declared by `getUsage().pendingOperations`; a hook returning while its transport remains pending is unsafe, stops before cadence and blocks reuse. Teardown has its own deadline. Synchronous runaway code cannot be preempted in process, and hard process memory/CPU/search limits are **not enforced**; memory/search usage remains explicitly unknown. This is not an adversarial sandbox. The authorized task-owned Ollama development path adds observed process-tree shutdown and sampled headroom stops, not a hard OS resource sandbox. On HTTP failure or abort its operation remains pending until owned shutdown succeeds; failed shutdown never becomes a successful cancellation receipt. A broader isolated/adversarial or paid-provider track still requires separately approved containment/accounting work, not merely positive limits.

## Opt-in installed-local development probe

```powershell
npm.cmd exec -- tsx scripts/evaluate-local.ts --confirm-local
```

This selects only the already-installed `qwen3.5:9b`, pinning the catalog digest and GGUF metadata. No pull/install/cloud fallback/retry occurs. It creates fresh in-memory fixture worlds, pairs no-command and privileged reference with the candidate on both existing development fixtures, and runs at most **three candidate calls**, **60,000 input + 256 output reserved tokens per call**, **65,536 context**, **90 seconds/decision**, **120 seconds/episode** and **five minutes overall**, with a separate **10-second teardown hook**. The world pauses during inference. The declared one-entry/1,024-byte history may omit oversized feedback with omission counts; current observations are not truncated. These larger token/context limits are conservative byte-based safety reservations, not expected actual token use.

Before any service or generation starts, exact RAM/VRAM readings must show **6 GiB free host RAM and 7 GiB free VRAM**. Planning accounts for roughly 2 GiB FP16 KV at 64K context in addition to 6.6 GB weights and runtime overhead, allowing partial GPU offload. That estimate is not a measured peak. During an owned run, sampling stops inference below 1 GiB free RAM or 128 MiB free VRAM or on inspection failure. Sampling cannot preempt transient allocation peaks; hard memory/CPU ceilings are not enforced.

A distinct loopback Ollama process uses one loaded model, one parallel request, cloud disabled and zero keep-alive. Listener PID ownership and captured process creation identities are checked; teardown kills only the owned tree/retained matching runner identities and verifies their exit and listener disappearance. This is bounded cooperative lifecycle management, not a Windows Job Object or proof against adversarial descendant escape. No shared Ollama service is stopped or unloaded. All logs/traces use unique OS-temp directories and are removed on confirmed ordinary teardown. Unconfirmed teardown is an unresolved failure, not a clean completion or successful cancellation claim.

The probe emits actual decision/result/outcome/usage/replay summaries only for episodes that ran. A failed preflight emits a blocker with **zero generation calls**, not a model score. No development results are sealed-suite evidence. See the working research checkpoint for the current measurement status.

## Artifacts and interpretation

Each episode writes:

- `initialization.json`: exact initialized world, pre-setup world, real setup results/hashes, endowment manifest, resolved actor ID, mutable authority copy, source/contract/manifest/world hashes, candidate provenance/seed, limits and public manual.
- `trace.jsonl`: incremental initialization, decision/failure, every single tick, termination and completion records; exact delivered observations, bounded candidate output or oversized hash/size, audit-only raw provider/mock response captured before decode (including malformed responses, and size/hash only when oversized), results, usage, privileged state hashes/holdings/orders/loot and newly retained events. Raw provider responses are never feedback/prompt history; stale or late responses are excluded.
- `report.json`: completion/incomplete/invalid reason, actual ticks/decisions, health/fullness/cash/inventory/work/order components, accounting, resource costs and objective success.

Events come from the bounded engine ring, labelled **bounded-ring-not-exhaustive** at every boundary. There is no passive full-emission sink and no claim of exhaustive fills/meals/damage/births/cancellation sequences or intra-boundary ordering. Actual synchronous order result quantities and per-boundary state/replay are retained independently. An accounting/replay mismatch invalidates harness evidence rather than establishing poor candidate decisions.

Only two development fixture families are included. `held-out` is a private manifest label supported by the schema, not evidence that a sealed suite has been selected/evaluated. No held-out cases/reference traces are shipped to candidates. Any future sealed selection must stay outside candidate prompts/retrieval/training and freeze candidates first. The tiny reference checks and mock protocol integration establish real-engine correctness only; they establish no generalization, model quality, natural-history emergence or deployed policy-controller performance.

## Verification

```powershell
npm.cmd test -- test/evaluation-harness.test.ts test/evaluation-candidates.test.ts test/evaluation-authority.test.ts
npm.cmd run typecheck
```

Coverage includes real buy/meal and sell/buy/meal replay, no-strategist critical hunger, initial funding, rejection timing, partial/resting fill and cancellation refunds, candidate craft/queue completion, movement knowledge updates, death settlement, cadence clamping, immutable observations, bounded output, late results, unsafe pending operations and actual adapter mock accounting. Existing engine-focused tests cover wider body/authority mechanics; these checks do not duplicate a simulator.
