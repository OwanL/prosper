# Resource acquisition: deeper audit

Four independent read-only audits examined prerequisite feasibility, market/hybrid lifecycle, survival/violence/territory costs, and observation/delivery/death contracts. Findings were checked against current source rather than accepted wholesale. This is a design review, not evidence that an acquisition controller works.

See [design](resource-acquisition-design.md), [condition](trees/can-obtain-resource.md) and [action](trees/obtain-resource.md).

## Disposition

| Finding | Disposition |
| --- | --- |
| Automatic servicing spends protected T1 stock | User explicitly removed servicing from the simulation. Tools are permanent, highest available tier is selected, and legacy servicing fields are discarded on checkpoint restore. No repair-material budget remains. |
| Fixed tool-before-station preparation rejects valid plans | Replaced with one bounded dependency-ordered sequence. Neither tool-first nor station-first is universally correct. Candidate feasibility tracks inputs after every step. |
| Failure can strand a funded bid or funding sell | All outcomes retain request ownership until every owned order and work item is cancelled or settled. Failed cleanup retains pending outcome/context; it is not permission to begin another task. |
| Market-off branches have no explicit action gates | Added gates before hybrid bidding, purchasing/funding and requested sell-escrow recovery. Prerequisites still inherit the same frozen permission. |
| Existing receipts cannot reliably establish requested delivery | Recorded a required future structured actor-visible delivery contract: identities, source handles, quantities before meals, request cursor, credit allocation and acknowledgement retention. No new receipt implementation is authorized here. |
| The same settlement can satisfy independent requests twice | Credit is allocated once. Parent-child aggregation requires the same demand; prerequisite inputs and future requests cannot reuse the same credit. |
| Public escrow evidence conflicts with carried-inventory wording | Public remaining sell stock can evidence a possible combat transfer under current death settlement; location must be independently known. Proposed carried snapshots add evidence, not global sight. |
| Multiple dated sightings can expose an older attack target | Recorded the current projection inconsistency as an observation-change dependency. Use visible evidence first, otherwise the latest date for each entity. No unrelated observation-runtime change was made. |
| Listed owned stations are described too loosely | Refinement requires an alive, unlisted owned station. Market-off prohibits delisting, so that repair cannot make the route feasible. |
| Healing, nutrition and destruction costs need sharper wording | Healing requires positive fullness, not a food item on hand. Added nutrition/starvation/refinement timing and observed building health. Salvage ETA is the whole destruction time, not time divided by output quantity. |
| Paid permit acquisition is assumed command-expressible | Only known existing access terms/permits are admitted. There is no general permit-purchase command; a gold gift does not buy access. Claims remain soft social demands, not mechanical exclusions. |
| Mixed queues cannot be selectively cancelled | Require exclusive request ownership of active/queued physical work. Current cancellation clears the entire queue; unrelated work cannot be mixed into it. |

## Recommendations not adopted

- Do not relax a false condition into waiting for an unsupported future market fill. If both known hybrid routes disappear, the request fails loudly and cleans up. If a physical fallback remains feasible, disappearance of an ask alone does not make the existential condition false.
- Do not infer a fill from an absent order, raw holdings delta or vanished escrow alone: cancellation/refunds and concurrent transfers make those signals ambiguous. Require authoritative delivery evidence instead.
- Do not impose a universal station-before-tool order while removing the inverse ordering. Dependencies determine order.
- Do not amortize destruction time across salvage units when estimating the first requested unit. A fresh T5 building has 540 health, not 490; actual remaining observed health is the relevant input. Large surplus can affect value, never shorten physical delivery time.
- Do not treat independent graph-branch booleans as executed feasibility tests. They test graph structure, not the correctness of future estimates or plans.

## Adversarial cases for future acquisition execution tests

| Case | Required outcome |
| --- | --- |
| T5 wood, market off, no axe; 48 T4 wood, 56 T4 fibre and 72 T3 food | A valid bounded plan can build a T4 butchery, refine food, craft a T4 axe, then harvest. Station construction precedes the tool only because this dependency requires it. Include travel/site/survival constraints. |
| Build a T4 lumbermill from exactly 48 T4 wood and 32 T4 fibre | Construction exhausts those inputs. It cannot then refine three nonexistent T4 wood; the combined plan needs extra input stock. |
| Nine T3 wood, owned usable T4 lumbermill, target T5 wood | Three T3→T4 conversions then one T4→T5 conversion are mechanically finite. Planner/ancestry granularity must support the agreed bounded strategy policy without silently bypassing exclusion. |
| Existing requested-tier wood is the only funding source | Selling it to buy a replacement does not qualify. Protected baseline and inherited caller inputs are hard restrictions. |
| Hybrid fallback fails while its bid remains funded | Error retains context, resolves all orders/work, and reconciles any concurrent committed fill. No orphan bid, duplicate request success or silent forecast-only waiting. |
| Bid fills during work; bounded trade/event logs evict the event | Durable actor-visible delivery identity/credit remains available, or a detectable evidence gap requires reconciliation. Never repost based on missing log text. |
| Immediate market result, later trade alert and racing harvest | Same-settlement reports deduplicate; a distinct harvest is real surplus. Independent demands cannot double-credit either unit. |
| Market-off request with a listed owned station or another task's order | No delisting or unrelated cancellation. Prior task cleanup remains with its original ownership scope. |
| Food arrives and is eaten before the next observation | Credit the exact delivery once; ingredient-stock checks inspect actual remaining holdings separately. |
| Visible target at A then B, later remote; public sell stock changes | Use newest dated location, never add inventories across sightings, and credit only actual transferred requested stock. |
| Low-health attacker pursues an equally fast fleeing seller | Pursuit may not settle. Include elapsed hunger/damage and failure uncertainty; health does not increase attack damage and desperation does not make a lethal plan safe. |
| Uneven estate items/gold/buildings and several deaths in one tick | Chosen recipient/remainder policy conserves assets, uses whole current gold units, does not confiscate a living partner's refund, and preserves permanent tools. Policy remains unresolved, not implemented. |

## Still open before controller implementation

- Bounded candidate/prerequisite planning and stable-strategy identity granularity for legitimate multi-tier chains.
- Receipt publication, allocation, acknowledgement and reload/reconciliation boundaries.
- Cost/risk calibration, pursuit and fill estimates, wait/cleanup bounds and forecast-only bid admission.
- Proposed local carried-inventory visibility and natural-death redistribution, including simultaneous-death eligibility, remainder fairness, no-survivor custody and combat-building ownership. Permanent tools cannot be destroyed by a future settlement policy.

Current focused draft tests validate structure and diagram synchronization. Tool-permanence and checkpoint tests exercise the separately authorized servicing removal. Neither establishes correctness of a future resource-acquisition executor.
