# Spike 2: the game world

This is a deliberately simple world intended to support specialization, wealth differences, territorial competition and alliances. Citizens use a layered controller: rare model policies guide continuous local economic, survival and social decisions. The October 2026 revision below is current authority and incorporates useful earlier-spike ideas under the user's revised direction.

## Map and visibility

Fresh worlds have procedural nested square bands. `RING_COUNT` in `src/shared/tiers.ts` is the single progression setting, currently 6. Rings are indexed 0 at the center through `RING_COUNT - 1` at the boundary; each tile belongs to exactly one band. Increasing the setting adds bands and supported tiers without editing recipes, balance tables, schemas or UI. Historical saves without ring metadata retain their original three-band geometry and deposits.

Coordinates are integer (x, y) pairs. Bottom-left is (0, 0); x increases east/right and y increases north/up. Normal model context uses bounded symbolic known coordinates and salient evidence. Debug ASCII observations print the northernmost row first, use one character per cell and include an entity index. The index lists all entities sharing a tile, even when its character can show only one. The character x means outside current sight, not empty or never explored. Current observations and dated memories remain distinguishable.

All starting citizens spawn on T1 deposits in the outermost band. Starts up to nine retain one citizen in each resource area (wood, food and fibre), with remaining citizens on distinct T1 food deposits; the competition/progression fixtures retain their smaller starts. The default village has 20 citizens. Populations above nine balance starting locations and livelihoods across the three resource areas, preventing a 100-person start from accidentally assigning 98 food specialists. Roughly one third of each region specializes in wood, one third in food and one third in fibre. Distribution and actual supply must both support survival; even placement alone does not guarantee it.

Deposit base tier is `RING_COUNT - ring`. Each deposit has a 5% chance of the next tier, except the first deposit in each resource sector/band remains base tier to guarantee viable T1 starts. There is no center clamping: six bands give mostly T6 and rare T7 at the center, mostly T1 and rare T2 at the outskirts. Supported tiers are generated as 1 through `RING_COUNT + 1`.

Equal-width normalized bands share geometry with map rendering. Base map side length is `6 * RING_COUNT + 1`, scaling with the square root of population above 20. Each resource sector in ring `r` has up to `ceil(6 * (r + 1) * populationScale)` deposits, bounded by available tiles. Rarity is a seeded probability, not a fixed percentage guaranteed on each individual map.

Citizens see a small radius around themselves and remember dated sightings outside it. Remembered people and resource stock do not update remotely. Buildings, **including walls, do not block sight**. Public messages and markets are global information outside fog of war; they do not expose unrelated private inventories or unseen activity.

Movement is between orthogonally adjacent cells, takes time and uses deterministic pathfinding. Citizens select coordinates or destinations rather than individual route steps. Citizens may share a tile. Station tiles are walkable; walls block everyone, including their owner.

## Resources and tools

There are three resource types: **food, fibre and wood**. Each has tiers T1 through `RING_COUNT + 1` (currently T7). Gold is currency, not a harvestable resource.

Tier determines recipe use and harvesting requirements. It does not multiply the number of units per harvest: higher-tier deposits produce higher-tier materials. Deposits have limited stock and replenish over time. Yield, base harvest duration and capacity are implementation settings. Regrowth now takes 120 ticks after harvest, increased from 24; already-scheduled deadlines are preserved. Concurrent workers cannot receive the same stock.

All T1 deposits can be harvested without tools. A tier-N tool unlocks deposits up to tier N+1, bounded by the generated supported tier range. Only the matching tool applies; bonuses do not stack.

| Matching tool | T1 deposit duration | T2 deposit duration | T3 deposit duration |
| --- | --- | --- | --- |
| None | 100% of base | Cannot harvest | Cannot harvest |
| T1 | 50% of base | 100% of base | Cannot harvest |
| T2 | 25% of base | 50% of base | 100% of base |
| T3 | 12.5% of base | 25% of base | 50% of base |

These are duration multipliers, not percentages of speed. The pattern continues through every configured tier: a tier-N tool unlocks N+1 and halves the duration at each upgrade. Duration is `ceil(base * 2 ** (depositTier - 1 - toolTier))`, with a minimum of one tick.

Tools and swords use the same generated tier range as resources. Recipe quantities double at each tier: multiply the following T1 costs by `2 ** (tier - 1)`. Every ingredient must match the crafted item's tier. Ingredients cannot be mixed across tiers or substituted automatically.

