# Production → trade → automatic meal: DEVELOPMENT conformance probe

Authored 2026-10-08. This extends the completed headless evaluation harness with one longer **real Prosper engine** fixture and an explicitly privileged scripted reference. No toy transitions, planner, training, candidate/model changes or sealed suite were added. No inference or services were used.

## Declared initialization

- Fixed creation: seed **7**, `progression`, **3** founders, autonomy enabled, maintenance disabled. Actor is creation index **0**, direct authority; both peers and any newborn are passive-body. The engine retains normal physical work, funded market settlement, regrowth, automatic meals and body damage/healing, without strategic rescue/controllers.
- Horizon **320 ticks**, cadence **1**, initial decision before tick 1. Default runner budgets remain zero model calls/tokens, 1,000 decisions, 1s/hook and 30s/episode.
- Generated 37×37 geography was inspected at authoring time. The actor's generated start `(27,2)` is explicitly pinned in the manifest. Unmodified `deposit-4` at `(6,1)` is T1 wood, stock/capacity 1. It is outside initial sight and becomes visible during real travel. No deposit, building, reservation or equipment mutation is used.
- Actor overrides: health 100, fullness 80, cash **0**, empty carried inventory. The food-endowment control instead receives **four T1 food**. Neither receives earned wood, equipment or fabricated history.
- Food seller overrides: health/fullness 100, cash 0, seven T1 food; posts a real resting sell for **four food at 4 each**, retaining three body meals.
- Wood buyer overrides: health/fullness 100, cash **16**, three T1 food; posts a real funded resting buy for **one wood at 16**, escrowing all 16 gold.
- Peers retain generated positions and policies. Inventory/vitals/funding overrides are authored endowments, not economically earned holdings. Setup goes through `initializeFixture`, strict schema, knowledge gate, dispatch and knowledge refresh; both orders are entirely resting. There is no replenishment or scheduled background trade.

The bid is an intentionally generous declared exchange opportunity, not evidence that this price/market naturally emerged or is economically optimal. The global market is remote: trade itself requires no trip to the counterpart. Travel here is to extraction, not a physical delivery mechanic.

## Reference and observed boundaries

`productionTradeReference()` is a **fixture-specific privileged comparator**, not an intelligent baseline. Its authored sequence is move, wait for accepted work to finish, harvest, wait, sell, buy, then advance. It uses the selected fixed deposit and quotes, never repairs/retries commands or supplies prerequisites. Only the existing runner commits commands and single ticks. This reference is not imported into candidate adapters, model prompts, retrieval or training.

| Boundary | Actual committed consequence |
| --- | --- |
| tick 0 | Move to `(6,1)` accepted; orthogonal path has 22 steps. No harvest has been supplied by the harness. |
| tick 44 | Move complete after 44 travel ticks; citizen sight includes `deposit-4`. Reference starts barehanded T1 harvest, duration 40. |
| tick 83 | No carried wood yet. |
| tick 84 | Harvest complete: one carried T1 wood, action idle, cash still zero. Reference sells it into the funded bid, filled quantity 1, **16 gold received**, no remainder. Real buyer holds that wood. |
| tick 85 | Reference buys four T1 food into the finite ask, filled quantity 4, **16 gold paid**, no remainder. Actor holds four food, cash zero; seller holds 16 gold. Fullness remains **71.5** immediately after purchase. |
| ticks 86, 87, 134, 245 | Actor's retained meal events and carried inventory show four automatic T1 meals. No eat command exists or was added. |
| tick 320 | Actor alive, health **100**, fullness **92.4444444444**, cash **0**, no food/wood/action/queue. Both orders exhausted; both passive peers alive with health 100. |

All four primitive commands passed the known-command gate and dispatcher. Each committed tick has its own current-sight `seenTick` knowledge update. The fixture is not a plan/queue macro, Local AI execution, or an authored stock sale masquerading as production.

## Controls and interpretation

The manifest's disclosed objective and existing runner `success` flag check only survival with health ≥100/fullness ≥85 at tick 320. The existing objective allowlist does **not** score production/trade; the dedicated test independently verifies the entire reference sequence and actual holdings/settlements above. A successful vital score alone must not be described as production capability.

| Episode | Actor food endowment | Commands | Final fullness / health | Vital objective | Production/trade |
| --- | ---: | ---: | --- | --- | --- |
| Privileged reference | 0 | 4 | 92.4444444444 / 100 | passes | Completed harvest, sale and purchase |
| No-command | 0 | 0 | 48 / 100 | fails fullness floor | None; both orders remain resting |
| No-command food-endowment control | 4 | 0 | 92.4444444444 / 100 | passes | None; both orders remain resting |

No-command actors stay at `(27,2)`, idle throughout, with no rescue or trades. The endowed control consumes its four carried food units automatically. Its matching endpoint explicitly exposes the benefit of authored food and the inadequacy of vitals alone as an intelligence metric. Failure of the unendowed control is **not death**: fullness drains gradually and no starvation occurs in this horizon. No impossibility, optimality, generalization or model-quality claim follows from any of these episodes.

## Reproduction and retained aggregate evidence

Files:

- `src/evaluation/development/production-trade.ts`: strict public manifests and separated privileged development reference.
- `test/evaluation-production-trade.test.ts`: initialized funding/authority, real work/trade/meal trajectory, both no-command controls and exact replay.

Run offline:

```powershell
npm.cmd test -- test/evaluation-production-trade.test.ts
```

The successful focused run passed **3 tests**, including all **3 complete 320-tick episodes** and exact real-engine replay of each. Every retained command/tick boundary preserved **16 total gold**, including escrow/loot, and each report had valid accounting, zero failures and **zero model calls/tokens**. TypeScript checking also passed. The test uses unique runner-owned OS-temp output directories and removes its task-owned traces after each test, including assertion failures. Only aggregate findings are recorded here, not raw traces; re-running regenerates them.

Replay reinitializes through public manifest APIs, gates/dispatches setup and recorded commands with declared authority, then applies each single tick/knowledge refresh, checking exact JSON state hashes. The reference metadata records a SHA-256 of its own source module, since the harness's fixed source-identity list does not include this new development subdirectory. Replay consumes the recorded command stream, not the reference implementation; it is deterministic boundary conformance, not a generic policy evaluation.

## Mechanics and evidence limits

- One deliberately selected development seed/site/opportunity, no held-out creation or claim. Fixed answers are suitable for conformance, not intelligence evidence.
- Reference performance is a feasible trajectory/lower bound, not a full-world optimum. The high wood bid and food supply are finite authored counterpart endowments, not natural market behavior.
- Normal runtime strategic policies and broader survival/family/combat/maintenance economics are not evaluated. The actor never reaches zero fullness and no equipment is used.
- Engine event coverage is labelled `bounded-ring-not-exhaustive`, not an emission ledger. Meal evidence is from per-boundary retained events plus inventory/vital consequences, with no extrapolation to unseen history or natural society totals. Market `CommandResult.order` certifies synchronous aggregate quantity/payment, not an exhaustive fill ledger.
- Paused cooperative in-process decisions, default budgets and exact replay are harness behavior. Hard process memory/CPU/search containment remains unknown/not enforced. No live inference, install/download, paid call, service, durable-data operation or commit was performed.

No manifest/mechanics blocker was encountered: current position/vitals/inventory/funding overrides and real counterpart orders express this bounded fixture without shared API changes. Production-specific objective scoring would need a separately approved contract change; it is deliberately not added here.
