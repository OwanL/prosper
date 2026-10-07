import { equipmentLevel, equipmentSpec, craftRequirement } from './equipment.mjs';
import { recordAudit } from './audit.mjs';
import { citizenProfile } from './citizen-profile.mjs';
import { ROCK_TILES, createRuins } from './terrain.mjs';
import { validArea, inArea, CENTER, RESOURCE_RINGS } from './places.mjs';
import { isDeepStrictEqual } from 'node:util';
import { normalizeUndertaking, normalizeAssessment, assessUndertaking, setUndertaking, recordUndertakingAction } from './undertaking.mjs';
import { familyContext, acceptedFamily } from './family.mjs';
import { ownInteractionRequirements } from './action-requirements.mjs';
import { findPath, isWalkable } from './pathfinding.mjs';
import { recordMotion } from './motion.mjs';
import { competitionPenalty, visiblyOccupied, observedHarvesterCount, foragePreferenceCost } from './foraging.mjs';
import { estimatedRecheckDelay } from './replenishment.mjs';
import { captureStrategyBaseline } from './strategy-progress.mjs';
import { resolveInteraction, tickInteractions, killCitizen } from './interactions.mjs';
import { resolveBuilding } from './buildings.mjs';
import { STRUCTURES, structureId, wallTile, houseRestMultiplier } from './structures.mjs';
import { observeWorld, knownDeposits, knownPeople, canSee, shareKnowledge, shareKnowledgeWith, reportLocation, explorationTarget,
  knownBuildings as knownBuildingSnapshots, shareBuildings, shareBuildingsWith } from './knowledge.mjs';
import { NODE_SEEDS, GRADED_NODE_SEEDS, economyForNodes, CRAFT_COSTS, FOOD_HARVEST_TICKS, WOOD_HARVEST_TICKS,
  ADULT_HUNGER_PER_TICK, CHILD_HUNGER_PER_TICK, STARVATION_DAMAGE_PER_TICK,
  BAKERY_COST, BUILD_TICKS, BAKE_TICKS, REPAIR_TICKS, BREAD_NUTRITION } from './economy.mjs';

const SEEDS = [
  { id: 'citizen-1', name: 'Mira', color: '#e76f51', x: 2, y: 2, food: 4, wood: 5, personality: 'curious, sociable, interested in raising a family', goals: ['Build a prosperous, independent household', 'Raise a thriving multigenerational family'] },
  { id: 'citizen-2', name: 'Oren', color: '#2a9d8f', x: 13, y: 2, food: 2, wood: 20, personality: 'practical, self-interested, cautious about shortages', goals: ['Run a profitable enterprise', 'Build wealth through production and exchange'] },
  { id: 'citizen-3', name: 'Lio', color: '#457b9d', x: 2, y: 7, food: 4, wood: 0, personality: 'generous, values relationships and a growing family', goals: ['Grow an enduring family tree', 'Build a lasting support network'] },
  { id: 'citizen-4', name: 'Sela', color: '#9b5de5', x: 13, y: 7, food: 2, wood: 15, personality: 'independent, competitive, values personal security', goals: ['Build lasting influence', 'Secure independence on my own terms'] },
];
const OUTER_SEEDS = [
  { id: 'citizen-5', name: 'Neri', color: '#bf6f93', x: 1, y: 1, food: 4, wood: 5, personality: 'outgoing, resourceful, values reciprocity', goals: ['Build a trusted network of trading partners', 'Raise a secure and welcoming household'] },
  { id: 'citizen-6', name: 'Bram', color: '#ae8742', x: 18, y: 1, food: 2, wood: 20, personality: 'opportunistic, domineering, comfortable with intimidation and violence for material gain; bargains when profitable and avoids fights he expects to lose', goals: ['Accumulate wealth and power, including at others\' expense', 'Make others depend on or yield to me through bargaining, threats or force'] },
  { id: 'citizen-7', name: 'Tavi', color: '#638b48', x: 1, y: 14, food: 4, wood: 0, personality: 'neutral, pragmatic, emotionally reserved; prefers fair transactions to allegiance and avoids other people\'s feuds unless personal interests are at stake', goals: ['Build an independent, reliable livelihood', 'Preserve freedom to deal with whoever offers useful terms'] },
  { id: 'citizen-8', name: 'Edda', color: '#6876b0', x: 18, y: 14, food: 2, wood: 15, personality: 'explicitly territorial, proud and biased toward hostility: treats encroachment and challenges as reasons to threaten, exclude or attack; weighs the cost of force, respects strength and welcomes useful alliances with partners who honor her boundaries', goals: ['Establish and defend territory that supports my independence', 'Build alliances that strengthen my position and make encroachment costly'] },
];
const STAT_COUNTERS = ['built', 'baked', 'buildingAttacks', 'destroyed'];
// Stable-ID aspiration seeds: upgradeWorld translates only these exact legacy
// arrays to their stronger successors and preserves every custom aspiration.
const STRONGER_ASPIRATIONS = Object.fromEntries(SEEDS.map((seed) => [seed.id, seed.goals]));
const SEED_ASPIRATIONS = {
  'citizen-1': ['Build a secure food reserve', 'Consider a family when resources permit'],
  'citizen-2': ['Become an efficient producer', 'Exchange surplus for what I need'],
  'citizen-3': ['Keep myself and my dependents fed', 'Find a willing partner if sustainable'],
  'citizen-4': ['Secure enough resources for myself', 'Decide how to respond to competition'],
};
const GUARD_RECALL_TICKS = 12;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const person = (world, id) => world.citizens.find((c) => c.id === id);
const resource = (name) => name === 'food' || name === 'wood';
const consumable = (name) => resource(name) || name === 'bread';
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const exact = (obj, keys) => obj && typeof obj === 'object' && !Array.isArray(obj)
  && Reflect.ownKeys(obj).length === keys.length && keys.every((key) => Object.hasOwn(obj, key));

function makeCitizen(seed) {
  return {
    hunger: 25, energy: 85, tool: false, memories: [], tasks: [], current: null,
    status: 'idle', thought: '', planCount: 0, lastError: null, health: 100, alive: true,
    weapon: false, weaponDurability: 0, bornAt: null, adult: true, parents: [],
    familyReady: false, reproduceAfter: 0, relationships: {}, routine: { family: false },
    work: null, incidents: [], actionResults: [], bread: 0,
    shoes: false, movementCredit: 0, knowledge: { nodes: {}, explored: [] }, resourceHistory: {},
    gatherTarget: null, exploreTarget: null,
    reviewAt: 0, lastPlanTick: null, replanReason: 'initial decision', planning: false,
    path: [], order: null, activity: 'Awaiting first strategy', ...seed,
    aspirations: [...(seed.aspirations ?? seed.goals)], goals: [...seed.goals],
  };
}

export function createWorld({ expanded = true } = {}) {
  // Explicit classic layout keeps historical scenario fixtures reproducible.
  const seeds = expanded ? [...SEEDS.map(c => ({ ...c, x: c.x + 2, y: c.y + 3 })), ...OUTER_SEEDS] : SEEDS;
  const nodes = expanded ? GRADED_NODE_SEEDS : NODE_SEEDS;
  const ruins = expanded ? createRuins() : [];
  const world = {
    tick: 0, width: expanded ? 20 : 16, height: expanded ? 16 : 10,
    ...(expanded ? { center: { ...CENTER }, rings: RESOURCE_RINGS.map(r => ({ ...r })) } : {}),
    blocked: expanded ? ROCK_TILES.map(([x, y]) => ({ x, y })) : [0, 1, 2, 3, 5, 6, 7, 8].map(y => ({ x: 8, y })),
    citizens: seeds.map(makeCitizen), dead: [],
    nodes: nodes.map((node) => ({ ...node, stock: node.capacity, regrowIn: 0 })),
    board: [], messages: [], events: [], offers: [], nextOfferId: 1, nextCitizenId: seeds.length + 1, nextEventId: 1, nextMessageId: 1,
    buildings: ruins, nextBuildingId: ruins.length + 1, familyProposals: [], nextFamilyId: 1,
    stats: { harvestedFood: 0, harvestedWood: 0, messages: 0, transfers: 0, crafted: 0, trades: 0, births: 0, deaths: 0, attacks: 0, weapons: 0,
      built: 0, baked: 0, buildingAttacks: 0, destroyed: 0 },
    economy: economyForNodes(nodes),
  };
  for (const citizen of world.citizens) observeWorld(world, citizen);
  return world;
}

export function recordEvent(world, text, citizenId) {
  const event = { id: `event-${world.nextEventId++}`, tick: world.tick, text: text.slice(0, 400), ...(citizenId ? { citizenId } : {}) };
  world.events.push(event);
  world.events = world.events.slice(-80);
  recordAudit(world.audit, { type: 'world_event', ...event });
  return event;
}
function remember(citizen, text) {
  if (text.trim()) citizen.memories = [...citizen.memories, text.slice(0, 200)].slice(-8);
}
function effectsFor(world) {
  return {
    event: (text, id) => recordEvent(world, text, id), remember,
    createChild(parent, partner) {
      const number = world.nextCitizenId++;
      const profile = citizenProfile(`citizen-${number}`);
      const child = makeCitizen({
        id: `citizen-${number}`, name: `Sprig ${number}`, color: parent.color,
        x: parent.x, y: parent.y, food: 2, wood: 0, adult: false, bornAt: world.tick,
        parents: [parent.id, partner.id], personality: `${profile.personality} Raised by ${parent.name} and ${partner.name}.`,
        aspirations: profile.aspirations,
        goals: ['Grow safely', 'Find enough food'], activity: 'Following family',
      });
      world.citizens.push(child);
      return child;
    },
  };
}

