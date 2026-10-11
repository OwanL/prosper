# Bounded genuine composed-controller evaluation (rerun 2)

Executed 11 October 2026 with `npm.cmd exec -- tsx scripts/evaluate-composed.ts`, against the integrated fixes (fractional food nutrition, real territory admission, failed-deposit cooldown, production/family work). Ordinary seeded founders, actual `createWorld({controllerMode:'composed'})` and `tickWorld`; no actor directives, mocked observations, model calls, services or durable persistence. New this run: **checkpoint validation every 100 ticks** (plus tick-0 and final): JSON serializability round-trip, full deep non-finite-number scan, gold-custody recheck, vital bounds (health/fullness 0..100), and an alive-with-health-≤0-after-settlement check. **Not a final immutable record**: the small starvation-interruption fix is still in flight; the source snapshot changed during no part of this run (before/after tracked-diff hash identical) but must be rerun after that fix lands.

## Results versus rerun-1 baseline

Same seeds and horizons as rerun 1 (overwrite of this file; that run's raw report remains in OS temp at `...\prosper-composed-eval-ug0tZY\report.json`). Columns follow the original table; deltas in parentheses versus rerun 1.

| Seed / founders / ticks | Living / deaths | Tasks succeeded / failed | Territories | Houses | Buildings | Trades | Attack events | Sleep / harvest / craft completions | ObtainTool s/f | births | ticks/sec |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|
| 1 / 20 / 1500 | 18 / 2 | 4449 / 281 (was 1380/921) | 0 (0) | 1 (9) | 0 | 138 (154) | 74 (29) | 132 / 366 / 15 | 3 / 64 (was 3/87) | 0 | 53.5 |
| 7 / 20 / 1500 | 18 / 2 | 3432 / 270 (was 1991/1025) | 2 (0) | 4 (12) | 0 | 168 (225) | 111 (42) | 134 / 373 / 13 | 1 / 64 (was 3/93) | 0 | 55.7 |
| 42 / 20 / 1500 | 17 / 3 | 5053 / 326 (was 2360/949) | 3 (0) | 2 (12) | 1 | 186 (191) | 75 (13) | 125 / 320 / 10 | 1 / 81 (was 3/178) | 0 | 56.4 |
| 7 / 100 / 300 | 97 / 3 | 5085 / 379 (was 2319/1170) | 1 (0) | 0 (1) | 0 | 535 (409) | 84 (98) | 83 / 358 / 9 | 2 / 84 (was 3/~) | 0 | 7.2 |

**What integration visibly changed (observed, not quotas met):**

- **Territory progression now establishes**: CreateTerritory succeeds 9/19/16 and ExpandTerritory 6/6/6 where all 129/31/76 attempts previously died at the knowledge gate. JoinTerritory succeeds 15/50/33/9 and LeaveTerritory 24/59/39/13, i.e. territory membership cycles through real admission instead of being unreachable. One and only one territory survived to the end in each run (0/1/3/1 retained at final tick).
- **Task failure mass collapsed** from 921/1025/949/1170 to 281/270/326/379; gold conserved to 0 error every sampled tick in all runs.
- **Houses dropped sharply** (9/12/12 → 1/4/2) against the identical `world.houses` metric, with BuildHouse task success matching the retained-house count. Cause not investigated here; recipe and rest rules changed since rerun 1, and buildings (`walls`) are now apparently counted in `buildings` instead of a separate wall count. Flagged as a regression-looking delta for the housing owner, not explained.
- **Predation persists without starvation support**: deaths 2/2/3/3, each matched by a `Defeated …` settlement completion. Victims died at fullness 56–98 (seed-42 citizen-168 at 93.9, throughput victims 93–97); the lowest recorded victim fullness was 39.1 (seed-1 citizen-171). No death in any run is attributable to starvation.

## Remaining observed gaps (all still absent after integration)

1. **Family progression remains a dead branch**: zero Reproduce task outcomes in all four runs — the task is never selected or never reaches a terminal observation — and zero births at every horizon. Whatever gates joint reproduction stays unmet in ordinary composed populations.
2. **Advanced production remains unreachable**: zero RefineResource and zero BuildResourceBuilding outcomes. CraftTool succeeds only 2/4/1/9 times against thousands of Explore successes; ObtainTool still fails 64/64/81/84 versus 1–3 successes, with recorded failures dominated by "Prerequisite failed" over deposit-depleted ObtainResource and "No seller is offering <tool>" (no supply, bids alone are not supply). The tool/refinement pipeline exists but the population cannot close it.
3. **Explore dominates and churns**: 2395–3931 successful Explore tasks per run and 2035–3474 consecutive repeated-Explore goals; Explore is roughly 75–80% of all successful work. Whether that is a legitimate information state or selection pathology is a selection-owner question, but at these horizons specialists do not emerge from exploration.
4. **Deposit-regrowth retry friction persists** in softer form: after cooldown handling, the dominant recorded failure is still "Deposit is depleted or reserved; wait for regrowth or choose another." (11/12/15/20 of the 30-captured failures per run; totals lower than rerun 1 but the pattern remains the top failure reason).

## Verification

- Determinism: seed-1 full 1,500-tick replay produced the **identical complete-world SHA-256 fingerprint** within this process/source snapshot. Throughput run included in-budget (total measured simulation ≈ 155s, wall-clock under the 5-minute budget; shared 270s ceiling).
- Checkpoint integrity: 16/16/16/16 checkpoints per run (tick 0, every 100, final), **0 failures, no issues found** — no NaN/Infinity anywhere in world state, all state JSON-serializable (no promises/timers), custody valid, vitals in range, no alive-at-zero-health citizens after settlement.
- Durable IO: `.prosper/` and `.prosper-v2/` file sets hashed before and after the run — byte-identical, both empty. No server or background service was started; the evaluator is single-process in-session.
- Source snapshot: HEAD `f861e9ce7d1f9db05555440d6dd604b50486454d`, heavily dirty with the composed implementation; tracked-diff hash `0418319e694b…` unchanged from before/after this run. Full status strings retained in the report. Because the starvation-interruption fix is ongoing upstream, **do not cite these numbers as a final benchmark**.

Raw evidence (OS temp, not repository/durable world data): `C:\Users\OWANLA~1\AppData\Local\Temp\prosper-composed-eval-KrRcep\report.json` — failure traces (30/run), 250-tick actor snapshots, final actor traces, counters, checkpoints and replay. Temporary evidence is not a permanent archived receipt.

`npm.cmd run typecheck`: passed. `npm.cmd test -- test/composed-behavior.test.ts`: passed (seeded 80-tick deterministic/custody test now also asserts checkpoint validation passes). No engine or controller files were changed by this task.
## Consent-free reproduction follow-up (2026-10-11)

Current reproduction costs one T1 food per parent with no consent/rendezvous. An isolated below-normal-priority seed-7 fresh composed trial (20 founders, 1,500 actual ticks, no model calls) produced **4 births, 3 combat deaths and 2 starvation deaths**, leaving 19 living. Checkpoint validation passed every 100 ticks (15 boundaries). Observed idle adjacent healthy/off-cooldown pair opportunities totaled 1,403 pair-ticks, including 499 with both T1 costs available; there were 2,442 prepared reproduction candidates and 6 distinct proposed reproduction commands. These opportunity counts are not unique couples or success-rate denominators. Earlier zero-birth runs remain historical evidence, not claims about this revision; stochastic selection does not guarantee births or survival.
