# Six-tier economy and spectator update, 8 October 2026

## Procedural-ring follow-up

The user clarified that adding tiers must also add concentric bands, rather than putting every advanced tier in the old center. Current fresh worlds use `RING_COUNT = 6` in `src/shared/tiers.ts`: base tier `RING_COUNT - ring`, with seeded 5% next-tier rarity and no clamping of the center. This gives supported T1–T7; changing the ring setting derives map size, tier lists, balance tables, refinement bounds, item patterns, checkpoints, model contracts and economy display. The first deposit per resource/band stays base tier to preserve viable starts.

New worlds persist their ring count. Saves without that metadata retain original three-band rendering and existing deposits. No existing world is reset or regenerated; Reset world explicitly archives and creates the new layout. Increasing the configuration is covered through multi-digit tiers; lowering it below tiers held in a save can make that save incompatible and is not a migration operation. The earlier six-tier trials below remain historical evidence, not procedural-map performance claims.

## Earlier rules and compatibility

Fresh village worlds use 20 founders. Resources, equipment and buildings span T1–T6. Equipment/construction costs are their original T1 recipe multiplied by 1, 2, 4, 8, 16 or 32, always using the output's exact tier. Adjacent upward processing costs three units for one output; downward processing costs one for two outputs. Owner-operated matching stations must be at least the lower tier. Conversion takes physical work and is not unattended production. Autonomous ingredient preparation can down-convert available higher stock.

Alliances consolidate existing member claims into one representative-owned rectangle instead of taking a union of their land. Members prefer shared grounds and can enforce/defend them. Succession preserves the claim after departure/death. Automatic claims favor unclaimed nearby known deposits with a small footprint; explicit rival overlap remains legal. Paid territorial access is persisted on the claim and honored by every member, unlike personal protection payments.

Existing populations, deposits, policies, ledgers and completed buildings are preserved. In-progress legacy craft/build reservations accept their exact original T1–T3 costs; arbitrary partial reservations remain invalid. Old refinement commands without a direction still go up. New tier distribution/default population applies only to new worlds, not automatic save migration. Reset archives the current world and preserves accounting.

Focused tests cover every conversion boundary, exact refunds, six-tier recipes/market/eating/schema/checkpoint behavior, local down-conversion, alliance succession and toll permissions. A normal seed-7 autonomous run reached 12,000 ticks with 25 living citizens, tools through T3 and active T4 goals. This is evidence of slower progression, not completed autonomous T4–T6 production or fully tuned late-game balance.

## Presentation

Economy separates carried items, work/sell reservations (including suspended emergency work), and unharvested deposits. Production/station use describe current actions, not completed output. Market quotes are separate from execution prices. Trade volume covers retained receipts only and can omit older events.

Combat lists current attackers and targets separately from recent strikes. Shared claims name the alliance and members; hatching marks competing demands, not actual fighting. Labels and attack cues have separate map toggles.

Headless before/after captures used isolated temporary persistence, no model calls or saved-run mutation. Representative 100-person combat and empty-combat captures used browser route mocks, not emergent-world evidence. Screenshots were inspected for clipping/readability; expanded panels remain scrollable without collapsing the map.

Temporary visual evidence:
- Before: `C:/Users/OwanLazic/AppData/Local/Temp/prosper-economy-before.png`
- Before Watch: `C:/Users/OwanLazic/AppData/Local/Temp/prosper-economy-watch-before.png`
- After: `C:/Users/OwanLazic/AppData/Local/Temp/prosper-economy-mocked-visuals-BHQa8M/real-economy-expanded-after.png`
- After Watch: same directory, `real-watch-after.png`
- Mocked stress cases: same directory, `mocked-100-conflict-after.png` and `mocked-empty-combat-after.png`

## Saved-run audit limit

No app answered GET `/api/state` on documented ports 5173 or 4310. Read-only inspection of `.prosper-v2/checkpoint.json` found run `run-aa93edab-449d-4d35-b973-bc2bb82c2a08`, saved 2026-10-07 19:07 UTC, paused in Live at tick 0. Forty citizens had full health/fullness, 4,000 gold and 120 T1 food. There were no actions, buildings, orders, claims, alliances, events or model receipts in that checkpoint. All controllers had scripted source. That checkpoint alone is stale and cannot describe the later run.