function string(value, max, empty = false) {
  return typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0);
}
function taskShape(task, required, optional = []) {
  return task && typeof task === 'object' && !Array.isArray(task)
    && required.every((key) => Object.hasOwn(task, key))
    && Reflect.ownKeys(task).every((key) => required.includes(key) || optional.includes(key));
}
function validShares(citizen, shares) {
  return shares === undefined || (Array.isArray(shares) && integer(shares.length, 1, 4)
    && new Set(shares).size === shares.length && shares.every((id) => knownDeposits(citizen).some((n) => n.id === id)));
}
function validBuildingShares(citizen, shares) {
  return shares === undefined || (Array.isArray(shares) && integer(shares.length, 1, 4)
    && new Set(shares).size === shares.length && shares.every(validBuildingMemory(citizen)));
}
function validBuildingMemory(citizen) {
  return (id) => {
    const memory = citizen.knowledge?.buildings?.[id];
    return !!memory && memory.id === id && typeof memory.kind === 'string';
  };
}
function knownBuildingMemory(citizen, id) {
  const memory = citizen.knowledge?.buildings?.[id];
  return !!memory && memory.id === id && typeof memory.kind === 'string' ? memory : null;
}
function knownShares(citizen, store, id) {
  const memory = citizen.knowledge?.[store]?.[id];
  return !!memory && memory.id === id && typeof memory.kind === 'string';
}
// A building may be attacked when the citizen knows it from a snapshot or sees
// it directly; unseen locations are never targetable and validation has no side effects.
function targetableBuilding(world, citizen, id) {
  if (!structureId(id)) return null;
  const memory = knownBuildingMemory(citizen, id);
  if (memory) return memory;
  const building = (world.buildings ?? []).find((entry) => entry?.id === id);
  return building && canSee(world, citizen, building) ? building : null;
}
function validateTask(world, citizen, task, maxMessageChars = 200) {
  const target = () => typeof task.target === 'string' && task.target !== citizen.id && !!person(world, task.target);
  let valid = false;
  switch (task?.type) {
    case 'construct': valid = exact(task, ['type', 'plan']) && typeof task.plan === 'string'
      && citizen.constructionPlans?.[task.plan]?.id === task.plan; break;
    case 'gather': valid = taskShape(task, ['type', 'resource', 'amount'], ['target', 'camp', 'area', 'maxTicks'])
      && resource(task.resource) && integer(task.amount, 1) && (task.maxTicks === undefined || integer(task.maxTicks, 1, 600))
      && (task.camp === undefined || typeof task.camp === 'boolean') && (!task.camp || typeof task.target === 'string')
      && (task.area === undefined || validArea(task.area))
      && (task.target === undefined || knownDeposits(citizen).some((n) => n.id === task.target && n.kind === (task.resource === 'food' ? 'crop' : 'tree'))); break;
    case 'acquire': valid = taskShape(task, ['type', 'resource', 'quantity'], ['area']) && resource(task.resource)
      && integer(task.quantity, 1) && (task.area === undefined || validArea(task.area)); break;
    case 'explore': valid = taskShape(task, ['type', 'ticks'], ['area']) && integer(task.ticks, 1, 600)
      && (task.area === undefined || validArea(task.area)); break;
    case 'move': valid = taskShape(task, ['type', 'x', 'y'], ['range']) && (task.range === undefined || task.range === 1)
      && integer(task.x, 0) && integer(task.y, 0) && task.x < world.width && task.y < world.height
      && (task.range === 1 || isWalkable(world, task.x, task.y, citizen)); break;
    case 'approach': valid = taskShape(task, ['type', 'target'], ['area']) && target()
      && (task.area === undefined || validArea(task.area)); break;
    case 'craft': valid = taskShape(task, ['type', 'item'], ['level']) && (task.level === undefined || integer(task.level, 1, 3)) && Object.hasOwn(CRAFT_COSTS, task.item); break;
    case 'post': valid = taskShape(task, ['type', 'text'], ['share', 'shareBuildings']) && string(task.text, maxMessageChars)
      && validShares(citizen, task.share) && validBuildingShares(citizen, task.shareBuildings); break;
    case 'message': valid = taskShape(task, ['type', 'target', 'text'], ['share', 'location', 'shareBuildings'])
      && target() && string(task.text, maxMessageChars) && validShares(citizen, task.share) && validBuildingShares(citizen, task.shareBuildings)
      && (task.location === undefined || typeof task.location === 'boolean'); break;
    case 'give': valid = exact(task, ['type', 'target', 'resource', 'amount']) && target() && consumable(task.resource) && integer(task.amount, 1); break;
    case 'offer': valid = (exact(task, ['type', 'give', 'giveAmount', 'want', 'wantAmount']) || exact(task, ['type', 'give', 'giveAmount', 'want', 'wantAmount', 'recipient']))
      && consumable(task.give) && consumable(task.want) && (task.give !== task.want || task.wantAmount === 0)
      && integer(task.giveAmount, 1) && integer(task.wantAmount, 0)
      && (task.recipient == null || (task.recipient !== citizen.id && !!person(world, task.recipient))); break;
    case 'trade': valid = exact(task, ['type', 'offer']) && typeof task.offer === 'string' && world.offers.some((o) => o.id === task.offer); break;
    case 'attack': valid = exact(task, ['type', 'target']) && (targetableBuilding(world, citizen, task.target)
      || (target() && person(world, task.target).adult)); break;
    case 'propose_family': valid = taskShape(task, ['type', 'target'], ['location']) && target() && person(world, task.target).adult
      && (task.location === undefined || typeof task.location === 'boolean'); break;
    case 'accept_family': valid = taskShape(task, ['type', 'proposal'], ['location']) && typeof task.proposal === 'string'
      && familyContext(world, citizen.id).some((p) => p.id === task.proposal && p.recipientId === citizen.id)
      && (task.location === undefined || typeof task.location === 'boolean'); break;
    case 'decline_family':
    case 'cancel_family': valid = exact(task, ['type', 'proposal']) && typeof task.proposal === 'string'
      && familyContext(world, citizen.id).some((p) => p.id === task.proposal); break;
    case 'reproduce': valid = exact(task, ['type', 'target']) && target() && person(world, task.target).adult; break;
    case 'build': valid = taskShape(task, ['type', 'building', 'x', 'y'], task.building === 'wall' ? ['length', 'axis'] : [])
      && Object.hasOwn(STRUCTURES, task.building) && integer(task.x, 0) && integer(task.y, 0)
      && (task.length === undefined || integer(task.length, 1, 6)) && (task.axis === undefined || ['horizontal', 'vertical'].includes(task.axis))
      && Array.from({ length: task.length ?? 1 }, (_, i) => wallTile(task, i)).every(p => isWalkable(world, p.x, p.y)); break;
    case 'bake': valid = exact(task, ['type', 'target', 'amount'])
      && (task.target === 'own' || knownBuildingMemory(citizen, task.target))
      && integer(task.amount, 1); break;
    case 'repair': valid = exact(task, ['type', 'target']) && knownBuildingMemory(citizen, task.target) !== null; break;
    case 'guard': valid = exact(task, ['type', 'target', 'ticks']) && integer(task.ticks, 1, 600)
      && knownBuildingMemory(citizen, task.target) !== null; break;
    case 'rest': valid = taskShape(task, ['type'], ['target']) && (task.target === undefined || task.target === 'own'
      || (knownBuildingMemory(citizen, task.target)?.kind === 'house' && knownBuildingMemory(citizen, task.target)?.ownerId === citizen.id)); break;
    case 'wait': valid = exact(task, ['type', 'ticks']) && integer(task.ticks, 1, 120); break;
  }
  if (!valid) throw new Error(`Invalid ${task?.type ?? 'unknown'} order: check its fields, bounds, and target.`);
  return { ...task, ...(task.share ? { share: [...task.share] } : {}),
    ...(task.shareBuildings ? { shareBuildings: [...task.shareBuildings] } : {}) };
}

const CANONICAL_PLAN_KEYS = ['thought', 'goals', 'memory', 'routine', 'work', 'reviewAfter', 'tasks'];
const LEGACY_PLAN_KEYS = ['thought', 'goals', 'memory', 'routine', 'reviewAfter', 'tasks'];
function validateWork(world, citizen, work, require) {
  if (work === null) return null;
  if (!work || typeof work !== 'object' || Array.isArray(work)) { require(false, 'work must be null or a policy object.'); return null; }
  switch (work.type) {
    case 'gather': {
      require(taskShape(work, ['type', 'resource'], ['target', 'camp', 'area']), 'gather work has resource, optional known node target, camp and area.');
      require(work.area === undefined || validArea(work.area), 'unknown work area.');
      require(resource(work.resource), 'gather work resource must be food or wood.');
      require(work.camp === undefined || typeof work.camp === 'boolean', 'gather work camp must be boolean.');
      if (work.camp === true) require(typeof work.target === 'string', 'camping gather work requires a node target.');
      if (work.target !== undefined) require(typeof work.target === 'string'
        && knownDeposits(citizen).some((node) => node.id === work.target && node.kind === (work.resource === 'food' ? 'crop' : 'tree')),
      'gather work target must be a known node of that resource.');
      return { ...work };
    }
    case 'bake':
      require(exact(work, ['type', 'target']) && (work.target === 'own' || knownBuildingMemory(citizen, work.target)), 'bake work targets the own bakery or a known bakery.');
      return { ...work };
    case 'guard':
      require(exact(work, ['type', 'target']) && knownBuildingMemory(citizen, work.target) !== null, 'guard work targets a known building.');
      return { ...work };
    case 'explore':
    case 'rest':
      require(exact(work, ['type']), `${work.type} work has no fields.`);
      return { ...work };
    default:
      require(false, `unknown work policy '${work.type}'.`);
      return null;
  }
}

export function interruptForMessage(citizen, messageId) {
  if (!citizen.alive || !citizen.adult) return;
  citizen.pendingMessageId = messageId;
  citizen.replanReason = 'private message received';
  if (citizen.asyncReview) return;
  if (citizen.current && ['need', 'care'].includes(citizen.current.purpose)) return;
  citizen.current = null;
  citizen.path = [];
  citizen.movementCredit = 0;
  citizen.activity = 'Reviewing a private message';
}

export function applyPlan(world, citizenId, plan) {
  const citizen = person(world, citizenId);
  if (!citizen?.alive || !citizen.adult) throw new Error('Only a living adult can receive a strategy.');
  const require = (condition, message) => { if (!condition) throw new Error(`Invalid strategic plan: ${message}`); };
  const record = !!plan && typeof plan === 'object' && !Array.isArray(plan);
  const hasWork = record && Object.hasOwn(plan, 'work');
  const hasUndertaking = record && Object.hasOwn(plan, 'undertaking');
  const hasAssessment = record && Object.hasOwn(plan, 'assessment');
  const hasCommunications = record && Object.hasOwn(plan, 'communications');
  const hasMode = record && Object.hasOwn(plan, 'mode');
  const planKeys = keys => [...keys, ...(hasUndertaking ? ['undertaking'] : []), ...(hasAssessment ? ['assessment'] : []), ...(hasCommunications ? ['communications'] : []), ...(hasMode ? ['mode'] : [])];
  require(!hasMode || ['continue', 'replace'].includes(plan.mode), 'mode must be continue or replace.');
  const continuing = plan?.mode === 'continue';
  const legacyRoutine = !hasWork && record && !!plan.routine && typeof plan.routine === 'object'
    && !Array.isArray(plan.routine) && (Object.hasOwn(plan.routine, 'food') || Object.hasOwn(plan.routine, 'wood'));
  require(record && (hasWork ? exact(plan, planKeys(CANONICAL_PLAN_KEYS))
    : legacyRoutine ? exact(plan, planKeys(LEGACY_PLAN_KEYS))
    : exact(plan, planKeys(LEGACY_PLAN_KEYS.filter((key) => key !== 'work')))), 'expected thought, goals, memory, routine, optional work/undertaking, reviewAfter, tasks only.');
  require(string(plan.thought, 400, true), 'thought must be a string of at most 400 characters.');
  require(string(plan.memory, 200, true), 'memory must be a string of at most 200 characters.');
  require(Array.isArray(plan.goals) && integer(plan.goals.length, 1, 3) && plan.goals.every((g) => string(g, 160)), 'goals must have 1–3 nonempty strings of at most 160 characters.');
  if (legacyRoutine) {
    require(exact(plan.routine, ['food', 'wood', 'family']), 'legacy routine requires food, wood, family only.');
    require(integer(plan.routine.food, 0) && integer(plan.routine.wood, 0) && typeof plan.routine.family === 'boolean', 'legacy reserve targets must be nonnegative safe integers, with boolean family consent.');
    // Accept old direct callers, but discard their retired reserve fields.
  } else {
    require(exact(plan.routine, ['family']), 'routine requires family consent only.');
    require(typeof plan.routine.family === 'boolean', 'routine family consent must be boolean.');
  }
  require(integer(plan.reviewAfter, 180, 600), 'reviewAfter must be an integer from 180 to 600.');
  require(Array.isArray(plan.tasks) && integer(plan.tasks.length, legacyRoutine ? 1 : 0, 4), 'tasks must contain up to 4 strategic orders.');
  const tasks = plan.tasks.map((task) => validateTask(world, citizen, task));
  const tradeIds = tasks.filter(task => task.type === 'trade').map(task => task.offer);
  require(new Set(tradeIds).size === tradeIds.length, 'each offer can be accepted once.');
  if (hasCommunications) require(Array.isArray(plan.communications) && plan.communications.length <= 2, 'communications requires 0–2 messages/posts.');
  const communications = hasCommunications ? plan.communications.map(task => {
    require(['message', 'post'].includes(task?.type), 'communications supports message and post only.');
    return validateTask(world, citizen, task, 500);
  }) : undefined;
  // Validate the chosen work before any effect: an explicit null is allowed, a
  // missing work key preserves the current policy, and nothing is invented.
  const work = hasWork ? validateWork(world, citizen, plan.work, require) : undefined;
  const undertaking = hasUndertaking ? normalizeUndertaking(plan.undertaking) : undefined;
  const assessment = hasAssessment ? normalizeAssessment(plan.assessment) : undefined;
  if (hasAssessment) {
    require(citizen.undertaking?.startedAt === assessment.startedAt, 'assessment must refer to the current undertaking startedAt.');
  }
  if (continuing) {
    require(tasks.length === 0, 'continue cannot replace tasks.');
    require(!hasWork || isDeepStrictEqual(work, citizen.work ?? null), 'continue cannot change work.');
  }
  // Validation is atomic. Effects come only from the deterministic executor, never model output.
  if (hasAssessment) assessUndertaking(citizen, assessment, world.tick);
  if (hasUndertaking) setUndertaking(citizen, undertaking, world.tick, { successor: hasAssessment });
  citizen.strategyBaseline = captureStrategyBaseline(citizen, world.tick);
  citizen.thought = plan.thought;
  citizen.goals = [...plan.goals];
  if (plan.memory.trim()) citizen.strategyMemory = plan.memory;
  remember(citizen, plan.memory);
  citizen.routine = { family: plan.routine.family };
  citizen.familyReady = plan.routine.family;
  if (!continuing) {
    if (hasWork) citizen.work = work ? { ...work } : null;
    citizen.tasks = tasks;
    citizen.current = null;
    citizen.order = null;
    citizen.path = [];
    citizen.gatherTarget = null;
    citizen.exploreTarget = null;
    citizen.strategyReplacements = (citizen.strategyReplacements ?? 0) + 1;
  } else citizen.continuedReviews = (citizen.continuedReviews ?? 0) + 1;
  citizen.lastPlanMode = continuing ? 'continue' : 'replace';
  if (hasCommunications) { citizen.communications = communications; citizen.phone = null; }
  citizen.status = 'acting';
  citizen.planning = false;
  citizen.replanReason = null;
  delete citizen.planBlocked;
  delete citizen.pendingMessageId;
  citizen.lastPlanTick = world.tick;
  citizen.reviewAt = world.tick + plan.reviewAfter;
  citizen.planCount++;
  citizen.lastError = null;
  recordEvent(world, `${citizen.name} ${continuing ? 'continued' : 'set'} a strategy: ${citizen.goals.join('; ')}. Review after tick ${citizen.reviewAt}.`, citizen.id);
  return citizen;
}

