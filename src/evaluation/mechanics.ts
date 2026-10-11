import { createHash } from 'node:crypto';
import { z } from 'zod';
import { commandSchema } from '../citizen/tools.ts';
import { MAX_TIER, RING_COUNT, TIERS } from '../shared/tiers.ts';
import {
  BALANCE, BUILDINGS, EQUIPMENT, MATCHING_TOOL, RESOURCES, STATION_RESOURCE,
  buildingRecipe, canRefine, equipmentRecipe, harvestDuration, nutrition,
  refinementOutput, refinementRecipe,
} from '../world/config.ts';
import type { MechanicsContext } from './contracts.ts';

// Public rules only: no world instance, controller suggestions, or evaluation data.
// Serialize the actual strict command decoder and exported recipe functions rather
// than maintaining a second command/recipe contract in the manual.
const tables = {
  commandSchema: z.toJSONSchema(commandSchema),
  tiers: { ringCount: RING_COUNT, maxTier: MAX_TIER, supported: TIERS },
  resources: RESOURCES,
  tools: EQUIPMENT,
  buildings: BUILDINGS,
  matchingTool: MATCHING_TOOL,
  stationResource: STATION_RESOURCE,
  balance: {
    maxHealth: BALANCE.maxHealth,
    maxFullness: BALANCE.maxFullness,
    fullnessDrainPerTick: BALANCE.fullnessDrain,
    starvationDamagePerTick: BALANCE.starvationDamage,
    healingPerFedTick: BALANCE.healing,
    moveTicksPerTile: BALANCE.moveTicks,
    harvestTicks: BALANCE.harvestTicks,
    minimumHarvestTicks: BALANCE.minimumHarvestTicks,
    craftTicks: BALANCE.craftTicks,
    buildTicks: BALANCE.buildTicks,
    refineTicksByStationTier: BALANCE.refineTicks,
    depositCapacity: BALANCE.depositCapacity,
    regrowTicks: BALANCE.regrowTicks,
    sightRadius: BALANCE.sightRadius,
    attackTicks: BALANCE.attackTicks,
    attackDamageBySwordTier: BALANCE.attackDamage,
    lootTicks: BALANCE.lootTicks,
    salvageFraction: BALANCE.salvageFraction,
    buildingHealthByTier: BALANCE.buildingHealth,
    reproductionFoodTier: BALANCE.reproductionFoodTier,
    reproductionFoodPerParent: BALANCE.reproductionFood,
    reproductionHealth: BALANCE.reproductionHealth,
    reproductionTicks: BALANCE.reproductionTicks,
    reproductionCooldown: BALANCE.reproductionCooldown,
    newbornHealth: BALANCE.newbornHealth,
    newbornFullness: BALANCE.newbornFullness,
    queueLimit: BALANCE.queueLimit,
    messageLength: BALANCE.messageLength,
    messagesPerWindow: BALANCE.messagesPerWindow,
    messageWindow: BALANCE.messageWindow,
    messageHistory: BALANCE.messageHistory,
    memoryLength: BALANCE.memoryLength,
    memoryLimit: BALANCE.memoryLimit,
    goalLimit: BALANCE.goalLimit,
    goalLength: BALANCE.goalLength,
  },
  nutritionByFoodTier: Object.fromEntries(TIERS.map((tier) => [tier, nutrition(tier)])),
  toolRecipes: EQUIPMENT.flatMap((item) => TIERS.map((tier) => ({
    item, tier, inputs: equipmentRecipe(item, tier), output: { [`${item}:${tier}`]: 1 },
  }))),
  buildingRecipes: BUILDINGS.flatMap((kind) => TIERS.map((tier) => ({
    kind, tier, inputs: buildingRecipe(kind, tier),
  }))),
  refinementRecipes: RESOURCES.flatMap((resource) => TIERS.flatMap((fromTier) =>
    (['up', 'down'] as const).filter((direction) => canRefine(MAX_TIER, fromTier, direction))
      .map((direction) => ({
        resource, fromTier, direction,
        minimumStationTier: direction === 'up' ? fromTier : fromTier - 1,
        inputs: refinementRecipe(resource, fromTier, direction),
        output: refinementOutput(resource, fromTier, direction),
      })))),
  harvestDurations: TIERS.map((depositTier) => ({
    depositTier,
    ticksByUsableMatchingToolTier: Object.fromEntries([0, ...TIERS]
      .filter((toolTier) => depositTier <= Math.min(MAX_TIER, toolTier + 1))
      .map((toolTier) => [toolTier, harvestDuration(depositTier, toolTier)])),
  })),
};

