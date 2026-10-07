import { EQUIPMENT_GUIDANCE } from './equipment.mjs';
import { AREA_CHOICES, AREA_GUIDANCE, worldAreas, inArea, areaOf, areaDestination, validArea, wallPlacement, areaResourceLevel } from './places.mjs';
import { findPath } from './pathfinding.mjs';
import { planningContext, applyPlan, transactCitizenAction } from './world.mjs';
import { normalizePlan } from './plans.mjs';
import { BAKERY_COST, BUILD_TICKS, BAKE_TICKS, BREAD_NUTRITION, ADULT_HUNGER_PER_TICK, CHILD_HUNGER_PER_TICK, STARVATION_DAMAGE_PER_TICK } from './economy.mjs';
import { survivalDeteriorated, immediateFoodWork, foodUrgency } from './survival.mjs';
import { competitionPenalty, foragePreferenceCost } from './foraging.mjs';
import { strategyProgress } from './strategy-progress.mjs';
import { exchangePreview } from './exchange-preview.mjs';
import { replenishmentEstimate, estimatedRecheckDelay } from './replenishment.mjs';
import { ollamaToolDefinitions } from './tool-schema.mjs';
import { publicHistory } from './public-history.mjs';
import { defenseCoversNewViolence, mailAffectsPlan } from './decision-relevance.mjs';
import { actionAffordances } from './action-affordances.mjs';
import { STRUCTURES } from './structures.mjs';
import { planConstruction, activeConstruction } from './construction.mjs';

const string = { type: 'string' };
const id = { type: 'string', minLength: 1, maxLength: 100 };
const quantity = { type: 'integer', minimum: 1, maximum: 1000 };
const resource = { type: 'string', enum: ['food', 'wood', 'bread'] };
const area = { type: 'string', enum: AREA_CHOICES, description: 'center is separate. Outside it: compass quadrant plus ring1/2, increasing outward. Bare quadrant includes its rings, excluding center. Use get_places for older worlds.' };
const text = { type: 'string', minLength: 1, maxLength: 500 };
const ids = { type: 'array', items: id, maxItems: 4, minItems: 1, uniqueItems: true };
const resourceReports = { ...ids, description: 'Personally known resource node IDs from find_resources. Offer IDs are text references, not resource reports.' };
const buildingReports = { ...ids, description: 'Personally known building IDs from get_buildings.' };
const directive = (type, properties = {}, required = [], description) => ({ type: 'object', additionalProperties: false,
  ...(description ? { description } : {}), required: ['type', ...required], properties: { type: { type: 'string', enum: [type] }, ...properties } });
const rawResource = { type: 'string', enum: ['food', 'wood'] };
const mechanicActions = ['resources', 'movement', 'equipment', 'production', 'exchange', 'family', 'combat', 'execution'];
const task = { type: 'object', oneOf: [
  directive('collect', { resource: rawResource, amount: quantity, maxTicks: { type: 'integer', minimum: 1, maximum: 600, description: 'Elapsed tick budget, default60. Continue the queue with what was gathered when budget ends.' }, area,
    target: { ...id, description: 'Optional known resource site preference from find_resources.' }, camp: { type: 'boolean', description: 'true pins collection to target, including when empty; requires target. Default automatic search.' } }, ['resource', 'amount']),
  directive('ensure_inventory', { resource: rawResource, minimum: { ...quantity, description: 'Minimum TOTAL inventory to hold before continuing, not additional goods to collect.' }, area }, ['resource', 'minimum']),
  directive('explore', { ticks: { type: 'integer', minimum: 1, maximum: 600 }, area }, ['ticks']),
  directive('move', { area, target: { ...id, description: 'Citizen to approach globally, following their movement even outside sight, or a known site.' } }),
  directive('craft', { item: { type: 'string', enum: ['tool', 'weapon', 'shoes'] }, level: { type: 'integer', minimum: 1, maximum: 3, description: 'Target equipment level, default1; upgrade one level at a time.' } }, ['item'], 'One equipment upgrade: gather its missing wood, then four fixed work ticks. Cost/effect depends on item and level.'),
  directive('build', { building: { type: 'string', enum: ['bakery', 'wall', 'house'] }, area, target: id,
    side: { type: 'string', enum: ['north', 'east', 'south', 'west'], description: 'Wall only: side of a known resource/building target.' },
    length: { type: 'integer', minimum: 1, maximum: 6, description: 'Wall only: contiguous segments, default1. For an enclosure use plan_construction.' } }, ['building'], `Bakery: ${BAKERY_COST} wood/${BUILD_TICKS} work ticks. House:60wood/30ticks, one owner occupant,4x rest recovery. Each wall: ${STRUCTURES.wall.wood} wood/${STRUCTURES.wall.ticks} ticks, blocks everyone and sight. Missing wood is gathered. Leave openings; wall owners have no special passage.`),
  directive('construct', { plan: id }, ['plan'], 'Execute your plan_construction blueprint. Gather missing wood and build its segments from adjacent tiles; progress persists through needs and continuation reviews.'),
  directive('bake', { target: id, amount: quantity }, ['target', 'amount'], `Owner only: each bread uses one food and one wood, then ${BAKE_TICKS} fixed work ticks. Missing raw inputs are gathered.`),
  directive('repair', { target: id }, ['target']),
  directive('guard', { target: id, ticks: { type: 'integer', minimum: 1, maximum: 600 } }, ['target', 'ticks']),
  directive('attack', { target: id }, ['target']),
  directive('trade', { offer: id }, ['offer']),
  directive('give', { target: id, resource, amount: quantity }, ['target', 'resource', 'amount']),
  directive('reproduce', { target: id }, ['target']),
  directive('rest', { target: { ...id, description: 'Optional own or known owned house ID: travel inside before sleeping. Omit to rest here.' } }, [], 'Five-tick sleep restores35energy, capped100. Inside your single-occupant house recovery is4x (+300%):140energy/sleep and2health/tick when fed. Needs also sleep automatically. No duration field.'),
] };
const work = { type: ['object', 'null'], required: ['type'], additionalProperties: false,
  description: 'null means needs only. Otherwise a repeating policy: gather needs resource, bake/guard need target, explore/rest need only type. No amount/ticks: use tasks for finite work.',
  properties: { type: { type: 'string', enum: ['gather', 'bake', 'guard', 'explore', 'rest'] }, resource: rawResource, area, target: id } };
const privateReply = directive('message', { target: id, text, share: resourceReports, shareBuildings: buildingReports, location: { type: 'boolean' } }, ['target', 'text']);
privateReply.required = ['target', 'text'];
privateReply.properties.type.default = 'message';
const communications = { type: 'array', maxItems: 2,
  description: 'Optional parallel communication queue,2ticks/send. Private contact: free speech if visibly nearby, otherwise1existing wood for phone. Public post:1wood. Cannot gather payment. Omit to retain pending sends; [] cancels. No receipt ID until sent.',
  items: { type: 'object', oneOf: [
    privateReply,
    directive('post', { text, share: resourceReports, shareBuildings: buildingReports }, ['text']),
  ] } };
const strategyNotes = {
  thought: { type: 'string', maxLength: 400 },
  goals: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 160 }, minItems: 1, maxItems: 3 },
  memory: { type: 'string', maxLength: 200 }, reviewAfter: { type: 'integer', minimum: 180, maximum: 600, default: 600,
    description: 'Scheduled reflection horizon, default600ticks. Choose an earlier horizon for expected useful change; mail, setbacks and distress review sooner regardless.' },
  undertaking: { type: ['object', 'null'], additionalProperties: false, properties: { objective: string, success: string, status: { type: 'string', enum: ['active', 'completed', 'abandoned'] } } },
  assessment: { type: 'object', description: 'Optional conclusion about the CURRENT undertaking, before any successor supplied in undertaking. Your assessment, not engine proof.',
    required: ['startedAt', 'status', 'reason'], additionalProperties: false, properties: { startedAt: { type: 'integer', minimum: 0 }, status: { type: 'string', enum: ['completed', 'abandoned'] }, reason: { type: 'string', minLength: 1, maxLength: 160 } } },
};
const tool = (name, description, properties = {}, required = []) => ({ type: 'function', function: {
  name, description, parameters: { type: 'object', properties, required, additionalProperties: false },
} });