| Item | Base ingredients, multiplied by the tier cost factor | Use |
| --- | --- | --- |
| Scythe | 3 wood + 3 food | Harvest fibre |
| Axe | 3 food + 3 fibre | Harvest wood |
| Hunting knife | 3 wood + 3 fibre | Harvest food |
| Sword | 4 wood + 4 fibre | Combat |

Food used as an ingredient gives no nutrition. Citizens craft equipment themselves without a crafting station; the stations below refine materials. Equipment can be traded. Citizens automatically use their highest-tier matching tool or sword available in inventory, without equip commands or separate equipped state. Tools can be sold or gifted like other inventory items. Equipment has no per-item durability system.

## Stations and progression

| Station | Material processed |
| --- | --- |
| Spinning wheel | Fibre |
| Lumbermill | Wood |
| Butchery | Food |

An upward refining operation converts **3 units of tier N into 1 unit of tier N+1 of the same resource**. Downward processing converts **1 unit of tier N into 2 units of tier N-1**. `RING_COUNT + 1` is the maximum supported tier; resources never change type. A round trip loses one third of its starting units.

- Upward conversion requires input T1 through one below the supported maximum and a station at least as high as the input tier.
- Downward conversion requires input T2 through the supported maximum and a station at least as high as the output tier.
- `refine`/`operate` accept optional `direction: 'up' | 'down'`; omission preserves upward behavior in old commands and saves.
- The highest station has the same conversion access as the preceding tier, with improved health. Processing takes 9 ticks at T1 and `max(1, ceil(12 / 2 ** (tier - 1)))` thereafter. Station health is `10 * tier² + 50 * tier + 40`; armed base damage is `6 * tier + 6`. These formulas preserve earlier T1–T6 values and extend procedurally.

Stations are owner-operated only. The owner must be at the station and spend time processing each batch. There are no automatic workers or unattended production. Owners can sell processed materials, equipment or the station itself.

Stations cost 6 wood + 4 fibre, multiplied by `2 ** (tier - 1)`. Walls cost 4 wood + 2 fibre with the same multiplier. Tier-N construction uses tier-N materials. T1 stations must be buildable from T1 materials without a prerequisite station. A station must never require the higher-tier output it is intended to unlock.

Progression must work from the initial state: gather T1 materials, craft T1 tools and build T1 stations, acquire T2 materials through harvesting or refining, then craft T2 equipment and build T2 stations to access T3, continuing through the configured maximum. Direct harvesting avoids the 3:1 conversion loss; refining provides an alternative to controlling higher-tier deposits.

## Buildings and walls

Stations and walls are the only building types initially. Each occupies one tile and has an owner, tier and health. Only one building fits on a tile, and buildings cannot cover resource deposits.

Construction takes time and requires reaching the site. Walls are built from an adjacent tile and cannot be placed on a citizen. Wall recipes and health are implementation settings following the same material-tier convention as stations.

Walls can create choke points and protect access, but block their owner too. There are no gates or owner-only passages: leave openings or demolish a segment to regain access. Walls remain transparent to sight.

Buildings can be attacked, including by their owner for demolition. **Destruction**, not each attack, awards the final attacker 75% of the materials consumed by construction, preserving type and tier and rounding each quantity down. Salvage is awarded once. Processing inputs are separate from construction materials.

An owner immediately learns which building was attacked, the attacker's identity and the building's damage. The alert includes the property's coordinates so the owner can travel there outside sight. It does not reveal the attacker's remote live position.

## Gold and markets

Every starting citizen receives **100 gold once at world creation**. Gold is never subsequently created or destroyed. New citizens receive no freshly minted gold. Inventory, escrow and loot all count toward the fixed total.

Gold balances and prices use whole units. Citizens can transfer gold globally without requiring anything in return. There are no transaction fees, NPC buyers, automatic wages or currency sinks.

All market trades are for gold. Resources, tools, swords and building ownership can be traded. Citizens themselves and territorial claims are not market assets. An order specifies one exact item type and tier, a quantity and a positive gold price **per unit**. A building is a unique asset with quantity one; selling it changes ownership, not location.

Markets are global and public. Summaries show the cheapest sell and highest buy per item and tier, with quantities; citizens can inspect individual listings. Building listings include location and current condition.

- Sell orders reserve goods; reserved goods cannot be used or listed again. Tools may be listed even during work; listed tools leave inventory and are no longer available for automatic use.
- Buy orders reserve quantity times unit price in gold. No unfunded orders, borrowing or negative inventory are allowed.
- Crossing orders match automatically at the older resting order's price. Best price is served first, then earliest order. A citizen's orders cannot match their own.
- Partial fills are allowed. Payment and delivery happen atomically. Excess buyer gold reserved for the filled quantity is refunded immediately.
- Unfilled quantities remain reserved until filled or cancelled. Orders do not expire automatically. Cancellation refunds remaining escrow; changing an order means cancelling and replacing it.
- A listed building remains on the map and attackable, but cannot operate until sold or delisted. A station with active processing cannot be listed. Destruction cancels its listing. Settlement rechecks ownership and existence.