function recordAction(world, citizen, task, failure, planId = citizen.auditPlanId) {
  if (task) {
    recordUndertakingAction(citizen, Boolean(failure));
    const result = { tick: world.tick, task: { ...task }, ...(task.type === 'gather' && task.maxTicks !== undefined ? { collected: citizen.order?.progress ?? 0, stoppedBy: failure ? 'failed' : (citizen.order?.progress ?? 0) >= task.amount ? 'amount reached' : 'time budget' } : {}), status: failure ? 'failed' : 'completed', ...(failure ? { reason: failure } : {}) };
    // Finite consequential work can finish while its replacement is being
    // reasoned about. Retain a monotonic revision and bounded evidence, separate
    // from routine harvests and synchronous tools whose receipts are already seen.
    if (!failure && !citizen.order?.work && ['give', 'trade', 'reproduce', 'craft', 'build', 'construct', 'bake', 'repair', 'attack'].includes(task.type)) {
      citizen.completedActionRevision = (citizen.completedActionRevision ?? 0) + 1;
      citizen.completedActions = [...(citizen.completedActions ?? []), { revision: citizen.completedActionRevision, ...result }].slice(-6);
    }
    const social = (item) => ['offer', 'trade', 'give', 'message', 'post', 'bake', 'build', 'repair', 'reproduce', 'attack', 'propose_family', 'accept_family', 'decline_family', 'cancel_family'].includes(item.task.type);
    const results = [...(citizen.actionResults ?? []), result];
    // Preserve consequential results even through many routine gather cycles.
    citizen.actionResults = [...results.filter(social).slice(-4), ...results.filter((item) => !social(item)).slice(-2)]
      .sort((a, b) => a.tick - b.tick);
    recordAudit(world.audit, { type: 'action_result', citizenId: citizen.id, planId, ...result });
  }
}

// Phone and escrow are logical transactions available during reasoning. They
// never replace physical work. Costs/consent/knowledge use the same validators.
export function transactCitizenAction(world, citizenId, input, planId) {
  const citizen = person(world, citizenId);
  if (!citizen?.alive || !citizen.adult) throw new Error('Only a living adult can act.');
  if (!['message', 'post', 'offer', 'propose_family', 'accept_family', 'decline_family', 'cancel_family'].includes(input?.type)) {
    throw new Error('This action requires a physical directive.');
  }
  const task = validateTask(world, citizen, input, 500);
  const replacedOffer = task.type === 'offer' ? world.offers.find(o => o.makerId === citizenId && o.status === 'open') : null;
  const result = ['message', 'post'].includes(task.type)
    ? { reason: sendCommunication(world, citizen, task) }
    : resolveInteraction(world, citizen, task, effectsFor(world));
  const failure = result.reason || (result.ok === false ? 'transaction failed' : null);
  recordAction(world, citizen, task, failure, planId);
  const receipt = task.type === 'offer' ? world.offers.findLast(o => o.makerId === citizenId && o.status === 'open')
    : task.type === 'message' ? world.messages.findLast(m => m.senderId === citizenId && m.recipientId === task.target)
    : task.type === 'post' ? world.board.at(-1)
    : world.familyProposals.findLast(p => p.makerId === citizenId || p.recipientId === citizenId);
  return { ok: !failure, tick: world.tick, ...(failure ? { error: failure } : { receiptId: receipt?.id,
    ...(task.type === 'message' ? { channel: receipt.channel, costWood: receipt.costWood } : {}),
    ...(task.type === 'offer' ? { offer: structuredClone(receipt), activeOfferId: receipt?.id,
      replacedOffer: replacedOffer ? { id: replacedOffer.id, status: 'cancelled', refunded: { resource: replacedOffer.give, amount: replacedOffer.giveAmount } } : null,
      note: replacedOffer ? `${replacedOffer.id} is cancelled and cannot be accepted. Only ${receipt?.id} is open; tell partners if their expected offer changed.` : 'This is your only open offer. It escrows goods, not a completed trade.' } : {}),
    ...(task.type.endsWith('_family') ? { family: familyContext(world, citizenId) } : {}) }),
    inventory: { food: citizen.food, wood: citizen.wood, bread: citizen.bread ?? 0 } };
}

