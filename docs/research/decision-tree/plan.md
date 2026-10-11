# Composed decision-tree implementation plan

Date: 2026-10-10
Status: historical planning checkpoint with implementation addendum (11 October 2026). The user subsequently authorized composed-controller/mechanics implementation and default Local AI integration. The original design discussion below preserves decision provenance: its design-only restrictions describe that earlier stage, not the current runtime. See [implementation checkpoint](composed-implementation.md) and [current evaluation](composed-evaluation.md); no final quality acceptance, model experiment or training is implied.

This plan updates the earlier architecture discussion in [citizen intelligence research](../../citizen-intelligence-research.md). It records agreed direction separately from proposed implementation details and unresolved choices. It does not establish that the design produces capable citizens.

## Follow-up implementation addendum — 11 October 2026

The user approved first-completion-wins harvest contention, adaptive quotes/repricing with exact own-order settlement evidence, visible competitors' estimated tools/travel/work, purposeful frontier exploration, territory colors and sortable citizen resources/membership/gold. These follow-ups are now represented in the inspected core, observation, tree-harvest, tree-market, tree-actions and UI modules; see [implementation status and control locations](composed-implementation.md#requested-follow-up-implementation-status--11-october-2026). This addendum supersedes any earlier exclusive harvest-reservation assumption below: concurrent work does not reserve yield, and completion settles actual stock. Other custody/order reservations remain distinct.

Optional mutual family invitations/preparation remain in progress, not an accepted natural-birth-rate solution. The latest supplied measured seed-7 result remains zero births. Earlier planning restrictions and measurements are historical provenance, not evidence that subsequent implementation has passed acceptance. A stabilized genuine rerun must establish behavioral improvements; no new outcomes are inferred from source changes.

## 1. Desired outcome

Build a citizen controller from reusable, responsibility-focused subtrees. Verify individual components and their composition before progressively integrating them into the live simulation. Headless tests and live citizens should execute the same decision components through different adapters, not separate versions of the behavior.

