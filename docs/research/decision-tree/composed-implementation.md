# Composed Local AI — implementation checkpoint

11 October 2026. The user subsequently authorized implementation and integration of the composed controller and agreed mechanics. This supersedes the earlier documentation-only planning scope; it does not retroactively change the provenance of those decisions. Implementation is not final quality acceptance.

## Runtime boundary

Fresh runtime worlds, resets and scenario replacements now default to `controllerMode: 'composed'`, paused in Local AI (serialized mode `scripted`), without model calls. `src/server/runtime.ts` bypasses the legacy runner for this mode and rejects Live/recorded inference. Low-level `createWorld` still supports legacy mechanics fixtures; restored untagged checkpoints are explicitly legacy, not silently converted. Existing citizens, policies, accounting and saved worlds are preserved. No durable-world migration/reset is implied.

The legacy controller and optional policy-model path remain compatibility/debugging behavior for legacy worlds. An optional disposition-update director with no required LLM was discussed; **it is not implemented**. Stored director scheduling fields/constants do not establish an active review service, nor approval to remove that proposed role.

## Executable composition

- `src/world/tree-controller.ts`: citizen-observation candidate preparation, stochastic goal/task selection, sequential idle-boundary execution, interruption, prerequisite delegation and bounded traces. Immediate material prerequisites are not a long-term planner.
- `src/citizen/tree-actions.ts`: pure guards and executable actions, ancestry exclusions, command feedback, request-owned work/order cleanup and net-delivery evidence. Acquisition, tools, construction, exploration, commerce, gifts, reproduction, combat and territory tasks have implementations; availability of a task is not proof of successful population progression.
- `src/citizen/tree-selection.ts`: seeded softmax over feasible prepared alternatives, ten 0..1 dispositions: ambition, morals, generosity, risk tolerance, patience, sociability, vengefulness, family orientation, enterprise and economic independence. Personality biases probabilities rather than granting permissions or imposing personality hard cutoffs. Ongoing commitments are not resampled every tick.
- `src/citizen/tree-memory.ts`, `tree-spatial.ts`: bounded structured experience and citizen-relative spatial scoring. Estimates remain provisional and knowledge-limited.
- `src/shared/tree-types.ts`, `territory-types.ts`: serializable mind/task/receipt and territory contracts. `src/world/core.ts`, `territory.ts`, `reputation.ts`, `life.ts`, `market.ts`, `observation.ts` integrate physical mechanics, witnessed social consequences, estates, fractional settlement and knowledge gates.

Composed worlds replace separate alliances, ground loot and building trading with reputation, marked membership/shared use and estate settlement. Legacy worlds retain their previous systems. Composed checkpoint validation refunds obsolete building escrow, removes resource-free disabled state, and fails visibly on unresolved loot custody or incompatible inference mode rather than discarding assets (`src/server/checkpoint.ts`).

## Provisional mechanics, not tuned balance

`src/world/config.ts` is authoritative: 2 chosen-tier wood per marked tile; 15% same-kind/tier harvest tax to current owner; sign health 16, attack duration 8 ticks, deliberate destruction recovery 50%; admission and offense cooldown 120 ticks. Quantities use finite JS numbers with 1e-9 accounting tolerance, not fixed-point integers.

Rest maximum 100, awake drain 0.1/tick, fatigue threshold 20 and physical-duration multiplier 1.5; outdoor recovery 2/tick, house base recovery 4/tick, minimum sleep 8 ticks. Exact-tier house recipe is `2 × 2^(tier-1)` wood and `2^(tier-1)` fibre. These implementation defaults resolve first-version details provisionally; they do not establish an optimal commute/work/rest economy.

## Evidence and remaining gaps

`test/composed-contracts.test.ts`, `composed-cognition.test.ts`, `composed-controller.test.ts`, `composed-tree-actions.test.ts` cover local contracts. `composed-engine.test.ts`, `composed-territory.test.ts`, `composed-life.test.ts`, `composed-market.test.ts` exercise actual mechanics; `composed-runtime.test.ts` covers fresh defaults, legacy restore and custody compatibility. `composed-ui.test.ts` covers inspection boundaries. Draft/render tests still validate descriptive graphs, not executable composition. Test presence is not a claim that final integration verification has passed.

The [current bounded evaluation](composed-evaluation.md) reports genuine seeded harvesting, crafting, sleep, trade, gifts, houses and consequential predation, with zero model calls. It also reports **zero births, territories, refinement completions or resource-station builds** at its horizons, retry churn and territory knowledge-gate failures. Subsequent source changes include failed-deposit cooldown handling; the evaluation used a concurrently changing checkout and must be rerun after integration stabilizes. Do not treat that report as a final-source benchmark or assume its failures are resolved merely because code changed.