export const CITIZEN_TOOLS = [
  tool('get_context', 'Your observation refreshes automatically before every model step. Use only if you need an explicit refresh within a batch of tool calls.'),
  tool('get_places', 'Stable areas, known resources, ideal supply rates and last seen people. Rates are upper bounds before travel/competition, not guaranteed stock. Unknown sites are not counted.'),
  tool('find_resources', 'Rank remembered sites by work per yielded unit, accounting for route, recheck and competition. Heuristic, not guaranteed stock. Includes observed level/yield/regrowth. Limit five; optional area. rank:distance lists nearest sites.', { resource: { type: 'string', enum: ['food', 'wood'] }, area,
    rank: { type: 'string', enum: ['forage', 'distance'], default: 'forage' } }, ['resource']),
  tool('get_people', 'Living directory plus dated personal sightings, visual condition, route and relationship. No remote live actions or private state. Up to12 per page; pass nextAfter as after for the next page. Optional area filters remembered locations.', {
    after: id, area, limit: { type: 'integer', minimum: 1, maximum: 12 },
  }),
  tool('get_buildings', 'Known buildings,8per page. Own properties first by default; owned:true filters yours. Optional kind/area. after:nextAfter gets the next page. Dated evidence; absence is not destruction.', {
    owned: { type: 'boolean' }, kind: { type: 'string', enum: ['bakery', 'wall', 'house'] }, area, after: id,
    limit: { type: 'integer', minimum: 1, maximum: 8 },
  }),
  tool('plan_construction', 'Preview a wall blueprint around a known resource/building target. line: optional side/length (default3). enclosure: size small|medium|large (3|5|7 square), openings (at least one; default entrance faces you). Requires explored free footprint. Returns cost/access warnings and a construct directive; builds nothing. Walls block everyone/sight, including owners.', {
    target: id, layout: { type: 'string', enum: ['line', 'enclosure'] }, area,
    side: { type: 'string', enum: ['north', 'east', 'south', 'west'] },
    length: { type: 'integer', minimum: 1, maximum: 6 }, size: { type: 'string', enum: ['small', 'medium', 'large'] },
    openings: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'string', enum: ['north', 'east', 'south', 'west'] } },
  }, ['target', 'layout']),
  tool('get_exchanges', 'Eligible actual escrow,8per page; after:nextAfter gets the next page. Each trade states what YOU pay/receive. Your closed-offer history is included. The initial preview may already contain the relevant offer.', { after: id, limit: { type: 'integer', minimum: 1, maximum: 8 } }),
  tool('get_history', 'Your retained outcomes/setbacks/memories. With publicQuery, search the public noticeboard INSTEAD: case/punctuation-insensitive words, compass abbreviations recognized. Empty query lists all notices, newest first;8per page, after:nextAfter. Claims are dated speech, not enforced territory or current escrow.', {
    publicQuery: { type: 'string', maxLength: 120 }, after: id, limit: { type: 'integer', minimum: 1, maximum: 8 },
  }),
  tool('get_mechanics', 'Exact action costs, prerequisites and effects. Query before using an unfamiliar action.', { action: { type: 'string', enum: mechanicActions } }, ['action']),
  tool('send_private_message', 'Contact now alongside physical work: speak FREE if the recipient is visibly nearby, otherwise phone for1EXISTING wood. Rechecks visibility at send; returns actual channel, cost and real message ID. Text compels no response. Reports share known snapshots; location shares your position.', { to: id, text, share: resourceReports, shareBuildings: buildingReports, location: { type: 'boolean' } }, ['to', 'text']),
  tool('post_public_message', 'Public phone post now; costs one existing wood. Text creates no trade, goods or contract.', { text, share: resourceReports, shareBuildings: buildingReports }, ['text']),
  tool('open_offer', 'Escrow existing goods now; returns the REAL offer ID for later messages. One open offer per maker. To replace one, explicitly pass its replaceOfferId; this CANCELS/refunds it, including offers to other recipients. Read the cancellation receipt before making promises. No meeting until acceptance. YOU give giveAmount, asking wantAmount in return; wantAmount zero is a gift. Choosing trade(offer) automatically routes to the moving maker globally.', { give: resource, giveAmount: quantity, want: resource, wantAmount: { type: 'integer', minimum: 0, maximum: 1000 }, recipient: { type: ['string', 'null'] }, replaceOfferId: { ...id, description: 'Only when deliberately cancelling and replacing your current open offer; use its exact ID.' } }, ['give', 'giveAmount', 'want', 'wantAmount']),
  tool('propose_family', 'Propose a pairing to an adult now; returns an actual proposal ID. No goods or meeting; recipient must explicitly accept. Optional location shares your position.', { to: id, location: { type: 'boolean' } }, ['to']),
  tool('accept_family', 'Recipient accepts an existing pending proposal now. Does not reproduce; permits a later physical directive. Requires actual proposalId, not message text.', { proposalId: id, location: { type: 'boolean' } }, ['proposalId']),
  tool('decline_family', 'Recipient declines an existing pending proposal now. Requires actual proposalId.', { proposalId: id }, ['proposalId']),
  tool('cancel_family', 'Either partner cancels an active proposal now. Requires actual proposalId.', { proposalId: id }, ['proposalId']),
  tool('continue_strategy', 'Finish this turn and retain physical execution, queue, work and invested effort. Optional notes revise goals/memory; communications can queue replies alongside retained work. No task/work echo is accepted. reviewAfter:180..600 ticks, default600; events may prompt earlier review.', { ...strategyNotes, communications }),
  tool('commit_strategy', 'Finish this turn by REPLACING physical execution with up to four serial directives then repeating work. Person interactions route globally themselves; no preparatory move is needed. Discards unfinished effort. ensure_inventory(resource,minimum,area?) ensures TOTAL stock at least minimum, including meals during collection; the simulation chooses/rechecks sites. build/move use area or known target instead of coordinates. Query mechanics for other actions. To keep execution use continue_strategy. reviewAfter:180..600 simulated ticks.', {
    ...strategyNotes,
    tasks: { type: 'array', items: task, maxItems: 4 }, work, communications,
  }),
];

// Reuse repeated schema fragments on the wire. Runtime validation continues to
// use the expanded schema above; no capability or constraint is removed.
export const MODEL_TOOLS = CITIZEN_TOOLS.map(definition => {
  const tool = structuredClone(definition);
  const definitions = {};
  let encoded = JSON.stringify(tool.function.parameters);
  for (const [name, schema] of Object.entries({ resourceReports, buildingReports, area, id, quantity, text })) {
    const fragment = JSON.stringify(schema);
    if (encoded.split(fragment).length < 3) continue;
    const candidate = encoded.split(fragment).join(JSON.stringify({ $ref: `#/$defs/${name}` }));
    if (candidate.length + JSON.stringify({ ...definitions, [name]: schema }).length >= encoded.length + JSON.stringify(definitions).length) continue;
    encoded = candidate;
    definitions[name] = schema;
  }
  tool.function.parameters = JSON.parse(encoded);
  if (Object.keys(definitions).length) tool.function.parameters.$defs = definitions;
  return tool;
});

// References in raw array items and $defs survive Ollama's parser. Expand only
// typed property boundaries, where references would otherwise disappear.
export const OLLAMA_MODEL_TOOLS = ollamaToolDefinitions(MODEL_TOOLS);

// Experimental compact interface: inspection and family lifecycle share entry
// points, while the original strict per-action validators remain authoritative.
const inspectionTools = { places: 'get_places', resources: 'find_resources', people: 'get_people',
  buildings: 'get_buildings', exchanges: 'get_exchanges', history: 'get_history', mechanics: 'get_mechanics' };