function finishOrder(world, citizen, failure) {
  const workPolicy = citizen.order?.work === true;
  recordAction(world, citizen, citizen.order?.task, failure, citizen.order?.planId ?? citizen.auditPlanId);
  if (failure) {
    const text = `${citizen.name}'s ${citizen.order?.task.type ?? 'order'} could not finish: ${failure}.`;
    remember(citizen, `Tick ${world.tick}: ${text}`);
    recordEvent(world, text, citizen.id);
    if (workPolicy) {
      // A failed chosen work clears the policy and requests a review; nothing repeats the failure.
      citizen.work = null;
      citizen.replanReason = 'chosen work failed';
    } else {
      citizen.replanReason = 'order failed';
      citizen.planBlocked = failure;
    }
  }
  if (!failure && citizen.asyncReview && !workPolicy) {
    const type = citizen.order?.task.type;
    if (!citizen.tasks.length && type !== 'wait') citizen.replanReason = 'planned steps complete';
    else if (['give', 'trade', 'reproduce', 'craft', 'build', 'construct', 'bake', 'repair', 'attack'].includes(type)) citizen.replanReason = 'milestone completed';
  }
  // Review concrete milestones while remaining tasks and chosen work continue.
  citizen.order = null;
  citizen.current = null;
  citizen.path = [];
  citizen.gatherTarget = null;
  citizen.activity = failure ? 'Order stopped' : 'Order complete';
}
function start(citizen, task, total, purpose = 'order') {
  const effortKey = purpose === 'order' && citizen.order && ['build', 'craft', 'bake', 'repair'].includes(task.type) ? JSON.stringify(task) : null;
  if (effortKey && citizen.order.effort?.key !== effortKey) citizen.order.effort = { key: effortKey, ticks: 0 };
  citizen.current = { task, remaining: total - (effortKey ? citizen.order.effort.ticks : 0), total, purpose, ...(effortKey ? { effortKey } : {}) };
  citizen.status = 'acting';
}
function travel(world, citizen, goal, range = 0, purpose = 'travel') {
  const path = findPath(world, citizen, goal, { range });
  citizen.path = path ?? [];
  if (path === null) return 'blocked';
  if (!path.length) return 'arrived';
  start(citizen, { type: 'move', x: goal.x, y: goal.y }, 1, purpose);
  return 'moving';
}
function meet(world, citizen, target, purpose = 'travel') {
  // Citizen navigation is global. Recompute the route on each movement step,
  // without adding remote position or private state to personal observations.
  if (citizen.order) delete citizen.order.contactSearch; // Old checkpoint compatibility.
  return travel(world, citizen, target, 1, purpose);
}
function advanceMovement(world, citizen) {
  citizen.movementCredit = (citizen.movementCredit ?? 0) + (equipmentSpec(citizen, 'shoes')?.speed ?? 1);
  let steps = Math.floor(citizen.movementCredit + 1e-9);
  const availableSteps = Math.min(steps, citizen.path.length);
  let moved = 0;
  citizen.movementCredit = Math.max(0, citizen.movementCredit - steps);
  while (steps-- > 0 && citizen.path.length) {
    const next = citizen.path.shift();
    if (!isWalkable(world, next.x, next.y, citizen) || distance(citizen, next) !== 1) { citizen.path = []; break; }
    const site = citizen.gatherTarget && citizen.knowledge.nodes[citizen.gatherTarget.nodeId];
    if (site && distance(citizen, site) === 0) citizen.gatherTarget.visited = false;
    const previous = { x: citizen.x, y: citizen.y };
    citizen.x = next.x; citizen.y = next.y;
    recordMotion(citizen, previous, world.tick - 1 + ++moved / Math.max(1, availableSteps));
    observeWorld(world, citizen);
  }
  if (!citizen.path.length) citizen.movementCredit = 0;
  citizen.current = null;
}
function outcome(citizen, nodeId) {
  citizen.resourceHistory ??= {};
  return citizen.resourceHistory[nodeId] ??= { visits: 0, emptyVisits: 0, lostRaces: 0, harvested: 0, waitTicks: 0, lastOutcomeAt: 0 };
}
function explore(world, citizen, area = null) {
  const target = citizen.exploreTarget;
  if (!target || (area && !inArea(world, target, area)) || citizen.knowledge.explored.includes(`${target.x},${target.y}`)) citizen.exploreTarget = explorationTarget(world, citizen, area);
  citizen.activity = 'Exploring';
  if (!citizen.exploreTarget) { citizen.activity = 'Exploration complete'; start(citizen, { type: 'wait', ticks: 5 }, 5, 'routine'); return false; }
  return travel(world, citizen, citizen.exploreTarget) !== 'blocked';
}
function bakerySnapshot(citizen, target) {
  const knowledge = citizen.knowledge?.buildings ?? {};
  if (target === 'own') {
    // Self-known selection from private snapshots: the nearest owned bakery, never a live remote oracle.
    return Object.values(knowledge).filter((entry) => entry?.id && entry.kind === 'bakery' && entry.health > 0 && entry.ownerId === citizen.id)
      .sort((a, b) => (distance(a, citizen) - distance(b, citizen)) || (a.id < b.id ? -1 : 1))[0] ?? null;
  }
  const memory = knowledge[target];
  return memory?.id === target && Object.hasOwn(STRUCTURES, memory.kind) ? memory : null;
}
function recordWitnesses(world, attacker, target, kind) {
  if (!attacker || !target) return;
  const isBuilding = structureId(target.id);
  const label = isBuilding
    ? `${attacker.name} struck the ${target.kind} ${target.id}.`
    : `${attacker.name} struck ${target.name ?? target.id}.`;
  for (const witness of world.citizens) {
    if (!witness?.alive) continue;
    if (!canSee(world, witness, attacker) || !canSee(world, witness, target)) continue;
    // The owner already received an exact property alert from resolveBuilding.
    if (isBuilding && witness.id === target.ownerId && witness.id !== attacker.id) continue;
    witness.incidents = [...(witness.incidents ?? []), {
      tick: Number.isFinite(world.tick) ? world.tick : 0,
      attackerId: attacker.id, targetId: target.id, kind, x: target.x, y: target.y,
      ...(isBuilding ? { attackerName: attacker.name, source: 'seen' } : {}),
    }].slice(-8);
    witness.replanReason = 'witnessed violence';
    recordEvent(world, `Tick ${world.tick}: ${label}`, witness.id);
    remember(witness, `Tick ${world.tick}: ${label}`);
  }
}
function witnessedThreat(world, citizen, site, targetId) {
  for (let index = (citizen.incidents ?? []).length - 1; index >= 0; index -= 1) {
    const incident = citizen.incidents[index];
    if (!Number.isFinite(incident?.tick) || world.tick - incident.tick > GUARD_RECALL_TICKS) break;
    if (incident.kind !== 'building' && incident.kind !== 'citizen') continue;
    if (incident.attackerId === citizen.id || (targetId && incident.attackerId !== targetId)) continue;
    const attacker = world.citizens.find((entry) => entry.id === incident.attackerId);
    if (!attacker || !attacker.adult || !canSee(world, citizen, attacker)) continue;
    if (distance(attacker, site) > 2) continue;
    if (incident.kind === 'building') {
      if (incident.targetId !== site.id) continue;
    } else {
      // The witnessed place, not a remote victim's current whereabouts or survival.
      if (distance(incident, site) > 2) continue;
    }
    return attacker;
  }
  return null;
}
function gather(world, citizen, kind, purpose, routingTarget) {
  const gatherOrder = purpose === 'order' && ['gather', 'acquire'].includes(citizen.order?.task.type) ? citizen.order : null;
  const area = gatherOrder?.task.area ?? null;
  const explicitTarget = routingTarget ?? (gatherOrder?.task.camp === true ? gatherOrder.task.target : undefined);
  const preferredTarget = gatherOrder?.progress === 0 ? gatherOrder.task.target : undefined;
  const automatic = !explicitTarget;
  // Travel can begin before nominal growth if arrival is due afterward. Use
  // personally dated evidence, never remote live stock or regrowth timers.
  const speed = equipmentSpec(citizen, 'shoes')?.speed ?? 1;
  const worthChecking = (node, path) => node && path !== null && estimatedRecheckDelay(node, world.tick) <= Math.ceil(path.length / speed);
  let chosen = citizen.gatherTarget;
  const chosenMemory = chosen && citizen.knowledge.nodes[chosen.nodeId];
  // Reconsider at primitive boundaries when personally seeing that all stock
  // is already being worked. This is not a reservation or remote live lookup;
  // explicit camping can still deliberately contest a harvest.
  if (automatic && chosen && chosenMemory && visiblyOccupied(citizen, chosenMemory, world.tick)) {
    chosen = citizen.gatherTarget = null;
  }
  if (automatic && chosen && !worthChecking(chosenMemory, chosenMemory ? findPath(world, citizen, chosenMemory) : null)
    && (chosen.visited || !chosenMemory || distance(citizen, chosenMemory) > 0)) {
    chosen = citizen.gatherTarget = null;
  }
  if (chosen && area && chosenMemory && !inArea(world, chosenMemory, area)) chosen = citizen.gatherTarget = null;
  if (!chosen || chosen.resource !== kind || (explicitTarget && chosen.nodeId !== explicitTarget)) {
    const candidates = knownDeposits(citizen).filter((n) => n.kind === (kind === 'food' ? 'crop' : 'tree')
      && (!area || inArea(world, n, area)) && (!explicitTarget || n.id === explicitTarget))
      .map((node) => ({ node, path: findPath(world, citizen, node) })).filter(entry => entry.path !== null
        && (!automatic || (worthChecking(entry.node, entry.path) && !visiblyOccupied(citizen, entry.node, world.tick))));
    const tie = Number(citizen.id.replace(/\D/g, '')) || 1;
    candidates.sort((a, b) => {
      if (preferredTarget && a.node.id !== b.node.id && (a.node.id === preferredTarget || b.node.id === preferredTarget)) {
        return a.node.id === preferredTarget ? -1 : 1;
      }
      const score = ({ node, path }) => foragePreferenceCost(citizen, node, world.tick, Math.ceil(path.length / speed));
      const rank = (n) => ((Number(n.id.replace(/\D/g, '')) || 0) * (tie * 2 + 1)) % 23;
      return score(a) - score(b) || rank(a.node) - rank(b.node);
    });
    if (!candidates.length) {
      if (explore(world, citizen, area)) return true;
      // Depleted remembered sites are still reachable opportunities. Retain the
      // order and recheck observations; never consult remote live stock/timers.
      const reachable = knownDeposits(citizen).some(n => n.kind === (kind === 'food' ? 'crop' : 'tree') && (!area || inArea(world, n, area))
        && findPath(world, citizen, n) !== null);
      if (!reachable) return false;
      citizen.activity = `Waiting to recheck ${kind} sources`;
      start(citizen, { type: 'wait', ticks: 5 }, 5, purpose === 'need' ? 'need' : 'resource-wait');
      return true;
    }
    chosen = citizen.gatherTarget = { resource: kind, nodeId: candidates[0].node.id, visited: false };
  }
  const memory = citizen.knowledge.nodes[chosen.nodeId];
  if (!memory) { citizen.gatherTarget = null; return explore(world, citizen, area); }
  citizen.activity = `Walking to ${memory.id}`;
  const route = travel(world, citizen, memory, 0, purpose === 'need' ? 'need' : 'travel');
  if (route === 'blocked') { citizen.gatherTarget = null; return false; }
  if (route !== 'arrived') return true;
  // Only now, physically at the remembered location, is actual stock consulted.
  observeWorld(world, citizen);
  const node = world.nodes.find((n) => n.id === memory.id && distance(citizen, n) === 0);
  if (!node) citizen.knowledge.nodes[memory.id] = { ...memory, stock: 0, observedAt: world.tick, source: 'seen' };
  const history = outcome(citizen, memory.id);
  if (!chosen.visited) {
    chosen.visited = true;
    history.visits++;
    history.lastOutcomeAt = world.tick;
    if (!node?.stock) {
      history.emptyVisits++;
      const text = `${citizen.name} arrived at ${memory.id}; it was empty (${history.emptyVisits} empty visits).`;
      remember(citizen, text); recordEvent(world, text, citizen.id);
      citizen.replanReason = 'resource setback';
    }
  }
  if (node?.stock > 0) {
    const penalty = (citizen.hunger >= 75 ? 1 : 0) + (citizen.energy <= 20 ? 1 : 0);
    const duration = Math.max(1, (kind === 'food' ? FOOD_HARVEST_TICKS : WOOD_HARVEST_TICKS) - (equipmentSpec(citizen, 'tool')?.harvestReduction ?? 0) + penalty);
    citizen.activity = `Harvesting ${kind} at ${node.id}`;
    start(citizen, { type: 'harvest', target: node.id }, duration, purpose);
  } else {
    if (automatic) {
      citizen.gatherTarget = null;
      return gather(world, citizen, kind, purpose);
    }
    // Explicit camping remains a strategy choice. Distant regrowth cannot wake the citizen.
    const wait = 8 + (Number(citizen.id.replace(/\D/g, '')) || 0) % 9;
    citizen.activity = `Waiting at ${memory.id}`;
    start(citizen, { type: 'wait', ticks: wait }, wait, purpose === 'need' ? 'need' : 'resource-wait');
    citizen.current.nodeId = memory.id;
  }
  return true;
}

function prepareInteraction(world, citizen, task, offer) {
  if (!citizen.asyncReview) return false;
  if (task.type === 'reproduce' && !acceptedFamily(world, citizen.id, task.target)) {
    finishOrder(world, citizen, 'the accepted pairing is no longer active');
    return true;
  }
  const requirements = ownInteractionRequirements(citizen, task, offer);
  if (!requirements) return false;
  for (const [resource, minimum] of Object.entries(requirements.goods)) {
    const current = citizen[resource] ?? 0;
    if (current >= minimum) continue;
    if (resource === 'bread') {
      finishOrder(world, citizen, 'chosen action needs more bread; choose production or exchange to supply it');
      return true;
    }
    citizen.order.preparation = { phase: 'gathering', resource, minimum, current };
    // Hungry meal buyers use the same fresh sources as the survival estimate,
    // rather than approving one route then gathering from an older memory.
    const payment = resource === 'wood' && task.type === 'trade' && ['food', 'bread'].includes(offer?.give)
      && citizen.food === 0 && (citizen.bread ?? 0) === 0 && citizen.hunger >= 60
      ? observedWoodPayment(world, citizen, minimum - current) : null;
    if (!gather(world, citizen, resource, 'support', payment?.target)) finishOrder(world, citizen, `no reachable ${resource} for the chosen action`);
    return true;
  }
  if (world.tick < (requirements.notBefore ?? 0)) {
    citizen.order.preparation = { phase: 'waiting', untilTick: requirements.notBefore };
    start(citizen, { type: 'wait', ticks: 5 }, 5, 'support');
    return true;
  }
  if (citizen.health < (requirements.minimumHealth ?? 0) || citizen.energy < (requirements.minimumEnergy ?? 0)) {
    citizen.order.preparation = { phase: 'resting', minimumHealth: requirements.minimumHealth, minimumEnergy: requirements.minimumEnergy };
    citizen.activity = 'Resting for chosen action';
    start(citizen, { type: 'sleep' }, 5, 'support');
    return true;
  }
  delete citizen.order.preparation;
  return false;
}