**Current planning scope: resource-acquisition drafts, building placement, and the agreed territory/reputation/land-value design, not an overall citizen controller.** The latest territory decisions are recorded in [territory design](territory-design.md); [section 11](#11-subtree-inventory-and-next-responsibilities-for-review) lists existing versus proposed subtree responsibilities for user review. Agreement on mechanics is not authorization to implement them. The initial food-only sketch was extended by user direction to `CanObtainResource(kind, tier, allowMarket)` and `ObtainResource` for food, fibre and wood. Each generic request acquires one additional exact-tier unit; the caller chooses tiers, repeats for quantity and owns exploration. The existing food-now examples remain alongside the generic drafts. The [resource-building condition](resource-building-brainstorm.md) has been drafted. The building pair concerns **placement, not material acquisition**: `CanBuildResourceBuilding` is a materials-ready check that current carried exact-tier wood/fibre already cover the station recipe. Its [typed condition and generated diagram](trees/can-build-resource-building.md) are accompanied by focused inventory-versus-recipe tests, not a runtime controller implementation. The future `BuildResourceBuilding` action owns placement; its contract remains unsettled and it is not implemented. Material acquisition stays with the parent and the generic resource subtrees. [Housing and rest](housing-and-rest-proposal.md) remain a separate future mechanic/subtree. These are planning subjects, not authorization to implement the simulation changes.

The broader goal is `ObtainFoodAsap`, but the current example graph defines **`CanObtainFoodNow` itself as a linear condition function/subtree** returning true or false without performing actions. In order: own food sell orders exist; another citizen is selling food (price acceptability is deliberately not judged; the function asks only whether food is obtainable); enough gold for the cheapest food; otherwise the shortfall must be coverable by refunds from cancelling own buy orders, then selling inventory to other citizens' buy orders, then also cancelling own sell orders and selling those items. Proceeds use bid prices and remaining quantities, counting each unit of demand once; equality suffices. Citizens may cancel their own orders at will. This check order accumulates possible funding; it does not impose action priority. Reasonableness of price, item-disposal policy and sequential command timing belong to callers and the execution contract, not this condition. Building-sale proceeds and delayed deconstruction/salvage remain outside this function.

The matching `ObtainFoodNow` action proposal compares funding combinations across buy-order refunds, carried-item sales and recovery/resale of item sell escrow. It uses citizen retention preferences together with actual proceeds, contextual gold utility and cancellation opportunity costs, rather than a fixed funding-source order. Cheap heuristics may use occasional LLM-preprocessed weights/tables, refreshed periodically or after meaningful changes, with default heuristics when missing or stale. Preferences cannot make a mechanically feasible route false. The caller checks `CanObtainFoodNow` on current observations before starting or resuming the action tree. Commands execute one at a time, but funding commands are intermediate steps within the same food-acquisition sequence, not successful terminals. Only buying and receiving food or cancelling an own food sell order and recovering food completes the tree. Its only non-action terminal is a loud error for a violated precondition or failed acquisition execution, not ordinary unavailability. Do not repeat the condition's feasibility checks inside the action tree. The surrounding caller/execution context owns request satisfaction, confirmed acquisition (including food already automatically eaten) and resolution of unfilled order remainders before switching tasks. Details and open calibration choices are recorded [with the action tree](trees/obtain-food-now.md). This remains a proposal, not authorization for inference or controller implementation.

The user chose sequential execution: evaluate ordinary decisions on idle ticks, without issuing trades alongside ongoing physical work. A cheap danger/interruption check still runs while busy. Carry intention and parent-strategy context from previous evaluations: wood harvesting can be a step in selling wood to fund food and must retain that survival purpose. The repeated presence of the same danger is not, by itself, a reason to cancel work in its remedying chain. Whether materially changed danger or invalidated plan assumptions justify an exception remains part of the interruption design. Resting-order wait ownership and same-tick emergency handoff still need execution-contract decisions. No broader controller graph is being added.

The [`CanObtainFoodNow` graph](trees/can-obtain-food-now.md) is the first worked condition tree; the [`ObtainFoodNow` graph](trees/obtain-food-now.md) is the matching action tree. Their small typed definitions in [`can-obtain-food-now.ts`](trees/can-obtain-food-now.ts) and [`obtain-food-now.ts`](trees/obtain-food-now.ts) are the source of truth for diagram structure, using shared types from [`draft-types.ts`](draft-types.ts). Edit those definitions, not the generated Mermaid blocks; keep detailed contracts and open questions in the accompanying prose. This is descriptive draft data, not a controller, class framework or execution engine. Broader integration and evaluation phases below remain deferred context, not current planning scope.

Regenerate the diagrams with `npx --no-install tsx docs/research/decision-tree/render.ts`; add `--check` to verify without writing. The generator checks links between nodes, reachability, cycles in the worked sketches, condition side-effect boundaries, and food-producing versus error terminals. Funding nodes require continuations and cannot be success terminals. These structural checks do not prove market feasibility or confirmed delivery. Mermaid remains the human-readable display. The draft's cycle check does not change the broader active-ancestry policy below.

The new generic [condition](trees/can-obtain-resource.md) and [action](trees/obtain-resource.md) diagrams are likewise generated from their adjacent TypeScript definitions. [Resource acquisition design](resource-acquisition-design.md) records complete-route time/cost/risk heuristics, hybrid bidding and physical work, and explicit current-versus-proposed observation/death mechanics. Building destruction and citizen combat are acquisition candidates only when they can deliver the requested resource. Local inventory visibility and natural-death redistribution of items, gold and buildings are proposed changes, not implemented behavior; ground loot is excluded from the proposed acquisition design.

## 2. Decisions recorded from the discussion

| ID | Decision | Practical consequence |
| --- | --- | --- |
| D1 | Compose reusable subtrees rather than one monolithic branch structure. | Components have explicit responsibilities and can delegate to other components. |
| D2 | Plan for both isolated headless verification and live controller integration. | Headless execution is a testing boundary, not a separate target architecture. |
| D3 | Verify subtrees individually, then gradually compose and verify them together. | Do not begin with a whole-society replacement. |
| D4 | Mock inputs may be sufficient for focused behavior tests, provided they are grounded in what a citizen can actually observe in Prosper. | Engine-derived values and consistent observation/feedback sequences underpin behavioral tests. Wider simulation is reserved for mechanics integration and end-to-end questions. |
| D5 | Goal selection may recur within a dependency chain. | A nested request for food is not automatically rejected just because an ancestor also needs food. |
| D6 | A selected strategy cannot be selected again while it is active in the current ancestor chain. | Nested selectors remove circular routes while retaining other alternatives. This is not a static ban on all cyclic references. |
| D7 | Exclusion is local to the active ancestry, not lifetime selection history. | Later attempts, independent branches after unwinding, and other citizens can use the same strategy. |
| D8 | Provide a way to step through and visualize the tree and its subtrees so their behavior is easy to reason about. | Design execution observability alongside composition, rather than adding opaque logging after the controller grows. |
| D9 | Keep current planning focused on `ObtainFood`. | Remove the overall-controller sketch; other subtrees may be referenced as prerequisites but are not being designed now. |
| D10 | The current example graph defines `CanObtainFoodNow` as a condition function/subtree. | Return true or false without world changes. Actions and alternative acquisition routes belong to the caller. |
| D11 | Keep controller execution sequential. | Ordinary decision evaluation happens when idle; do not issue a trade alongside physical work. Busy ticks still allow a cheap interruption check. |
| D12 | Carry intention/strategy provenance between evaluations and through delegated prerequisites. | An indirect survival step, such as harvesting wood to fund food, inherits its parent purpose. Do not interrupt that chain merely because the same mortal danger is still present. |
| D13 | The tree is effectively stateless; nodes consult stateful information. | Keep continuity in explicit per-citizen intention/execution state, not hidden mutable node instances. Nodes read through the citizen-observation boundary; conditions have no side effects. |
| D14 | Separate funding feasibility from goal-sensitive disposal preferences. | Compare refunds and sales together using retention cost and contextual gold utility; preferences do not redefine `CanObtainFoodNow`. Occasional LLM-preprocessed preferences plus cheap local selection are proposed, not a mandatory call per trade. |
| D15 | Exclude buildings from immediate liquidation for food. | The desired building direction is physical deconstruction/salvage, a delayed route. This planning update does not remove the current engine's building-trading mechanic. |
| D16 | Check whether an action is possible before starting or resuming its action tree. | For `ObtainFoodNow`, the caller first checks `CanObtainFoodNow` on the same current observation. A violated precondition or failed execution produces a loud error, not an ordinary-unavailable terminal. |
| D17 | Successful terminals must achieve the tree's responsibility. | `ObtainFoodNow` ends by actually receiving purchased food or recovering food from an own sell order. Refunds, sales and recovery of non-food items are intermediate commands; continue the sequence until food is obtained. |
| D18 | Extend the initial food-only scope to generic exact-tier resource acquisition. | Use kind, tier and market permission, one additional unit per request; callers own quantity, economic tier choice and exploration. D9 describes the initial scope, not a continuing ban on this user-directed extension. |
| D19 | Compare complete permitted routes using cheap time/cost/risk heuristics. | Include movement, prerequisites, opportunity costs, survival and uncertainty; desperation and violence propensity influence selection without overriding hard constraints. |
| D20 | Permit a funded resting bid plus an independent physical fallback. | Confirm actual receipts, prevent double-counted budgets, and resolve request-owned work/order remainders before handoff. |
| D21 | Propose visible local inventories and remove ground loot from the design. | Natural deaths redistribute items, gold and whole buildings among other living citizens. Visibility, remainder allocation, no-survivor disposition and combat-property settlement need explicit contracts before simulation changes. |
| D22 | Remove tool servicing from the simulation as explicitly authorized during the deeper audit. | Tools never wear or consume repair materials; usage preserves them and trade/transfer changes custody. Old checkpoint flags/counters are retired without losing tools, work or history. This does not authorize other proposed mechanic changes. |
| D23 | Retain request ownership through all handoffs, including errors. | Settle every owned order/work item before discarding context; use dependency-ordered preparation, explicit market gates and uniquely allocated structured delivery evidence. |
| D24 | Work diagram-first, then test the responsibility as a black box with mocked dependencies and drill into failing subtrees. | Define only enough contract for the tests initially; consistent mock outcomes are not evidence that actual simulation operations behave as mocked. |
| D25 | Record tiered housing/rest as a future mechanic and give housing its own subtree. | Cheap basic houses, short sleep and costly fatigue should create location/workflow trade-offs. Rates, tier benefits and exact penalty remain open; no runtime housing change is authorized. |
| D26 | Narrow the building pair to a `CanBuildResourceBuilding` materials-ready condition first. | Start with existing refinement stations. The guard takes `(resource, exactBuildingTier)` and is true iff current **carried inventory** covers the exact-tier wood/fibre recipe; it is not a site, reachability, work-idle, safety or market check and performs no acquisition or prerequisite planning. |
| D27 | The building subtree concerns placement, not material acquisition; the parent arranges missing materials separately. | Earlier full-material-plan responsibilities for this pair are superseded. Material acquisition, funding, escrow cancellation, refinement, harvesting and tools stay with the parent and the generic resource subtrees; expense preferences never change inventory truth. A future `BuildResourceBuilding` action owns placement/site checks; its contract remains unsettled and it is not implemented. |
| D28 | Adopt wood-funded marked territory: 2 wood per territory tile, with breakable signs/markings that return wood. | Creation/expansion represents physical investment. Wood tier, recovery amount and boundary changes on destruction remain open; no runtime marks exist by this decision alone. |
| D29 | A citizen belongs to at most one territory at a time; creation automatically makes its creator a member. Membership shares building use and the current owner receives a harvest tax at one constant rate across territories (recipient clarified by D40). | All resource harvests inside the territory are taxed, preserving resource kind/tier. Fractional quantities are required; the user's 1 → 0.15 creator + 0.85 harvester example supplies a 15% candidate rate to confirm. Shared use is distinct from ownership; consent, admission and exit rules remain open. |
| D30 | Use five directed reputation levels: hostile, disliked, neutral, positive and admired. | Neutral is the default, family starts admired, gifts improve the recipient's view of the giver, and a personal attack sets the victim's view of the attacker to hostile. Family scope and gift increments remain open; a matrix does not imply symmetric or publicly visible opinions. |
| D31 | Structure attacks take time; witnessing territorial offenses propagates reputation consequences to territory members. | Structure/sign attacks and harvesting cause group-wide reductions under offense rules still to be specified. A member witnessing an attack on a fellow member makes all members hostile toward the attacker; hostility supplies a grievance for stochastic combat selection, not a mandatory attack. Hidden events do not trigger omniscient reactions. |
| D32 | Witnessed trespass reduces territory members' reputation toward the trespasser by one level, with a cooldown. | Do not penalize every sighting/tick. Cooldown duration/scope, authorization and repeated-entry behavior remain open; repeated offenses may eventually produce hostility. |
| D33 | Provide normalized 0..1 citizen-relative spatial value for territory creation/expansion and building placement. | Refined from generic higher-tier preference: current tools/opportunities determine immediate usefulness; future opportunity and evidence-grounded strategic value also contribute. Reuse components with task-specific scoring; keep hard eligibility separate. The parent chooses purpose and the subtree chooses location. The [evaluation contract](territory-design.md#evaluation-contract--sufficient-direction-for-a-first-concrete-design) is sufficient for a first draft with provisional formulas and contrasting ranking tests; runtime integration remains unauthorized and emergent usefulness unproven. |
| D34 | Review subtree responsibilities before expanding their graphs. | Start with `InTerritory`, `OwnsTerritory`, `CreateTerritory` and `ExpandTerritory`, alongside the existing drafts. Suggested supporting responsibilities are proposals, not implemented trees or an overall controller. |
| D35 | Drop the separate alliance system from the intended design. | Reputation and territory membership serve its social purpose; do not add alliance-forming subtrees or a separate ally flag. Existing runtime alliances remain until separately authorized mechanics migration/removal. |
| D36 | Confirm no ground loot in the intended world. | Do not add `CanLoot` / `Loot`. Keep the earlier estate-redistribution direction; death/inheritance settlement details remain open. Existing runtime ground loot remains until separately authorized removal/migration. |
| D37 | Remove building trading from the intended world. | Do not add building-buy/sell pairs. Construction, shared use, retaining buildings and physical destruction/salvage remain the relevant alternatives; inheritance is a separate mechanic. Current building orders/ownership transfers remain until separately authorized removal/migration. |
| D38 | Owner departure disbands the territory. | No absentee ownership after leaving: dissolve the territory, end all memberships, tax and membership-based access. Buildings retain location/ownership. Sign disposition/recovery remains separate; owner death is governed by D39. Design only. |
| D39 | Owner death uses membership seniority for succession. | The longest continuously serving living current member becomes owner; leaving/rejoining resets seniority. Preserve territory identity/area/memberships; disband if none remain. Territory leadership does not assign all building estates. Tax follows ownership (D40); exact seniority ties still need a rule. |
| D40 | Harvest tax follows current territory ownership. | The creator is the initial recipient as first owner; after succession, future harvest tax goes to the successor at the same fixed rate. No perpetual founder/estate tax entitlement. This clarifies D29. |
| D41 | An eligible killer inherits a slain leader's territory before the seniority fallback. | Eligible at death: living current member of that territory or unaffiliated killer (automatically made a member). A killer affiliated elsewhere does not inherit or switch membership. Otherwise use D39, including natural deaths. Preserve identity/area/surviving memberships; tax follows owner and hostile reputation is not reset. Building estates remain separate. |
| D42 | Current members collectively vote on territory admission. | No sole-owner admission authority or automatic reputation enrollment. `JoinTerritory` requests and confirms the collective decision. Threshold is settled by D43; individual criteria and timing remain open. Ownership/tax receipt grants no admission veto. |
| D43 | Admission requires strict majority of all living current members. | One equal vote each, including the owner; more than half must vote yes. Silence is not approval, ties do not admit and unresolved requests eventually expire. Exact timeout/timing remain open. |
| D44 | Keep individual admission voting policy black-box at this stage. | Generally use reputation and citizen preferences; no fixed reputation threshold or detailed decision algorithm is approved. Deliberately deferred, not a blocker for mapping high-level responsibilities. |
| D45 | No discretionary territory expulsion. | Voluntary exit only: neither owner nor member vote may expel another member. Death/disbanding still end memberships under existing lifecycle rules. Hostility does not automatically cancel membership; no expulsion pair is planned. |
| D46 | Any current member may expand territory using their own wood. | Membership supplies expansion authority, with no separate approval vote. Material and eligible-known-land checks still apply; identity/ownership remain unchanged and added harvest tax goes to the existing owner. |
| D47 | Prevent claims over nonmember buildings and nonmember construction inside territory. | Hard eligibility at creation/expansion and construction, not a soft social penalty. Creator's own buildings are eligible through automatic initial membership. Apply to building kinds, including houses/walls; materials-only building guards remain unchanged, with placement permission checked by actions. Non-owner exit is resolved by D48; estate effects remain open. |
| D48 | A non-owner leaving does not revoke shared use of their buildings. | Buildings stay at their location with unchanged ownership/owner use; active territory members keep shared use. The departing member loses membership-based access to others' buildings. No demolition or boundary carve-out; placement eligibility is prospective. |
| D49 | One active territory per tile; no overlapping claims. | Creation/expansion cannot overwrite another active claim. Reclaiming requires an unclaimed tile; succession/conquest preserves the existing territory rather than adding overlapping ownership. |
| D50 | New claims and expansion must be connected. | Initial area is connected; additions connect through existing/newly marked tiles. Holes around ineligible tiles are allowed. Damage may fragment the same territory under D51; this growth rule does not force an automatic split. |
| D51 | Destroying a sign immediately frees only its tile. | Tile tax/shared-use context ends; buildings stay unchanged. Other signs retain the same territory and memberships even if fragmented. Losing the last sign disbands. Reclaiming uses normal expansion eligibility/cost, including restrictions on nonmember-owned buildings. |
| D52 | Disbanding removes remaining signs without refund. | Claims, tax, memberships and shared-use grants end; intact signs disappear with no wood recovery. Buildings remain with unchanged ownership. Deliberate sign destruction recovery remains a separate rule. |
| D53 | Newborns inherit membership only when both parents share a territory. | At birth, automatically join that active territory without an admission vote; otherwise start unaffiliated. Membership grants shared use, not building ownership. Birth membership is a world mechanic, not a separate JoinTerritory execution. |
| D54 | Territory voting and succession rights are equal from birth. | Child members count in the all-living-member admission denominator and have one equal vote. No adulthood requirement for leadership succession; a child may inherit by membership seniority. Individual voting policy remains deferred under D44. |
| D55 | Children's membership is independent after birth. | A parent's departure neither transfers nor ends their children's memberships or shared-use rights. Children leave through their own decisions; whole-territory disbanding still ends all memberships, including when its owner parent leaves. |
| D56 | Caught nonmember harvesting drops reputation one level with all territory members. | Each member's directed opinion of the harvester drops one level, bounded by hostile. Harvest tax still applies and does not buy permission. Unobserved harvesting does not trigger omniscient punishment. Repetition/cooldown and stacking with trespass remain deferred details. |
| D57 | Existing building shared use survives inheritance. | An heir receives ownership without revoking territory members' existing use, regardless of the heir's membership. Shared use lasts while the building remains inside the active territory; disbanding or loss of its claimed tile ends it. Heir selection remains separate. |
| D58 | A killer also inherits the victim's personal property. | Fatal-attack estate recipient is the killer: inventory, gold, tools and owned buildings transfer without ground loot. Existing building shared-use obligations survive (D57). Territory succession remains separately subject to D41 membership eligibility; natural-death beneficiaries follow D59; detailed death/order settlement remains open. |
| D59 | Natural-death estates go to family first, otherwise territory members. | Use surviving eligible family; only if none exist use surviving members of the deceased's territory. Personal estate distribution is separate from territory leadership succession. If neither group exists, distribute the estate among all living citizens. Exact family scope, allocation and the no-survivors case remain open. Existing shared-use obligations survive inheritance. |

The node-selection method is not settled. Rules, utility, task-specific predictors, classifiers or a small local LLM may serve different nodes. Authored alternatives and supplied consequences must be reported as assistance, not credited as strategies independently discovered by a model.

## 3. Nested selection and cycle prevention

### Terminology for this plan

- **Goal selector:** chooses a means of achieving a requested outcome, such as obtaining food.
- **Strategy:** one selected means, such as buying food or producing wood for sale. It may require other outcomes.
- **Execution component:** performs and monitors ordinary primitives, such as travel, harvesting or an order.
- **Active ancestry:** the selected strategies that led to the current nested request and remain unresolved.

These are behavioral roles, not a committed class hierarchy or interpreter design.

### Worked example

```text
ObtainFood
└── BuyFood
    └── ObtainGold
        └── ProduceWood
            └── CraftAxe
                └── ObtainFood
                    ├── BuyFood       excluded: active ancestor
                    ├── GatherFood    eligible for ordinary feasibility checks
                    └── Other means   eligible for ordinary feasibility checks
```

If a nested selector considers `ProduceWood` through another route, that strategy is excluded too. The guard applies across intermediate selectors and execution components; inserting a helper cannot hide an active ancestor.

This example is a possible bad dependency route, not a required Prosper workflow. Axe recipes use food and fibre, but barehanded harvesting exists. Producing wood must not automatically require an axe, and preparing an optional tool must not silently displace an urgent food need.

### Guard semantics to preserve

1. Before entering a strategy, compare its stable definition identity with active ancestor strategies. A new invocation ID does not make the same strategy different.
2. Exclude that candidate before selection. Do not wait for recursive expansion to overflow, then call it a failed decision.
3. Keep ancestor exclusions available throughout nested execution, including across ticks while parents await prerequisites.
4. Do not bypass the exclusion by changing a target, quantity or deadline. Exact strategy identity granularity remains an implementation-design question.
5. If all means are excluded or infeasible, report that this request cannot currently be fulfilled in this context. The parent reconsiders its route; do not conclude the overall goal is universally impossible.
6. Remove the strategy from the active path when that invocation exits. Execution across multiple citizens must not share mutable ancestry.

This permits cyclic references in the component graph while preventing repeated selected strategies along an active path. It intentionally does not use the earlier proposed blanket acyclic-graph rule or a generic recursive dependency manager.

### Limits of the guard

Ancestor exclusion is not a complete planner. It does not establish affordability, physical feasibility, profitable production, eventual order fills or optimality. Different strategies can still lead to wasted work. Ordinary failure handling, commitment revalidation and bounded decision work are still needed.

Before implementation, define how suspended intentions retain ancestry, how branch failure unwinds it, and what bounds stop direct selector/helper recursion that never enters a new strategy. Do not add a general-purpose graph language merely to support this rule.

## Persistent dispositions and local selection

Most decisions should use local scoring of prepared alternatives with persistent citizen dispositions/weights, rather than a model call per choice. Examples include ambition, morals and generosity. Occasional LLM strategic reviews may adjust these dispositions using relevant experience/context; small targeted model decisions remain possible where useful, but are not the default. Local execution continues with existing settings between reviews. The agreed baseline dimensions are ambition (pursuit of greater wealth/capability/control), morals (acceptable harm/exploitation), generosity (help at personal cost), risk tolerance (uncertain or dangerous outcomes), patience (future versus immediate rewards), sociability (community versus independence), vengefulness (retaliation after remembered harm) and family orientation (reproduction/family support). Do not add overlapping aggression, greed or cooperation dimensions without an identified expressive gap. Temporary hunger, fatigue, danger and shortages are situation inputs, not personality weights. Scales and adjustment limits remain provisional. **Agreed director schedule:** run at citizen creation, then on a fixed infrequent schedule staggered across citizens. Supply current weights and a summary of experience since the previous review; unchanged weights are a valid result. Do not add event-triggered reviews initially. Citizens continue locally between reviews. Exact cadence is provisional.

**Disposition-driven selection is stochastic, without personality-based hard cutoffs.** This supersedes the earlier interpretation of high morals as an absolute prohibition. Low morals make killing for survival much more likely; high morals make it very unlikely but still possible. Locally sample among feasible alternatives using probabilities influenced by dispositions, prepared consequences and current circumstances, rather than always taking the highest score. Exact probability mapping remains provisional. Hard world permissions and physical feasibility still exclude invalid actions; personality does not bypass those constraints. Low morals do not require attacking regardless of danger or alternatives. Random selection occurs at decision/reconsideration points, not as per-tick resampling that discards ongoing commitments.

Prepared option estimates remain separate from these preferences: local selection combines estimated consequences with citizen dispositions and current context. The occasional LLM adjusts strategic preferences, not physics, permissions, forecasts or confirmed outcomes. This refines the selection direction below without requiring a separate per-citizen boolean for every personality-governed behavior, and does not authorize runtime changes.

### Economic approach preferences

Add **two agreed economic tendencies** alongside the eight baseline dispositions, not one weight per strategy:

- **Enterprise:** preference for simple, familiar work versus investment in tools, buildings and more involved ventures. Distinct from ambition (how much advancement is desired) and patience (when benefits arrive).
- **Economic independence:** preference for earning through personal production versus exchange, coordination or control of others' activity. Distinct from sociability: enjoying community does not require an exchange-based livelihood. Numeric direction/scales remain provisional.

These replace the earlier six proposed per-approach weights (market, production, tools, simplicity, exploitation and territory), which are not adopted. Personality alone should not be stretched to imply a preferred economic approach. The two tendencies bias comparisons without imposing professions or permissions: an independent producer may sell goods, and a low-enterprise citizen may buy a useful tool. Prepared forecasts and circumstances distinguish tools from refinement or trade from territory. Morals influence the probability of exploitation rather than imposing a personality threshold that forbids it; neither tendency grants price foresight, profitable tax income or permission to claim ineligible tiles. Citizens may combine strategies. Exact formulas remain provisional.

### Model necessity checkpoint

Start with no required inline model calls in the master tree; the occasional preference-update director is the agreed model role. Local stochastic selection uses prepared consequences and weights after hard world-feasibility checks. Improve missing candidate/forecast representations before adding model calls.

A read-only scout of current policy/context interfaces and autonomy found no intended mechanical behavior requiring inline LLM interpretation. Optional model benefits include interpreting prose personality/memories during strategic review and generating expressive messages or summaries. These are convenience/characterization opportunities, not proven necessities: family negotiation already uses typed signals, and messages themselves are not consent or transactions. Admission and economic choice can use structured preferences and evidence. Add an inline model node only for a demonstrated behavioral gap, with a bounded contract and local fallback; do not invent language-dependent mechanics to justify it.

## Strategic selection: prepared alternatives, not model forecasting

For nuanced choices such as which goal or strategy to pursue, a selectable decision method (for example a classifier or LLM) receives compact, easily parsed strategic context: relevant memory, observed situation, citizen personality/preferences, current intention and explicit candidate alternatives. Each alternative includes prepared estimates of its outcomes, costs, duration, risks and relevant trade-offs. The selector weighs alternatives against citizen context; it is not responsible for complicated forecasting, reconstructing mechanics or inventing a plan.

Separate **candidate preparation and outcome estimation** from **preference-based selection**. Forecasts come from upstream task-specific calculations/predictors using citizen-visible evidence and known mechanics, not hidden world state. Distinguish confirmed facts from estimates; retain assumptions, uncertainty and unknown outcomes rather than presenting speculative returns as guarantees. Comparable option summaries should use common units/horizons where applicable, without requiring a general world simulator or perfect predictions.

The selector returns a supplied option identifier (or an explicit supported defer/no-choice outcome), not arbitrary commands or invented alternatives. Hard feasibility remains the responsibility of guards and action revalidation; attractive forecast results never override permissions or establish success. Selection may be fallible and personality-dependent. This contract does not choose a model, mandate an LLM at every branch, or authorize runtime integration. Evaluation must distinguish the quality of prepared candidates/forecasts from the quality of the selector's choice.

## 4. Proposed component contracts

The following is a design proposal to resolve before coding, not a frozen API:

- A request describes the desired outcome, satisfaction condition, urgency/deadline and constraints. A parent should not dictate the means unless explicitly constraining them.
- A subtree reports `running`, `succeeded` or `failed`, with a reason and any proposed ordinary command. Distinguish waiting, strategy exclusion, infeasibility and engine rejection in diagnostics.
- Completion depends on confirmed observations/results, not command acceptance alone.
- Per-citizen, per-invocation state records the selected strategy, phase, target, progress, prerequisite and relevant ancestry. Keep it serializable and separate from reusable component definitions.
- Separate goal/intention state from current physical action and from beliefs/preferences. An action failure need not erase its goal.
- Continue viable work across observations rather than selecting from scratch each tick. Define reconsideration, interruption, cancellation and resumption explicitly.
- The adapter supplies citizen observations and command feedback. Components must not receive the authoritative `World` or directly dispatch commands.
- Shared pure fact calculations may derive meaning from observations and public mechanics. They must preserve stale/uncertain information and not consult hidden state.

A goal such as maintaining reserves belongs above acquisition. An acquisition subtree can therefore serve both routine reserves and critical hunger without owning a competing hunger policy. The generic request meaning is settled: one additional exact-tier delivery, including food automatically consumed afterward. Recipe callers still check actual ingredient holdings. Delivery attribution, credit allocation and lifecycle details remain to be specified before implementation.

## 5. Grounded test strategy

**Working order from the latest discussion:** sketch the diagram, test its overall responsibility as a black box using small consistent dependency/world mocks, then drill into failing subtrees with more detailed mocks. Do not settle every execution contract upfront or require a whole real simulation before the first behavioral test. The practices below ground those mocks and describe progressively stronger verification; they do not make mock success equivalent to engine integration.

### A. Focused component tests

Test selection, ancestor exclusion, progress and lifecycle with the smallest relevant input projection. Use the smallest consistent modeled facts initially. Generate representative observations using the real engine and `observe` where useful, then verify component inputs through the same projection used at runtime before claiming engine integration.

Prefer fixture builders and supported setup/commands over manually assembling complete `CitizenObservation` objects. Public mechanics constants, recipes and tiers should come from their actual definitions, not duplicated example values. Assertions should test behavior against those mechanics, with explicit tests for any intentionally fixed balance assumptions.

Synthetic malformed/impossible inputs may test defensive behavior, but label them separately. They do not count as evidence that a citizen behaves correctly in a possible world state.

### B. Observation-sequence tests

Static values alone are insufficient for commitments. Initial black-box mocks should give consistent outcomes for the actions actually chosen, including active work, stale targets, partial fills, changed conditions and interruption. Later generate representative short sequences through actual dispatches, individual ticks and knowledge updates, feeding only citizen-visible observations/feedback to verify the mock contracts against the engine.

An accepted buy order must not be mocked as guaranteed food. Its feedback must agree with actual funding, settlement, remaining demand and subsequent inventory. Likewise, modeled travel/harvest completion needs consistent prerequisites, duration and effects; a bare success response is insufficient. Label future/proposed feedback contracts as mocks, not current engine evidence.

Recorded sequences test behavior along the recorded path. If a candidate chooses a different action, do not continue supplying consequences from the old path as if they were its outcomes. Either test the decision boundary only or use action-dependent modeled outcomes, then branch through the real engine for integration evidence.

### C. Engine integration and end-to-end tests

Execute commands through the existing headless harness to verify knowledge gates, physical actions, automatic meals, settlement, failure recovery and composed behavior. Use outcome-specific assertions; the harness's vital-success score alone does not prove acquisition, production or trade capability.

Only after components and their composition work should longer isolated live-style simulations test ownership, interactions and performance. These are fresh temporary worlds, not the user's saved society.

### Required cycle cases

- Direct and indirect repetition of an active strategy is excluded.
- Repeated goal selection still permits a different strategy.
- Every active ancestor is considered, not only the immediate parent.
- Exclusion cannot be bypassed by fresh invocation IDs or changed request parameters.
- Exhausted alternatives fail the attempted route and permit parent reconsideration.
- Successful and failed invocations release their active-path entries correctly.
- Waiting across ticks preserves ancestry; suspension/resumption semantics are explicit.
- Independent citizens and subsequent invocations remain isolated.

## 6. Stepping and visualization

The user requested stepping and visualization as part of making the composed controller understandable. The following is a proposed debugging design; UI placement, layout and exact stepping granularity are not yet chosen.

### Two complementary views

- **Definition view:** show selectors, strategies, execution components and subtree references. Expand/collapse references on demand. The reference graph can contain cycles, so render recursive references as links rather than expanding them indefinitely.
- **Execution view:** show one citizen's actual invocation path and selected strategies, with stable definition identities and distinct invocation identities. Repeated `ObtainFood` requests should appear as distinct invocations; show which ancestor excludes a strategy at the nested selector.

Inspect relevant request/inputs, observation tick, state, evaluated conditions, considered alternatives, recorded selection reason, exclusions, proposed command and confirmed feedback. Distinguish not evaluated, excluded, running/waiting, succeeded and failed. Do not label an unvisited branch as a failure. Display uncertainty and dated evidence as such, not as hidden live truth.

For the worked example, the view should explain `BuyFood excluded: active ancestor <invocation>` and show the remaining alternatives. A decision view should report actual rule results, utility values or bounded model outputs where available, not invent an explanation or claim access to a model's private reasoning.

### Separate decision execution from simulation time

Provide distinct concepts for:

- **Tree step:** advance an explicit logical decision boundary, such as entering a component, excluding a candidate, selecting a strategy or proposing a command. Tree stepping must not implicitly advance world time.
- **World tick:** advance physical simulation through the normal adapter and feed back the resulting citizen observation. Command commitment is an explicit normal execution boundary, not a side effect of expanding a visual node.
- **Trace playback:** move forward/backward through already recorded decision events and observations without executing the controller again.

Backward inspection is not world rollback. Re-executing or branching from an earlier point would require a separately defined replay mechanism; it is not implied by the first debugger. Headless stepping is the initial target. Before live stepping, decide its pause scope so the world cannot silently change while a decision is being inspected as frozen.

### Shared execution evidence

Emit structured execution events from the same components used by headless and live adapters. Proposed event fields include citizen/decision/invocation identity, parent invocation, definition identity, observation tick, transition, reason and associated command/result. The definition view also needs inspectable component/reference metadata; handwritten diagrams must not drift from the executable composition.

Use this evidence for the visualizer and focused assertions. Viewing, expanding nodes and playing back a trace must not dispatch commands, mutate intentions, re-run selectors or trigger inference. Explicit forward execution still uses the ordinary dispatcher, knowledge gate and any approved inference budget. Keep actor-visible evidence separate from privileged evaluator diagnostics; neither the controller nor its knowledge view may gain hidden information through the debugger.

Trace retention and detail must be bounded, with omissions identified. Choose the small event contract before fixing a UI framework or adding debugger-specific orchestration. Keep any execution instrumentation lightweight when inspection is disabled.

### Initial acceptance cases

- Step an isolated grounded-input subtree and inspect the same path in trace playback.
- Expand a reused subtree without confusing definitions with citizen-specific invocations.
- Show a repeated goal request, its ancestor exclusions, alternate selection and parent resumption.
- Show accepted work waiting across world ticks and distinguish proposal, acceptance and completion.
- Inspect a failed prerequisite and the parent's reconsideration.
- Verify playback produces no additional commands or model calls and does not change controller state.

## 7. Actual Prosper boundaries

Source anchors:

- Observation, citizen state and primitive commands: `src/shared/types.ts`.
- Citizen projection and command knowledge gate: `src/world/observation.ts`.
- Mechanics constants/recipes: `src/world/config.ts`; dynamic tiers: `src/shared/tiers.ts`.
- Tick/action/meal behavior: `src/world/core.ts`; market settlement: `src/world/market.ts`.
- Existing production strategy: `src/world/autonomy.ts`, `src/world/production.ts`, `src/world/society.ts`.
- Headless candidate API: `src/evaluation/contracts.ts`; execution: `src/evaluation/runner.ts`.

Constraints that examples and mocks must respect:

- Commodity markets are global and settle remotely; buying food does not require travel to a market.
- Eating is automatic. There is no eat command; acquired food may already be consumed by a later observation.
- Remembered deposits have observation dates, not guaranteed current stock. Loot sightings do not expose their contents.
- Commands can fail knowledge validation or mechanics validation independently. Acceptance of work is not completion; a resting order is not a promised fill.
- Travel/work estimates use personally available information and public mechanics. Hidden obstacles, competing claims on work and future availability can invalidate estimates.
- Reservations, carried inventory and funded orders must not be counted twice or duplicated on retries.

Use public development fixtures for controller construction. Do not inspect evaluator-private held-out cases or reference solutions for tuning. Candidate-private fact derivation and authored strategy generation are controller behavior, not undeclared assistance supplied by the runner.

## 8. Incremental implementation sequence

These are proposed work packages, retained from the initial food-acquisition pass. Resource drafts now exist; building placement and territory responsibilities are the next design subjects. Settle the responsibility being implemented and obtain separate authorization before starting runtime code. Phases 4–6 remain deferred possibilities, not a whole-controller implementation plan.

### Phase 1: settle the small contract

- Define goal/strategy identities, ancestor propagation/unwinding and invocation state.
- Specify statuses, completion, failure, waiting and interruption semantics.
- Define inspectable composition metadata, execution events and the distinction between tree stepping, command commitment, world ticks and playback.
- Enumerate `ObtainFood` means and prerequisites from actual mechanics, leaving other prerequisite trees unexpanded.
- Write its behavior matrix and grounded fixture plan before implementing the component.

Exit: a worked trace, including a nested repeated goal and an excluded ancestor strategy, with no ambiguous lifecycle decisions.

### Phase 2: implement the minimum composition support

- Add only the contracts, ancestry guard and state needed for the selected responsibility.
- Verify the cycle cases above with small isolated tests.
- Keep node selection replaceable without introducing model services, training or a general interpreter.
- Emit the agreed events and provide a minimal headless-oriented stepping/visualization path before composing larger behavior. Its first UI surface remains to be selected.

Exit: reliable selection/exclusion and isolated invocation state, with bounded per-decision execution and an inspectable step-through trace.

### Phase 3: implement and verify one complete responsibility

- Add its means incrementally, sharing execution components where justified.
- Cover success, unavailable prerequisites, engine rejection, no progress and interruption.
- Verify both isolated observation sequences and actual command execution.

Exit: the documented responsibility is satisfied across its declared cases, or failures are explicitly diagnosed. Do not claim coverage of means not implemented yet.

### Phase 4: compose another responsibility

- Exercise real delegation and parent recovery, not just independent happy paths.
- Test changes in urgency, incomplete work and reservations across nested requests.
- Add alternatives only where supported by the world and the declared scope.

Exit: integration demonstrates reuse and the ancestor exclusion rule without hidden competing strategy.

### Phase 5: integrate live execution progressively

- Keep shared controller code independent of evaluation-only modules; use thin headless/live adapters.
- Choose exactly which existing controller responsibilities the tree replaces. Prevent autonomy, emergency, directive or plan controllers from issuing competing commands for those responsibilities.
- Preserve normal physics, automatic meals, accounting and authoritative cancellation/death boundaries.
- Resolve checkpoint compatibility for any persistent execution state before enabling it.
- Verify in isolated worlds first; do not migrate or reset saved worlds implicitly.

Exit: headless and live-style execution obey the same component contracts and have clear command ownership.

### Phase 6: evaluate decision methods where useful

Compare selection methods at identified ambiguous nodes under matched information, alternatives, action authority and horizons. Specify model/resource limits and authorization separately. Measure actual outcomes, latency and failures; valid formatting and fast classification do not establish good choices.

## Planning detail policy

Routine mechanics should use explicit provisional defaults rather than requiring user approval for each edge case. Reserve further design questions for material changes to behavior, responsibility boundaries or world incentives. Balance values and individual decision policies may remain deferred; these defaults are not user-approved decisions or runtime implementation authorization.

Provisional family default: parents, children and siblings (including half-siblings) count for initial family reputation and family-first inheritance; reproduction partners are not automatically relatives. Exact estate allocation remains deferred.

## 9. Open decisions before implementation

1. Which bounded resource-acquisition routes belong in the first implementation increment? The current subject is the generic resource pair; controller implementation is not yet authorized. Tool-servicing removal is a separately authorized mechanics change.
2. Which strategy identities are appropriate for exclusion, without making identities so broad that useful routes disappear or so narrow that circularity evades detection?
3. How are unique delivery records, per-request credit and acknowledgement retained through asynchronous fills, automatic consumption, interruption and reload? Generic one-unit exact-tier acquisition semantics are settled; the concrete feedback boundary is not.
4. How should waiting, suspension, resumption and abandonment preserve or release ancestry and real reservations?
5. Which selection nodes start with code/utility, and which, if any, justify a learned predictor or local model?
6. What is the smallest live ownership boundary, and how is it enabled without competing controllers?
7. Where should shared components live? The current source-identity audit in `src/evaluation/audit.ts` hashes immediate TypeScript files in selected directories, not arbitrary nested modules. Any chosen layout must keep all executed controller code covered by replay identity.
8. What fixture cases, success criteria, decision limits and horizons define the first bounded implementation?
9. What is the first visualizer surface and exact logical-step granularity? How are composition metadata and bounded execution events exposed without introducing a second behavior implementation?
10. What pause scope and command-commit controls are appropriate for eventual live stepping?

## 10. Scope and evidence discipline

This checkpoint documents a working direction, not a demonstrated architecture winner. Acquisition and territory/reputation/land-value mechanics remain design-only; typed subtree drafts are descriptive, not runtime executors. Tool-servicing removal was separately authorized and implemented with compatibility tests; no other proposed mechanic, package, model acquisition, paid call, training run, durable-data access or whole-controller replacement is authorized. Temporary test artifacts belong in the OS temp directory and must be cleaned when no longer needed. Existing pending code changes remain untouched.

Related references: [headless harness usage](../evaluation-harness-usage.md), [decision harness contract](../decision-harness-contract.md), [current layered implementation](../../spike-2/OVERNIGHT.md). Some older research sections describe earlier unselected architectures or a pre-implementation harness; use the current source and this dated planning checkpoint for the boundaries addressed here.

## 11. Subtree inventory and next responsibilities for review

**Maintained subtree register.** On 2026-10-10 the user accepted the proposed territory and supporting responsibilities. Keep this section as the canonical list; update each row as its responsibility, draft or implementation status changes rather than maintaining competing lists.

- **Drafted:** typed descriptive definition and generated diagram exist. This does not mean a runtime executor exists.
- **Planned:** accepted responsibility; contracts and diagrams remain to be designed. Acceptance does not authorize runtime implementation.
- **Future proposal:** recorded for later discussion, without a settled subtree name or contract.

| Subtree / responsibility | Kind | Status | Responsibility |
| --- | --- | --- | --- |
| [`CanObtainFoodNow`](trees/can-obtain-food-now.md) | Condition | Drafted | Check immediate food feasibility, including recoverable food escrow and purchase funding. |
| [`ObtainFoodNow`](trees/obtain-food-now.md) | Action | Drafted | Fund and obtain food; funding alone is not success. |
| [`CanObtainResource`](trees/can-obtain-resource.md) | Condition | Drafted | Check feasibility of one additional exact-tier food/fibre/wood unit under market permission. |
| [`ObtainResource`](trees/obtain-resource.md) | Action | Drafted | Obtain one additional exact-tier unit; confirm delivery and clean up owned work/orders. |
| `CanExplore` | Condition | Planned | Check a known permitted route offering new/refreshed information relevant to the parent's search goal. |
| `Explore` | Action | Planned | Choose where to investigate and travel/observe until the search goal is met, budget exhausted or interrupted; no guaranteed discovery. |
| `CanHarvestResource` | Condition | Planned | Check known reachable harvestable deposits of the requested exact tier under hard restrictions. |
| `HarvestResource` | Action | Planned | Choose known deposits, travel and harvest until one additional net exact-tier unit is delivered; parent repeats for quantity. |
| `CanSellItem` | Condition | Planned | Check requested carried resource/tool stock is available for sale and market use is permitted; no guaranteed buyer. |
| `SellItem` | Action | Planned | Price/manage a sale, confirm requested quantity actually sold and resolve remaining owned orders; parent defines surplus and limits. |
| `CanObtainTool` | Condition | Planned | Check known permitted purchase, own sell-escrow recovery or crafting/prerequisite routes to one additional exact-kind/tier tool. |
| `ObtainTool` | Action | Planned | Choose a route, delegate materials/crafting or funding, confirm one additional requested tool and clean up owned work/orders. |
| `CanCraftTool` | Condition | Planned | Check available recipe materials for a requested axe, knife, scythe or sword tier. |
| `CraftTool` | Action | Planned | Craft and confirm receipt of one requested-kind/tier tool; parent chooses investment and arranges materials. |
| `CanRefineResource` | Condition | Planned | Check carried conversion inputs and a known usable, reachable station, including shared territory access. |
| `RefineResource` | Action | Planned | Choose a station, travel, perform one requested tier conversion and confirm output; parent arranges inputs. |
| [`CanBuildResourceBuilding`](trees/can-build-resource-building.md) | Condition | Drafted | Check carried construction materials only; no placement or acquisition. |
| [`BuildResourceBuilding`](resource-building-brainstorm.md) | Action | Planned | Select/revalidate a site and complete one new requested station; parent arranges materials. |
| `InTerritory` | Condition | Planned | Check whether a known position lies in territory; not membership, ownership or permission. |
| `OwnsTerritory` | Condition | Planned | Check ownership, independently of position or membership elsewhere. |
| `CanCreateTerritory` | Condition | Planned | Check no existing membership, enough wood for the requested tile count and at least one eligible known area within parent constraints. |
| `CreateTerritory` | Action | Planned | Choose an area, mark it and confirm completed territory, creator ownership and automatic creator membership; parent arranges wood. |
| `CanExpandTerritory` | Condition | Planned | Check current membership, own wood for newly marked tiles and eligible known additions within parent constraints. |
| `ExpandTerritory` | Action | Planned | Choose and mark additions and confirm the enlarged area, preserving territory identity, ownership and membership. |
| `IsTerritoryMember` | Condition | Planned | Check membership, independently of location and ownership. |
| `CanJoinTerritory` | Condition | Planned | Check known admission rules and that the citizen is not a member of another territory; this does not guarantee acceptance. |
| `JoinTerritory` | Action | Planned | Request admission through current-member voting and confirm membership/shared building access; do not transfer ownership. |
| `CanLeaveTerritory` | Condition | Planned | Check that the citizen currently belongs to the specified territory. |
| `LeaveTerritory` | Action | Planned | End membership and confirm access consequences; owner departure disbands the territory. No automatic joining elsewhere or building ownership transfer. |
| `CanUseBuilding` | Condition | Planned | Check ownership/shared-use permission and station eligibility; presence is not permission. |
| `CanReproduce` | Condition | Planned | Check own known physical/material prerequisites and an available potential partner, without assuming consent or private inventory. |
| `Reproduce` | Action | Planned | Choose a partner, handle consent/rendezvous, revalidate both participants and confirm completed reproduction. |
| `CanGiveGift` | Condition | Planned | Check selected gift availability and delivery feasibility to a known recipient under hard restrictions. |
| `GiveGift` | Action | Planned | Deliver selected resources, tool or gold, including necessary travel, and confirm receipt; reputation is a mechanics consequence. |
| `CanAttackCitizen` | Condition | Planned | Check physical fighting ability and engagement feasibility for a known target under hard restrictions. |
| `AttackCitizen` | Action | Planned | Approach and attack one target until defeated, interrupted or no longer engageable; no looting or invented target location. |
| `CanAttackStructure` | Condition | Planned | Check known structure reachability and attack feasibility under hard restrictions, not whether attack is worthwhile. |
| `AttackStructure` | Action | Planned | Travel to a selected structure, damage it over time and confirm destruction and any resources actually returned. |
| `CanBuildWall` | Condition | Planned | Check available materials and known feasible placements for requested wall tier/extent within parent constraints. |
| `BuildWall` | Action | Planned | Choose placement, travel and confirm construction of the requested wall section; no automatic land claim. |
| `CanBuildHouse` | Condition | Planned | Check available materials against the future requested-tier house recipe; no placement guarantee. |
| `BuildHouse` | Action | Planned | Choose/revalidate a site, travel and confirm one completed requested-tier house; parent arranges materials. |
| `CanSleep` | Condition | Planned | Check a known permitted, reachable sleeping option under the eventual house/outdoor rules. |
| `Sleep` | Action | Planned | Choose a sleeping option, travel if needed and confirm requested rest recovery, or report interruption/failure. |

### Current executable coverage — 2026-10-11

This is the current status overlay for the canonical registry above; its Drafted/Planned column records the **historical diagram status**, not present runtime absence. Descriptive `.ts`/Mermaid drafts remain separate from executable definitions.

| Registry group | Implementation / evidence boundary |
| --- | --- |
| Food/resource acquisition, tools, harvest, refining, sales | Guards/actions in `src/citizen/tree-actions.ts`; `HarvestResource` is implemented as `Harvest`. Local action/market/engine tests cover execution and receipts, not profitable specialization. |
| Stations, houses, walls, sleep, exploration | Executable guards/actions plus core physical mechanics; engine tests cover construction/rest. Seeded evaluation shows houses/sleep/exploration, but no station/refinement progression. |
| Territory facts, creation/expansion, joining/leaving, building use | Executable conditions/actions and `src/world/territory.ts`; territory/engine tests cover membership, marking, access and lifecycle. Evaluation established no territories and recorded knowledge-gate failures. |
| Gifts, reproduction, citizen/structure attacks | Executable guards/actions and reputation/life/core settlement; life/engine tests cover mechanics. Seeded gifts/combat exist; births remain unestablished. |
| Main selection, memory, ownership/cleanup | `src/world/tree-controller.ts`, `tree-selection.ts`, `tree-memory.ts`; controller/cognition/action/runtime tests. Stochastic tasks with ten dispositions, no long-term planner; optional director not implemented. |

Source/test paths and provisional defaults are summarized in [composed implementation](composed-implementation.md). Coverage means an implementation and focused tests exist, not complete design fidelity or final suite/evaluation acceptance. Stepping/visualization and forecast quality remain incomplete. Legacy alliances/loot/building trade persist only in compatibility worlds; composed worlds use the replacement mechanics without silently migrating saved worlds.

### Approved pair boundaries — 2026-10-10 (historical design contracts)

Use `CanX` / `X` for meaningful action responsibilities. Names should explain the citizen-visible outcome, not an internal algorithm. Pure facts such as `InTerritory`, `OwnsTerritory` and `IsTerritoryMember` do not need artificial action counterparts.

- **`CanBuildResourceBuilding` / `BuildResourceBuilding`:** guard remains materials-only; action owns location choice, travel, site revalidation and completed construction. Parent owns investment, tier choice and material acquisition. Buying an existing building or gaining shared access is not construction success.
- **`CanCreateTerritory` / `CreateTerritory`:** parent supplies investment intent, requested tile count/location constraints and wood. Guard checks no current membership, stock and an eligible known connected area, excluding other active territory claims and nonmember-owned building tiles (creator's own buildings are allowed through automatic membership). Action chooses land, marks it and confirms ownership plus automatic creator membership. Partial marking is not full success; admission of other citizens, tax settlement and defense remain separate.
- **`CanExpandTerritory` / `ExpandTerritory`:** parent supplies investment intent, requested additions/location constraints and wood. Any current member has authority and pays their own wood, without a separate approval vote. Guard checks membership, stock and eligible known unclaimed connected additions without nonmember-owned building tiles; action chooses land, marks it and confirms expansion. Existing tiles are not charged again. A destroyed sign frees its tile (D51); reclaiming it is normal expansion with fresh wood cost/eligibility, not free replacement. New territory creation and membership changes remain outside this pair.
- **`CanJoinTerritory` / `JoinTerritory`:** parent decides whether joining is worthwhile; action handles current-member voting for admission and confirmed membership/shared access. Refusal or no response is not success. No creation, property transfer, tax negotiation or silent membership switching. At most one membership; creating another territory also requires leaving first. Admission rules and whether ownership can span territories remain open.
- **`CanLeaveTerritory` / `LeaveTerritory`:** guard checks current membership; action confirms withdrawal and access consequences. Parent decides when to leave. Owner departure disbands the territory, ending all memberships, territory tax and membership-based shared use; it does not retain absentee ownership. No automatic new membership, building ownership transfer or building demolition. A non-owner retains their buildings/own use and existing shared use continues for remaining members; they lose membership-based use of others' buildings. On disbanding, remaining signs disappear without refund (D52); recovery from deliberate sign destruction remains unresolved. Owner death is not voluntary leaving: an eligible killer succeeds for fatal attacks (D41), otherwise the longest-serving living current member succeeds, or disband if neither exists (D39). This revises the earlier owner-departure boundary.

- **`CanAttackStructure` / `AttackStructure`:** parent supplies target/purpose. Guard checks known target reachability and permitted attack feasibility; action owns travel, timed damage and confirmed destruction/recovery. Citizen combat, territorial strategy and claiming the destroyed structure's land are separate; salvage and interruption rules remain open.

- **`CanAttackCitizen` / `AttackCitizen`:** approved on 2026-10-10. Guard checks physical ability and known-target engagement under hard restrictions. Action owns approach and one-target combat until defeat, interruption or inability to continue. Low-reputation/presence triggers can invoke it; reputation propagation, territory policy, patrol and looting are outside the pair.

- **`CanRefineResource` / `RefineResource`:** approved on 2026-10-10 as reusable conversion behavior. Guard checks carried inputs and known usable/reachable stations; action chooses a station, travels, converts once and confirms output. Parent chooses resource/conversion and supplies inputs. No station construction, territory admission or input acquisition. `ObtainResource` may delegate a refining route to it; `CanUseBuilding` remains a pure permission/eligibility fact check.

- **`CanBuildHouse` / `BuildHouse`:** approved on 2026-10-10. Guard checks materials against the future house recipe; action chooses a site, travels, revalidates and confirms one new house of the requested tier. Parent owns investment and materials. Sleeping, rest recovery and automatic old-house demolition remain outside the pair. Recipes, footprint and house access rules remain open.

- **`CanSleep` / `Sleep`:** approved on 2026-10-10. Guard checks known permitted/reachable sleeping options; action chooses one, travels if needed and confirms the requested rest level. Parent owns urgency, trade-off against ongoing work and recovery target. Housing construction, food acquisition and long-term residence decisions remain separate; hunger/danger still apply and rates/outdoor/access rules remain open.

- **`CanCraftTool` / `CraftTool`:** approved on 2026-10-10 for axes, knives, scythes and swords. Guard checks available recipe stock; action crafts and confirms one requested-kind/tier tool. Parent owns investment and materials; purchase is not crafting success. Tools remain permanent, without repair/servicing behavior.

- **`CanGiveGift` / `GiveGift`:** approved on 2026-10-10. Parent chooses recipient, gift and purpose. Guard checks available selected resources/tool/gold and permitted delivery; action travels if needed, transfers and confirms receipt. Reputation improvement comes from world gift rules, not direct tree mutation. No acquiring gift items, admission requests or entire relationship management.

- **`CanHarvestResource` / `HarvestResource`:** approved on 2026-10-10 beneath `ObtainResource`. Guard checks known reachable harvestable deposits under hard restrictions; action chooses deposits, travels and completes one net exact-tier unit, accounting for tax. Parent repeats for quantity. No unknown-land exploration, tool crafting or switching to market/refining routes. Barehanded harvesting remains available; automatic food consumption and delivery attribution still follow the acquisition contract.

- **`CanExplore` / `Explore`:** approved on 2026-10-10. Parent supplies a search purpose and limits, such as finding a requested resource tier or suitable territory land. Guard checks a known permitted investigation route; action chooses destinations, travels and obtains new/refreshed observations until the goal is met or search ends without success. No guaranteed discovery, harvesting or claiming. Exploration remains outside `ObtainResource`'s known-route acquisition scope.

- **`CanReproduce` / `Reproduce`:** approved on 2026-10-10 after the world-coverage audit. **Superseded on 2026-10-11:** current execution requires adjacency and one T1 food each, without consent or rendezvous; the following records the earlier approval, not the current rule. Guard checks own known physical/material prerequisites and a potential partner; no assumed consent/private stock. Action chooses a partner, handles consent and meeting, revalidates both participants and confirms reproduction. Parent owns the family decision and supplies own required food. Refusal or failed preparation is not success. Child creation, family reputation and newborn membership are separate mechanics.

- **`CanBuildWall` / `BuildWall`:** approved on 2026-10-10. Guard checks materials and known feasible placements for requested tier/extent; action chooses placement, travels and completes the wall section. Parent supplies purpose, extent/location constraints and materials. Walls physically block movement; this is a construction job, not one subtree per tile. No territory policy, structure attack or automatic claim of enclosed land.

- **`CanSellItem` / `SellItem`:** approved on 2026-10-10 for routine sales of carried resources/tools, not only funding acquisitions. Guard checks available requested stock and market permission, not guaranteed demand. Action chooses price within parent limits, manages orders and confirms actual requested sales, cleaning up owned remainders. Parent defines surplus, quantity and price/time constraints. No missing-stock production or livelihood selection. Building trading was subsequently excluded from the intended world; this pair sells carried resources/tools only.

- **`CanObtainTool` / `ObtainTool`:** approved on 2026-10-10. Request is one additional tool of exact kind/tier with market permission. Known routes are purchase, own tool sell-escrow recovery or crafting with feasible prerequisites. Action selects a route and delegates material acquisition/crafting or funding, then confirms delivery and cleans up owned work/orders. Market permission applies through prerequisites. Parent owns investment; `CraftTool` remains the materials-ready executor and no equip/repair/servicing is added.

**Alliance decision after coverage audit:** the user chose to drop the separate alliance system. Reputation and territorial membership serve its purpose; no `FormAlliance` pair or additional alliance state is planned. This is a design decision, not runtime removal. Existing communication/consent mechanisms can remain internal to concrete tasks such as admission and reproduction.

**Ground-loot decision after coverage audit:** the user confirmed no ground loot in the intended world. Do not add `CanLoot` / `Loot`; preserve the earlier natural-death redistribution direction while resolving actual death/estate contracts separately. Current runtime loot is not removed by this documentation decision.

**Building-trade decision after coverage audit:** the user chose to remove building trading, not just exclude it from food funding. No building purchase/sale pairs are planned. Retaining one's buildings, shared access, construction and physical destruction/salvage remain distinct options; death/estate transfers are not market trading. Current runtime building trading is unchanged by this documentation decision.

**No expulsion pair:** membership removal is voluntary (`LeaveTerritory`), except death and territory disbanding. Neither an owner nor member vote can expel a member, even if hostile.

**Rejected during pair review:** `CanDefendTerritory` / `DefendTerritory` is not needed. Territorial offenses propagate reputation changes; hostility supplies a grievance and makes ordinary citizen combat a candidate, not an obligation. Citizens select stochastically using dispositions, relationships, risk and feasible alternatives. No separate territory-defense behavior or patrol duty is added. Presence awareness, physical eligibility and interruption handling still need execution contracts.

**Review disposition:** conquest/estate incentives and lifetime rates of rare stochastic actions are simulation evaluation subjects, not blockers for further planning. Defer incentive balance until observed behavior supplies evidence; do not add speculative safeguards or alter agreed conquest mechanics on review concerns alone.

**Abstraction correction approved by the user:** remove both standalone `CanSelectTerritoryLocation` / `SelectTerritoryLocation` and `CanSelectTerritoryExpansion` / `SelectTerritoryExpansion` pairs. Their names described implementation details rather than clear behaviors. Location choice now belongs inside creation/expansion, using known land value and contextual costs/risks. This supersedes the initial separate-location-pair approval and the earlier parent-selected-area boundaries. The user accepts these as potentially complex behaviors; detailed decomposition is deferred until needed.

Names identify responsibilities, not frozen signatures or a general tree framework. Simple conditions may remain pure queries. Internal choices can remain black boxes initially. Gift-giving is approved as a concrete pair. Broader sharing preferences and joining/remaining strategy selection are not added without further scope agreement.

**Mechanics, not subtrees:** tax division/accounting; reputation transitions; witness detection and group notification; trespass cooldowns; mark health and boundaries. Reputation and land-value lookups are reusable pure fact calculations.

### Review risks and unresolved decisions

The detailed [territory design](territory-design.md#decisions-still-required) lists open rules. The main responsibility-level concerns are:

1. **Authorized behavior versus offenses:** normal member harvesting or passage must not accidentally receive the same penalties as unauthorized acts. Paying tax does not itself resolve permission.
2. **Hostility escalation:** repeated trespass can eventually become lethal under the proposed minimum-reputation response. Decide self-defense treatment before retaliation creates cascading group conflicts.
3. **Shared use versus property:** define owner consent, withdrawal effects and sign-destruction consequences; signs must not silently confiscate another citizen's station.
4. **Net acquisition:** at the example rate, a one-unit harvest delivers only 0.85 to the harvester. Existing one-unit acquisition drafts require one full **net delivered** unit, not one harvest. Fractional accounting and delivery attribution need explicit revision before engine integration; building recipe thresholds do not shrink.
5. **Location knowledge:** a spectator's global land-value layer must not silently become an omniscient citizen input.

The initial action-responsibility review did not cover the full world. The subsequent code audit led to approved reproduction, wall construction, routine resource/tool sales and tool acquisition pairs. The user explicitly dropped separate alliances in favor of reputation. Ground-loot removal is now confirmed as intended design, with no loot pair; death/estate rules still require resolution. Building trading is now explicitly excluded from the intended world, with no building-buy/sell pairs. The existing food/resource drafts remain listed; pure territorial/access queries remain facts rather than fake action pairs. No separate movement, reputation-update, tax-collection or ranking subtrees are added. New responsibilities need further user review rather than expansion for its own sake. The mechanics and contract questions above remain open. Next work should focus on diagram-first black-box examples for one selected responsibility. This documentation update does not implement runtime mechanics, new typed trees or an overall controller.

## 12. World responsibility coverage checkpoint

The code audit checked the current `Command` union and building/tool kinds in `src/shared/types.ts`, recipes in `src/world/config.ts`, and social/family policy in `src/shared/autonomy-types.ts`. This maps known world responsibilities to the intended design; it is not evidence of executable tree coverage or a claim that mechanics contracts are finished.

| World responsibility | Intended home |
| --- | --- |
| Food/resource acquisition, harvesting, refining | Resource/food drafts plus approved harvesting/refining pairs; eating stays automatic. |
| Tools and equipment | `ObtainTool` and `CraftTool`; selection is automatic, tools permanent, no servicing. |
| Commerce and gold transfers | Acquisition owns permitted buying/funding; `SellItem` owns routine resource/tool sales; `GiveGift` owns selected gifts. Taxes settle mechanically. |
| Buildings and territory | Station/house/wall construction, territory creation/expansion/membership, shared-use fact checks and structure attacks. No building trading. |
| Combat and social reactions | `AttackCitizen`, structure attacks, directed reputation and witnessed group propagation. No separate alliance or territory-defense system. |
| Reproduction and rest | `Reproduce` owns partner choice, consent and rendezvous; `Sleep` owns recovery. Birth/family/estate/succession rules remain mechanics. |
| Exploration and physical travel | `Explore`; travel remains internal to outcome behaviors, not a separate pair per move. |
| Messages, memory, goals, cancellation and waiting | Communication is internal to concrete tasks; memory/goals, priority, interruption/resumption and command/order ownership are controller/execution contracts. |
| Death and material recovery | Death/estate settlement plus confirmed structure salvage; no ground loot in the intended world. |

Known current action families now have a design home or an explicit exclusion. Remaining work includes unresolved mechanics, lifecycle and observation contracts, not automatically more subtrees. Admission voting, exit/ownership, newborn membership, succession and mark-destruction boundaries are now mapped by D38–D59. Remaining details include voting timing, estate allocation, sign recovery, reputation-event repetition, fractional tax/delivery accounting, housing/rest balance and execution interruption/resumption. Routine details may use provisional defaults under the planning detail policy rather than blocking the high-level map. Runtime alliances, ground loot and building trading still exist until separately authorized removal and compatibility work.