const familyTools = { propose: 'propose_family', accept: 'accept_family', decline: 'decline_family', cancel: 'cancel_family' };
const COMPACT_ALIASES = [
  tool('inspect', 'Read missing facts. subject:places|people|buildings|exchanges|history needs no other fields; resources requires resource, optional area; mechanics requires action. Dated personal knowledge only; exchanges are actual eligible escrow.', {
    subject: { type: 'string', enum: Object.keys(inspectionTools) }, resource: rawResource, area,
    after: id, limit: { type: 'integer', minimum: 1, maximum: 12 },
    action: { type: 'string', enum: mechanicActions },
  }, ['subject']),
  tool('family', 'Act now. propose requires to (adult ID); accept/decline/cancel require proposalId. Optional location shares your position. Proposing/accepting creates consent, not a birth; physical reproduce still needs accepted unspent consent.', {
    action: { type: 'string', enum: Object.keys(familyTools) }, to: id, proposalId: id, location: { type: 'boolean' },
  }, ['action']),
];
export const COMPACT_MODEL_TOOLS = [...MODEL_TOOLS.filter(t =>
  !Object.values(inspectionTools).includes(t.function.name) && !Object.values(familyTools).includes(t.function.name)), ...COMPACT_ALIASES];

export const MECHANICS = {
  resources: 'collect(resource,amount,maxTicks?,area?,target?,camp?): NEW units; meals do not undo progress. Default60tick budget; deadline continues queue with actual yield, even zero. ensure_inventory(resource,minimum,area?): TOTAL held stock, meals included; rechecks until reached/revised and can block the queue. Execution shows current/best stock and stalled ticks. target prefers a known matching site in any required area; camp:true pins it even empty. Automatic selection compares route/recheck/competition/effort per yielded unit and avoids visibly fully occupied stock; camping may contest. Regrowth estimates predict nominal growth, not available stock. Quality changes yield only: levels1..3 give1..3food or5/10/15wood. All levels: crop6work/99regrowth ticks; tree8work/120regrowth ticks. Stock counts opportunities; each yields a full bundle. Old sites retain actual values. Food collection retains area through hunger; meals/rest interrupt, emergency escape follows execution rules. Other tasks may forage elsewhere. Repeating gather is indefinite. Craft/build/bake/trade/reproduce gather missing raw inputs; extra stockpiles are optional. explore(ticks:1..600,area?) reveals local sites. No bread deposits.',
  movement: `${AREA_GUIDANCE} move(area) enters an area; move(target:citizenId) routes directly to that citizen globally and follows their movement even outside sight. No area hint or location report is needed; if target and area are both supplied, the citizen target takes precedence. give/trade/reproduce/attack route to their person target automatically: choose the interaction directly, with no separate move or search. Travel takes time; effects require adjacent contact and their normal prerequisites. Unreachable or dead targets fail; finite movement and meetings timeout600ticks. Navigation does not disclose remote private state or update unseen observations. Known static sites use remembered locations; move(target:buildingId) stops adjacent, even outside sight. Sight reaches three tiles; living buildings hide what is behind, while old sightings remain dated memories. Walls also block everyone\'s movement, including owners. Rest adds energy. There is no deliberate wait directive; keep useful work going while awaiting replies.`,
  equipment: EQUIPMENT_GUIDANCE,
  production: `build(building:bakery,area? or target:knownNodeId): choose nearest personally explored unoccupied tile in area or near known node; gathers ${BAKERY_COST} wood, then ${BUILD_TICKS} ticks. Only owner can bake(target:own|knownBuildingId,amount): 1 raw food + 1 wood / ${BAKE_TICKS} ticks -> 1 bread (${BREAD_NUTRITION} hunger relief vs food35, clamped at zero); gathers missing inputs. Baking work repeats. Extra bakeries do not add workers or increase your personal output; compare a new location with using an existing site. Walls:15wood/10ticks,120health, block everyone\'s movement and sight. Unclaimed ruin walls can be demolished for standard60%salvage. Leave openings; owners have no special passage. plan_construction(target:knownResourceOrBuildingId,layout:line|enclosure) computes geometry in explored free terrain; construct(plan:returnedPlanId) gathers inputs and builds segments with retained progress. A line takes length1..6, optional side. Enclosure sizes small/medium/large mean3/5/7 squares; choose at least one north/east/south/west opening, default faces builder. Openings are free passage for anyone. Preview reports total wood, work and known access losses; occupancy/routes can change. Houses:60wood/30build ticks,180health,one owner occupant. Inside, rest recovers4x (+300%):140energy per5ticks capped100, and2health/tick when fed. rest(target:own|knownOwnedHouseId) routes inside first; ordinary/automatic sleep also benefits while inside. Other citizens cannot enter. Repair own damaged bakery/wall/house: 2 wood/4 ticks, +20 health. Health0 destroys it.`,
  exchange: 'open_offer: escrow currently held goods; one open per maker across ALL recipients; explicitly name replaceOfferId to cancel/refund the old offer, expiry/refund after 1800 ticks. recipient limits access. trade(offer): YOU pay want/wantAmount, YOU receive give/giveAmount; automatically route to the maker globally, 2 ticks adjacent, one fill only. No separate move or location report needed. give(target,resource,amount): automatically route to the recipient globally and transfer goods, 2 ticks adjacent. Chosen trade/give gather missing raw food/wood and recheck payment before meeting, within600 ticks. Missing bread requires an explicit production/exchange choice. No currency, employment, ownership transfer or enforceable promises. Private contact is free speech when visibly nearby, otherwise a phone send costs1existing wood NOW; public posts cost1wood. Sends report snapshots and never transfer goods. Text claiming coordinates is not a location report.',
  family: 'Propose to an adult, recipient must explicitly accept. Pairing lasts 1800 ticks; each person has one accepted pairing. reproduce(target): automatically route to partner globally, then 4 ticks adjacent. EACH adult needs health>=50 and pays 2 food equivalents (2 raw food or 1 bread; raw food first, then whole bread). No wood or energy cost, hunger threshold, reproduction cooldown or population cap. Your chosen directive gathers missing food, rests for health and retries temporary joint failures after contact, within600 ticks. The partner chooses independently; no automatic consent, gifts or peer preparation. Success consumes consent; child matures after300ticks. Ordinary needs/care still apply.',
  combat: 'attack(target:adultId|knownBuildingId): route globally to a citizen or to a known building location, 3 ticks/strike, 8 energy, 6 unarmed; armed damage18/27/40 by weapon level. Survivor with4 energy counters for4 unarmed or12/18/27 armed damage and4 energy. Adults stop after3 strikes or wounded retreat; children cannot attack/be attacked. Fatal attack transfers victim goods to killer. Buildings have no counter; destroyed at0health. Destruction returns60% of original construction wood to the destroyer exactly once: bakery30/wall9/house36, including own-property demolition; repairs do not increase salvage. You may attack your own buildings to demolish them. Each attack alerts its living owner immediately with attacker name/ID, building position and damage, even outside sight. The owner can move/guard/repair/attack that building by ID; no exploration or location report is required. Alerts do not reveal the attacker\'s current whereabouts. guard(target:knownBuildingId,ticks?): stay within2 tiles and counter a visible attacker only after witnessing a strike there or on a nearby person within12ticks. Rest heals .5/tick when fed; danger and consequences are real. Neither reports nor hostility automatically authorize guard attacks.',
  execution: `continue_strategy keeps current physical order, queue, work and invested effort. commit_strategy replaces unfinished execution. Construction blueprints retain segment progress and allow600 ticks per segment; other finite directives timeout600 ticks; inventory acquisition continues until reached or revised; work repeats. Chosen food collection keeps its area/target through ordinary hunger. At starvation, if its next estimated meal cannot fit before fatal hunger but personally observed uncontested food can, emergency foraging takes that meal and then resumes the retained strategy. Feasible in-progress harvests stay intact; no remote live stock, automatic shopping or guaranteed survival. Needs: hunger+${ADULT_HUNGER_PER_TICK}/tick (children+${CHILD_HUNGER_PER_TICK}), with bread eat at${BREAD_NUTRITION} for${BREAD_NUTRITION}relief; otherwise eat food at60 for35relief, forage if no meals; at100 lose${STARVATION_DAMAGE_PER_TICK}health/tick. An explicitly chosen funded bake or food trade may finish before eating/foraging if its known route and duration fit before fatal hunger. Food trades may prepare missing wood payment from several recently personally observed, stocked, uncontested sources when the whole preparation and meeting fit. The route rechecks depletion, competing harvests and remaining survival time. No remote live stock or future regrowth is assumed, and no trade is automatically chosen. Existing bread is eaten first. Rest atenergy<=20, +35energy/5ticks; inside your house4x recovery (+300%), one occupant. Wounded retreat/dependent care may interrupt. Failed finite tasks hold later work for review. New mail and materially worsening survival can trigger review, while physical work continues during reasoning. Worsening vitals and citizen deaths refresh the turn; reconsider that evidence before committing. Refresh when state changes matter. Goals/notes alone do not execute actions.`,
};