function runOrder(world, citizen) {
  const order = citizen.order;
  const task = order.task;
  // Standing work and semantic acquisition persist through reviews; other
  // explicit jobs retain the legacy 600-tick limit.
  if (!order.work && !(citizen.asyncReview && task.type === 'acquire')
    && world.tick - (task.type === 'construct' ? order.segmentStartedAt ?? order.startedAt : order.startedAt) > 600) { finishOrder(world, citizen, 'timed out; awaiting the next review'); return; }
  citizen.activity = { craft: `Crafting ${task.item}`, post: 'Posting a message', message: 'Sending a private message', offer: 'Listing an offer', wait: 'Waiting by choice' }[task.type] ?? task.type;
  switch (task.type) {
    case 'acquire':
      if (order.bestInventory === undefined || citizen[task.resource] > order.bestInventory) {
        order.bestInventory = citizen[task.resource];
        order.lastInventoryIncreaseAt = world.tick;
      }
      if (citizen[task.resource] >= task.quantity) finishOrder(world, citizen);
      else if (!gather(world, citizen, task.resource, 'order')) finishOrder(world, citizen, 'no reachable resource in the chosen area');
      return;
    case 'gather':
      if (order.progress >= task.amount || (task.maxTicks !== undefined && world.tick - order.startedAt >= task.maxTicks)) finishOrder(world, citizen);
      else if (!gather(world, citizen, task.resource, 'order')) finishOrder(world, citizen, 'no reachable resource');
      return;
    case 'explore':
      if (world.tick - order.startedAt >= task.ticks) finishOrder(world, citizen);
      else if (!explore(world, citizen, task.area)) finishOrder(world, citizen, order.work ? 'no unexplored reachable terrain' : undefined);
      return;
    case 'move': {
      const result = travel(world, citizen, task, task.range ?? 0);
      citizen.activity = `Travelling to (${task.x}, ${task.y})`;
      if (result === 'arrived') finishOrder(world, citizen);
      if (result === 'blocked') finishOrder(world, citizen, 'no path');
      return;
    }
    case 'approach': {
      const target = person(world, task.target);
      if (!target?.alive) { finishOrder(world, citizen, 'contact no longer alive'); return; }
      const result = meet(world, citizen, target);
      citizen.activity = `Approaching ${target.name}`;
      if (result === 'arrived') finishOrder(world, citizen);
      else if (result === 'blocked') finishOrder(world, citizen, 'no reachable meeting place');
      return;
    }
    case 'craft': {
      if (equipmentLevel(citizen, task.item) >= (task.level ?? 1)) { finishOrder(world, citizen); return; }
      const required = craftRequirement(citizen, task);
      if (required.error) { finishOrder(world, citizen, required.error); return; }
      if (citizen.wood < required.cost) { gather(world, citizen, 'wood', 'support'); return; }
      start(citizen, task, 4); return;
    }
    case 'post':
    case 'message':
      if (citizen.wood < 1 && !(task.type === 'message' && canSee(world, citizen, person(world, task.target)))) { gather(world, citizen, 'wood', 'support'); return; }
      start(citizen, task, 2); return;
    case 'wait':
      if (order.progress >= task.ticks) finishOrder(world, citizen);
      else start(citizen, task, task.ticks - order.progress);
      return;
    case 'offer': start(citizen, task, 1); return;
    case 'propose_family':
    case 'accept_family':
    case 'decline_family':
    case 'cancel_family':
      citizen.activity = ({ propose_family: 'Proposing a family', accept_family: 'Accepting family proposal', decline_family: 'Declining family proposal', cancel_family: 'Cancelling family proposal' })[task.type];
      start(citizen, task, 2); return;
    case 'construct':
    case 'build': {
      const blueprint = task.type === 'construct' ? citizen.constructionPlans?.[task.plan] : null;
      if (task.type === 'construct' && !blueprint) { finishOrder(world, citizen, 'construction blueprint is unavailable'); return; }
      const building = blueprint ? 'wall' : task.building;
      const length = blueprint ? blueprint.tiles.length : task.length ?? 1;
      const spec = STRUCTURES[building];
      if (building === 'wall' && order.progress >= length) { finishOrder(world, citizen); return; }
      const site = blueprint ? blueprint.tiles[order.progress] : building === 'wall' ? wallTile(task, order.progress) : task;
      if (building === 'wall' && canSee(world, citizen, site)
        && world.buildings.some(b => b.kind === 'wall' && b.ownerId === citizen.id && b.health > 0 && b.x === site.x && b.y === site.y)) {
        order.progress += 1; order.segmentStartedAt = world.tick;
        return;
      }
      if (citizen.wood < spec.wood) {
        if (!gather(world, citizen, 'wood', 'support')) finishOrder(world, citizen, `no reachable wood for the new ${building}`);
        return;
      }
      citizen.activity = building === 'wall' ? `Building wall ${order.progress + 1}/${length}` : `Building a ${building}`;
      const escape = building === 'wall' && distance(citizen, site) === 0
        ? [{ x: site.x, y: site.y - 1 }, { x: site.x + 1, y: site.y }, { x: site.x, y: site.y + 1 }, { x: site.x - 1, y: site.y }]
          .find(p => isWalkable(world, p.x, p.y)) : null;
      const route = building === 'wall' && distance(citizen, site) === 0
        ? escape ? travel(world, citizen, escape) : 'blocked' : travel(world, citizen, site, building === 'wall' ? 1 : 0);
      if (route === 'arrived') start(citizen, { type: 'build', building, x: site.x, y: site.y }, spec.ticks);
      else if (route === 'blocked') finishOrder(world, citizen, 'no path to the building site');
      return;
    }
    case 'bake': {
      if (task.amount !== undefined && order.progress >= task.amount) { finishOrder(world, citizen); return; }
      const site = bakerySnapshot(citizen, task.target);
      if (!site) { finishOrder(world, citizen, 'no known bakery for the baking choice'); return; }
      if (site.health <= 0 || site.ownerId !== citizen.id) {
        finishOrder(world, citizen, 'no usable owner-operated bakery at this site'); return;
      }
      // Finish supplying the recipe before routing back to its work site.
      if (citizen.food < 1) {
        if (!gather(world, citizen, 'food', 'support')) finishOrder(world, citizen, 'no reachable raw food for baking');
        return;
      }
      if (citizen.wood < 1) {
        if (!gather(world, citizen, 'wood', 'support')) finishOrder(world, citizen, 'no reachable wood for baking');
        return;
      }
      citizen.activity = `Baking at ${site.id}`;
      const route = travel(world, citizen, site, 1);
      if (route === 'blocked') { finishOrder(world, citizen, 'no path to the bakery'); return; }
      if (route !== 'arrived') return;
      const bakery = world.buildings?.find((b) => b.id === site.id);
      if (!bakery || bakery.health <= 0 || bakery.ownerId !== citizen.id) {
        finishOrder(world, citizen, 'no usable owner-operated bakery at this site'); return;
      }
      start(citizen, { type: 'bake', target: site.id }, BAKE_TICKS);
      return;
    }
    case 'repair': {
      const site = bakerySnapshot(citizen, task.target);
      if (!site) { finishOrder(world, citizen, 'the bakery is unknown'); return; }
      if (citizen.wood < 2) {
        if (!gather(world, citizen, 'wood', 'support')) finishOrder(world, citizen, 'no reachable repair wood');
        return;
      }
      citizen.activity = `Repairing ${site.id}`;
      const route = travel(world, citizen, site, 1);
      if (route === 'blocked') { finishOrder(world, citizen, 'no path to the bakery'); return; }
      if (route !== 'arrived') return;
      start(citizen, { type: 'repair', target: site.id }, REPAIR_TICKS);
      return;
    }
    case 'guard': {
      if (task.ticks !== undefined && order.progress >= task.ticks) { finishOrder(world, citizen); return; }
      const site = bakerySnapshot(citizen, task.target);
      if (!site) { finishOrder(world, citizen, 'the guarded bakery is unknown'); return; }
      if (canSee(world, citizen, site) && !(world.buildings ?? []).some((b) => b.id === site.id && b.health > 0)) {
        finishOrder(world, citizen, 'the guarded bakery is no longer usable'); return;
      }
      const threat = witnessedThreat(world, citizen, site);
      if (threat) {
        citizen.activity = `Guarding against ${threat.name}`;
        const route = travel(world, citizen, threat, 1, 'guard');
        if (route === 'blocked') { start(citizen, { type: 'wait', ticks: 3 }, 3, 'guard'); return; }
        if (route === 'arrived') start(citizen, { type: 'attack', target: threat.id }, 3, 'guard');
        return;
      }
      citizen.activity = `Guarding ${site.id}`;
      const route = travel(world, citizen, site, 2, 'guard');
      if (route === 'arrived') start(citizen, { type: 'wait', ticks: 3 }, 3, 'guard');
      else if (route === 'blocked') start(citizen, { type: 'wait', ticks: 3 }, 3, 'guard');
      return;
    }
    case 'rest':
      if (task.target !== undefined) {
        const site = task.target === 'own' ? Object.values(citizen.knowledge.buildings ?? {}).filter(b => b.kind === 'house' && b.ownerId === citizen.id && b.health > 0)
          .sort((a, b) => distance(a, citizen) - distance(b, citizen))[0] : knownBuildingMemory(citizen, task.target);
        if (!site || site.kind !== 'house' || site.ownerId !== citizen.id || site.health <= 0) { finishOrder(world, citizen, 'no known usable owned house for resting'); return; }
        const route = travel(world, citizen, site);
        citizen.activity = `Going home to ${site.id}`;
        if (route === 'blocked') { finishOrder(world, citizen, 'no path to the house'); return; }
        if (route !== 'arrived') return;
        if (houseRestMultiplier(world, citizen) === 1) { observeWorld(world, citizen); finishOrder(world, citizen, 'house no longer usable'); return; }
      }
      citizen.activity = 'Resting by choice';
      start(citizen, { type: 'sleep' }, 5, 'order');
      return;
    case 'attack': {
      const site = bakerySnapshot(citizen, task.target);
      if (site) {
        citizen.activity = `Striking ${site.id}`;
        const route = travel(world, citizen, site, 1);
        if (route === 'blocked') finishOrder(world, citizen, 'no path to the building');
        else if (route === 'arrived') start(citizen, { type: 'attack', target: site.id }, 3);
        return;
      }
      if (order.progress >= 3 || citizen.health < 30) { finishOrder(world, citizen); return; }
      break;
    }
  }
  let target, offer;
  if (task.type === 'trade') {
    offer = world.offers.find((o) => o.id === task.offer && o.status === 'open' && o.expiresAt > world.tick
      && o.makerId !== citizen.id && (o.recipient === null || o.recipient === citizen.id));
    if (!offer) { finishOrder(world, citizen, 'offer no longer open'); return; }
    target = person(world, offer.makerId);
  } else target = person(world, task.target);
  if (!target?.alive) { finishOrder(world, citizen, task.type === 'attack' && order.progress > 0 ? undefined : 'target no longer alive'); return; }
  if (prepareInteraction(world, citizen, task, offer)) return;
  const arrived = meet(world, citizen, target);
  citizen.activity = `${{ give: 'Delivering to', trade: 'Trading with', attack: 'Pursuing', reproduce: 'Meeting' }[task.type]} ${target.name}`;
  if (arrived === 'blocked') finishOrder(world, citizen, 'no reachable meeting place');
  if (arrived === 'arrived') start(citizen, task, task.type === 'reproduce' ? 4 : task.type === 'attack' ? 3 : 2);
}

