# Territory, reputation and land value — agreed design direction

Date: 2026-10-10. **Design agreement, not runtime authorization.** This records the latest user proposal and separates agreed direction from outstanding decisions. It adds no typed trees, mechanics, tests or controller implementation. It does not claim emergent settlements or model intelligence.

Read alongside the [composed plan](plan.md), [territory research](territory-emergence-research.md) and [resource acquisition design](resource-acquisition-design.md). The research note's competing alternatives are historical discussion, not a veto on this subsequently agreed direction. Existing runtime claims/access rules remain unchanged until separately authorized implementation. The user subsequently confirmed removal of separate alliances, ground loot and building trading from the intended world; this document does not remove those current runtime systems.

## Agreed direction

### Marked territory, membership and property

- Creating territory and expanding its marked area costs **2 wood per marked territory tile**, represented by a sign or marking. Citizens can break marks to recover wood. The wood tier and deliberate-destruction recovery amount/rule remain unresolved; do not assume full reimbursement. Destroying a sign frees its tile under the rule below.
- **A citizen may belong to at most one territory at any one time. Creating territory automatically makes its creator a member.** Joining or creating another territory requires leaving the current membership first; both `CanJoinTerritory` and `CanCreateTerritory` must check this constraint. Creation does not require a separate join request. Ownership remains a distinct role, but **the owner leaving disbands the territory**, rather than retaining absentee ownership. Disbanding ends the territory, all its memberships, its harvest tax and membership-based shared-use grants. Existing buildings remain in place with unchanged ownership. Remaining signs disappear on disbanding without any wood refund. This differs from deliberate sign destruction, whose recovery amount remains unresolved. This supersedes the earlier unresolved owner-departure rule.
- **Owner death is different from voluntary departure:** ordinarily ownership passes to the living current member with the longest uninterrupted membership. Dead/departed members are skipped; leaving and rejoining resets seniority. If no eligible members remain, disband the territory.
- **Fatal attack overrides seniority when the killer is eligible:** a living killer inherits if already a member of the victim's territory or unaffiliated at the death settlement. An unaffiliated killer becomes a member. A killer belonging to another territory does not inherit; use ordinary seniority/disbanding instead, without switching or dissolving the killer's existing membership. Natural death still uses seniority.
- Succession/conquest retains territory identity, area and surviving memberships. It transfers territory leadership, not automatic ownership of all its buildings; buildings follow separate estate rules. It does not reset reputation or cancel witnessed-attack hostility: members may attack their new owner. Future harvest tax follows the new owner at the unchanged fixed rate; the founder's estate retains no separate tax entitlement.
- **Admission is decided by a vote of current territory members**, not by the owner's sole approval or automatic reputation-based enrollment. Admission requires **strictly more than half of all living current members** to vote yes, with one equal vote each including the owner and no owner veto. Silence is not approval; unresolved requests eventually expire. Individual votes generally use reputation and citizen preferences; the exact decision policy is intentionally deferred, with no fixed reputation threshold. Precise timing and timeout remain open. `JoinTerritory` owns the request and confirmation of the collective decision.
- **Any current member may expand the territory**, paying the new marking cost from their own wood. Expansion does not transfer ownership to the contributor or require a separate owner/member vote; eligibility, known-land and material checks still apply. Harvest tax from the additions goes to the current owner at the same fixed rate.
- **Newborn membership:** if both parents belong to the same active territory at birth, the newborn automatically becomes a member without an admission vote. Otherwise the newborn starts unaffiliated. This grants shared use, not building ownership, and is settled by birth mechanics rather than a separate joining task.
- **Equal voting and succession rights from birth:** child members have one equal admission vote and count in the all-living-member majority denominator. Succession has no adulthood gate; the longest-serving eligible survivor may be a child. Individual voting policy remains deliberately deferred.
- **Independent membership after birth:** a parent's departure does not move their children or revoke their memberships/shared use. Children leave through their own decisions. Whole-territory disbanding still ends everyone's membership, including when a departing parent is the owner.
- **Caught nonmember harvesting:** all territory members' directed reputations toward the harvester drop one level, bounded by hostile. Tax still applies; payment does not grant permission. Unobserved harvesting does not trigger omniscient reputation changes. Repetition/cooldown and stacking with trespass remain deferred details.
- **No discretionary expulsion:** members may leave voluntarily, but neither the owner nor a vote can expel a member. Admission therefore has lasting consequences even if relationships deteriorate. Death and whole-territory disbanding still end memberships under the agreed lifecycle rules; hostility does not itself revoke membership. No expulsion subtree is needed.
- **Connected claims and growth:** an initial territory forms one connected marked area; expansion connects additions through existing or newly marked tiles. Holes may remain around ineligible buildings or other claims. This constrains claiming/growth; damage may fragment the existing marked area without splitting its identity.
- **Destroyed sign frees its tile immediately:** that tile leaves the territory, stopping its territory tax and automatic shared building use without destroying or transferring any building. Other marked tiles retain the same territory identity and memberships, even if disconnected by damage. Loss of the last sign disbands the territory. Reclaiming a freed tile is expansion under normal connected-growth, ownership and eligibility rules, not free sign replacement.
- **One active territory per tile:** creation/expansion cannot overwrite another active territory's claim. A tile must become unclaimed before another territory can mark it; succession/conquest changes the existing territory's owner, not an overlapping claim. This supplies one territory tax/access/offense context per tile.
- **Hard claim/building eligibility:** creation/expansion cannot claim tiles containing buildings owned by nonmembers of that territory. At creation, the creator's automatic membership allows their own buildings; it does not enroll other building owners. Nonmembers cannot construct buildings inside an existing territory. These are permission/eligibility restrictions, not merely reputation risks; current runtime claims do not yet enforce them.
- Territory membership grants shared **USE**, not shared ownership. Joining does not transfer a station, and standing inside a territory does not make a citizen its owner or member. Building trading is excluded from the intended world; construction, retention, shared use and physical destruction/salvage remain options. Inheritance/estate ownership transfers are separate mechanics.
- The **current territory owner** receives a fixed harvest tax: the creator is the first owner, and future tax follows the successor after owner death. The rate is constant across territories and applies to **all resources harvested inside the territory**, not just wood or outsider harvests. Authorization and offense rules are separate questions from tax settlement.
- Resource quantities must support fractions. The user's example is **1 wood harvested → 0.15 wood to the current owner + 0.85 wood to the harvester**. This supplies a **15% candidate rate**, not an independently chosen or locked balance value. Preserve the harvested resource's kind and tier in both shares.

