# Evaluator-private held-out capability suite v1

**Access restriction:** this document, `src/evaluation/held-out.ts`,
`test/evaluation-held-out.test.ts`, and all resulting manifests, definitions,
verifier output and traces are evaluator-only. Candidate builders must not inspect
or retrieve them. Cooperative in-process execution is not a filesystem sandbox;
this restriction must be enforced operationally. The candidate receives only the
unchanged runner API v1 context, public objective, public command subset, ordinary
mechanics manual and citizen observations/feedback. No scored menu, reference
plan, simulator handle, privileged evaluator query or rescue strategy is supplied.

These are two fixed, authored initial fixtures in **real Prosper**, not natural
society histories, a toy economy, a broad seed search or evidence of model
intelligence. Both use seed **21**, `progression`, three citizens, autonomy data
present but evaluation authority `direct` for actor index 0 and `passive-body` for
both peers. Newborn authority is passive-body, although reproduction is outside
the disclosed command subset. Maintenance is disabled. No durable worlds,
services, provider calls or downloads are involved.

## Predeclared evaluation definition

Both episodes start at tick 0, have a **120-tick horizon**, cadence **one**, and
first decision before the first tick. Bodies pause during decisions. Each
accepted command goes through the known-command gate and synchronous dispatcher.
Each committed tick has its own knowledge refresh. Peers place only the finite
orders declared below during setup; they never replenish orders or choose actions.
Their meals, survival, death/refunds and ordinary body mechanics still apply.

Public command subset: `move`, `harvest`, `craft`, `build`,
`refine`, `cancel`, `order`, `cancel-order`. `advance` is the runner's no-command
decision, not a physical command. Excluding attack/loot/gifts/family keeps these
production tasks focused, rather than inviting acquisition through a different
capability. All commands retain existing core semantics, queues and refunds.

| Case | Authored actor endowment | Setup market | Disclosed task, in addition to survival |
| --- | --- | --- | --- |
| `tool-production-sale` | At (28,4), gold 6, wood:1 ×3; no food/tool/fibre | Peer 1 asks fibre:1 ×3 at 2; peer 2 bids food:2 ×1 at 12 | Produce and actually sell ≥1 newly harvested T2 food for ≥12 gold |
| `station-conversion-sale` | At (1,1), gold 0, wood:1 ×6, fibre:1 ×4, fibre:2 ×2; no food/tool/station | Peer 2 bids fibre:2 ×1 at 9 | Construct an owned production station, produce and actually sell ≥1 newly refined T2 fibre for ≥9 gold |

All bodies start idle, healthy (100), full (100), with no inventory tools or work
reservations. There is no separate equipment state. Tools are ordinary inventory
items; citizens automatically use the highest-tier matching available tool, excluding
sell escrow and work reservations, without equip/unequip commands. Tools remain
craftable and tradable. Peer 1 is at (2,1), peer 2 at (1,2). Each peer carries three T1 food units, plus peer 1's
three T1 fibre units in the tool case. Peer 1 starts with no gold; peer 2 starts
with exactly its funded bid's gold. Setup uses real order commands after knowledge
initialization, not hand-inserted order/escrow records. It must establish resting,
unfilled orders. Initial gold including escrow is **18** in the tool case and
**9** in the station case, and must remain exact at every boundary.

The tool actor starts on a real, visible T2 food deposit with stock one. The
station actor starts at a real empty build site. Tests validate those assertions
against this seed. No geography, deposits, buildings, events, memories, action
reservations or strategies are fabricated. Engine recipe tables remain authoritative.

Survival means alive at tick 120, health ≥100, fullness ≥70. This floor is
intentionally attainable without any decision: **vitals alone are not capability
success**. Task success additionally requires actual committed production and a funded
delivery of produced output. The station case also requires constructing an owned
station and producing there. Crafting, automatic matching-tool use and particular conversion
sequences are evidence of the private feasibility trajectory, not public required
milestones or verifier strategy gates. Alternate valid production paths count. Posting an offer or starting
work is insufficient. There is no requirement to liquidate remaining stock, close
orders, maximize gold or find an optimal plan. Work/order state at horizon is kept.

## Scoring and causal attribution

`runEpisode`'s existing `success` scores vitals only. Do not use it as this suite's
score. `verifyHeldOutEpisode` separately reports:

- Evidence counts for craft, matching-tool T2 food harvest, owned spinning-wheel
  build at any tier, down-conversion and up-conversion on that newly built station.
  Neither a knife craft nor a prescribed down/up sequence is required for scoring.
- Initial target-item endowment, qualifying produced units, all actual target
  sale units/gold, and conservatively attributed **delivered produced units**.
- Horizon status/reason, survival component, runner-vitals-only result, final
  accounting validity, exact replay boundaries/state hash, case/control identity
  and definition hash.

The verifier first uses the existing exact replay and source/setup reconciliation.
It additionally re-runs canonical `initializeFixture(heldOutFixture(...))` and
compares the actual initialized world, pre-setup world, setup log, actor ID and
authority options. Internally consistent artifact hashes do not authorize extra
endowments or another origin. Terminal failure markers must agree with report
status/reason: they cannot be relabelled as complete/horizon success. Legitimate
noncomplete terminal failures and teardown reason overrides remain reportable.
Focused regressions cover self-consistent extra stock and a final-feedback failure
whose report and completion record are both relabelled. These regressions are
authored only, pending parent-owned serial verification under the RAM gate.
It then reconstructs core commands/ticks and scores engine state transitions,
not candidate prose, public memories, an accepted-command label, or final vitals.
A production completion requires the prior action to finish and a new core
completion event. Construction additionally requires a genuinely new owned
building. Settlement must agree with counterpart target-item holdings. No strategy
is run during verification.