function sendCommunication(world, citizen, task) {
  switch (task.type) {
    case 'message': {
      const recipient = person(world, task.target);
      if (!recipient?.alive) return 'recipient unavailable';
      const nearby = canSee(world, citizen, recipient);
      const costWood = nearby ? 0 : 1;
      if (citizen.wood < costWood) return 'Recipient is not visibly nearby. Distant phone contact costs one existing wood; approach them or obtain wood before sending.';
      // Both share lists validate before anything is shared: no partial invalid sends.
      const nodeSharesValid = !task.share || (Array.isArray(task.share) && task.share.every((id) => knownShares(citizen, 'nodes', id)));
      const buildingSharesValid = !task.shareBuildings || (Array.isArray(task.shareBuildings) && task.shareBuildings.every((id) => knownShares(citizen, 'buildings', id)));
      if (!nodeSharesValid || !buildingSharesValid) return 'cannot report unknown knowledge';
      if (task.share && !shareKnowledgeWith(world, citizen, recipient, task.share).ok) {
        return 'cannot privately report unknown deposits';
      }
      if (task.shareBuildings && !shareBuildingsWith(world, citizen, recipient, task.shareBuildings).ok) {
        return 'cannot privately report unknown buildings';
      }
      const location = task.location ? reportLocation(world, citizen, recipient).location : undefined;
      citizen.wood -= costWood; world.stats.messages++;
      recipient.inboxRevision = (recipient.inboxRevision ?? 0) + 1;
      world.messages ??= [];
      world.messages.push({ id: `message-${world.nextMessageId++}`, tick: world.tick,
        senderId: citizen.id, recipientId: recipient.id, text: task.text, channel: nearby ? 'voice' : 'phone', costWood,
        ...(task.share ? { share: [...task.share] } : {}),
        ...(task.shareBuildings ? { shareBuildings: [...task.shareBuildings] } : {}),
        ...(location ? { location: { x: location.x, y: location.y } } : {}),
      });
      world.messages = world.messages.slice(-80);
      interruptForMessage(recipient, world.messages.at(-1).id);
      recordEvent(world, nearby ? `${citizen.name} spoke privately to ${recipient.name}.` : `${citizen.name} sent a private message to ${recipient.name}.`, citizen.id);
      return null;
    }
    case 'post':
      if (citizen.wood < 1) return 'message cost unavailable';
      if (!validShares(citizen, task.share) || !validBuildingShares(citizen, task.shareBuildings)) {
        return 'cannot report unknown knowledge';
      }
      if (task.share) {
        const result = shareKnowledge(world, citizen, task.share);
        if (!result.ok) return 'cannot report unknown deposits';
      }
      if (task.shareBuildings) {
        const result = shareBuildings(world, citizen, task.shareBuildings);
        if (!result.ok) return 'cannot report unknown buildings';
      }
      citizen.wood--;
      world.stats.messages++;
      world.board.push({ id: `message-${world.nextMessageId++}`, tick: world.tick, citizenId: citizen.id, name: citizen.name, text: task.text,
        ...(task.share ? { share: [...task.share] } : {}),
        ...(task.shareBuildings ? { shareBuildings: [...task.shareBuildings] } : {}) });
      world.board = world.board.slice(-40);
      recordEvent(world, `${citizen.name} posted: ${task.text}`, citizen.id);
      return null;
  }
}

function finishPrimitive(world, citizen, current) {
  const { task, purpose } = current;
  switch (task.type) {
    case 'harvest': {
      const node = world.nodes.find((n) => n.id === task.target);
      if (!node || distance(citizen, node) !== 0) return;
      const history = outcome(citizen, node.id);
      history.lastOutcomeAt = world.tick;
      if (node.stock < 1) {
        history.lostRaces++;
        const text = `${citizen.name} finished work at ${node.id}, but someone else took the harvest (${history.lostRaces} lost races).`;
        remember(citizen, text); recordEvent(world, text, citizen.id);
        citizen.replanReason = 'resource setback';
        observeWorld(world, citizen);
        return;
      }
      const kind = node.kind === 'crop' ? 'food' : 'wood';
      const amount = node.yield ?? 1;
      if (!Number.isSafeInteger(citizen[kind] + amount)) { finishOrder(world, citizen, 'inventory numeric limit'); return; }
      node.stock--;
      if (!node.regrowIn) node.regrowIn = node.regrowTicks;
      citizen[kind] += amount;
      world.stats[kind === 'food' ? 'harvestedFood' : 'harvestedWood'] += amount;
      history.harvested += amount;
      if (purpose === 'order' && citizen.order?.task.type === 'gather' && citizen.order.task.resource === kind) {
        citizen.order.progress += amount;
        citizen.order.lastProgressAt = world.tick;
      }
      citizen.gatherTarget = null;
      observeWorld(world, citizen);
      recordEvent(world, `${citizen.name} gathered ${amount} ${kind} at ${node.id}.`, citizen.id);
      return;
    }
    case 'eat':
      // Bread first when available; relief is clamped at zero hunger.
      if (task.bread === true && (citizen.bread ?? 0) > 0) {
        citizen.bread--;
        citizen.hunger = Math.max(0, citizen.hunger - BREAD_NUTRITION);
      } else if (citizen.food > 0) {
        citizen.food--;
        citizen.hunger = Math.max(0, citizen.hunger - 35);
      }
      return;
    case 'sleep':
      citizen.energy = Math.min(100, citizen.energy + 35 * houseRestMultiplier(world, citizen));
      if (purpose === 'order' && citizen.order?.task.type === 'rest' && !citizen.order.work) finishOrder(world, citizen);
      return;
    case 'wait': if (purpose === 'order') finishOrder(world, citizen); return;
    case 'build':
    case 'bake':
    case 'repair': {
      const result = resolveBuilding(world, citizen, task, effectsFor(world));
      // Completion first, then updated observations: hp/ownership confirmed from the actual site only.
      observeWorld(world, citizen);
      if (!result.ok) { if (purpose === 'order') finishOrder(world, citizen, result.reason); return; }
      if (task.type === 'bake') {
        if (purpose === 'order' && citizen.order?.task.type === 'bake') citizen.order.progress += 1;
      } else if (task.type === 'build' && task.building === 'wall' && purpose === 'order') {
        citizen.order.progress += 1;
        citizen.order.segmentStartedAt = world.tick;
        const length = citizen.order.task.type === 'construct' ? citizen.constructionPlans[citizen.order.task.plan].tiles.length : citizen.order.task.length ?? 1;
        if (citizen.order.progress >= length) finishOrder(world, citizen);
      } else if (purpose === 'order') finishOrder(world, citizen);
      return;
    }
    case 'message':
    case 'post':
      finishOrder(world, citizen, sendCommunication(world, citizen, task)); return;
  }
  if (['propose_family', 'accept_family', 'decline_family', 'cancel_family'].includes(task.type)) {
    const result = resolveInteraction(world, citizen, task, effectsFor(world));
    if (!result.ok) { finishOrder(world, citizen, result.reason); return; }
    // Consent does not insert travel or reproduction ahead of chosen preparation.
    finishOrder(world, citizen);
    return;
  }
  let target = person(world, task.target);
  if (task.type === 'trade') target = person(world, world.offers.find((o) => o.id === task.offer)?.makerId);
  if (!target && task.type === 'attack') {
    // A building strike resolves against the actual building registry only.
    const building = (world.buildings ?? []).find((entry) => entry?.id === task.target);
    if (!building) return; // Unknown building target: nothing to strike, the next review re-evaluates.
    const result = resolveBuilding(world, citizen, task, effectsFor(world));
    // Immediately observe nearby people so hp and survivors are confirmed and never all-remote.
    observeWorld(world, citizen);
    if (!result.ok) {
      if (purpose === 'order') finishOrder(world, citizen, 'the building was destroyed or moved');
      return;
    }
    if (purpose === 'order' && citizen.order?.task.type === 'attack') citizen.order.progress += 1;
    recordWitnesses(world, citizen, building, 'building');
    if (building.health <= 0 && purpose === 'order') finishOrder(world, citizen);
    return;
  }
  if (['give', 'trade', 'attack', 'reproduce'].includes(task.type) && target?.alive && (!canSee(world, citizen, target) || distance(citizen, target) > 1)) return; // Target moved during the action; approach again before applying any effect.
  if (purpose === 'guard' && task.type === 'attack') {
    const site = bakerySnapshot(citizen, citizen.order?.task.target);
    if (!site || site.health <= 0 || !witnessedThreat(world, citizen, site, task.target)) return;
  }
  if (task.type === 'give') {
    if (!target?.alive || citizen[task.resource] < task.amount || !Number.isSafeInteger((target[task.resource] ?? 0) + task.amount)) {
      if (purpose === 'order') finishOrder(world, citizen, 'recipient or resources unavailable');
      return;
    }
    citizen[task.resource] -= task.amount;
    target[task.resource] = (target[task.resource] ?? 0) + task.amount;
    world.stats.transfers++;
    recordEvent(world, `${citizen.name} gave ${task.amount} ${task.resource} to ${target.name}.`, citizen.id);
    if (purpose === 'order') finishOrder(world, citizen);
    return;
  }
  const result = resolveInteraction(world, citizen, task, effectsFor(world));
  if (!citizen.alive) {
    // The attacker may die earlier in the resolution, but living witnesses still record the hit.
    if (task.type === 'attack' && target) recordWitnesses(world, citizen, target, purpose === 'guard' ? 'defense' : 'citizen');
    return;
  }
  if (!result.ok) {
    if (purpose === 'order' && citizen.asyncReview && task.type === 'reproduce' && result.retryable && citizen.order) {
      // A real adjacent attempt established joint requirements were unmet;
      // retain the choice without disclosing remote readiness/private state.
      citizen.order.preparation = { phase: 'retrying_meeting', lastAttemptAt: world.tick, reason: result.reason };
      citizen.activity = 'Waiting to retry chosen meeting';
      start(citizen, { type: 'wait', ticks: 5 }, 5, 'support');
      return;
    }
    if (purpose === 'order') finishOrder(world, citizen, result.reason);
    return;
  }
  if (task.type === 'attack' && purpose === 'order' && citizen.order?.task.type === 'attack') citizen.order.progress++;
  else if (purpose === 'order') finishOrder(world, citizen);
  if (task.type === 'attack' && target) {
    // A guard's strike records as defense so guards never spiral against each other.
    recordWitnesses(world, citizen, target, purpose === 'guard' ? 'defense' : 'citizen');
    observeWorld(world, citizen);
  }
}

function observedWoodPayment(world, citizen, missing) {
  const currentTarget = citizen.current?.task.type === 'harvest' ? citizen.current.task.target
    : citizen.gatherTarget?.resource === 'wood' ? citizen.gatherTarget.nodeId : null;
  const sources = knownDeposits(citizen).filter(n => n.kind === 'tree' && n.source === 'seen' && n.stock > 0 && n.yield > 0
    && world.tick - n.observedAt >= 0 && world.tick - n.observedAt <= 12 && competitionPenalty(citizen, n, world.tick) === 0)
    .map(node => ({ node, stock: Math.max(0, node.stock - observedHarvesterCount(citizen, node, world.tick)),
      path: findPath(world, citizen, node) })).filter(entry => entry.path !== null && entry.stock > 0)
    .sort((a, b) => Number(b.node.id === currentTarget) - Number(a.node.id === currentTarget)
      || a.path.length - b.path.length || a.node.id.localeCompare(b.node.id));
  const harvestTicks = Math.max(1, WOOD_HARVEST_TICKS - (equipmentSpec(citizen, 'tool')?.harvestReduction ?? 0)
    + (citizen.hunger >= 75 ? 1 : 0));
  let remaining = missing, ticks = 0;
  for (const { node, stock, path } of sources) {
    const harvests = Math.min(stock, Math.ceil(remaining / node.yield));
    const firstHarvest = citizen.current?.task.type === 'harvest' && citizen.current.task.target === node.id
      ? citizen.current.remaining : harvestTicks;
    // Round trips to the current position bound any route through these trees.
    // Use present stock only: no future regrowth or remote live inventory.
    ticks += path.length * 2 + firstHarvest + (harvests - 1) * harvestTicks;
    remaining -= harvests * node.yield;
    if (remaining <= 0) return { ticks, target: sources[0].node.id };
  }
  return null;
}