// All results are constructed from approved knowledge, never by exposing the world.
export function semanticValue(world, value) {
  if (Array.isArray(value)) return value.map(item => semanticValue(world, item));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  if (Number.isFinite(value.x) && Number.isFinite(value.y)) out.area = areaOf(world, value);
  for (const [key, item] of Object.entries(value)) if (!['x', 'y', 'path', 'knowledge'].includes(key)) out[key] = semanticValue(world, item);
  if (value.type === 'acquire') {
    out.type = 'ensure_inventory';
    out.minimum = value.quantity;
    delete out.quantity;
  }
  if (value.type === 'approach') out.type = 'move';
  if (value.type === 'gather' && value.maxTicks !== undefined) out.type = 'collect';
  return out;
}

export function citizenObservation(world, citizenId) {
  const context = planningContext(world, citizenId);
  const c = context.citizen;
  const citizen = world.citizens.find(person => person.id === citizenId);
  const progress = strategyProgress(citizen, world.tick);
  const completionFloor = citizen.strategyBaseline?.completionRevision ?? 0;
  const completions = c.completedActions.filter(a => a.revision > completionFloor).slice(-4);
  const family = context.familyProposals.filter(p => ['pending', 'accepted'].includes(p.status));
  const lastClosedFamily = context.familyProposals.find(p => !['pending', 'accepted'].includes(p.status));
  if (lastClosedFamily) family.push(lastClosedFamily);
  // Inventory goals are not harvest counters. The legacy progress field stays
  // zero for this directive and can falsely suggest that no food was gathered.
  if (c.order?.type === 'acquire') {
    delete c.execution.completedUnits;
    c.execution.inventoryTarget.minimum = c.execution.inventoryTarget.quantity;
    delete c.execution.inventoryTarget.quantity;
    c.execution.inventoryTarget.ticksSinceNewPeak = c.execution.inventoryTarget.ticksSinceIncrease;
    delete c.execution.inventoryTarget.ticksSinceIncrease;
    c.execution.inventoryTarget.gap = Math.max(0, c.order.quantity - c[c.order.resource]);
    c.execution.inventoryTarget.elapsedTicks = world.tick - c.execution.orderStartedAt;
  }
  return semanticValue(world, {
    tick: context.tick,
    capabilities: { immediate: CITIZEN_TOOLS.filter(t => !/^(get_|find_|continue_|commit_)/.test(t.function.name)).map(t => t.function.name),
      physical: task.oneOf.map(t => t.properties.type.enum[0]),
      note: 'Persistent world abilities, subject to normal inputs/consent. A review may temporarily restrict immediate tools; that does not remove an ability from the game.' },
    geography: { width: world.width, height: world.height, areas: worldAreas(world), ...(world.rings ? { rings: world.rings } : {}),
      ...(world.center ? { center: world.center, resourceLevels: { center: 3, ring1: 2, ring2: 1 } } : {}) },
    citizen: Object.fromEntries(['id', 'name', 'x', 'y', 'food', 'wood', 'bread', 'hunger', 'energy', 'health', 'tool', 'weapon', 'shoes', 'toolLevel', 'shoesLevel', 'weaponLevel', 'weaponDurability', 'personality', 'aspirations', 'goals', 'strategyMemory', 'undertaking', 'order', 'tasks', 'work', 'communications', 'execution', 'lastPlanError'].filter(key => c[key] !== undefined).map(key => [key, c[key]])),
    ...(progress ? { strategyProgress: progress } : {}),
    ...(activeConstruction(citizen) ? { construction: activeConstruction(citizen) } : {}),
    ...(citizen.undertakingHistory?.length ? { previousUndertaking: citizen.undertakingHistory.at(-1) } : {}),
    recentMemories: c.memories,
    household: householdInformation(world, context),
    inbox: context.inbox, board: context.board.slice(-2), family, familyOmitted: context.familyProposals.length - family.length,
    familyConsent: consentInformation(context.familyProposals, citizenId, world.tick),
    incidents: context.incidents, propertyAlerts: (citizen.buildingAlerts ?? []).slice(-3), recentResults: c.actionResults.slice(-3),
    property: { bakeryCount: context.knownBuildings.filter(b => b.kind === 'bakery' && b.ownerId === citizenId && b.health > 0).length,
      bakeries: context.knownBuildings.filter(b => b.kind === 'bakery' && b.ownerId === citizenId && b.health > 0).slice(0, 4).map(b => b.id),
      walls: context.knownBuildings.filter(b => b.kind === 'wall' && b.ownerId === citizenId && b.health > 0).length,
      houses: context.knownBuildings.filter(b => b.kind === 'house' && b.ownerId === citizenId && b.health > 0).slice(0, 4).map(b => b.id),
      note: 'Dated property records. bake(target:own) uses an existing bakery; rest(target:own) uses your house (4x recovery). Extra buildings do not add workers or stack rest bonuses. Compare location/access benefits with cost; demolish obsolete property for60% salvage.' },
    completedActions: { sinceTick: citizen.strategyBaseline?.tick ?? null, items: completions,
      omitted: Math.max(0, c.completedActionRevision - completionFloor - completions.length) },
    ownOffer: context.offers.find(o => o.makerId === citizenId) ?? null,
    ...(context.offerHistory.length ? { lastClosedOwnOffer: context.offerHistory.at(-1) } : {}),
    eligibleExchanges: exchangePreview(context),
    foodUrgency: foodUrgency(citizen),
    combatStakes: 'Killing transfers ALL victim food, wood and bread, including refunded escrow. Destroying a structure returns 60% of its original construction wood to the destroyer (bakery30, wall9, house36), including self-demolition, once only. Peer private stocks remain unknown; weigh injury, weapon wear and retaliation against spoils.',
    currentPlace: placeInformation(world, citizen, context, areaOf(world, c)),
    more: { resources: context.deposits.length, buildings: context.knownBuildings.length, people: context.neighbors.length, offers: context.offers.length },
  });
}

function householdInformation(world, context) {
  const family = [...context.citizen.children.map(c => ({ ...c, relation: 'child', status: 'living' })),
    ...context.citizen.parents.map(id => {
      const living = context.neighbors.find(p => p.id === id), deceased = world.dead.find(p => p.id === id);
      // Family death is already explicitly announced by the simulation. Keep
      // that fact visible after short memory prose rolls away; expose no last
      // location, goods or vitals from a deceased parent's world record.
      return { id, relation: 'parent', ...(living ? { name: living.name, adult: living.adult, status: 'living' }
        : deceased ? { name: deceased.name, status: 'deceased' } : { status: 'unknown' }) };
    })];
  const items = family.map(person => {
    const contact = context.contacts.find(p => p.id === person.id);
    return { ...person, ...(contact && person.status !== 'deceased' ? { lastSeen: { area: areaOf(world, contact), ageTicks: world.tick - contact.observedAt,
      ...(contact.observedCondition ? { condition: contact.observedCondition } : {}) } } : {}) };
  }).sort((a, b) => (b.lastSeen?.condition?.nourishment === 'starving') - (a.lastSeen?.condition?.nourishment === 'starving')
    || (a.lastSeen?.ageTicks ?? Infinity) - (b.lastSeen?.ageTicks ?? Infinity));
  return { members: items.slice(0, 8), omitted: Math.max(0, items.length - 8),
    note: 'Condition is a dated visual impression, not remote vitals or inventory. Adults choose their own actions; automatic parental care stops at adulthood.' };
}

