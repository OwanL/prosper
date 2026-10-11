# Genuine composed market/family evaluation — 11 October 2026

**Retained earlier market snapshot.** The tables and counts below describe that campaign, not the latest source. The latest bounded family trials are reported separately below; their metrics must not be mixed with this earlier campaign's **329 fills and 10-gold median execution price**.

No fixes, forced targets, inventory edits, scripted dispatches, models, persistence services or durable-world access. `npm.cmd exec -- tsx scripts/evaluate-market-family.ts` runs seeds 1/7/42 with 20 ordinary composed founders, a shared 270-second ceiling and 2,000-tick horizons. Spectator trace aggregation never feeds decisions.

## Actual run

All three completed 2,000 ticks in **170.32 seconds** combined (51.56 / 69.23 / 49.54 seconds; 38.8 / 28.9 / 40.4 ticks/sec). Each passed 21 numeric/JSON/vitals/custody checkpoints. Maximum gold drift was **0**; all retained 2,000 gold including escrow and estates. This is gold conservation, not item conservation (harvesting/consumption transform stock).

| Seed | Living | Births | Kills / other deaths | Fills | Execution price min / median / max | Buy proposals | Cancel proposals |
|---|---:|---:|---:|---:|---|---:|---:|
| 1 | 12 | 0 | 8 / 0 | 107 | 8 / 10 / 14 | 103 | 7 |
| 7 | 13 | 0 | 4 / 3 | 112 | 7 / 10 / 16 | 107 | 6 |
| 42 | 15 | 0 | 5 / 0 | 110 | 8 / 10 / 22 | 101 | 5 |

Execution histograms (price: fills): seed 1 `8:30,9:17,10:36,11:12,12:8,13:3,14:1`; seed 7 `7:1,8:3,9:26,10:52,11:27,12:2,16:1`; seed 42 `8:14,9:16,10:47,11:26,12:6,22:1`. These are actual event-backed executions, not merely requested asks. Buy-proposal median was 10 in every seed. Sell proposals numbered 108/113/110. Cancellation counts include cleanup, so **do not establish repricing frequency**. Tick-sampled two-sided books existed only 2/7/0 times; the nine observed spreads were 2 gold. Transient within-tick quotes are missing. Neither price diversity nor those sparse spreads establishes efficiency or profitability.

## Work and exploration

| Seed | Harvest success / failure | Earlier-competitor failures | Public-work acquisition failures | Depleted/reserved task failures | ObtainTool success / failure | Explore success / failure | Distance / Explore-associated distance | Unique visited / final dated-known tiles |
|---|---|---:|---:|---:|---|---|---|---|
| 1 | 148 / 53 | 12 | 19 | 14 | 1 / 20 | 569 / 12 | 3643 / 992 | 1479 / 390 |
| 7 | 120 / 55 | 23 | 20 | 13 | 4 / 16 | 885 / 23 | 4592 / 1511 | 1738 / 435 |
| 42 | 112 / 37 | 15 | 10 | 25 | 4 / 26 | 552 / 8 | 3906 / 1168 | 1344 / 400 |

Tile counts are sums of per-citizen unique sets, not unique world coverage. Distance is summed Manhattan movement; Explore-associated distance attributes movement to the active task observed after each tick, so boundaries are approximate. Final knowledge is bounded dated retention, not lifetime discovered area. Many exploration completions therefore do not imply proportionate new discovery. Position baseline starts after tick 1.

Competitor failure reasons explicitly say `Current competitor finishes earlier leaves no other known deposit ... under hard restrictions`; public-work failures say `Current public work leaves no viable acquisition route`. These establish controller responses to contention, not successful speed-optimal choices. The evaluator does **not** establish tool-speed decision quality. Tool-acquisition success is sparse; unavailable scythes account for 10/5/13 failures respectively. Core error events numbered 27/16/34; exact rejected deposit-busy attempts were not retained separately, so depleted/reserved task failures above are **not** that metric.

Other common failures: no feasible wood:1 route (13/20/27), unavailable sellers, interrupted work due to material danger/hunger, refused territory admission, and occupied house sites. Terminal tasks and trace failures were accidentally both counted in the original raw reason dictionary; the table divides matching duplicate counts by two. The script now counts terminal failures once and retains contention terminal evidence. Original task outcome counts were already single-counted. No physics was changed and no rerun is claimed for this aggregation correction.