**A departing non-owner's buildings keep their shared-use status while inside the active territory.** The departing citizen retains building ownership and their own use, but loses membership-based use of other people's buildings. Remaining members continue using the contributed facilities; departure does not demolish buildings or carve their tiles out of the territory. Claim/building eligibility rules apply when claiming or constructing, not as an instruction to remove existing buildings after departure. Existing shared use also survives inheritance regardless of the heir's membership: the heir receives ownership without revoking members' access. Disbanding or loss of the building's claimed tile ends territory-based shared use. For fatal attacks, the killer also inherits the victim's personal property (inventory, gold, tools and owned buildings), without ground loot. This does not bypass the separate membership eligibility rule for inheriting territory leadership. On natural death, personal property goes to surviving eligible family first, otherwise surviving members of the deceased's territory. This is separate from territory leadership succession. If neither group exists, distribute the personal estate among all living citizens. Exact family scope, allocation, the no-survivors case and detailed death/order settlement remain open.

Shared use can make existing stations useful to participants without duplicating construction. It does not establish productive surplus: travel, competing users, access uncertainty and owner alternatives still matter. Membership access must be specified without silently rewriting ownership, consent or exit rights.

### Directed reputation and witnessed offenses

Reputation is each citizen's view of another citizen, not a symmetric friendship score. A directed matrix is a possible representation. The ordered states are:

**hostile → disliked → neutral → positive → admired**.

Everyone starts neutral; family starts at admired. The user chose to drop the separate alliance system from the intended design: reputation and territory membership serve its social purpose, without an additional alliance flag or alliance-forming subtree. Existing runtime alliances are not removed by this documentation decision. Gifts improve the receiver's view of the giver. A personal attack immediately puts the victim's view of the attacker at the minimum, hostile. Reverse reputation does not change merely because one direction changed.

Structure damage takes time rather than instant removal. The agreed witness-driven reactions are:

| Witnessed occurrence | Direction of consequence |
| --- | --- |
| Owner or territory participant sees someone attacking a building, sign or other structure in the territory, or harvesting there | All territory members reduce their reputation **toward that actor**. Exact offense/authorization applicability and reduction magnitude remain open. |
| Another territory member witnesses an attack on a member | All territory members put their view of the attacker at minimum. Hostility supplies a grievance and combat candidate; actual attack selection remains stochastic and sensitive to dispositions, relationships, risk and alternatives, not compulsory. This is intended behavior, not a current controller feature. |
| Witnessed trespass through territory | All territory members reduce their view of the trespasser by **one step**, with a cooldown so repeated sightings do not immediately escalate to attack. |

