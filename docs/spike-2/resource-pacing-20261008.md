# Resource pacing follow-up, 8 October 2026

The running world inspected through read-only GET `/api/state` had 756 deposits on a 53×53 map (26.9% of tiles), 61 total / 51 living citizens, and current harvest work lasting 2–8 ticks at tick 13,440. Existing resources and saved progress were preserved.

## Changes

- Legal barehanded or previous-tier-tool harvesting takes **40 ticks**; a matching-tier tool takes **20**, and stronger tools retain a **12-tick minimum**. At the normal four simulation ticks per second these represent ten, five and three simulated seconds. Accelerated playback accelerates these durations with everything else. Physical reservations, cancellation, and existing action durations retain their existing semantics. New actions use the new timing; a restored action already doing work retains its saved duration/progress.
- New maps use separated seeded resource patches at 2.4 × (ring index + 1) × population scale rather than 6 × that factor. Inward tier bands, rare next-tier deposits, six-band geometry and the tiered recipes remain intact.
- Sparse T1 forage appears beside some outskirts wood/fibre patches. Each founder receives a viable starting habitat with two distinct discoverable edible sites, without private ownership or an ongoing food grant. Allocation only constrains generation: citizens can still compete for, deplete or claim those sites. The seed-7 20-founder map has **188 deposits / 13.73% of tiles**, compared with 378 before, and 42 T1 food plants.
- Hungry local controllers briefly wait for personally visible, unreserved food expected to regrow within 40 ticks. They can also explore a public food claim's advertised center, with a 300-tick revisit cooldown. A claim provides coordinates, not remote resource stock or another citizen's private inventory. Hard no-go areas and pathfinding remain binding. Routine social work yields when the citizen has less than 180 ticks of food runway; immediate combat reaction remains separate.

**Existing runs get future-action pacing and navigation changes. Sparse placement and starting forage apply only to newly created worlds.** No running-world reset or deposit deletion was performed.

## Experiments and limits

All trials used `test/autonomy-experiments.ts`, local deterministic controllers, seed 7, twenty founders, maintenance enabled and a 4,000-tick horizon. No language model requests were made. Raw reports and world snapshots are retained under `.experiments/world-ai/` with unique `pacing-*20261008` tags.

The first sparse/48-tick trial left eight alive: food scarcity and discovery were too severe. An early forage experiment contained invalid coordinates from an incorrect `neighbors` argument and is invalid evidence; the API call and finite-coordinate regression were repaired. The first valid 40-tick habitat trial left twelve alive. A 32-tick trial left nine, so faster work alone was ineffective. Providing two *overlapping* food sites near each founder improved the next trial to sixteen alive but concealed an aggregate supply shortfall: only 24 T1 plants existed for twenty adults. One plant's 40 work + 120 regrowth cycle yields one 111-tick meal per 160 ticks. Extending the local wait to 120 ticks worsened outcomes and was rejected.

The final distinct-site trial (`world-ai-20-7-maintenance-pacing-disjoint-20261008`) kept all twenty founders alive through tick 3,000 and finished with **20 living citizens: 19 founders and one child**. It recorded **one birth, one founder starvation, 53 trades, 40 strikes and two alliances**; total gold remained **2,000**. The trial establishes viability for this seed and horizon, not complete economy equilibrium, broad swarm performance, or model intelligence. Market turnover remains modest, and a founder still starved late in the run.

Focused regressions cover substantial/tool-sensitive work, reservation release, sparse deterministic finite coordinates, two-site starting habitat, personally observed regrowth waiting, public-claim exploration without hidden resources, no-go behavior, procedural tier placement and legacy progression with explicit meal provisioning. The mechanical progression fixture now includes gold left on other citizens' bodies in its conservation check because its longer work can outlast unprovisioned fixture citizens.