A subsequent read-only check of this exact run's diagnostic log found activity through **tick 3427 at 19:22:57 UTC** (08:22:57 Auckland). Its ledger records **10 settled requests**, 47,147 input + 952 output = **48,099 actual reported tokens**, with no unresolved reservation for this run. All ten Qwen 3.5 9B reviews completed with accepted policies: eight changed, two continued. Thirty logged turn entries are lifecycle snapshots, not thirty calls. No validation/inference errors were recorded; this does not prove every policy was useful.

Concrete run issues/evidence:
- A tick-3203 snapshot shows citizen-50757 with zero gold, empty inventory and fullness 16.81, with failed-food-search/begging evidence despite market food supply. This is a real liquidity/survival tension, not a complete starvation diagnosis. Other citizens had saturated production and paused extraction.
- Personal snapshots record repeated contested harvesting/trespass and toll claims; they are not a complete global map for measuring overlap frequency.
- Diagnostic line 2250 retains reciprocal strikes at tick 1522 for 8.88 and 4.96 damage. Fighting occurred; the visibility complaint is not evidence that attacks were absent.
- Line 3138 admits a review for failed food search/begging while snapshot fullness is 97.92, based on older tick-2751 evidence. This is possible stale review evidence, not a proven bug and not changed in this task.

Diagnostics are historical snapshots, not current live state. Durable state and ledgers were not changed.

## Parallel local-model investigation

Read-only hardware/API checks found RTX 3070 Ti Laptop with **8 GiB VRAM**, Ryzen 9 6900HX and **15.26 GiB RAM**. At inspection only about 893 MiB GPU and 2.17 GiB system memory were free. Ollama reported version 0.35.1. Its only local weight set was Qwen 3.5 9B Q4_K_M, 6.59 GB on disk. Other installed tags were cloud aliases, not local weights. `/api/ps` showed approximately 5.11 GiB GPU residency at 4K context; this does not establish the context of Prosper's explicitly 8K requests.

Candidates checked against official catalog pages on 8 October:

| Candidate | Catalog artifact size | Why compare |
| --- | --- | --- |
| [qwen3:4b-instruct-2507-q4_K_M](https://ollama.com/library/qwen3/tags) | 2.5 GB | Text-only non-thinking instruction model; first efficiency candidate. [Official card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507). |
| [ministral-3:8b-instruct-2512-q4_K_M](https://ollama.com/library/ministral-3/tags) | 6.0 GB | Independent family with advertised function/JSON support; plausible but tight 8K GPU fit. |
| [gemma4:e2b-it-q4_K_M](https://ollama.com/library/gemma4/tags) | 4.6 GB | Edge-model alternative with more headroom. Effective parameter count is not weight memory. |
| [qwen3.5:4b-q4_K_M](https://ollama.com/library/qwen3.5/tags) | 3.3 GB | Same-family efficiency control. |

These are artifact sizes, not measured runtime allocation. Replace rather than co-load the resident model when testing. Defer 12–14B and larger weights on this currently constrained machine. CPU offload competes with simulation/browser memory. The installed Qwen digest starts `6488c96fa5fa`; the current catalog alias starts `fdf5fd4cd409`, so a pull would change the baseline.

**No candidate is proven better.** No downloads, installations, new inference calls or cloud spending were performed. Retain Qwen 9B as the default until a controlled test justifies a switch. Recommended next comparison, subject to separate download/inference approval: installed Qwen 9B, Qwen 4B Instruct and Ministral 8B, three frozen policy cases and two repeats, a hard 18-request ceiling without retries/fallback. Use explicit 8K context, no thinking, 1,200 output tokens and 120-second deadlines. Record digests, validation, real usage, latency and GPU memory; apply accepted replies to identical frozen worlds for a 600-tick comparison against unchanged policy. Existing `probe-policy.ts` advances state during inference, so freeze comparison states to avoid conflating latency and decision quality.

[Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs) can constrain syntax; that does not establish economic judgment. Existing small overnight samples are not a reliable model ranking.