function starvationFoodFallback(world, citizen) {
  const task = citizen.order?.task ?? citizen.tasks[0] ?? citizen.work;
  if (!citizen.asyncReview || citizen.food > 0 || (citizen.bread ?? 0) > 0 || citizen.hunger < 100
    || !['acquire', 'gather'].includes(task?.type) || task.resource !== 'food') return null;
  const beforeFatalHunger = Math.max(0, citizen.health / STARVATION_DAMAGE_PER_TICK - 1);
  const currentSource = citizen.current?.task.type === 'harvest' && citizen.knowledge.nodes[citizen.current.task.target];
  if (currentSource?.kind === 'crop' && citizen.current.remaining + 1 < beforeFatalHunger) return null;
  const harvestTicks = Math.max(1, FOOD_HARVEST_TICKS - (equipmentSpec(citizen, 'tool')?.harvestReduction ?? 0) + 1);
  const speed = equipmentSpec(citizen, 'shoes')?.speed ?? 1;
  const sources = knownDeposits(citizen).filter(n => n.kind === 'crop')
    .map(node => ({ node, path: findPath(world, citizen, node) })).filter(entry => entry.path !== null);
  const travelTicks = path => Math.ceil(path.length / speed);
  const chosenSources = sources.filter(({ node }) => (!task.area || inArea(world, node, task.area))
    && (!task.camp || node.id === task.target));
  if (chosenSources.some(({ node, path }) => {
    const recheck = node.stock > 0 ? 0 : task.camp ? 8 + (Number(citizen.id.replace(/\D/g, '')) || 0) % 9 : 5;
    const unfinishedWait = citizen.current?.task.type === 'wait' ? citizen.current.remaining : 0;
    return Math.max(travelTicks(path), estimatedRecheckDelay(node, world.tick), unfinishedWait)
      + recheck + competitionPenalty(citizen, node, world.tick) + harvestTicks + 1 < beforeFatalHunger;
  })) return null;
  // Only a personally observed, reachable meal can override a starving food
  // plan whose next yield no longer fits. Keep the strategic order; this is a
  // temporary need, not a replacement goal, shopping decision or remote oracle.
  return sources.filter(({ node, path }) => node.source === 'seen' && node.stock > observedHarvesterCount(citizen, node, world.tick)
    && world.tick - node.observedAt >= 0 && world.tick - node.observedAt <= 12 && competitionPenalty(citizen, node, world.tick) === 0
    && travelTicks(path) + harvestTicks + 1 < beforeFatalHunger)
    .sort((a, b) => a.path.length - b.path.length || a.node.id.localeCompare(b.node.id))[0]?.node ?? null;
}

function chosenMealCanFinish(world, citizen) {
  if (!citizen.asyncReview || citizen.planBlocked || citizen.energy <= 20 || (citizen.bread ?? 0) > 0) return false;
  const task = citizen.order?.task ?? citizen.tasks[0] ?? citizen.work;
  // A chosen food collection strategy already serves the immediate need. Let
  // its area/target and harvest progress execute instead of substituting a
  // different global forage routine before the order can even start.
  if (citizen.food === 0 && ['acquire', 'gather'].includes(task?.type) && task.resource === 'food') return !starvationFoodFallback(world, citizen);
  let target, duration, availableTicks = Infinity;
  if (task?.type === 'bake' && citizen.food >= 1 && citizen.wood >= 1) {
    target = bakerySnapshot(citizen, task.target);
    if (!target || target.ownerId !== citizen.id || target.health <= 0) return false;
    duration = citizen.current?.task.type === 'bake' ? citizen.current.remaining : BAKE_TICKS;
  } else if (task?.type === 'trade' && citizen.food === 0) {
    const offer = world.offers.find(o => o.id === task.offer && o.status === 'open' && o.expiresAt > world.tick
      && o.makerId !== citizen.id && (o.recipient === null || o.recipient === citizen.id));
    if (!offer || !['food', 'bread'].includes(offer.give)) return false;
    availableTicks = offer.expiresAt - world.tick;
    target = person(world, offer.makerId);
    if (!target?.alive) return false;
    duration = citizen.current?.task.type === 'trade' ? citizen.current.remaining : 2;
    const missing = Math.max(0, offer.wantAmount - (citizen[offer.want] ?? 0));
    if (missing) {
      // Preserve the chosen trade when several fresh sources jointly fund it.
      // No shopping is chosen here; unreachable/stale/contested stock and
      // future regrowth cannot extend the survival window.
      if (offer.want !== 'wood') return false;
      const payment = observedWoodPayment(world, citizen, missing);
      if (!payment) return false;
      duration += payment.ticks;
    }
  } else return false;
  if (!target) return false;
  const path = findPath(world, citizen, target, { range: 1 });
  // This is a feasibility check on an explicitly chosen food-producing action,
  // not automatic shopping or a preference for someone else's offer.
  const hungerRate = citizen.adult ? ADULT_HUNGER_PER_TICK : CHILD_HUNGER_PER_TICK;
  const beforeFatalHunger = Math.max(0, (100 - citizen.hunger) / hungerRate)
    + Math.max(0, citizen.health / STARVATION_DAMAGE_PER_TICK - 1);
  return path !== null && path.length + duration < Math.min(beforeFatalHunger, availableTicks);
}

function needs(world, citizen) {
  const hasBread = (citizen.bread ?? 0) > 0;
  // Spend a loaf when its full relief is useful, before starvation at 100.
  if (citizen.hunger >= (hasBread ? BREAD_NUTRITION : 60)) {
    // Bread first when available, then raw food.
    if (hasBread) { citizen.activity = 'Eating'; start(citizen, { type: 'eat', bread: true }, 1, 'need'); return true; }
    if (chosenMealCanFinish(world, citizen)) return false;
    if (citizen.food > 0) { citizen.activity = 'Eating'; start(citizen, { type: 'eat' }, 1, 'need'); return true; }
  }
  if (citizen.energy <= 20) { citizen.activity = 'Resting'; start(citizen, { type: 'sleep' }, 5, 'need'); return true; }
  if (citizen.hunger >= 60 && !hasBread && gather(world, citizen, 'food', 'need', starvationFoodFallback(world, citizen)?.id)) return true;
  return false;
}
function retreat(world, citizen) {
  if (citizen.health >= 30) return false;
  const threats = world.citizens.filter((c) => c.id !== citizen.id && canSee(world, citizen, c) && (citizen.relationships[c.id] ?? 0) < 0 && distance(citizen, c) <= 3);
  if (!threats.length) return false;
  const options = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => ({ x: citizen.x + dx, y: citizen.y + dy }))
    .filter((p) => isWalkable(world, p.x, p.y)).sort((a, b) => Math.min(...threats.map((t) => distance(b, t))) - Math.min(...threats.map((t) => distance(a, t))));
  if (!options.length) return false;
  if (citizen.order?.task.type === 'attack') finishOrder(world, citizen, 'retreating while wounded');
  citizen.activity = 'Retreating from danger';
  start(citizen, { type: 'move', ...options[0] }, 1, 'need');
  citizen.path = [options[0]];
  return true;
}
function careForChild(world, citizen) {
  const provisions = citizen.food > 0 ? 'food' : (citizen.bread ?? 0) > 0 ? 'bread' : null;
  if (!provisions) return false;
  const dependent = world.citizens.filter((c) => !c.adult && canSee(world, citizen, c) && c.parents.includes(citizen.id)
    && c.hunger >= 50 && c.food < 1 && (c.bread ?? 0) < 1)
    .sort((a, b) => b.hunger - a.hunger || distance(citizen, a) - distance(citizen, b))[0];
  if (!dependent) return false;
  citizen.activity = `Feeding ${dependent.name}`;
  const route = travel(world, citizen, dependent, 1, 'care');
  if (route === 'blocked') return false;
  if (route === 'arrived') start(citizen, { type: 'give', target: dependent.id, resource: provisions, amount: Math.min(2, citizen[provisions]) }, 1, 'care');
  return true;
}
function childRoutine(world, citizen) {
  const locations = new Map(knownPeople(citizen).map((p) => [p.id, p]));
  const parents = world.citizens.filter((c) => citizen.parents.includes(c.id) && (canSee(world, citizen, c) || locations.has(c.id)))
    .sort((a, b) => distance(citizen, locations.get(a.id) ?? a) - distance(citizen, locations.get(b.id) ?? b));
  const availableParent = citizen.food < 1 && (citizen.bread ?? 0) < 1 && citizen.hunger >= 50
    ? parents.find((p) => (p.food > 0 || (p.bread ?? 0) > 0) && distance(citizen, p) <= 1) : null;
  if (availableParent) {
    const resource = availableParent.food > 0 ? 'food' : 'bread';
    availableParent[resource]--; citizen[resource] = (citizen[resource] ?? 0) + 1; world.stats.transfers++;
    recordEvent(world, `${availableParent.name} fed ${citizen.name}.`, availableParent.id);
  }
  // Gifts are reserved, not automatically transferred; collect them before they expire, even before hunger rises.
  if (citizen.hunger >= 60 && (citizen.food > 0 || (citizen.bread ?? 0) > 0) && needs(world, citizen)) return;
  const gift = world.offers.find((o) => o.status === 'open' && o.expiresAt > world.tick && o.recipient === citizen.id
    && o.wantAmount === 0 && (o.give === 'food' || o.give === 'bread'));
  const giver = gift && person(world, gift.makerId);
  if (giver) {
    citizen.activity = `Collecting gift from ${giver.name}`;
    const route = meet(world, citizen, giver, 'care');
    if (route === 'arrived') start(citizen, { type: 'trade', offer: gift.id }, 1, 'care');
    if (route === 'arrived' || route === 'moving') return;
  }
  if (citizen.food < 1 && (citizen.bread ?? 0) < 1 && citizen.hunger >= 50) {
    const provider = parents.find((p) => (p.food > 0 || (p.bread ?? 0) > 0) && canSee(world, citizen, p) && findPath(world, citizen, p, { range: 1 }) !== null);
    if (provider) {
      citizen.activity = `Following ${provider.name} for food`;
      travel(world, citizen, provider, 1, 'care');
      return;
    }
  }
  if (needs(world, citizen)) return;
  const parent = parents[0];
  if (parent) {
    const route = meet(world, citizen, parent, 'care');
    if (route === 'moving') { citizen.activity = `Following ${parent.name}`; return; }
  }
  citizen.activity = 'Staying with family';
  start(citizen, { type: 'wait', ticks: 3 }, 3, 'routine');
}
function workTask(citizen) {
  const work = { ...citizen.work };
  if (work.type === 'bake') work.target = bakerySnapshot(citizen, work.target)?.id ?? work.target;
  return work;
}
function choosePrimitive(world, citizen) {
  if (!citizen.adult) { childRoutine(world, citizen); return; }
  if (retreat(world, citizen) || needs(world, citizen) || careForChild(world, citizen)) return;
  if (citizen.pendingMessageId && !citizen.asyncReview) {
    citizen.activity = 'Reviewing a private message';
    start(citizen, { type: 'wait', ticks: 1 }, 1, 'message-review');
    return;
  }
  if (citizen.planBlocked) {
    citizen.activity = 'Review needed after failed step';
    start(citizen, { type: 'wait', ticks: 5 }, 5, 'routine');
    return;
  }
  if (!citizen.order && citizen.tasks.length) {
    citizen.order = { task: citizen.tasks.shift(), startedAt: world.tick, progress: 0, work: false };
    Object.defineProperty(citizen.order, 'planId', { value: citizen.physicalAuditPlanId });
  }
  if (!citizen.order && citizen.work) {
    // The chosen undertaking repeats after the finite task list is exhausted.
    citizen.order = { task: workTask(citizen), startedAt: world.tick, progress: 0, work: true };
    Object.defineProperty(citizen.order, 'planId', { value: citizen.physicalAuditPlanId });
  }
  if (citizen.order) { runOrder(world, citizen); return; }
  // No reserves agenda and no automatic gathering: the strategy is complete and awaits its review.
  if (!citizen.replanReason) citizen.replanReason = 'strategy complete';
  citizen.activity = 'Choosing next undertaking';
  start(citizen, { type: 'wait', ticks: 5 }, 5, 'routine');
}