## Zero-birth blocker

All seeds have **zero Reproduce traces and zero consent proposals**, rather than failed mutual-consent/rendezvous attempts. Every captured food market proposal is `food:1`; none is `food:2`. Trace-backed acquisition failures concentrate on T1 routes/public-work availability while exploration dominates. The strongest supported structural lead is **failure to reach family-provision eligibility before reproduction selection**, not consent expiry. `CanReproduce` requires own reproduction-tier food, sufficient health, cooldown and a known partner; candidate preparation discards infeasible candidates before recording a selected task. Family-provision candidates also require a feasible acquisition route. Consequently absence of Reproduce traces does not expose the rejected guard itself. **A definitive top blocking guard is not proved by this dataset**: per-tick prerequisite/visible-partner snapshots were not retained. Claiming specifically insufficient T2 food in every tick would exceed the evidence. A follow-up should retain guard rejection reasons and family provisions without reading any partner mind in decision code.

## Provenance and verification

HEAD `f861e9ce7d1f9db05555440d6dd604b50486454d`, substantial pre-existing tracked/untracked composed/world changes (not merely UI/tests). Full status and tracked-diff hash before/after are in the raw report; tracked diff hash stayed equal during the campaign. Untracked-source content is not hashed, so this is not a complete immutable snapshot guarantee.

Raw OS-temp report: `C:\Users\OWANLA~1\AppData\Local\Temp\prosper-market-family-ZQSKQ9\report.json`. This includes all captured trades, quote proposals, family events, task/trace counts and checkpoints. It is temporary evidence, not durable retention. No service was started.

`test/composed-market-family-behavior.test.ts`: **1 test passed**, three genuine 20-tick worlds with gold/checkpoint/automatic harvesting assertions. `npm.cmd run typecheck`: passed. No full-suite/build claim. Remaining evaluation gaps are explicit above; this result establishes genuine market fills, movement and lethal conflict, **not successful automatic families or economically efficient/tool-optimal behavior**.

## Subsequent implementation and bounded family evidence

The user-approved follow-ups are represented in current inspected modules: first-completion-wins harvest settlement replaces exclusive deposit reservations (`core.ts`); current visible competitor tools and estimated travel/work support completion comparison (`observation.ts`, `tree-harvest.ts`); adaptive asks and cancellation/reposting preserve exact attributed own-order fills and their persisted cursor (`tree-market.ts`, `tree-actions.ts`). Purposeful exploration investigates dated resource goals or unknown frontier tiles rather than guaranteeing discovery. Territory-owner colors and membership display, plus sortable citizen gold/carried resources, are present in `src/ui/model.ts`, `Scene.tsx` and `WorldActivity.tsx`.

For controls, open **Citizens → Sort by** (Territory, Gold, Carried units); rows show membership and resource totals, with **Resources by tier** expandable. Use **Settings → map layers** and **Map guide** for territory presentation. Unknown knowledge-view holdings are not replaced with spectator values.

The reproduction workflow now supports early voluntary consent and simultaneous independent preparation; the focused fixture succeeds. This establishes workflow feasibility, not natural uptake or a solved family rate.

Latest bounded final family trials used **seeds 3/7/11, 20 founders each, 2,000 ticks each**, with per-tick knowledge updates: **216 seconds combined, zero model calls**.

| Seed | Births | Attack events | Final living |
|---|---:|---:|---:|
| 3 | 0 | 31 | 18 |
| 7 | 0 | 3 | 20 |
| 11 | 0 | 47 | 18 |

Attack events are **not killings or death counts**; these metrics do not establish causes of population loss. Natural births remain zero in all three seeds, so family balance/uptake remains unresolved. Aggression is not automatically calibrated by these results.

Market, territory colors, citizen list, harvest competition and purposeful exploration are implemented and ready for testing, not accepted as economically efficient or tool-optimal. Historical “depleted/reserved” and competitor-failure counts remain their original labels; they are not current reservation mechanics or new rejection counts. This documentation update records supplied trial/fixture evidence only; it makes no new test/build/browser verification claim and changes no source or live data.