## Requested follow-up implementation status — 11 October 2026

Source inspection, not a new evaluation: the user approved **first completion wins** harvesting, replacing the earlier deposit-reservation assumption. `src/world/core.ts` permits competing harvest work; stock is checked at start and authoritative yield settles at completion. Work is not a guaranteed unit or an exclusive deposit lock. `src/world/observation.ts` exposes current visible harvest work with estimated remaining travel/work time and matching tool tier; `src/citizen/tree-harvest.ts` compares completion estimates and known stock/regrowth. Dated sightings are not current competitor locks, and estimates do not guarantee victory.

`src/citizen/tree-market.ts` prepares adaptive quotes from effort, dispositions, visible orders, witnessed executions and waiting age. `SellResource` in `tree-actions.ts` revises an aged unfilled ask through cancellation/reposting, preserving confirmed partial sales. Sale completion uses exact attributed own-order trade evidence and a persisted event cursor; disappearing orders and resting quantities are not fill evidence. These are implemented heuristics, not proof of profitable or efficient pricing.

Exploration now retains purpose: `tree-actions.ts` can investigate dated requested-resource evidence or choose an unknown frontier near known land. Reaching a frontier provides information, not guaranteed resource discovery or progression. The current reproduction workflow (2026-10-11) supersedes consent/rendezvous: adjacent eligible parents each reserve one T1 food, with no consent required. Completion creates one adult-capable citizen; interruption refunds the recorded costs, including restored historical 3-T2 commitments. Natural family balance remains unresolved; seed-7 evidence below establishes births, not a guarantee.

Latest bounded final family trials: **seeds 3/7/11, 20 founders, 2,000 ticks each**, per-tick knowledge updates, **216 seconds combined and zero model calls**. Births were **0/0/0**, attack events **31/3/47**, and final living **18/20/18**. Attack events are not killings/deaths and do not establish causes of population loss. Neither natural family rate nor aggression calibration is solved by this evidence.

### Where to see it

Open **Citizens → Sort by** for Name, Status, Territory, Gold or Carried units. Rows show membership/owner role, gold and concise carried-resource totals; expand **Resources by tier** for detail. Carried units are not wealth and exclude escrow. Unknown values stay unknown in knowledge view. Territory marks and citizen swatches share owner-based colors; selection distinguishes owner/member/nonmember boundaries. Use **Settings → map layers** for territory visibility and **Map guide** for interpretation. Color is membership presentation, not proof of friendship or permission.

Market, colors, citizen list, competition and exploration are implemented and ready for testing. The latest family evidence is recorded separately in the [market/family report](market-family-evaluation.md); its earlier **329 fills and 10-gold median** remain an earlier snapshot, not current metrics. This documentation update records supplied trials and fixture results, not newly executed test/build/browser verification.

Outstanding acceptance: reproducible stabilized reruns, advanced production/family/territory progression, forecast and selection quality, lifetime predation balance, full material-flow accounting evidence, runtime/browser throughput and richer stepping/visualization. Bounded traces/inspection are not the full proposed interactive debugger. No LLM quality or spontaneous intelligence claim follows from local rule composition.

## Consent-free reproduction follow-up (2026-10-11)

Current reproduction costs one T1 food per parent with no consent/rendezvous. An isolated below-normal-priority seed-7 fresh composed trial (20 founders, 1,500 actual ticks, no model calls) produced **4 births, 3 combat deaths and 2 starvation deaths**, leaving 19 living. Checkpoint validation passed every 100 ticks (15 boundaries). Observed idle adjacent healthy/off-cooldown pair opportunities totaled 1,403 pair-ticks, including 499 with both T1 costs available; there were 2,442 prepared reproduction candidates and 6 distinct proposed reproduction commands. These opportunity counts are not unique couples or success-rate denominators. Earlier zero-birth runs remain historical evidence, not claims about this revision; stochastic selection does not guarantee births or survival.

## Current food, trade and quantity behavior

Food bids adapt to personal known prices across food tiers, account for fractional nutrition, and pace spending against a half-budget allowance per cadence. Background surplus offers preserve the citizen's own survival runway, committed recipe inputs and owned tools, except when urgent food funding takes priority. Procurement may explicitly support a committed family goal; reproduction itself remains one T1 food per parent. Meal eligibility compares the nutrition of the actual available portion, so partial food can satisfy a meal without waiting for a full unit.

Task quantity accounting is explicit and optional, retaining compatibility with older tasks that omit it. Quantity is carried as quantity data, never inferred from coordinates. These are current practical behaviors, not claims of profitable markets or balanced population outcomes.