Delivery and settlement are **instant and remote**, with no meeting or hauling. This is an explicit exception to timed physical actions. Escrow cannot shelter assets from death.

## Combat, death and loot

Citizens can attack citizens or buildings on the same or an orthogonally adjacent tile. Unarmed attacks are possible; swords increase damage by tier without making their holder immune to weaker attacks. Damage is sampled uniformly from 50% to 150% of base damage.

Health, base damage and attack intervals are implementation settings. Combat should leave time to react or flee rather than kill in one ordinary hit. Attacks take time and cannot pass through walls. Pursuit uses ordinary movement, follows a target while visible and searches its last-seen position if sight is lost; a lost or unreachable target produces feedback rather than a remote hit.

Citizens may flee, retaliate or seek help. Fed citizens recover health slowly; the rate is an implementation setting.

Death stops all activity and cancels the citizen's orders. Unused market and work reservations join the death holdings before loot settles. Holdings include gold, resources and carried tools.

- A citizen killed by an attack transfers **100% of those holdings** to the killer, once.
- A natural death leaves the holdings at the death location. Another citizen travels there and collects all of them; the body then disappears. Concurrent pickups cannot duplicate loot. Bodies and uncollected gold do not expire.

Buildings are not inherited by a killer or included in carried loot. A dead owner's buildings remain as unowned structures, cannot operate and may be demolished for salvage. Processing inputs join the owner's death holdings, not a duplicate station inventory.

## Hunger and reproduction

Citizens have health and a fullness meter. Fullness drains gradually; health drains only once fullness reaches zero. Capacity and drain rates are implementation settings. Starvation must leave time to gather, trade or relocate.

| Food tier | Fullness restored per unit |
| --- | --- |
| T1 | One ninth of maximum |
| T2 | One third of maximum |
| T3–T6 | Maximum |

Fullness is capped; excess nutrition is lost. Automatic meals use the lowest-tier available, unreserved food once enough fullness is missing to use its full nutrition. If fullness reaches zero, eat available food before applying starvation damage. Upward refining preserves potential nutrition through T3 and loses it at higher tiers. Downward processing of T4–T6 food increases total edible portions because all T3–T6 meals are capped at maximum fullness; station labor is required. A full up/down cycle still loses resource units and cannot create an unlimited food loop. Higher-tier food is also a crafting ingredient.

Reproduction requires two living, adjacent citizens who both consent, meet the health requirement, can each pay the food cost and are both off cooldown. Costs are **per parent**; cooldown applies to both. Food cost, required food tier, minimum health and cooldown duration are implementation settings.

Reproduction takes time; completion creates one citizen immediately capable of adult actions. There is no pregnancy, childhood, dependent care or population cap. New citizens receive no free materials, equipment or gold. Initial health and fullness are implementation settings and must be accounted for when balancing reproduction costs. The new citizen spawns on a parent's walkable tile and has their own identity, personality, goals and knowledge; parental equipment and buildings are not copied.

## Time and communication

Movement, harvesting, construction, crafting, refining, attacks, loot pickup and reproduction take time. A citizen performs one physical action at a time. Physical work continues during model reasoning.

Citizens can submit travel to a remembered location followed by appended work on a known target or remembered build site, without a fresh model review on arrival. Appended work is conditional intent: submission does not query remote stock, existence, ownership or occupancy. Current sight and all gameplay prerequisites are checked when that queued entry starts. No inputs or deposit claims are reserved until activation. Unknown targets and unseen actions that would start immediately remain gated; an entry still outside sight on activation fails without probing remote state. Failed entries produce personal feedback and subsequent entries still try, preserving the existing queue semantics.

Approved citizen plans can sequence existing physical commands and bounded gathering/waiting. Drafts are not world state and execute nothing. Gathering chooses matching locally discovered or dated known deposits, travels to dated sightings, and checks current sight before harvesting. Resource intent may be approved before preceding travel discovers a deposit, without granting remote knowledge; depleted local nodes can be revisited after observed regrowth within the citizen's time budget. A carried target counts available inventory, not prior yields already eaten or consumed. Citizen-chosen stop conditions end a step, not automatically choose a survival goal. Failures stop for review by default or skip only if the citizen explicitly selected continue. Approval may append to existing work or explicitly replace it; cancellation/death clears future plan work and returns active inputs under the ordinary rules. Approved progress and bounded actual-result receipts are durable; successful steps do not require model calls.