These are witnessed consequences, not omniscient reactions to hidden events. A triggering witness and group-wide propagation are distinct: the proposal intentionally propagates the consequence to members, but does not give every citizen global vision. Define offense attribution and event timing before implementation; do not multiply one event's sanction merely because several members see it.

## Land value and selection

Provide a **citizen-relative spatial value** map, normalized **0..1**, reusable for territory creation, expansion and building placement. Citizens value tiles differently according to their tools/capabilities and opportunities. Higher-tier nodes are not automatically more useful to every citizen: an unharvestable node provides no immediate direct harvesting opportunity, but may retain strategic value because other citizens can exploit it or because the citizen may acquire better tools. Useful buildings and resource proximity contribute to valuation. This refines the earlier generic higher-tier-is-more-valuable direction; it is a location-selection heuristic, not a guaranteed return or a selected formula.

### General spatial reasoning direction

Citizen-relative spatial maps/matrices are reusable representations for spatial reasoning, not a mechanism limited to land value. Candidate layers include travel cost/reachability, danger or social risk, resource opportunity, facility access and exploration uncertainty. These are examples, not a requirement to implement every layer. Task-specific evaluators may combine relevant layers rather than recomputing spatial facts independently.

Preserve each layer's meaning: not every map is a normalized value score, and hard eligibility must not become a soft weighted preference. All citizen-facing layers respect known information, uncertainty and staleness. Derivation is side-effect-free; world mechanics remain authoritative. Choose concrete layers, storage and update methods only when a task benefits from them; this direction does not authorize a general spatial framework or runtime implementation.

### Evaluation contract — sufficient direction for a first concrete design

- **Inputs:** citizen-visible knowledge and its age/uncertainty, current tools/capabilities, usable buildings, resource opportunities, travel, investment costs, depletion, conflict and access risks.
- **Immediate usefulness:** harvestable resources, usable facilities and travel saved for this citizen.
- **Future usefulness:** opportunities unlocked by realistically obtainable tools or buildings, not assumed access to every future capability.
- **Strategic value:** expected harvest tax from others, shared opportunities for members and control of desirable land. Ground these estimates in known evidence; a rich deposit nobody visits does not automatically promise tax revenue, and other citizens' hidden capabilities are not available inputs.
- **Task context:** reuse valuation inputs/components, not necessarily one final score for every task. Territory creation, expansion and each building purpose can weight them differently. Expansion evaluates marginal benefit of the added area, including connecting-tile investment; a valuable remote deposit need not be a good house site.
- **Eligibility versus desirability:** enforce hard claim, construction, access and reachability constraints separately from ranking. An attractive tile does not override permissions. Preserve the distinction between physical restrictions and social risk. The global commodity market does not create an invented delivery advantage from nearby buyers.
- **Composition:** the parent/main decision tree chooses the purpose; spatial evaluation helps the selected responsibility choose where. Evaluation is a reusable pure calculation, not an independent action or an overall controller.

This is enough direction to draft the evaluator without further approval of routine formula choices. An implementation/design agent may propose explicit provisional weights, radius, normalization, combination and update rules, then test rankings across contrasting citizens and tasks. No particular formula is locked. Meaningful cases include an inaccessible high-tier deposit versus a usable lower-tier one, known use by other harvesters versus speculative tax income, and territory value versus house/station placement value. Such ranking tests establish contract behavior, not useful emergent behavior; simulation evidence is still needed for that. This design readiness does not authorize runtime integration.

A spectator/authoritative map may show global land value, but citizens must calculate or consume value only from known/observed facts, retaining uncertainty and staleness. No global omniscient map becomes citizen input by implication.

## Accepted responsibility inventory — not coded

Existing descriptive drafts cover `CanObtainFoodNow` / `ObtainFoodNow`, `CanObtainResource` / `ObtainResource`, and the materials-only `CanBuildResourceBuilding`. `BuildResourceBuilding` placement and housing/rest remain future responsibilities. Territory does not turn the building materials guard into a placement or access check.

