# Exact-tier resource acquisition — rough design

Status: bounded design proposal, not an engine/controller implementation. Later resource-specific direction extends the earlier food-only sketch; it does not authorize a broader controller.

Typed graph definitions: [CanObtainResource](trees/can-obtain-resource.ts), [ObtainResource](trees/obtain-resource.ts).
Generated diagrams/contracts: [condition](trees/can-obtain-resource.md), [action](trees/obtain-resource.md). Their typed graphs own structure; this prose records the contract and open choices.
Preserve the [existing plan's ancestry and sequential-execution policy](plan.md). The [deeper audit](resource-acquisition-review.md) records counterexamples, accepted fixes and remaining implementation gates.

**Later world-design decisions (2026-10-10):** [territory membership/shared building use and fractional harvest tax](territory-design.md) are accepted directions; separate alliances, ground loot and building trading are excluded from the intended world. Current-engine ownership/listing/permit facts below remain baseline evidence, not requirements to retain those mechanics. Typed acquisition sketches and mocks still need reconciliation with shared use, removal of listing restrictions and net fractional delivery before integration; no runtime change is made here.

## Responsibility and context

- `CanObtainResource(kind, tier, allowMarket)` is a side-effect-free boolean condition.
- `ObtainResource(kind, tier, allowMarket)` is its matching action; kind is food, wood or fibre.
- Each request obtains **one additional unit of the exact requested tier**, not “at least this tier” and not a quantity batch. Existing carried stock does not by itself satisfy a new acquisition request.
- Snapshot existing available stock of the requested kind/tier as a **protected baseline**. No candidate may sell it, consume it in a recipe, or spend it in prerequisites to obtain its replacement. Propagate this hard restriction alongside other protected inputs; it is not merely a retention-score preference. A caller wanting to spend that stock on an investment must make that a separate explicit goal, not hide it in this acquisition. Automatic food consumption is not prevented by a planning reservation: account for it and let recipe callers recheck actual holdings.
- The caller chooses quantity by repeating requests, chooses economically desirable tiers, and handles exploration, reserve goals and subsequent ingredient-stock checks.
- Shared explicit citizen context carries a request identity and start cursor, parent purpose, deadline/urgency, dated observed facts, permissions, preferences, active ancestry, a bounded ordered commitment, budgets/reservations, every owned order/work handle and allocated delivery credit. Only one top-level acquisition owns the citizen's active/queued physical work; nested prerequisites belong to that ownership scope.
- Nodes remain stateless. Continuity belongs in that context; no mutable node instances, new controller framework or execution classes are proposed.
- Preparation and delegated prerequisites inherit purpose and `allowMarket`. A no-market wood-production request cannot secretly buy tools, inputs, station materials or funding through a prerequisite.
- Market-off prohibits all market commands in this request and its prerequisites, including funding, purchases, sales, resting bids and requested sell-escrow recovery. Request arguments remain fixed: cleanup for a prior market-enabled request is completed under that prior context before a market-off request starts. Unrelated orders are not cancelled.

## Condition/action agreement

The condition and action use the same permission, evidence and candidate-feasibility mechanics. The condition checks for a credible bounded plan with known inputs/capabilities that preserves protected stock; the action ranks and executes the same eligible plans. Goal-sensitive price reasonableness is **not** a condition filter. A permitted expensive purchase can be possible even if economically unattractive.

A positive result is not a clairvoyant guarantee: deposits can deplete, people move and quotes can disappear. Known travel, input, tool/service and ownership requirements must nevertheless be accounted for; unknown supply cannot be wished into existence. Mere money or a postable bid does not prove availability.

If no known permitted source exists, return false. The caller may explore when its purpose/runway permits; this subtree does not add exploration as an unbounded speculative source. For an unsatisfied request, check the condition and retained plan before starting or resuming at an idle command boundary, not on every busy tick. First reconcile already-committed delivery feedback. Losing both known hybrid routes still produces a loud `Error` with cleanup; an outstanding bid alone does not justify forecast-only waiting. Execution ending without actual target delivery is also an error, not ordinary success or silently substituted work.

All successful routes require a confirmed **actual target-unit delivery** attributable to this request. Funding, movement, tool preparation, station construction, order acceptance and killing without the target are intermediate outcomes. Food may be automatically consumed after delivery: the receipt can satisfy acquisition, but a recipe caller must separately check actual ingredient stock.

## Candidate routes and costs

| Route | Required evidence / feasibility | Actual elapsed ETA to first target unit | Other costs / uncertainties |
| --- | --- | --- | --- |
| Purchase / resting buy | Market enabled; observed executable matching ask and bounded feasible funding; hybrid bids additionally have a credible physical fallback | Matching settlement, or first receipt in a hybrid race; include sequential funding steps | Gold spent, sale/refund opportunity cost, changing quotes; acceptance is not delivery. Admission of bid-only waiting without executable supply remains open |
| Recover own requested sell escrow | Owned cancellable order containing this exact kind/tier; cancellation actually returns the item | Cancellation/confirmed return, normally no physical journey | Lost sale opportunity; recover only the relevant unit/request credit, account for any extra returned stock |
| Harvest | Dated known deposit, reachable route within hard policy limits, matching available tool capability (or T1 barehand) | Travel + necessary tool preparation + harvest duration | Food consumed en route/at work, tool/input costs, depletion, existing access terms and social/property-response risk |
| Adjacent refinement | Known materials plus owned, alive, unlisted appropriate station, or a complete permitted preparation plan; exact adjacent conversion | Travel + prerequisite input/station preparation + actual refinement work | Input opportunity cost and loss of future station usefulness; no invented station-capacity limit or magic skip across tiers. Delisting requires market permission |
| Building destruction / salvage | Observed reachable permitted target with known construction tier/material quantities yielding requested salvage | Travel + estimated destruction time until actual salvage | Destroyed capacity, ownership/shared-use loss, food/time cost, uncertain property response; buildings do not themselves retaliate |
| Citizen combat / direct transfer | Proposed observed/remembered carried stock or current public exact-tier sell stock; independently known target location, hard-policy-compliant approach and credible bounded fight | Approach/pursuit + estimated strikes to kill and actual settlement | Lethality, retaliation, food/healing burden, moving target, possible failed pursuit and stale stock; no ground-loot journey |

Funding may include releasing owned buy escrow or selling eligible carried/recovered items against observed executable demand, when market is enabled. Existing requested-tier stock and caller-protected inputs are ineligible for funding or preparation. Count each demand unit once and account for funded-bid escrow before calling money spendable. Recovery of a requested resource from an owned sell order is itself delivery; recovery of another item is only preparation.

These are route families, not fully designed candidate/prerequisite internals. Positive `Can` needs a bounded plan rather than a list of hypothetically possible recipes. Tool crafting and station preparation require observed capabilities and known inputs, not assumed remote inventory. Execute prerequisites in dependency order, never a universal tool-first or station-first order: a station may be needed to refine tool ingredients, while a tool may be needed to gather station materials. Account for material availability after each step; the same stack cannot fund construction and then remain available for refinement. Current production helpers that buy or explore cannot be reused unchanged under the inherited market, protected-stock and ancestry restrictions.

## Confirmed mechanics informing estimates

- Movement costs **2 ticks per route step**. Estimate a route from the citizen's known map, not straight-line distance through known exclusions or an omniscient view of hidden walls. Unknown/dated cells add uncertainty; authoritative movement checks still belong to the engine.
- Harvest duration is `max(12, ceil(40 * 2^(resourceTier - 1 - availableToolTier)))`. Matching tool tier must be at least resource tier minus one, except T1 allows bare hands. Tools have no wear, servicing or repair inputs; use the highest matching tier in available carried inventory, excluding escrow and work reservations. Tools persist through use and change custody only through trade or transfer.
- Crafting takes **8 ticks**; building takes **16 ticks**. Add their actual material prerequisites and travel, not just these durations.
- Refinement is adjacent only: **3 lower → 1 higher**, or **1 higher → 2 lower**. The station must be owned, alive, unlisted and tier at least the lower tier. Duration uses the station tier: 9 ticks at T1, otherwise `max(1, ceil(12 / 2^(stationTier - 1)))`.
- Highest available matching sword is used automatically. An attack strike takes **8 ticks**; bare base damage is 8, sword base is `6 * tier + 6`, randomized from **0.5–1.5 × base**.
- Health affects survival, not strike damage. Combat ETA is a rough prediction, not a guarantee based on average damage alone.
- Healing is **0.05 health/tick** while fullness is positive, concurrent with work; it does not require a food item on hand. Appetite falls **0.1/tick**; at zero fullness, starvation damage is **0.2 health/tick** instead. Nutrition is `100/9` for T1, `100/3` for T2, and 100 for T3+. Automatic meals check lower tiers first and consume a unit when enough fullness is missing (or fullness is zero). Only available food is eaten; engine-reserved or escrowed food is excluded, unlike a planning-only protection marker. Do not blindly append full recovery duration to elapsed acquisition ETA.
- New building health is `10 * tier^2 + 50 * tier + 40`; use **observed remaining health**, not that initial value, to estimate destruction. Attacks strike at range one, including walls. Time to the first requested salvage unit includes the **whole destruction**, never destruction time divided by the number of salvaged units. Surplus value belongs in opportunity-cost accounting, not an artificially shortened ETA.
- Building salvage is `floor(0.75 * materialUnits)`: only wood/fibre at construction tier, no food and no store stock. Apply the floor to actual material quantities, not to invented contents.
- Combat kills currently transfer the victim's current items/gold directly to the killer; buildings currently become ownerless. Killing alone is not proof of target delivery.

## Observation and death-policy boundaries

**Current:** other visible citizens' carried inventories are hidden. Public sell listings can already evidence their remaining exact-tier escrow stock; death releases that escrow before transfer to a living killer. A global seller ID supplies neither location nor hidden holdings: independently known approach/location evidence is still required. Spectator/world access must not fill observation gaps or double-count listed units as carried stock.

**User-proposed:** nearby visible carried inventories and dated remembered snapshots may become observable. No global remote inventory updates. Use detached snapshots: current visible evidence first, otherwise the latest `seenTick` for each citizen, with deterministic equal-date handling. Multiple sightings of one citizen are historical evidence, not multiple targets or additive stock. Current attack projection can select an older remembered sighting; that mismatch must be corrected when implementing this observation contract. Remembered stock is uncertain; revalidate when possible and include stale-evidence risk. This document does not implement visibility.

**User-removed design:** there is no ground-loot acquisition branch. Proposed natural-death settlement releases escrow/work reservations and redistributes items, gold and buildings roughly evenly among other living citizens. Indivisible assets stay whole; distribute leftovers fairly while conserving every asset/value. This is a proposed replacement, **not an implemented engine change**. Unlike servicing removal, neither visibility nor estate redistribution has been authorized for runtime implementation here.

Natural deaths are not predictable planned acquisition routes. Incidental redistribution may satisfy a request only through actual delivery receipts. Disposition when no living recipient exists, and combat-victim building ownership under the future policy, remain **explicit open choices**; do not silently invent destruction, inheritance or killer ownership. Any future no-survivor policy must preserve permanent tools in some custody, not destroy them. Before implementation also settle recipient timing for same-tick deaths, fair/reproducible remainder allocation, and the fairness measure for heterogeneous buildings. Gold uses whole safe-integer units today; do not introduce fractional shares accidentally. Collect escrow and active/suspended reservations through existing settlement boundaries; a surviving reproduction partner's refund belongs to that partner, not the deceased's estate.

## Rough cheap selection heuristic

For each feasible candidate, compare:

`estimated ticks to first target unit + calibrated tick-equivalent opportunity costs + recovery/risk/uncertainty penalties`

Keep actual elapsed ETA separate from utility penalties in explanations. Gold/material opportunity cost, expected food and health recovery burden, lethal/retaliation risk, lost owned/shared-use asset capacity and uncertainty need rough calibration; none is a new mechanical delay. Expected damage may imply food/recovery work later, while healing during current work reduces the residual burden. Waiting/fill estimates are predictions, not market facts.

For a hybrid, compare scenarios: buy fills before work completes, work delivers before the bid fills, or both effects commit in a race. Estimate time to the first real unit, wasted partial work, actual spending versus refundable escrow and possible surplus. Do not add two full route costs as though both always finish, or assume a resting bid will fill.

Desperation derives from inherited purpose, deadline and food/cash runway. It prioritizes earlier delivery for that goal and may reduce property/social risk aversion. A wealth-seeking wood request must not pretend to be urgent survival merely because urgency would improve its score. Low health **increases combat lethality risk**, not damage output; desperation does not make a suicidal fight safe.

Violence propensity is separate from desperation. Prefer not to destroy one's own buildings by default, without a hard ban; preserve the opportunity cost of lost capacity. A low-health citizen may prefer salvage to citizen combat, but property owners/territory members may respond and their response is uncertain.

Claims are soft demands/risk signals, not walls or a mechanical harvest veto. In the intended design, account for known territory membership, explicit use permissions, reputation and witnessed-response risk; do not infer permissions merely from favorable reputation. Current-engine alliance/permit handling is baseline behavior that will be replaced under the separately agreed world design. A gold transfer alone is not a general permit-purchase command. A contested physical route can remain mechanically feasible while carrying social/retaliation costs. Explicit no-go rules and physical walls are hard exclusions that desperation cannot override. Do not invent future permissions or completed mechanics migration in current-engine tests.

## Hybrid: funded bid plus independent physical fallback

1. Admit a hybrid only with a credible permitted physical fallback and budgets that can fund **both** the one-unit bid and fallback prerequisites. A bid alone is not evidence of supply.
2. While idle, post a funded bid for one target unit, record ownership, escrow, controller-enforced wait bound and delivery cursor (orders have no native expiry); then start independent physical fallback work.
3. Do not count escrow as free gold or reserve the same materials for both plans. A fallback requiring that escrow to be refunded is not independently funded; revise the plan before posting.
4. While busy, monitor owned settlement feedback and danger only. **Actual fill**, not order acceptance or predicted fill, may interrupt fallback. No routine market commands while busy; only explicit cancellation exceptions for context-owned orders/work are in scope.
5. On fill, confirm delivery, stop/settle interruptible work through normal cancellation boundaries, release its reservations and finish cleanup. If work cannot safely interrupt, retain receipt credit and resolve work before handoff; no simultaneous second physical command.
6. On fallback delivery, cancel the remaining owned bid through the explicit owned-context exception (or after becoming idle), confirm refund/remaining quantity and resolve work. Never hand off with forgotten funded demand.
7. At the bounded wait/escrow limit, cancel/reconcile and continue only a still-credible fallback. If neither route delivers, report `Error`. Bounds and cleanup responsibility remain in context across ticks.

A fill/work race credits the first attributable target delivery exactly once. A second actual delivery is real surplus, not another request success; reconcile both receipts, inventory changes, bid remainder and work reservations. Before **any** task handoff, including failure, abort and timeout, settle **all request-owned orders** (including funding sells) and owned work. Keep the original frozen market-enabled context for its cleanup; a market-off request never acquires permission by inheriting that work. Current cancellation clears the whole physical queue, so the request must own that queue exclusively. If cleanup cannot be confirmed, retain the pending outcome and ownership context instead of starting another task or dropping the request. Reconcile deliveries committed before closure receipt-first; failure diagnostics remain visible even if an acquisition ultimately succeeds. Once the request closes, delayed feedback only reconciles already-committed surplus and cannot reopen it.

**Open admission question:** should predicted bid-only waiting without currently executable supply count as obtainable, and what counterparty evidence would justify it? Do not resolve this by treating a postable bid as supply. The first sketch admits executable purchases and hybrids with credible physical fallbacks; extending `Can` to forecast-only waiting remains unsettled.

## Required delivery evidence before implementation

Current command results, plan/directive receipts and bounded event logs do **not** meet the required acquisition evidence contract. In particular, later resting fills lack structured order attribution, completed orders disappear, and food may be eaten before the next holdings snapshot. An absent order, inventory delta or event-text match is not proof of a fill.

Require a small actor-visible delivery record at each authoritative commit boundary, before automatic consumption: unique delivery ID, recipient-local commit sequence/tick, exact item and quantity, source kind and relevant source handles (order/action/building/defeated citizen/estate). Repeated alerts and observation of the same settlement reference the same identity. Cover purchases, harvest/refinement output, permitted requested sell-escrow recovery, salvage, combat transfer and proposed estate allocation. Gold refunds and returning work reservations do not masquerade as fresh acquisition output.

Request context records its start cursor and allocated quantity against those delivery IDs. No pre-start or already-credited unit satisfies a new independent request. A parent may explicitly aggregate a child's credit for the **same demand**; one physical unit cannot satisfy two independent demands, and inputs earmarked for prerequisite consumption cannot also fulfill the parent. Surplus remains real inventory, not an automatic success token for a future request; callers inspect current holdings before deciding whether another request is needed.

Delivery records and allocations must survive reload and remain available until acknowledged/reconciled, or expose a detectable evidence gap requiring reconciliation. Do not guess success or repost a bid when evidence is missing. This specifies minimum feedback and context requirements, not a new controller, event-store framework or implemented ledger.

## Walkthroughs / boundaries to retain

| Situation | Expected reasoning / outcome |
| --- | --- |
| Market off, known T1 wood deposit | Travel and barehand harvest may qualify; no buying an axe or selling fibre via nested preparation. Requested escrow recovery is also forbidden; prior-request cleanup stays with its original context. |
| Hybrid fill during harvest | Credit actual fill, cancel/settle work and bid remainder; reconcile any racing harvest receipt as surplus. Acceptance alone never interrupts. |
| Low health: property versus citizen | Compare salvage travel/destruction/capacity loss with combat lethality and food-supported healing. Buildings do not strike back; owner response remains uncertain. |
| Contested source versus no-go source | Contested permitted access can be risk-priced using known permissions, membership and reputation; no-go or blocked path is infeasible even in desperation. |
| Money but no known source | `Can` is false without a credible source/fallback; caller may explore. Cash and willingness to post a bid do not prove supply. |
| T5 wood with missing tool/station inputs | Require a bounded known chain for matching capability or adjacent refinement inputs/owned station. No positive result from merely naming craft/build routes. |
| Decreasing-tier refinement prerequisite chain | Preserve active-strategy ancestry exclusion across helpers/ticks. Identity granularity allowing legitimate tier-decreasing chains is unresolved; do not silently exempt changed tiers. Excluded/exhausted chain needs another route. |
| Incidental natural-death redistribution | Only a real target receipt may fulfill the request; never select another citizen's predicted natural death as a plan. Recipient/ownership policy remains proposed. |
| Accumulate another T5 wood unit with no free gold | Selling the existing T5 wood to buy its replacement is forbidden. Consider other allowed funding or production; if every known route spends protected stock, `Can` is false. |

## Deliberately unfinished

Candidate enumeration, bounded prerequisite expansion, service evidence, wait limits and cost calibration need further design. Preserve existing stable-strategy ancestry exclusion: changing arguments or inserting helpers cannot bypass it. Its granularity for legitimate decreasing-tier chains remains unresolved, not a license to replace the policy. These gaps must be settled before implementation claims; the graphs and this document are descriptive planning only.