function consentInformation(proposals, citizenId, tick) {
  return { acceptedPartnerIds: proposals.filter(p => p.status === 'accepted' && p.expiresAt > tick)
    .map(p => p.makerId === citizenId ? p.recipientId : p.makerId),
    note: 'Only an accepted, unexpired pairing supplies consent. Fulfilled means a child was already born and that consent was consumed. Another birth requires a fresh proposal and acceptance.' };
}

function placeInformation(world, citizen, context, id) {
  const records = Object.values(citizen.knowledge.nodes).filter(n => inArea(world, n, id));
  const idealSupply = (kind, harvestTicks) => records.filter(n => n.kind === kind).reduce((total, n) => total + 100 * (n.yield ?? 1) / ((n.regrowTicks ?? (kind === 'crop' ? 99 : 120)) + harvestTicks), 0);
  const explored = citizen.knowledge.explored.filter(key => { const [x, y] = key.split(',').map(Number); return inArea(world, { x, y }, id); }).length;
  const destination = areaDestination(world, citizen, id);
  const people = context.contacts.filter(p => inArea(world, p, id) && context.neighbors.some(n => n.id === p.id))
    .sort((a, b) => b.observedAt - a.observedAt || a.id.localeCompare(b.id));
  const foodDemand = (areaOf(world, citizen) === id ? (citizen.adult ? ADULT_HUNGER_PER_TICK : CHILD_HUNGER_PER_TICK) : 0)
    + people.reduce((sum, p) => sum + (p.adult ? ADULT_HUNGER_PER_TICK : CHILD_HUNGER_PER_TICK), 0);
  return { id, ...(areaResourceLevel(world, id) ? { resourceLevel: areaResourceLevel(world, id) } : {}),
    exploredTiles: explored, knownFoodSites: records.filter(n => n.kind === 'crop').length, knownWoodSites: records.filter(n => n.kind === 'tree').length,
    idealFoodPer100Ticks: Number(idealSupply('crop', 6).toFixed(2)), idealWoodPer100Ticks: Number(idealSupply('tree', 8).toFixed(2)),
    yourRawFoodNeedPer100Ticks: Number((100 * (citizen.adult ? ADULT_HUNGER_PER_TICK : CHILD_HUNGER_PER_TICK) / 35).toFixed(2)),
    supplyNote: `Upper bound from known sites before travel, competition or further discoveries; bread has ${BREAD_NUTRITION / 35}x nominal raw-food nutrition, requiring wood and an owned bakery. Relief cannot lower hunger below zero.`,
    estimatedRawFoodBalancePer100Ticks: Number((idealSupply('crop', 6) - 100 * foodDemand / 35).toFixed(2)),
    pressureNote: 'Known ideal raw supply minus nominal demand of you here and last-seen people, assuming no baking. Dated sightings may have moved; not a census or guaranteed yield.',
    lastSeenPeopleCount: people.length, lastSeenPeopleOmitted: Math.max(0, people.length - 6),
    lastSeenPeople: people.slice(0, 6).map(p => ({ id: p.id, ageTicks: world.tick - p.observedAt,
      ...(p.observedActivity ? { observedActivity: p.observedActivity } : {}),
      ...(p.observedEquipment ? { observedEquipment: p.observedEquipment } : {}),
      ...(p.observedCondition ? { observedCondition: p.observedCondition } : {}) })),
    latestObservationAt: records.length ? Math.max(...records.map(n => n.observedAt)) : null,
    travelTicks: destination ? findPath(world, citizen, destination)?.length ?? null : null };
}