The user accepted these territory and supporting responsibilities on 2026-10-10. The [maintained register in the working plan](plan.md#11-subtree-inventory-and-next-responsibilities-for-review) is the canonical list and status record. The boundaries below explain that list; signatures and graphs are not frozen:

| Responsibility | Bounded purpose |
| --- | --- |
| `InTerritory` | Pure condition: determine whether the relevant known position lies in a territory; report ambiguity rather than infer membership or permission. |
| `OwnsTerritory` | Pure condition: determine territory ownership. Owner **≠** member **≠** current occupant. |
| `CanCreateTerritory` / `CreateTerritory` | Check no existing membership, wood and eligible known land; choose and mark an initial area and automatically make its creator a member. Parent supplies investment intent/constraints and materials. |
| `CanExpandTerritory` / `ExpandTerritory` | Check authority, wood and eligible known additions; choose and mark additional land, preserving territory identity. Parent supplies investment intent/constraints and materials. |
| `JoinTerritory` / `LeaveTerritory` | Request/execute membership changes subject to consent and exit rules; joining requires no membership in another territory. Neither transfers ownership by default. |
| `CanUseBuilding` | Pure access condition combining known ownership/use grants and authoritative use restrictions. Membership is not ownership; unknown access is not guaranteed access. |
| `AttackStructure` | Execute and monitor timed damage against a selected structure; account for risk and confirmed destruction/recovery, not instantaneous salvage. |

The user rejected a separate `DefendTerritory` subtree: territorial hostility makes ordinary citizen combat a candidate for capable citizens aware of the offender, not a mandatory action. Reputation propagation supplies the grievance; stochastic selection weighs dispositions, relationships, risks and alternatives. This does not require a separate patrol/defense controller. Exact presence awareness, physical eligibility and interruption handling remain to be specified.

The user approved folding location selection into creation/expansion instead of keeping standalone selection pairs: names should describe meaningful behaviors, not internal algorithms. Complex internals can be decomposed later when needed.

Reputation lookup/derived facts and land-value calculations belong in reusable **pure shared fact calculations**, constrained by observation boundaries. Tax settlement, witness detection/propagation and cooldown enforcement are **mechanics**, not behavioral subtrees. Subtrees decide or execute permitted actions using those facts; they do not independently invent taxes or apply sanctions.

## Fractional accounting and acquisition implications

Fixed-point versus floating-point representation is **not selected**. Before implementation, settle precision, rounding/remainders and conservation across inventory, harvest output, market/escrow, recipes, transfers, persistence and delivery evidence. Tax divides output; it must not mint or lose resources. Define owner-as-harvester settlement and avoid duplicate delivery credit while conserving the same gross yield.

Current acquisition drafts promise **one additional exact-tier unit delivered to the requester**. A gross one-unit harvest with the example tax delivers only **0.85** to that harvester; it cannot complete that request. Route estimates must target net delivery, accumulating confirmed fractional receipts or adjusting work quantities under a separately agreed contract. Owner tax receipts and harvester receipts need distinct attribution; the same output cannot be credited twice toward independent demands. Recipe callers still check actual usable holdings, including automatic food consumption. No draft contract is silently changed here.

## Decisions still required

- Who is authorized to harvest or pass through? Which outsider/member acts constitute harvesting offenses or trespass? Do permitted acts avoid sanctions? “All resources taxed” does not answer these questions.
- Trespass cooldown duration, scope/key, reset and repeated-entry behavior; reduction magnitude for other offenses; gift improvement magnitude and limits.
- Family scope, relationship changes and self-defense exceptions; witness eligibility/range/timing and owner-versus-member defense obligations.
- Admission timing/timeout; the strict-majority threshold and absence of expulsion are agreed. Individual voting policy is deliberately deferred, broadly based on reputation and citizen preferences. Owner departure disbands; owner death selects an eligible killer for fatal attacks, otherwise the longest-serving living current member, or disbands if neither exists. Deliberate sign-destruction recovery and exact seniority tie handling remain open; disbanding removes remaining signs without refund. Tax entitlement follows current ownership.
- Estate beneficiary selection and station capacity/contention. Existing shared use survives both non-owner departure and inheritance while the building remains inside the active territory. Shared USE must not silently confiscate privately owned stations.
- Mark wood tier/recovery; tax rate confirmation; fractional accounting and net-delivery contracts; land-value formula and citizen-visible projection.

These gaps block faithful mechanics/behavior implementation, not recording this agreed design direction. Resolve responsibility boundaries with the user before adding trees or runtime behavior.
