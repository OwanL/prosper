# Resource-building subtree — brainstorm

Date: 2026-10-09
Clarified: 2026-10-09
Status: inventory-only condition drafted; condition/action responsibility boundary approved on 2026-10-10. Detailed execution design and runtime implementation remain deferred.

## Approved pair responsibility — 2026-10-10

The user approved `CanBuildResourceBuilding` / `BuildResourceBuilding` during the pair-by-pair review:

- `CanBuildResourceBuilding(resource, exactTier)` remains the pure materials-ready check.
- `BuildResourceBuilding(resource, exactTier, placementContext)` owns location selection, travel, local site revalidation and completion of one new requested station. Territory, known land value, travel and risk inform placement.
- The parent owns whether to invest, which tier to build and arranging materials. Buying an existing building or obtaining shared access remains outside this construction pair.
- Success requires the completed requested building, not a selected site or accepted command. Materials-ready does not guarantee placement success.

The later world-coverage review explicitly removed building trading from the intended design. Future investment alternatives are existing owned/shared-use facilities, new construction, retention and physical destruction/salvage, not buying/selling stations. Current-engine listing/sale facts below remain descriptions of the runtime until separately authorized removal.

This approves the responsibility, not a typed action graph, detailed execution contract or runtime change. Earlier references below to the action being undesigned describe the initial guard-only pass; this review now settles its high-level boundary.

Current subject: **only the `CanBuildResourceBuilding` condition**. The matching `BuildResourceBuilding` action — and therefore all placement, site-selection and construction behavior — is **not designed or implemented this turn**. Housing has its [own future subtree](housing-and-rest-proposal.md); walls/fortifications are outside this pair.

## Latest user clarification: placement, not material acquisition

The building subtree is concerned with **placement, not material acquisition**. Recording that clarification narrows this pair:

- Start **only** the `CanBuildResourceBuilding` condition draft now.
- The guard is straightforward: **current available carried inventory ≥ the exact-tier station wood/fibre recipe**. Nothing else.
- `CanBuildResourceBuilding` is true iff the citizen already carries enough exact-tier wood and fibre for the requested building tier. **True means materials-ready only** — it does **not** assert site legality, reachability, work idleness or safety. Those are **placement** checks belonging to a future placement action, not full existential feasibility.
- The pair performs **no** buy/sell orders, escrow cancellation, funding, refinement, harvesting, tool handling or generic prerequisite planning, and it does **not** call `CanObtainResource`/`ObtainResource`.
- If materials are missing, the **parent arranges them separately** through the generic resource subtrees. Expense preferences never change inventory truth; the guard reads carried stock as-is.
- Proposed arguments reduce to **`(resource, exactBuildingTier)`**. No `allowMarket` or `placementGoal` argument is needed for the current guard.
- The [typed condition and generated diagram](trees/can-build-resource-building.md) record this guard. Its focused tests compare supplied inventory against the public station recipes; it is not integrated into the citizen controller.

### Superseded: earlier full-material-plan responsibilities

An earlier version of this note treated `CanBuildResourceBuilding`/`BuildResourceBuilding` as an existential planner that chose a site **and** acquired missing exact-tier wood/fibre, delegating shortages to `ObtainResource`. **Those full-material-plan responsibilities are superseded.** Material acquisition stays with the parent and the generic resource subtrees; this pair does not acquire materials. Site selection belongs to its future placement action, not the current condition. The placement factors retained below are **deferred planning input only**.

## What a resource building is

For this brainstorm, “resource building” means an existing **refinement station**, not a proposed extraction building:

| Resource argument | Building |
| --- | --- |
| wood | lumbermill |
| fibre | spinning wheel |
| food | butchery |

These buildings do not passively produce or harvest resources. An owner brings carried inputs to the station tile and performs adjacent-tier conversions there. No market building, hauling/storage system, public station use or station-capacity limit is implied.

## The current guard: `CanBuildResourceBuilding(resource, exactBuildingTier)`

Tentative signature:

```text
CanBuildResourceBuilding(resource, exactBuildingTier)
```

It is a pure, side-effect-free **materials-ready** check:

