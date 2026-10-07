# Spike 2: the game world

This is a deliberately simple world intended to support specialization, wealth differences, territorial competition and alliances. Citizens are not required to choose any particular strategy. Mechanics from the previous spike do not carry over unless included here.

## Map and visibility

The world is a rectangular grid with three nested regions: center, ring 1 and ring 2. Center is innermost; ring 1 surrounds it; ring 2 reaches the map boundary. Each tile belongs to exactly one region.

Coordinates are integer (x, y) pairs. Bottom-left is (0, 0); x increases east/right and y increases north/up. ASCII maps print the northernmost row first, use one character per cell and include an entity index. The index lists all entities sharing a tile, even when its character can show only one. Row and column labels are not required. The character x means outside current sight, not empty or never explored. Current observations and dated memories must remain distinguishable.

All starting citizens spawn in ring 2, spread across its resource areas. Roughly one third of each region specializes in wood, one third in food and one third in fibre. Starting distribution must give all three resources a viable supply; placing citizens evenly does not itself guarantee this.

| Region | Deposit tiers |
| --- | --- |
| Ring 2 | Mostly T1; T2 deposits may occur but must be fewer than 10% of its deposits; no T3 |
| Ring 1 | Mostly T2, with some T1; no T3 |
| Center | T3 deposits of all three resource types |

Map dimensions, boundaries, initial population and deposit counts are implementation settings. The under-10% restriction counts deposits, not tiles or harvested units.

Citizens see a small radius around themselves and remember dated sightings outside it. Remembered people and resource stock do not update remotely. Buildings, **including walls, do not block sight**. Public messages and markets are global information outside fog of war; they do not expose unrelated private inventories or unseen activity.

Movement is between orthogonally adjacent cells, takes time and uses deterministic pathfinding. Citizens select coordinates or destinations rather than individual route steps. Citizens may share a tile. Station tiles are walkable; walls block everyone, including their owner.

## Resources and tools

There are three resource types: **food, fibre and wood**. Each has tiers T1 through T3. Gold is currency, not a harvestable resource.

Tier determines recipe use and harvesting requirements. It does not multiply the number of units per harvest: higher-tier deposits produce higher-tier materials. Deposits have limited stock and replenish over time. Yield, base harvest duration, capacity and regrowth timing are implementation settings. Concurrent workers cannot receive the same stock.

All T1 deposits can be harvested without tools. A tier-N tool unlocks deposits up to tier N+1, capped at T3. Only the matching tool applies; bonuses do not stack.

| Matching tool | T1 deposit duration | T2 deposit duration | T3 deposit duration |
| --- | --- | --- | --- |
| None | 100% of base | Cannot harvest | Cannot harvest |
| T1 | 50% of base | 100% of base | Cannot harvest |
| T2 | 25% of base | 50% of base | 100% of base |
| T3 | 12.5% of base | 25% of base | 50% of base |

These are duration multipliers, not percentages of speed. Round up to whole ticks, with a minimum of one tick.

Tools and swords have tiers T1 through T3. Recipes keep the same quantities at every tier, but every ingredient must match the crafted item's tier. Ingredients cannot be mixed across tiers or substituted automatically.

| Item | Ingredients at the item's tier | Use |
| --- | --- | --- |
| Scythe | 3 wood + 3 food | Harvest fibre |
| Axe | 3 food + 3 fibre | Harvest wood |
| Hunting knife | 3 wood + 3 fibre | Harvest food |
| Sword | Wood + fibre; quantities chosen during implementation | Combat |

Food used as an ingredient gives no nutrition. Citizens craft equipment themselves without a crafting station; the stations below refine materials. Equipment can be traded. A citizen equips at most one tool of each type and one sword; spare equipment remains inventory. Equipment has no durability system initially.

## Stations and progression

| Station | Material processed |
| --- | --- |
| Spinning wheel | Fibre |
| Lumbermill | Wood |
| Butchery | Food |

One refining operation converts **3 units of tier N into 1 unit of tier N+1 of the same resource**. There is no downgrading or conversion between types. T3 is the maximum material tier.