Actions reserve required inputs, consume them once on completion and produce output once. Cancellation returns unconsumed inputs and discards unfinished work. If a prerequisite disappears, such as the station being destroyed or ownership changing, stop the action, release its inputs and report the failure. Reserved food cannot also be eaten or sold. Death follows the loot rules above.

Public posts and private messages are global and free. Messages and market actions can occur alongside physical work. Messages have a maximum character count and bounded sending rate chosen during implementation. Text is a statement or request, not an automatic trade, ownership transfer or reproduction consent.

## Implementation discretion

Unspecified balance numbers are intentionally left to the implementer. Keep them centralized and documented. Recipe and economy inspiration may come from Albion Online without importing its additional systems.

Validate initial survival, viable supply of all three resources, progression without circular prerequisites, useful equipment upgrades, and conservation of gold and escrow. These are mechanical checks, not requirements that citizens trade, specialize, reproduce or fight.

Resources are consumed per node, then regenerate over time, meaning the same node cant be harvested twice back to back.

## Continuous autonomy revision, October 2026

Fresh runtime worlds enable a deterministic local controller beneath rare model
policy reviews. The mechanical `createWorld()` API remains opt-in so legacy
fixtures and restored runs retain their previous behavior. Local survival,
market purchases, specialization, recipe prerequisites, territorial warnings,
paid access, negotiated small alliances, family rendezvous and defensive combat
continue without any provider call. These are authored behaviors whose
interactions can produce aggregate patterns; they are not evidence of general
human reasoning or model emergence.

Claims are public demands over resource areas, not movement barriers or ownership
of deposits. Enforcement requires personally observed competition, warnings and
a worthwhile local fight. Alliances require delivered offers and independent
acceptance; they consolidate to one shared claim with a living representative,
prefer gathering within it, can give food and intervene against an observed
attack. Representative departure/death preserves the remaining members' grounds.
Territorial toll receipts are claim-scoped and honored by all members; individual
protection demands remain separate. Automatic claims prefer unclaimed locally
known deposits and use a single-tile footprint rather than overlapping broad
rectangles. Explicit claims can still overlap as rival demands. Pursuit is bounded and uses ordinary movement. Desperate citizens can
beg before attacking an observed food producer or public seller, without reading
private inventories. Access/protection demands are extortion; there is no secret
or disclosure system implementing blackmail.

`noGo` is a hard travel/work exclusion. A policy revision cancels affected work
and refunds its reserved inputs; safe work continues. A citizen already inside
newly forbidden ground can take a shortest outward exit, then cannot re-enter.
Excluded food does not create a silent survival exception: the citizen records
blocked-survival evidence and requests a policy review. Optional home, territory
and partner fields can explicitly be cleared with null patches. Clearing a
territory revokes its claim and suppresses automatic replacement until a new
territory is selected. Revoking a partner or marking them rival withdraws pending
courtship and consent, unless an explicit selected partner intentionally
overrides rivalry. Reproduction avoidance always vetoes the local controller.
Naming an existing pact member as rival also renounces the actor's membership,
leaving other members' pact intact. Departure revokes outstanding alliance offers,
blocks immediate rejoining for 500 ticks, and forbids joining a pact containing a
current rival. Clearing rivalry permits a later independently negotiated reunion.

Tools and weapons are permanent inventory assets. They do not wear, require
servicing or consume repair supplies. Work automatically selects the highest-tier
matching tool in available carried inventory; escrowed tools are unavailable.
Use never destroys a tool or lowers its tier. Trade, gifts and death settlement
transfer tools intact. Legacy checkpoint servicing flags/counters are validated
and discarded on restore without changing inventory, committed work, escrow or
historical events.

Production also counts a citizen's own inventory and sell escrow against survival,
recipe and market buffers. Funded public buy orders and actual recent personal
sales raise that buffer. When unsold stock saturates it, extraction pauses while
trade, equipment plans, family preparation and local defense remain
active. Private inventories of other citizens never create inferred demand.
This limits useless hoarding; it does not invent customers or solve weak demand
for a particular specialty.

Children inherit bounded parental dispositions with small seeded mutation and
receive no free gold or tools. They can act immediately under the existing life
mechanics; local parent/ally gifts provide practical support, not a childhood
simulation. Populations above six scale map area and initial deposits with
founder count, while later births increase competition on the fixed map.