function tickPhone(world, citizen) {
  if (!citizen.adult) return;
  if (!citizen.phone && citizen.communications?.length) {
    citizen.phone = { task: citizen.communications.shift(), remaining: 2, planId: citizen.auditPlanId };
  }
  if (!citizen.phone || --citizen.phone.remaining > 0) return;
  const { task, planId } = citizen.phone;
  citizen.phone = null;
  const failure = sendCommunication(world, citizen, task);
  recordAction(world, citizen, task, failure, planId);
  if (failure) {
    citizen.replanReason = 'communication failed';
    remember(citizen, `Tick ${world.tick}: communication failed: ${failure}`);
  }
}

export function tickWorld(world) {
  if (!Number.isSafeInteger(world.tick) || world.tick < 0 || world.tick === Number.MAX_SAFE_INTEGER) throw new Error('World tick is outside the safe numeric range.');
  world.tick++;
  const effects = effectsFor(world);
  const interactions = tickInteractions(world, effects);
  if (!interactions.ok) throw new Error(`Invalid simulation state: ${interactions.reason}`);
  for (const node of world.nodes) {
    if (node.stock < node.capacity && node.regrowIn > 0 && --node.regrowIn === 0) {
      node.stock++; if (node.stock < node.capacity) node.regrowIn = node.regrowTicks;
    }
  }
  // Copy because death removes a citizen and birth appends one during this tick.
  for (const citizen of [...world.citizens]) {
    if (!citizen.alive) continue;
    observeWorld(world, citizen);
    citizen.hunger = Math.min(100, citizen.hunger + (citizen.adult ? ADULT_HUNGER_PER_TICK : CHILD_HUNGER_PER_TICK));
    citizen.energy = Math.max(0, citizen.energy - 0.15);
    if (citizen.hunger >= 100) {
      if (citizen.health <= STARVATION_DAMAGE_PER_TICK) { killCitizen(world, citizen, null, effects); continue; }
      citizen.health -= STARVATION_DAMAGE_PER_TICK;
      citizen.replanReason = 'starvation';
    } else if (citizen.hunger < 60 && citizen.current?.task.type === 'sleep') citizen.health = Math.min(100, citizen.health + 0.5 * houseRestMultiplier(world, citizen));
    tickPhone(world, citizen);
    const danger = citizen.health < 30 && world.citizens.some((other) =>
      other.id !== citizen.id && canSee(world, citizen, other) && (citizen.relationships[other.id] ?? 0) < 0 && distance(citizen, other) <= 3);
    const familyNeedsHelp = citizen.adult && (citizen.food > 0 || (citizen.bread ?? 0) > 0) && world.citizens.some((child) =>
      !child.adult && canSee(world, citizen, child) && child.parents.includes(citizen.id) && child.hunger >= 50 && child.food < 1 && (child.bread ?? 0) < 1);
    const childNeedsHelp = !citizen.adult && citizen.food < 1 && (citizen.bread ?? 0) < 1 && citizen.hunger >= 50
      && (world.citizens.some((p) => citizen.parents.includes(p.id) && canSee(world, citizen, p) && (p.food > 0 || (p.bread ?? 0) > 0) && findPath(world, citizen, p, { range: 1 }) !== null)
        || world.offers.some((o) => o.status === 'open' && o.recipient === citizen.id && o.wantAmount === 0 && (o.give === 'food' || o.give === 'bread')));
    if (citizen.pendingMessageId && !citizen.asyncReview && citizen.current && ['order', 'routine'].includes(citizen.current.purpose)) {
      citizen.current = null;
      citizen.path = [];
      citizen.movementCredit = 0;
    }
    if (citizen.current && !['eat', 'sleep'].includes(citizen.current.task.type)
      && (danger || (citizen.current.purpose !== 'care' && (familyNeedsHelp || childNeedsHelp))
        || (!['need', 'care'].includes(citizen.current.purpose) && ((citizen.hunger >= 60 && !chosenMealCanFinish(world, citizen)) || citizen.energy <= 20)))) {
      citizen.current = null; // Preserve the strategic order/progress, not incomplete resource effects.
    }
    if (!citizen.current) choosePrimitive(world, citizen);
    const current = citizen.current;
    if (current?.task.type === 'move') {
      advanceMovement(world, citizen);
    } else {
      citizen.movementCredit = 0; // Rest/work never bank walking speed.
      if (current) {
        if (current.task.type === 'wait' && (current.purpose === 'order' || current.purpose === 'guard') && citizen.order) citizen.order.progress++;
        if (current.nodeId) outcome(citizen, current.nodeId).waitTicks++;
        current.remaining--;
        if (current.effortKey && citizen.order?.effort?.key === current.effortKey) citizen.order.effort.ticks++;
        if (current.remaining <= 0) {
          if (current.effortKey && citizen.order?.effort?.key === current.effortKey) delete citizen.order.effort;
          citizen.current = null; finishPrimitive(world, citizen, current);
        }
      }
    }
    if (citizen.alive) citizen.status = citizen.current || citizen.order || citizen.tasks.length ? 'acting' : 'idle';
  }
  return world;
}

export function planningContext(world, citizenId) {
  const citizen = person(world, citizenId);
  if (!citizen) throw new Error('Citizen is not alive.');
  const { id, name, x, y, food, wood, bread, hunger, energy, health, tool, weapon, shoes, familyReady, reproduceAfter, personality, aspirations, goals, memories, work, order, tasks, relationships, parents } = citizen;
  const buildingSnapshots = knownBuildingSnapshots(citizen);
  return structuredClone({
    tick: world.tick, width: world.width, height: world.height,
    citizen: { id, name, x, y, food, wood, bread: bread ?? 0, hunger: Math.round(hunger), energy: Math.round(energy), health: Math.round(health),
      tool, weapon, shoes, toolLevel: equipmentLevel(citizen, 'tool'), shoesLevel: equipmentLevel(citizen, 'shoes'), weaponLevel: equipmentLevel(citizen, 'weapon'), weaponDurability: citizen.weaponDurability, familyReady, reproduceAfter, personality, aspirations, goals, memories: memories.slice(-3),
      work: work ?? null, routine: { family: familyReady }, order: order?.task ?? null, tasks, relationships, parents,
      strategyMemory: citizen.strategyMemory ?? '',
      familyRevision: citizen.familyRevision ?? 0,
      inboxRevision: citizen.inboxRevision ?? 0,
      completedActionRevision: citizen.completedActionRevision ?? 0,
      completedActions: citizen.completedActions ?? [],
      children: world.citizens.filter((c) => c.parents.includes(id)).map((c) => ({ id: c.id, name: c.name, adult: c.adult })),
      exploredTiles: citizen.knowledge.explored.length,
      actionResults: citizen.actionResults ?? [],
      execution: {
        orderStartedAt: order?.startedAt ?? null, completedUnits: order?.progress ?? 0,
        investedTicks: order?.effort?.ticks ?? 0,
        remainingTicks: citizen.current?.purpose === 'order' && citizen.current.task.type !== 'move' ? citizen.current.remaining : null,
        interruptedBy: citizen.pendingMessageId ? 'private message' : ['need', 'care'].includes(citizen.current?.purpose) ? citizen.current.purpose : null,
        lastReview: citizen.lastPlanMode ?? null,
        ...(order?.preparation ? { preparation: { ...order.preparation } } : {}),
        ...(order?.task.type === 'acquire' ? { inventoryTarget: { resource: order.task.resource, quantity: order.task.quantity,
          current: citizen[order.task.resource], best: order.bestInventory ?? citizen[order.task.resource],
          ticksSinceIncrease: world.tick - (order.lastInventoryIncreaseAt ?? order.startedAt) } } : {}),
        ...(citizen.planBlocked ? { blockedBy: citizen.planBlocked } : {}),
      },
      ...(citizen.lastError ? { lastPlanError: citizen.lastError } : {}),
      communications: [...(citizen.phone ? [citizen.phone.task] : []), ...(citizen.communications ?? [])],
      ...(citizen.undertaking ? { undertaking: citizen.undertaking } : {}),
      resourceHistory: Object.entries(citizen.resourceHistory).sort((a, b) => b[1].lastOutcomeAt - a[1].lastOutcomeAt).slice(0, 6).map(([nodeId, data]) => ({ nodeId, ...data })),
    },
    // Own projections only: peers' private fields stay out of the shared context.
    buildings: buildingSnapshots,
    knownBuildings: buildingSnapshots,
    incidents: (citizen.incidents ?? []).slice(-4).map((incident) => ({ ...incident })),
    neighbors: world.citizens.filter((c) => c.id !== citizenId).map((c) => ({
      id: c.id, name: c.name, adult: c.adult,
    })),
    contacts: knownPeople(citizen),
    inbox: (world.messages ?? []).filter((m) => m.recipientId === citizenId).slice(-4),
    outbox: (world.messages ?? []).filter((m) => m.senderId === citizenId).slice(-4),
    deposits: knownDeposits(citizen).map(({ id, kind, x, y, stock, observedAt, source, reportedBy }) => ({ id, kind, x, y, stock, observedAt, source, ...(reportedBy ? { reportedBy } : {}) })),
    offers: world.offers.filter((o) => o.status === 'open' && (o.recipient === null || o.recipient === citizenId || o.makerId === citizenId)),
    // Only the maker's own escrow history, never remote recipient outcomes.
    offerHistory: world.offers.filter((o) => o.makerId === citizenId && o.status !== 'open').slice(-4),
    familyProposals: familyContext(world, citizenId),
    board: world.board.slice(-4), events: world.events.filter((e) => e.citizenId === citizenId).slice(-4),
  });
}

export function upgradeWorld(world) {
  if (!world || typeof world !== 'object' || Array.isArray(world) || !Array.isArray(world.citizens)) {
    throw new Error('Upgrade requires a world with citizens.');
  }
  // Defaults for preserved state: building registry, counters, bread, work, and incidents.
  world.buildings ??= [];
  world.nextBuildingId ??= 1;
  world.stats ??= {};
  for (const key of STAT_COUNTERS) world.stats[key] ??= 0;
  for (const citizen of world.citizens) {
    if (!citizen || typeof citizen !== 'object') throw new Error('Upgrade requires valid citizens.');
    const legacyPolicy = citizen.work === undefined || Object.hasOwn(citizen.routine ?? {}, 'food') || Object.hasOwn(citizen.routine ?? {}, 'wood');
    if (citizen.bread === undefined) citizen.bread = 0;
    if (citizen.work === undefined) citizen.work = null;
    if (!Array.isArray(citizen.incidents)) citizen.incidents = [];
    // Old routines carried reserve targets the executor no longer pursues; only consent remains.
    citizen.routine = { family: citizen.familyReady === true };
    if (legacyPolicy && citizen.adult) citizen.replanReason ||= 'new opportunities';
    // Translate only the exact original seed aspiration arrays per stable ID; custom aspirations survive.
    const original = SEED_ASPIRATIONS[citizen.id];
    const stronger = STRONGER_ASPIRATIONS[citizen.id];
    if (original && stronger && Array.isArray(citizen.aspirations) && citizen.aspirations.length === original.length
      && citizen.aspirations.every((aim, index) => aim === original[index])) {
      citizen.aspirations = [...stronger];
    }
    // A lingering reserves-met idling primitive re-evaluates immediately under the normal reasons.
    if (citizen.activity === 'Reserves met') {
      if (citizen.current?.task?.type === 'wait' && citizen.current?.purpose === 'routine') citizen.current = null;
      citizen.activity = 'Choosing next undertaking';
    }
  }
  // No resets: world, ticks, tasks, orders, resources, consent, budgets, and review cooldowns are preserved;
  // observation stays bound to each citizen's own nearby vision.
  return world;
}