- `resource` selects the station (wood → lumbermill, fibre → spinning wheel, food → butchery); every station currently uses the same wood/fibre costs.
- `exactBuildingTier` selects the recipe size and must match the built station's tier; a higher-tier station is not substituted.
- Recipe: `6 * 2^(tier - 1)` **wood** and `4 * 2^(tier - 1)` **fibre**, both at the exact building tier. (E.g. 6 wood + 4 fibre at T1; 48 wood + 32 fibre at T4.)
- True iff the citizen's **current available carried inventory** covers both amounts; otherwise false.

Deliberately **out of scope for this guard** (deferred to the future placement action or the parent): site legality, reachability, work idleness, safety, market permission, material acquisition, funding, tool selection, refinement/harvest and any generic prerequisite planning. It makes no `CanObtainResource`/`ObtainResource` call.

The parent owns the investment decision — whether to build, at which exact tier, and how to arrange any missing materials. The guard never spends gold, posts orders, cancels escrow or trades; it only reports whether carried stock is already sufficient.

## Deferred placement brainstorm (useful, not consulted by the current guard)

Everything below is retained as future planning input for the placement action. None of it gates `CanBuildResourceBuilding`'s true/false result.

### Known mechanics that constrain placement

Facts checked against `src/world/config.ts`, `src/world/core.ts`, `src/world/pathfinding.ts` and `src/world/market.ts`:

- Each station occupies one tile. Stations are walkable and may share their tile with a citizen, unlike walls. A station cannot cover a deposit or another building. Known other active/suspended construction can reserve a tile; unstarted queues do not.
- Work occurs **on the station tile**, not merely next to it. “Adjacent refinement” means neighboring resource tiers, not neighboring map cells.
- Construction takes 16 work ticks, plus travel at 2 ticks per orthogonal route step. No construction tool is required.
- Refinement requires the station to be owned, alive, unlisted and suitable for the resource/conversion tier. Higher tiers support more conversions and speed refinement: T1 9 ticks, T2 6, T3 3, T4 2, T5+ 1. There is no processing-speed benefit above T5 under current balance.
- Build activation requires the site within current sight (Manhattan radius 3). A distant remembered site requires a separate move and local revalidation before submitting the build; a remembered empty tile is not a guaranteed reservation.
- Materials are physically reserved at action activation, returned on failure/cancel and consumed on completion. Site/route changes can invalidate work; successful command acceptance is not construction completion.
- Market trades settle globally and remotely. “Close to market” provides no current transport advantage.
- Hard no-go routes/work exclusions remain hard. Territory claims are soft demands/social risks, not a mechanical ownership veto. Use only known evidence; do not search hidden world state for an ideal site or private reservations.

### Placement factors to separate (future action)

1. **Hard feasibility beyond materials:** valid resource and exact tier; a known legal site inside supplied placement restrictions; reachable approach and working position under hard permissions; enough survival runway for travel and work. The material part is now the current guard; the site, reachability and survival parts belong to the placement action.

2. **Site choice — where does the supplied purpose work best?**
   - **Immediate use:** route from current position/material-gathering endpoint to the site, then to the parent’s next task. For an urgent one-off conversion, extra positioning travel may dominate future savings.
   - **Recurring workflow:** expected trips from known input patches, food/home and other stations. Score weighted actual routes, not just distance to one deposit or an omniscient global geometric center.
   - **Material dependencies:** a refinery often serves several deposits or other refiners. Ask where inputs will actually come from; purchased inputs arrive at the citizen remotely, so deposit proximity is not always valuable.
   - **Supply longevity:** dated stock, regrowth, contention, accessible input tiers and likelihood of moving on. Current depletion does not imply permanent exhaustion; nominal tier/value alone does not establish a profitable work site.
   - **Safety/property risk:** known rival/claim activity, territory membership/shared-use access, exposed approaches, likely destruction and safe escape/food routes. Preferences rank viable sites; desperation cannot relax hard restrictions.
   - **Commitment horizon:** short emergency job versus sustained livelihood. Future route savings need a bounded horizon and uncertainty discount, not assumed endless use.
   - **Future layout:** optional proximity to housing and complementary stations, preserving useful empty sites. These are future-value estimates, not current storage/capacity mechanics. Housing/rest effects stay disabled until that proposal is implemented.
   - **Stability:** keep a still-viable selected site unless new evidence materially changes it; repeatedly switching to the latest slightly better tile can prevent completion. Bound local search and retries, and use deterministic tie-breaking.