const text = `Prosper public mechanics manual v1
All durations are simulation ticks, not wall-clock seconds. The JSON tables below are generated from the command decoder, tier definitions and exported balance/recipe functions. They describe rules, not recommendations or forecasts. Observations and command results describe the citizen's current situation.

EVALUATION AUTHORITY
In this direct-primitive evaluation track the actor and passive-body peers have no autonomous, reactive, emergency, plan or legacy strategist. The body still advances accepted work and candidate queues, settles harm/death and automatically eats carried unreserved food. No automatic food search, market rescue or defensive strategy is supplied. All bodies pause during candidate decisions; cadence advances committed simulation ticks only.

COMMANDS AND TIME
Commands are strict JSON objects with a required type and only that variant's fields, as specified by commandSchema below. Every variant accepts optional queue: "replace" or "append". Coordinates are nonnegative whole numbers within mapSize; movement is orthogonal, with bottom-left origin. Walls block movement, not sight. Citizens do not block ordinary movement.
Physical commands are move, harvest, craft, build, refine, attack, loot and reproduce. They start timed actions; acceptance does not mean completion. Travel costs moveTicksPerTile for each route step, followed by work duration. A move already at its destination still uses moveTicksPerTile of work. Craft works at the current tile. Harvest and refine travel to their target tile; a wall is built from a reachable neighboring tile. Construction cannot cover a deposit or building, and a wall cannot cover a living citizen. Site/stock reservations and dynamic prerequisites can prevent or interrupt work.
Physical commands default to replace: a valid new action cancels unfinished work and clears its queue. Validation precedes replacement, so an invalid replacement preserves the old work. With append and an active action, the command joins the FIFO queue (up to queueLimit); inputs and prerequisites are checked/reserved only at activation, not submission. Append without active work starts immediately. When idle, failed queued commands are reported and removed, and the queue can continue to its next entry in the same tick. Nonphysical commands execute immediately even during work; their queue field does not make them queued physical actions.
Work ingredients leave available inventory into action.reserved when an action starts. Completion consumes those ingredients once. Cancel returns unused reserved ingredients and clears physical work and the queue; joint reproduction cancels both halves and refunds both parents. Harvest stock is claimed by active actions, not received before completion; cancellation releases the claim. Cancel does not cancel market orders: cancel-order is separate. Interrupted work has no partial product. External physical commands can supersede approved plans; cancellation/replacement also releases suspended emergency-work inputs.
The core tick order includes regrowth, physical advancement, automatic meals/starvation, then queued/planned work advancement. Enabled local controllers can act before physical advancement. Only committed ticks advance timed work; issuing an immediate command alone does not advance time.

ITEMS, PRODUCTION AND TOOLS
Carried keys are resource-or-tool:tier (for example food:1); building:<id> identifies one unique market property, not a carried ingredient. Recipes require exact ingredient tiers, without automatic substitution. Each craft produces one carried tool/weapon. Each build produces one owned building. Stations refine only their mapped resource, only for their owner, while alive and not listed for sale. Refine direction defaults to up; the tables specify adjacent-tier inputs/outputs and minimum station tier. Refinement duration depends on station tier, not input tier. Walls do not refine.
A completed harvest yields one unit of the deposit's resource and tier. Bare hands have usable tool tier zero and can harvest T1. Other tiers require the matching usable tool tier to be at least deposit tier minus one. Harvest duration is max(minimumHarvestTicks, ceil(harvestTicks * 2^(depositTier - 1 - usableToolTier))); the table lists legal combinations. A depleted/reserved deposit cannot be harvested. After extraction, regrowAt schedules one unit after regrowTicks; additional missing stock regrows in successive intervals up to capacity.
Work and attacks automatically use the highest matching positive-count tool tier in carried inventory. Tools are counted only as inventory units, not extra holdings. Selling or giving a tool removes those units from carried inventory and can change the tier available for later work.

FOOD AND HEALTH
Each living tick drains fullness, then automatically considers carried, unreserved food in ascending tier order. It consumes at most one unit: the first food whose nutrition fits the fullness deficit (with floating-point tolerance), or any available food when fullness is effectively zero. Fullness is capped at maxFullness. Reserved food and sell escrow are unavailable to meals. There is no eat command. After the meal, zero fullness causes starvationDamage; positive fullness causes healing capped at maxHealth. Zero health settles death. Automatic feeding is distinct from optional local autonomy; without autonomy, emergency feeding may temporarily suspend nonjoint work at zero fullness when no carried food is available, using known nearby food rather than unseen resources.

MARKET AND GIFTS
Order specifies buy/sell, exact item key, positive whole safe-integer quantity and gold price PER UNIT, with a safe integer total. Buy reserves the full quantity * limit price from unreserved gold immediately. A carried sell reserves its unreserved stock immediately. An accepted order can fill partially, fully, or not at all. The result's filledQuantity/remainingQuantity and goldPaid/goldReceived describe immediate settlement, not promised future delivery. Unmatched quantity stays funded/reserved until matching or cancellation; orders do not expire automatically.
Matching is global, remote and synchronous, for the exact item/tier, opposite sides, different citizens, and crossing limits. Incoming buys take the lowest asks first; incoming sells take the highest bids first. Ties use creation tick then sequence. Execution price is the RESTING order's price, quantity is the smaller remaining quantity. Bought goods arrive directly in carried inventory; sellers receive gold. Unused buyer limit-price difference is refunded on each fill. There is no barter, transport fee or meeting requirement for market settlement. Cancel-order is only for one's own existing order and refunds its remaining escrow. The market does not create unfunded bids or permit sales against reserved work inputs.
Building order quantity must be one. Only the owner may list a living building, with no duplicate sell listing or active processing by that owner. A listed station stays attackable but cannot process. Settlement changes ownership. Destroyed buildings invalidate/cancel their orders and refund escrow.
Transfer is an unconditional remote gold gift to a living citizen using unreserved gold; it buys no goods. Give transfers positive whole carried quantity to another living citizen on the same or orthogonally adjacent tile using unreserved inventory. Neither gift requires a reciprocal action.

SIGHT AND KNOWLEDGE
Sight is Manhattan distance <= sightRadius and is not occluded by walls. Visible tiles are fresh; remembered tiles retain their seenTick and may be stale. Knowledge updates overwrite visible tiles, including newly empty tiles, and do not refresh remote tiles. Observe itself is a pure projection, not a knowledge commit. Enabled autonomy can prune older notebook tiles. Unknown ASCII tiles are x; unseen state is not implied by a remembered entity.
Open market orders are public globally; other citizens' escrow and private holdings are not revealed. Building listings can publish building location/condition. Messages are public when to is omitted, otherwise only sender/recipient see them. Alerts require the citizen in their audience. Claims and alliances are public announcements, not guaranteed resource ownership or physical travel barriers.
Citizen command validation rejects unknown entity references. Harvest, refine, attack, loot and reproduce require current sight at activation, and build requires a visible site. While an action is active, append may accept known remembered targets/sites as intent, deferring sight/prerequisites until activation. Move coordinates remain legal travel destinations even when unseen; reaching them can expose new tiles. Known people can also come from public orders, messages, alerts, claims/alliances or remembered building ownership. Public knowledge does not waive physical prerequisites. Projected action paths show only a contiguous visible prefix; a hidden remainder is not proof that the route has ended.

COMBAT, BODIES AND FAMILY
Attack pursues a citizen/building using visible or dated knowledge and requires a walkable adjacent/same-tile strike position. Out-of-sight targets are searched at their last-known position, not tracked by hidden live coordinates. Repeated timed strikes deal attackDamageBySwordTier * (0.5 + a random value in [0,1)) damage (usable sword tier zero means bare hands); targets can move, die or be destroyed. Destruction refunds processing reservations and awards floor(original construction inputs * salvageFraction) to the attacker once. On citizen death, work inputs and market escrow return before settlement, property becomes unowned and consent clears. A living killer receives the victim's gold/inventory; otherwise those holdings remain in a body. Loot travels to a body and takes lootTicks to collect it; no remote pickup.
Reproduce requires another living, idle partner on the same/adjacent walkable tile, reproductionHealth and completed cooldown for both parents, and one unreserved T1 food PER PARENT. No consent, invitation or mutual choice is required. Joint work occupies both parents for reproductionTicks. Prerequisites remain authoritative during work; cancellation refunds unused food. Completion produces a child and starts both parents' reproductionCooldown.

MESSAGES AND PERSONAL NOTES
Message sends bounded nonempty text publicly or to a known living recipient, limited by messagesPerWindow/messageWindow and retained messageHistory. Remember adds a bounded personal note, evicting oldest notes above memoryLimit. Goals replaces the personal list with at most goalLimit bounded nonempty strings. Notes/messages/goals do not directly produce goods or enact physical work.

SOURCE-DERIVED TABLES
${JSON.stringify(tables)}
`;

const context: MechanicsContext = Object.freeze({
  version: 'prosper-public-mechanics-1',
  text,
  sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
});

/** Stable, frozen published rules. No episode-specific or hidden state enters it. */
export function mechanicsContext(): MechanicsContext {
  return context;
}