- T1 stations refine T1 into T2.
- T2 stations refine T1 into T2 or T2 into T3.
- T3 stations support the same conversions as T2, with better processing speed and building health. They do not produce T4 materials.

Stations are owner-operated only. The owner must be at the station and spend time processing each batch. There are no automatic workers or unattended production. Owners can sell processed materials, equipment or the station itself.

Station recipes and processing durations are implementation settings. Tier-N construction uses tier-N materials. T1 stations must be buildable from T1 materials without a prerequisite station. A station must never require the higher-tier output it is intended to unlock.

Progression must work from the initial state: gather T1 materials, craft T1 tools and build T1 stations, acquire T2 materials through harvesting or refining, then craft T2 equipment and build T2 stations to access T3. Direct harvesting avoids the 3:1 conversion loss; refining provides an alternative to controlling higher-tier deposits.

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

- Sell orders reserve goods; reserved goods cannot be used or listed again. Equipment must be unequipped and not in use before listing.
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

Death stops all activity and cancels the citizen's orders. Unused market and work reservations join the death holdings before loot settles. Holdings include gold, resources and carried/equipped equipment.

- A citizen killed by an attack transfers **100% of those holdings** to the killer, once.
- A natural death leaves the holdings at the death location. Another citizen travels there and collects all of them; the body then disappears. Concurrent pickups cannot duplicate loot. Bodies and uncollected gold do not expire.

Buildings are not inherited by a killer or included in carried loot. A dead owner's buildings remain as unowned structures, cannot operate and may be demolished for salvage. Processing inputs join the owner's death holdings, not a duplicate station inventory.

## Hunger and reproduction

Citizens have health and a fullness meter. Fullness drains gradually; health drains only once fullness reaches zero. Capacity and drain rates are implementation settings. Starvation must leave time to gather, trade or relocate.

| Food tier | Fullness restored per unit |
| --- | --- |
| T1 | One ninth of maximum |
| T2 | One third of maximum |
| T3 | Maximum |

Fullness is capped; excess nutrition is lost. Automatic meals use the lowest-tier available, unreserved food once enough fullness is missing to use its full nutrition. If fullness reaches zero, eat available food before applying starvation damage. Refining preserves total potential nutrition rather than multiplying food supply. Higher-tier food is also a crafting ingredient.

Reproduction requires two living, adjacent citizens who both consent, meet the health requirement, can each pay the food cost and are both off cooldown. Costs are **per parent**; cooldown applies to both. Food cost, required food tier, minimum health and cooldown duration are implementation settings.

Reproduction takes time; completion creates one citizen immediately capable of adult actions. There is no pregnancy, childhood, dependent care or population cap. New citizens receive no free materials, equipment or gold. Initial health and fullness are implementation settings and must be accounted for when balancing reproduction costs. The new citizen spawns on a parent's walkable tile and has their own identity, personality, goals and knowledge; parental equipment and buildings are not copied.

## Time and communication

Movement, harvesting, construction, crafting, refining, attacks, loot pickup and reproduction take time. A citizen performs one physical action at a time. Physical work continues during model reasoning.

Actions reserve required inputs, consume them once on completion and produce output once. Cancellation returns unconsumed inputs and discards unfinished work. If a prerequisite disappears, such as the station being destroyed or ownership changing, stop the action, release its inputs and report the failure. Reserved food cannot also be eaten or sold. Death follows the loot rules above.

Public posts and private messages are global and free. Messages and market actions can occur alongside physical work. Messages have a maximum character count and bounded sending rate chosen during implementation. Text is a statement or request, not an automatic trade, ownership transfer or reproduction consent.

## Implementation discretion

Unspecified balance numbers are intentionally left to the implementer. Keep them centralized and documented. Recipe and economy inspiration may come from Albion Online without importing its additional systems.

Validate initial survival, viable supply of all three resources, progression without circular prerequisites, useful equipment upgrades, and conservation of gold and escrow. These are mechanical checks, not requirements that citizens trade, specialize, reproduce or fight.

Resources are consumed per node, then regenerate over time, meaning the same node cant be harvested twice back to back.