Because units are fungible, lineage is deliberately conservative. Initial and
purchased target stock is uncredited. Eligible T2 food harvests or fibre refinements producing T2 output at a newly
built owned station create produced credit. Both valid refinement directions count
when their actual output is T2 fibre, using the engine's output recipe.
Sales exhaust uncredited stock first; other losses, processing and consumption
exhaust produced credit first. Available inventory, reserved action inputs and
own sell escrow all count as ownership, so listing/canceling/reserving alone is
not delivery or destruction. Only actual settled sale quantity can earn delivery
credit. This can under-credit mixed-inventory strategies; it cannot turn sale of
endowed units alone into production success. The station task therefore cannot
pass by simply selling its endowed T2 fibre. Food eaten automatically cannot
substitute for a delivered unit.

These bounds have three citizens, short horizons and sparse events. Completion
records come from the existing bounded event ring, not an exhaustive emission
sink. Exact state replay validates transitions, but the suite does not claim a
complete lifetime trade/event ledger or general provenance tracking for arbitrary
long worlds. The declared fixtures and passive peers avoid intra-boundary event
floods. No final-buffer extrapolation is used for lifetime counts.

## Budgets, termination and controls

Fixed candidate seed **1**; reset via a fresh factory for each episode. Bounds:
1,000 ms per hook, 30,000 ms per episode, 100 ms teardown, 120 decisions,
16,384 output bytes per decision, **zero model calls/tokens**. This initial suite
execution authorizes only offline candidates. These are cooperative runner bounds,
not process/memory/search isolation; those costs remain unknown, not zero. Live
inference is not authorized or tested.

Termination is the existing runner contract: tick horizon or actor death yields
complete; episode/decision/resource exhaustion or unsafe cancellation is incomplete;
other runner/accounting failures are invalid. No free-running tail or inferred
success for incomplete runs. A replay or definition mismatch throws harness
invalidity rather than counting as candidate failure. No early task-success stop:
all scheduled 120 ticks are retained if execution can complete.

Predeclared controls, run separately for each case:

1. No-command baseline on the standard fixture. Exposes sufficient starting vitals
   and confirms no automatic strategic work, rescue or trading.
2. No-command baseline on `endowed-meals`, which adds exactly three carried T1
   food units to the actor. Automatic meals may improve vitals but cannot earn
   capability success. It is not pooled with standard-case results.
3. A simple immediate-market-only primitive baseline: one affordable input
   purchase in the tool case, or one endowed-output sale in the station case,
   then no commands. Real trade without the required work cannot pass.
4. Tool-case start/cancel control checks no completion credit and real ingredient
   refunds for unfinished work.

Private test scripts establish each standard fixture's feasibility via actual
production and settlement followed by exact replay. **Scripted evidence is
feasibility only**, not spontaneous planning, model intelligence, optimality or
out-of-distribution generalization. Recipes remain only in evaluator-private tests;
they are never added to candidate observations or the public mechanics manual.

## Stable evaluator interface and retention

```ts
heldOutFixture(caseId, control = 'standard'): FixtureManifest
runHeldOutCase(caseId, factory: CandidateFactory, control = 'standard')
  : Promise<{ episode: EpisodeReport; verification: HeldOutVerification }>
verifyHeldOutEpisode(outputDirectory: string): HeldOutVerification
```

`HELD_OUT_CASES`, `HeldOutCase`, `HeldOutControl` and `HELD_OUT_LIMITS` are stable
v1 evaluator-facing exports. The candidate factory is the unchanged
`src/evaluation/contracts.ts` API v1. Reference factories are not exported.
Calling `runEpisode(heldOutFixture(...), ...)` directly does **not** retain the
suite definition and is not a valid suite-scored run; use the wrapper.

The runner creates a unique OS-temp output directory with initialized world/setup
log/source hashes, immutable public mechanics, candidate metadata, observations,
decisions, single-tick boundary hashes and report. The wrapper additionally retains
`held-out-definition.json` with the exact manifest, limits, seed and full text of
all three evaluator-owned files plus their combined hash, and
`held-out-verification.json`. On verifier failure the wrapper retains an invalidity
record and throws `HeldOutVerificationFailure` with `outputDirectory`, so callers
can retain or clean up that run rather than lose its location. The verifier rejects
another definition, manifest, budget or candidate seed. Replay still requires the identical engine/runner source
identified by the initialization artifact; retaining evaluation text alone does
not archive the engine checkout. Caller owns approved retention/cleanup. Tests
remove only their own OS-temp outputs; no traces are retained in the repository.

Freeze candidate artifacts/provenance and fixture selection before a capability
run. Keep every planned failure, timeout, incomplete and invalid result, without
best-seed selection. No held-out result has yet established candidate intelligence.
If candidate revisions use these definitions/results, this split becomes
**development**, requiring new evaluator-owned held-out cases.

Planned verification: focused `test/evaluation-held-out.test.ts` with one worker,
then parent-owned integrated typecheck. Implementation handoff has **not** run
those checks: the user's fresh-available-RAM ≥1 GiB gate remained unsatisfied
(07:51:21Z check: 5,861,376 free bytes). The private feasibility assertions are
unverified until those checks pass. No services, inference or package/config/core/
adapter changes are required.