function validateSchema(value, schema, path = 'arguments') {
  if (schema.oneOf) {
    const discriminator = value?.type;
    const selected = schema.oneOf.find(choice => choice.type === 'null' && value === null
      || choice.properties?.type?.enum?.includes(discriminator));
    if (!selected) throw new Error(`${path}.type must be ${schema.oneOf.flatMap(choice => choice.properties?.type?.enum ?? []).join(' | ')}; received ${JSON.stringify(discriminator)}`);
    return validateSchema(value, selected, path);
  }
  if (value === null && (schema.type === 'null' || schema.type?.includes?.('null'))) return;
  const types = [].concat(schema.type);
  const type = Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  if (!types.includes(type) && !(type === 'integer' && types.includes('number'))) throw new Error(`${path} must be ${types.join(' or ')}`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} has an unknown value; expected ${schema.enum.join(' | ')}, received ${JSON.stringify(value)}`);
  if (type === 'integer' && (!Number.isSafeInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw new Error(`${path} must be an integer from ${schema.minimum ?? '-Infinity'} through ${schema.maximum ?? 'Infinity'}; received ${value}`);
  if (type === 'string' && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity))) throw new Error(`${path} length must be ${schema.minLength ?? 0}..${schema.maxLength ?? 'unbounded'} characters; received ${value.length}`);
  if (type === 'array') {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) throw new Error(`${path} must contain ${schema.minItems ?? 0}..${schema.maxItems ?? 'unbounded'} items; received ${value.length}`);
    if (schema.uniqueItems && new Set(value).size !== value.length) throw new Error(`${path} must be unique`);
    value.forEach((item, index) => validateSchema(item, schema.items, `${path}[${index}]`));
  }
  if (type === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw new Error(`${path}.${key} is unsupported`);
      validateSchema(item, schema.properties[key], `${path}.${key}`);
    }
  }
}

function compileTask(world, citizen, input) {
  if (input.type === 'collect') return compileTask(world, citizen, { ...input, type: 'gather', maxTicks: input.maxTicks ?? 60 });
  if (input.type === 'ensure_inventory') return { type: 'acquire', resource: input.resource, quantity: input.minimum,
    ...(input.area ? { area: input.area } : {}) };
  if (input.type === 'trade') {
    const offers = planningContext(world, citizen.id).offers.filter(offer => offer.makerId !== citizen.id);
    if (!offers.some(offer => offer.id === input.offer)) {
      throw Object.assign(new Error('trade.offer must identify an eligible open offer. Offers can be filled, cancelled or expire while you reason; choose from the attached current exchanges or revise your method.'), {
        exchanges: { items: offers.slice(0, 8).map(offer => ({ id: offer.id, makerId: offer.makerId,
          youPay: { resource: offer.want, amount: offer.wantAmount }, youReceive: { resource: offer.give, amount: offer.giveAmount } })),
          omitted: Math.max(0, offers.length - 8), note: 'Eligible current escrow only; no reservation or guaranteed future availability.' },
      });
    }
  }
  if (input.type === 'gather') {
    if (input.camp && !input.target) throw new Error('gather.camp=true requires target: a known resource node ID. Omit camp for automatic search within an area.');
    if (input.target && citizen.knowledge.nodes[input.target]?.kind !== (input.resource === 'food' ? 'crop' : 'tree')) {
      throw new Error('gather.target must be a known matching resource node ID; find_resources returns those IDs.');
    }
    if (input.target && input.area && !inArea(world, citizen.knowledge.nodes[input.target], input.area)) throw new Error('The selected resource target is outside your requested area. Remove the area restriction or choose a matching site.');
  }
  if (input.type === 'reproduce') {
    const family = planningContext(world, citizen.id).familyProposals;
    if (!family.some(p => p.status === 'accepted' && p.expiresAt > world.tick && [p.makerId, p.recipientId].includes(input.target))) {
      throw new Error('Reproduction requires a current accepted pairing with that citizen. A fulfilled proposal has been consumed and is not reusable.');
    }
  }
  if (input.type === 'move' && !input.area && !input.target) throw new Error('move requires area or a known target ID.');
  if (input.type === 'move' && input.target && world.citizens.some(p => p.id === input.target && p.id !== citizen.id)) {
    return { type: 'approach', target: input.target, ...(input.area ? { area: input.area } : {}) };
  }
  if (!['build', 'move'].includes(input.type)) return { ...input };
  const reference = input.target && (citizen.knowledge.nodes[input.target] ?? citizen.knowledge.buildings?.[input.target] ?? citizen.knowledge.people?.[input.target]);
  if (input.target && !reference) throw new Error('Destination must be a known site/person ID.');
  if (input.area && !validArea(input.area)) throw new Error('Unknown area.');
  const chosenArea = input.area ?? (reference ? areaOf(world, reference) : areaOf(world, citizen));
  if (input.type === 'build' && input.building === 'wall') {
    if (input.target && !citizen.knowledge.nodes[input.target] && !citizen.knowledge.buildings?.[input.target]) throw new Error('A wall target must be a known resource or building.');
    return { type: 'build', building: 'wall', ...wallPlacement(world, citizen, { reference, area: chosenArea, side: input.side, length: input.length ?? 1, restrictArea: Boolean(input.area) }) };
  }
  if (input.type === 'build' && (input.side !== undefined || input.length !== undefined)) throw new Error('side/length are wall-only fields.');
  const point = input.type === 'move' && reference ? reference
    : areaDestination(world, reference ? { ...citizen, x: reference.x, y: reference.y } : citizen, chosenArea, { exploredOnly: input.type === 'build', buildable: input.type === 'build' });
  if (!point) throw new Error('No suitable known destination in that area.');
  return { type: input.type, ...(input.type === 'build' ? { building: input.building ?? 'bakery' } : {}),
    ...(input.type === 'move' && reference && citizen.knowledge.buildings?.[input.target] ? { range: 1 } : {}), x: point.x, y: point.y };
}

// Some tool transports return structured fields as JSON text. Decode the
// representation only where the schema expects a structure, never quantities,
// IDs or message text. The original strict schema still validates every field.
function decodeStructuredFields(value, schema) {
  const types = [].concat(schema.type ?? []);
  let decoded = value;
  if (typeof value === 'string' && types.some(type => ['array', 'object'].includes(type))) {
    try { decoded = JSON.parse(value); }
    catch { throw new Error(`Expected ${types.join(' or ')}; structured JSON text was invalid.`); }
  }
  if (Array.isArray(decoded) && schema.items) return decoded.map(item => decodeStructuredFields(item, schema.items));
  if (decoded && typeof decoded === 'object' && !Array.isArray(decoded) && schema.properties) {
    return Object.fromEntries(Object.entries(decoded).map(([key, item]) => [key,
      schema.properties[key] ? decodeStructuredFields(item, schema.properties[key]) : item]));
  }
  return decoded;
}

export function createCitizenToolSession({ getWorld, citizenId, planId, signal }) {
  let committed = null;
  let reviewedMessageId;
  let reviewedContext;
  const worldAndCitizen = () => {
    if (signal?.aborted) throw new Error('Turn cancelled.');
    const world = getWorld();
    const citizen = world.citizens.find(c => c.id === citizenId && c.alive && c.adult);
    if (!citizen) throw new Error('Citizen no longer able to act.');
    return { world, citizen };
  };
  const refresh = () => {
    const { world } = worldAndCitizen();
    const observation = citizenObservation(world, citizenId);
    reviewedContext = planningContext(world, citizenId);
    reviewedMessageId = observation.inbox.at(-1)?.id;
    return observation;
  };
  const changesSinceReview = context => {
    const changes = [];
    const change = (kind, message) => changes.push({ kind, message });
    if (reviewedContext && survivalDeteriorated(reviewedContext.citizen, context.citizen)) change('survival', 'Your survival has deteriorated; reconsider the time and means to obtain food or recover');
    const missing = reviewedContext?.neighbors.filter(previous => !context.neighbors.some(current => current.id === previous.id)) ?? [];
    if (missing.length) change('death', `Citizens no longer alive: ${missing.map(person => person.id).join(', ')}`);
    if ((context.citizen.inboxRevision ?? 0) !== (reviewedContext?.citizen.inboxRevision ?? 0)
      || (context.inbox.at(-1)?.id && context.inbox.at(-1).id !== reviewedMessageId)) change('mail', 'New private mail arrived');
    if (context.citizen.execution?.blockedBy !== reviewedContext?.citizen.execution?.blockedBy) change('failure', 'A physical directive failed during reasoning');
    if (JSON.stringify(context.familyProposals) !== JSON.stringify(reviewedContext?.familyProposals)) change('family', 'Family consent changed during reasoning');
    if (JSON.stringify(context.incidents) !== JSON.stringify(reviewedContext?.incidents)) change('violence', 'New violence evidence or property attack alert');
    if ((context.citizen.completedActionRevision ?? 0) !== (reviewedContext?.citizen.completedActionRevision ?? 0)) change('completion', 'A consequential action completed during reasoning; reconsider which actions remain');
    return changes;
  };
  const pollUpdates = () => {
    const { world } = worldAndCitizen();
    const changes = changesSinceReview(planningContext(world, citizenId));
    return changes.length ? { changes: changes.map(c => c.message), kinds: changes.map(c => c.kind), context: refresh() } : null;
  };
  return {
    refresh,
    pollUpdates,
    get committed() { return committed; },
    execute(name, args) {
      if (committed) return { ok: false, error: 'Strategy already committed; turn is closed.' };
      let noteOmissions = [];
      try {
        if (name === 'set_strategy') {
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be object');
          const mode = Object.hasOwn(args, 'mode') ? args.mode
            : Object.hasOwn(args, 'tasks') || Object.hasOwn(args, 'work') ? 'replace' : 'continue';
          validateSchema(mode, { type: 'string', enum: ['continue', 'replace'] }, 'arguments.mode');
          const { mode: _mode, ...fields } = args;
          name = mode === 'continue' ? 'continue_strategy' : 'commit_strategy';
          args = fields;
        }
        const alias = COMPACT_ALIASES.find(t => t.function.name === name);
        if (alias) {
          validateSchema(args, alias.function.parameters);
          const { subject, action, ...fields } = args;
          if (name === 'inspect') {
            name = inspectionTools[subject];
            args = { ...fields, ...(action ? { action } : {}) };
          } else {
            name = familyTools[action];
            args = fields;
          }
        }
        const definition = CITIZEN_TOOLS.find(t => t.function.name === name);
        if (!definition) throw new Error('Unknown tool.');
        args = decodeStructuredFields(args, definition.function.parameters);
        if (name === 'continue_strategy' && args && typeof args === 'object' && (Object.hasOwn(args, 'tasks') || Object.hasOwn(args, 'work'))) {
          throw new Error('continue_strategy retains the existing physical order, queue and work. To issue or change actions, use commit_strategy with your tasks/work and notes, even when your goals stay the same. To retain execution, omit tasks and work.');
        }
        // Optional notes are bounded, projected metadata, never executable
        // fields. Copying read-only counters cannot overwrite simulation state.
        if (['commit_strategy', 'continue_strategy'].includes(name) && args && typeof args === 'object') {
          args = { ...args };
          if (Array.isArray(args.communications)) args.communications = args.communications.map(message => {
            if (!message || typeof message !== 'object') return message;
            const { to, ...fields } = message;
            if (to !== undefined && fields.target !== undefined && to !== fields.target) throw new Error('A communication has conflicting to and target recipients.');
            if (to !== undefined && fields.type !== undefined && fields.type !== 'message') throw new Error('to is only valid for a private message; public posts require type:post.');
            const target = fields.target ?? to;
            // An explicit recipient unambiguously names a private reply. Never
            // infer a public post from a missing recipient or discriminator.
            return { ...fields, ...(to !== undefined ? { target } : {}),
              ...(fields.type === undefined && target !== undefined ? { type: 'message' } : {}) };
          });
          for (const [key, limit] of [['thought', 400], ['memory', 200]]) if (typeof args[key] === 'string') args[key] = args[key].trim().slice(0, limit);
          if (Array.isArray(args.goals)) args.goals = args.goals.filter(g => typeof g === 'string' && g.trim()).slice(0, 3).map(g => g.trim().slice(0, 160));
          // This is descriptive metadata, like thought/memory. A character
          // counting mistake must not block otherwise valid physical work.
          // Keep identity/status and every executable field strictly checked.
          if (args.assessment && typeof args.assessment.reason === 'string') {
            const original = args.assessment.reason;
            let reason = original.trim();
            if (reason.length > 160) {
              reason = reason.slice(0, 159).trimEnd();
              const boundary = reason.lastIndexOf(' ');
              if (boundary >= 120) reason = reason.slice(0, boundary);
              noteOmissions = [{ field: 'assessment.reason', omittedCharacters: original.length - reason.length }];
              reason += '…';
            }
            args.assessment = { ...args.assessment, reason };
          }
          if (args.undertaking && typeof args.undertaking === 'object') args.undertaking = Object.fromEntries(['objective', 'success', 'status'].filter(key => Object.hasOwn(args.undertaking, key)).map(key => [key, args.undertaking[key]]));
        }
        // An explicit empty sharing list conveys no report, just like omission.
        // It cannot reveal information or weaken nonempty-report validation.
        const normalizeShares = message => {
          if (!message || typeof message !== 'object' || Array.isArray(message)) return message;
          return Object.fromEntries(Object.entries(message).filter(([key, value]) => !(['share', 'shareBuildings'].includes(key) && Array.isArray(value) && value.length === 0)));
        };
        if (['send_private_message', 'post_public_message'].includes(name)) args = normalizeShares(args);
        if (Array.isArray(args?.communications)) args.communications = args.communications.map(normalizeShares);
        if (Array.isArray(args?.tasks) && args.tasks.some(task => ['message', 'post'].includes(task?.type))) throw new Error('Phone replies belong in communications, alongside physical tasks, or use an immediate phone tool before the decision phase. A message is not a physical directive.');
        validateSchema(args, definition.function.parameters);
        const { world, citizen } = worldAndCitizen();
        const targets = [args.to, args.recipient, ...(args.tasks ?? []).map(task => task.target), ...(args.communications ?? []).map(task => task.target)].filter(Boolean);
        for (const target of targets) {
          if (world.dead.some(person => person.id === target || person.name === target)) {
            throw new Error(`${target} is dead. This action cannot target them; choose a living citizen or revise the action.`);
          }
        }
        const correspondence = ['send_private_message', 'post_public_message'].includes(name) ? [args] : args.communications ?? [];
        for (const message of correspondence) {
          if (message.share?.some(id => !citizen.knowledge.nodes[id])) throw new Error('share accepts only personally known resource node IDs from find_resources. Reference an offer ID in text; it is not a resource report.');
          if (message.shareBuildings?.some(id => !citizen.knowledge.buildings?.[id])) throw new Error('shareBuildings accepts only personally known building IDs from get_buildings.');
        }
        const context = planningContext(world, citizenId);
        const route = point => findPath(world, citizen, point)?.length ?? null;
        const snapshot = entry => ({ ...semanticValue(world, entry), ageTicks: world.tick - (entry.observedAt ?? world.tick),
          travelTicks: Object.hasOwn(STRUCTURES, entry.kind) ? findPath(world, citizen, entry, { range: 1 })?.length ?? null : route(entry) });
        const list = (items, limit = 8) => ({ items: items.slice(0, limit), omitted: Math.max(0, items.length - limit) });
        switch (name) {
          case 'get_context': return refresh();
          case 'get_places': return { current: areaOf(world, citizen), explanation: AREA_GUIDANCE, areas: worldAreas(world).map(id => placeInformation(world, citizen, context, id)) };
          case 'find_resources': {
            const sites = Object.values(citizen.knowledge.nodes).filter(n => n.kind === (args.resource === 'food' ? 'crop' : 'tree') && (!args.area || inArea(world, n, args.area)));
            const ranked = sites.map(n => { const travelTicks = route(n); return { id: n.id, resource: args.resource, area: areaOf(world, n), travelTicks, observedStock: n.stock,
              recheckDelayTicks: estimatedRecheckDelay(n, world.tick),
              preferenceCostTicks: travelTicks === null ? null : foragePreferenceCost(citizen, n, world.tick, travelTicks),
              observedAt: n.observedAt, ageTicks: world.tick - n.observedAt, source: n.source, ...(n.reportedBy ? { reportedBy: n.reportedBy } : {}),
              ...(n.level ? { level: n.level } : {}), yield: n.yield, regrowthTicks: n.regrowTicks, ownHistory: citizen.resourceHistory[n.id] ?? null,
              competitionPenaltyTicks: competitionPenalty(citizen, n, world.tick),
              ...(replenishmentEstimate(n, world.tick) ? { regrowthEstimate: replenishmentEstimate(n, world.tick) } : {}),
              lastSeenHarvesters: context.contacts.filter(p => p.observedActivity?.type === 'harvesting' && p.observedActivity.target === n.id)
                .slice(0, 4).map(p => ({ id: p.id, ageTicks: world.tick - p.observedAt })) }; })
              .sort((a, b) => ((args.rank === 'distance' ? a.travelTicks : a.preferenceCostTicks) ?? Infinity)
                - ((args.rank === 'distance' ? b.travelTicks : b.preferenceCostTicks) ?? Infinity) || a.id.localeCompare(b.id));
            return { ...list(ranked, 5), ranking: args.rank ?? 'forage', note: 'Preference cost is (max(route,recheck delay) + harvest effort + recent competition) / yield, in estimated ticks per unit. A search heuristic, not guaranteed harvest time. Dated stock, recheck at arrival; unknown sites omitted. An empty sighting is not the harvest time; its nominal cycle sets a conservative recheck delay. regrowthEstimate requires a witnessed stock drop and predicts nominal growth, not available stock. No reservation or remote live stock.' };
          }
          case 'get_people': {
            const people = context.neighbors.filter(p => !args.after || p.id > args.after)
              .filter(p => !args.area || context.contacts.some(c => c.id === p.id && inArea(world, c, args.area)))
              .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
            const page = list(people.map(person => {
            const contact = context.contacts.find(c => c.id === person.id);
            return { ...person, relationship: citizen.relationships[person.id] ?? 0, lastLocation: contact ? snapshot(contact) : null };
            }), args.limit ?? 12);
            return { ...page, nextAfter: page.omitted ? page.items.at(-1).id : null,
              note: 'Area filters use dated sightings; citizens with unknown locations are omitted from area searches.' };
          }
          case 'get_buildings': {
            const sorted = context.knownBuildings.filter(b => (args.owned === undefined || (b.ownerId === citizenId) === args.owned)
              && (!args.kind || b.kind === args.kind) && (!args.area || inArea(world, b, args.area)))
              .sort((a, b) => Number(b.ownerId === citizenId) - Number(a.ownerId === citizenId) || a.id.localeCompare(b.id));
            const index = args.after ? sorted.findIndex(b => b.id === args.after) : -1;
            if (args.after && index < 0) throw new Error('Building cursor is not in this filtered result; query its first page again.');
            const page = list(sorted.slice(index + 1).map(snapshot), args.limit ?? 8);
            return { ...page, nextAfter: page.omitted ? page.items.at(-1).id : null,
              note: 'Owned records first; use owned/kind/area filters and nextAfter. move(target:buildingId), repair, guard and attack route to remembered sites, including property alerts outside sight. Walls block everyone; owners can demolish. Unclaimed ruin walls have no citizen owner; attack clears them and returns standard salvage.' };
          }
          case 'plan_construction': return { ok: true, ...planConstruction(world, citizen, args) };
          case 'get_exchanges': {
            const offers = context.offers.filter(o => !args.after || o.id > args.after).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
            const page = list(offers.map(offer => ({ ...offer,
              ...(offer.makerId !== citizenId ? { directive: { type: 'trade', offer: offer.id }, youPay: { resource: offer.want, amount: offer.wantAmount }, youReceive: { resource: offer.give, amount: offer.giveAmount } } : {}) })), args.limit ?? 8);
            return { ...page, nextAfter: page.omitted ? page.items.at(-1).id : null, ownHistory: context.offerHistory,
              note: 'Offers are competitive escrow, not reservations for a taker. Another citizen may fill an offer before arrival. trade(offer) gathers your missing payment and routes to the maker; a separate stockpile or move is unnecessary.' };
          }
          case 'get_history': {
            if (args.publicQuery !== undefined) return publicHistory(world.board, world.tick, args);
            if (args.after !== undefined || args.limit !== undefined) return { ok: false, error: 'after/limit are for public notice search. Supply publicQuery (empty string lists all) or omit these fields for your own history.' };
            return semanticValue(world, { results: list(context.citizen.actionResults, 6), memories: list(citizen.memories.slice(-8), 8), harvesting: list(context.citizen.resourceHistory, 6), undertakings: citizen.undertakingHistory ?? [], family: context.familyProposals });
          }
          case 'get_mechanics': {
            const result = { action: args.action, rules: MECHANICS[args.action] };
            if (['equipment', 'production'].includes(args.action)) {
              const options = actionAffordances(world, citizenId, { actionTemplates: true });
              if (args.action === 'equipment') result.nextUpgrades = options.upgrades;
              else Object.assign(result, { bakeryBuild: options.bakeryBuild, baking: options.baking,
                houseBuild: { directive: { type: 'build', building: 'house' }, wood: STRUCTURES.house.wood,
                  buildTicks: STRUCTURES.house.ticks, health: STRUCTURES.house.health, occupants: 1,
                  restRecoveryMultiplier: 4, restDirective: { type: 'rest', target: 'own' }, note: 'One owner occupant; bonus applies only inside, does not stack. Builds gather missing wood.' } });
              result.note = options.note;
            }
            return result;
          }
          case 'send_private_message': {
            const { to, ...fields } = args;
            return transactCitizenAction(world, citizenId, { type: 'message', target: to, ...fields }, planId);
          }
          case 'post_public_message': return transactCitizenAction(world, citizenId, { type: 'post', ...args }, planId);
          case 'open_offer': {
            const { replaceOfferId, ...terms } = args;
            const currentOffer = world.offers.find(o => o.makerId === citizenId && o.status === 'open');
            if (currentOffer?.id !== replaceOfferId) return { ok: false,
              error: currentOffer ? `You already have open offer ${currentOffer.id}. Keep it, or explicitly set replaceOfferId to its ID to cancel/refund it and replace it. You cannot keep both offers open.`
                : 'The offer you intended to replace is no longer open. Refresh get_exchanges before opening a new offer.',
              currentOffer: currentOffer ? structuredClone(currentOffer) : null };
            return transactCitizenAction(world, citizenId, { type: 'offer', ...terms }, planId);
          }
          case 'propose_family':
          case 'accept_family':
          case 'decline_family':
          case 'cancel_family': {
            const receipt = transactCitizenAction(world, citizenId, { type: name, ...(name === 'propose_family' ? { target: args.to } : { proposal: args.proposalId }),
              ...(args.location !== undefined ? { location: args.location } : {}) }, planId);
            if (receipt.ok && reviewedContext) {
              reviewedContext.familyProposals = receipt.family;
              reviewedContext.citizen.familyRevision = citizen.familyRevision ?? 0;
            }
            return { ...receipt, familyConsent: consentInformation(receipt.family ?? context.familyProposals, citizenId, world.tick) };
          }
          case 'continue_strategy':
          case 'commit_strategy': {
            const changes = changesSinceReview(context);
            // A family lifecycle change does not invalidate independent
            // physical work. Reproduction still requires explicit review and
            // live consent; the unreviewed revision requests a later review.
            const mode = name === 'continue_strategy' ? 'continue' : 'replace';
            const independentWork = mode === 'replace' && (args.tasks?.length || args.work)
              && !args.tasks?.some(task => task.type === 'reproduce');
            const foodResponse = immediateFoodWork({ ...args, mode }, citizen);
            const defenseResponse = defenseCoversNewViolence({ ...args, mode }, citizen, reviewedContext, context);
            const unrelatedMail = !mailAffectsPlan({ ...args, mode }, citizen, reviewedContext, context);
            const blockers = changes.filter(change => !(change.kind === 'family' && independentWork)
              && !(change.kind === 'death' && (independentWork || foodResponse))
              && !(change.kind === 'survival' && foodResponse)
              && !(change.kind === 'violence' && defenseResponse)
              && !(change.kind === 'mail' && unrelatedMail));
            if (blockers.length) return { ok: false, error: `${blockers.map(c => c.message).join('; ')}. Review the attached context and decide again.`, context: refresh() };
            if (args.work) {
              const required = { gather: ['resource'], bake: ['target'], guard: ['target'] }[args.work.type] ?? [];
              for (const key of required) if (!Object.hasOwn(args.work, key)) throw new Error(`work.${key} is required for ${args.work.type}.`);
            }
            const raw = { reviewAfter: 600, ...args, mode, tasks: (args.tasks ?? []).map((t, index) => {
              try { return compileTask(world, citizen, t); }
              catch (error) { error.message = `tasks[${index}] (${t.type}): ${error.message}`; throw error; }
            }),
              ...(mode === 'replace' && args.work === undefined ? { work: null } : {}) };
            const plan = normalizePlan(raw, context);
            // Dry validation is atomic and also catches unknown targets before
            // the turn ends. Real application remains simulation-owned.
            applyPlan(structuredClone(world), citizenId, plan);
            const unreviewedChanges = changes.filter(c => !blockers.includes(c)).map(c => c.kind);
            committed = { plan, reviewContext: reviewedContext, unreviewedChanges };
            return { ok: true, status: 'committed', tick: world.tick, mode: plan.mode, tasks: semanticValue(world, plan.tasks), work: semanticValue(world, plan.work),
              ...(noteOmissions.length ? { noteOmissions, metadataNote: 'The descriptive reason was shortened; its ending is omitted. No executable field or assessment status was changed.' } : {}),
              ...(unreviewedChanges.length ? { unreviewedChanges, note: 'Valid selected work can proceed. Changed evidence remains unreviewed and requests follow-up; relevant mail, failed directives and completed actions still require review.' } : {}),
              notes: { thought: plan.thought, goals: plan.goals, memory: plan.memory } };
          }
        }
      } catch (error) {
        const result = { ok: false, error: error.message };
        const index = error.message.match(/^(?:arguments\.)?tasks\[(\d+)\]/)?.[1];
        const variant = index !== undefined && task.oneOf.find(v => v.properties.type.enum.includes(args?.tasks?.[index]?.type));
        if (variant) result.taskFormat = { type: variant.properties.type.enum[0],
          required: variant.required.filter(field => field !== 'type'),
          optional: Object.keys(variant.properties).filter(field => field !== 'type' && !variant.required.includes(field)),
          ...(variant.properties.minimum?.description ? { minimumMeans: variant.properties.minimum.description } : {}) };
        if (error.exchanges) result.exchanges = error.exchanges;
        if (['commit_strategy', 'continue_strategy'].includes(name)) {
          result.decisionApplied = false;
          // Report independent directive problems together. A model should not
          // spend one recovery call per bad task, and this inspection never
          // executes or silently repairs a proposed action.
          if (Array.isArray(args?.tasks)) {
            try {
              const { world, citizen } = worldAndCitizen();
              const problems = args.tasks.slice(0, 4).flatMap((input, index) => {
                const errors = [];
                try { validateSchema(input, task, `arguments.tasks[${index}]`); } catch (failure) { errors.push(failure.message); }
                const variant = task.oneOf.find(v => v.properties.type.enum.includes(input?.type));
                if (variant) {
                  try { compileTask(world, citizen, input); } catch (failure) {
                    if (!errors.includes(failure.message)) errors.push(failure.message);
                    if (failure.exchanges) result.exchanges ??= failure.exchanges;
                  }
                }
                return errors.length ? [{ index, ...(variant ? { type: input.type,
                  required: variant.required.filter(field => field !== 'type'),
                  optional: Object.keys(variant.properties).filter(field => field !== 'type' && !variant.required.includes(field)) } : {}), errors }] : [];
              });
              if (problems.length) result.taskProblems = problems;
            } catch { /* Citizen/world cancellation keeps the original rejection. */ }
          }
        }
        // Character counting is mechanical. Supply a valid draft rather than
        // making the model guess at several near-limit rewrites. No send occurs
        // until the model reviews and explicitly retries this argument.
        if (['send_private_message', 'post_public_message'].includes(name)
            && error.message.startsWith('arguments.text length') && typeof args?.text === 'string' && args.text.length > 500) {
          let draft = args.text.slice(0, 499).trimEnd();
          const boundary = draft.lastIndexOf(' ');
          if (boundary >= 350) draft = draft.slice(0, boundary);
          result.suggestedArguments = { ...args, text: `${draft}…` };
          result.note = 'This shortened draft omits the ending. Review or rewrite its meaning before explicitly retrying; nothing was sent or charged.';
        }
        return result;
      }
    },
  };
}