3. **Investment alternatives — the parent’s call, not the guard’s:**
   - Existing owned usable stations or shared-use access may avoid construction. Building purchases/sales are excluded from the intended design after the world-coverage review; current-engine listing/delisting behavior is not a future investment route.
   - Compare new construction with continuing the current workflow, choosing another acquisition route or another station tier.
   - A new station’s material/time cost, food burden and expected risk should be weighed against actual future conversions and saved travel. Claiming ownership of nearby land does not create production or guaranteed demand.
   - Relocation need not demolish an old building. Retain or destroy for salvage only if justified; building sales are excluded from the intended design. Account for whole destruction time, lost future use and actual salvage, not free movement of an asset.

   An existing usable station can remove the need to call this pair, but is not success for a request to build a new one. Retaining or gaining shared use of an existing building is a parent-level alternative, not silently substituted new-build success. Building purchases are excluded from the intended world. A higher-tier existing station may already meet a lower-tier capability need. Do not automatically duplicate it or confuse output-resource tier with required station tier: T4→T5 refinement requires at least a T4 station, not T5.

### Placement-goal input (deferred with the action)

`placementGoal` was proposed as a small input **for the future placement action**, not a new goal framework: for example, a known work anchor plus a maximum acceptable route distance/allowed area. It is **not part of the current `CanBuildResourceBuilding` guard**. Existing explicit citizen context supplies parent purpose, horizon/urgency, protected stock, hard no-go policy, observed map, ancestry and preferences; the placement action should not guess those or silently widen restrictions.

## Future action: `BuildResourceBuilding` (not designed or implemented this turn)

A future `BuildResourceBuilding(resource, exactBuildingTier, …)` would own site selection, local revalidation, material reservation and construction of one new owned station of the requested exact tier. Its condition/action agreement, execution ranking, completion receipt and mock scenarios are **not settled here**. When designed, it must:

- treat `CanBuildResourceBuilding` as a **materials-ready precondition only**, not a site or reachability guarantee;
- recheck site legality/reachability/safety and locally revalidate before reserving a build;
- keep the parent responsible for arranging missing materials before entry, since the guard performs no acquisition.

Success would require authoritative completed placement of **one new owned building of the requested kind and exact tier**. Movement, acquired materials, command acceptance and finding an existing station are not successful terminals. No runtime building behavior or tree runner/framework is authorized by these notes.

## Black-box mock scenarios

The `CanBuildResourceBuilding` condition itself needs only inventory-versus-recipe cases: enough carried exact-tier wood/fibre → true; a shortage of either → false; tier mismatch or none carried → false. Market permission and preferences do not change the result.

The placement and material-plan scenarios below are retained for the **future action**, not the current guard:

1. Inputs already available; one legal nearby site: build once, consume the recipe once, confirm exact identity/tier/location.
2. Better deposit proximity but longer home/food/station circuit: select for the supplied purpose, not a universal nearest-deposit rule.
3. One-off urgent build versus recurring work: the same map can justify different placement.
4. All good sites hard-forbidden or unreachable: the placement action fails. An expensive but feasible permitted site: placement feasible, though the parent may decline investment.
5. Parent is materials-short: the guard is false; the parent must arrange materials separately first. Market-off never quietly turns into a purchase inside this pair.
6. Exactly 48 T4 wood and 32 T4 fibre build a T4 station: none remains for a subsequent recipe. The parent’s plan must budget that separately.
7. Chosen remembered site becomes occupied/reserved before arrival: revalidate without consuming inputs twice; bounded reselection stays inside constraints or fails loudly.
8. Wall changes the route during travel; cancellation fails or funding orders remain: keep explicit ownership until cleanup is confirmed.
9. Existing station is found; build command is accepted but not completed; completion feedback is duplicated or restored after reload: none may invent or duplicate new-build success.

Mock subtree behavior and observable outcomes first, then drill into failing placement and construction cases. Only afterward verify leaf operations against actual simulation mechanics. No new tree runner/framework or runtime building behavior is authorized by these notes.
