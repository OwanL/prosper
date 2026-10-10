import type {
  Action,
  Building,
  Citizen,
  Command,
  CommandResult,
  Inventory,
  Point,
  Resource,
  Tier,
  World,
} from '../shared/types.ts';
import { TIERS } from '../shared/types.ts';
import { strategyAllowed, validateWorldAuthority, type WorldControlOptions } from './evaluation-authority.ts';
export type { CitizenAuthority, EvaluationAuthority, WorldControlOptions } from './evaluation-authority.ts';
import { RING_COUNT, MAX_TIER, CARRIED_ITEM_RE } from '../shared/tiers.ts';
import {
  addInventory,
  distance,
  event,
  fail,
  hasInventory,
  id,
  itemKey,
  ok,
  random,
  ringAt,
  takeInventory,
} from '../shared/utils.ts';
import {
  BALANCE,
  BUILDINGS,
  buildingRecipe,
  EQUIPMENT,
  equipmentRecipe,
  harvestDuration,
  MATCHING_TOOL,
  nutrition,
  RESOURCES,
  STATION_RESOURCE,
  canRefine,
  refinementRecipe,
  refinementOutput,
} from './config.ts';
import { findPath, inBounds, neighbors, walkable } from './pathfinding.ts';
import { startingCharacter } from './characters.ts';
import { LEGACY_FIRST_NAMES } from './name-data.ts';
import { allocateCitizenName } from './names.ts';
import { validateKnownCommand } from './observation.ts';
import { advancePlan, discardPlan, planActionResult } from './plans.ts';
import {
  advanceDirectives,
  directiveActionResult,
  discardStrategy,
  isDirectiveGatherRetry,
} from './directives.ts';
import { advanceEmergency, beginEmergency } from './emergency.ts';
import { advanceAutonomy, enableAutonomy, reactAutonomy } from './autonomy.ts';
import { maintainSociety, witnessHarvest } from './society.ts';
import { highestToolTier } from '../shared/tool-utils.ts';
import { isBuildingListed, marketCommand } from './market.ts';
import { ensureTelemetry, sampleTelemetry } from './telemetry.ts';
import {
  advanceLifeAction,
  consentCommand,
  isLifeAction,
  releaseAction,
  settleDeath,
  startLifeAction,
  validateLifeCommand,
} from './life.ts';

const physicalTypes = new Set([
  'move',
  'harvest',
  'craft',
  'build',
  'refine',
  'attack',
  'loot',
  'reproduce',
]);
const validTier = (tier: number): tier is Tier => TIERS.includes(tier as Tier);
const sameTile = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const physical = (command: Command) => physicalTypes.has(command.type);
const toolTier = (citizen: Citizen, resource: Resource): number => {
  return highestToolTier(citizen,MATCHING_TOOL[resource]);
};

/** Seeded, serializable creation. Only this function mints gold. */
export function createWorld(
  options: { seed?: number; scenario?: string; runId?: string; autonomy?: boolean; population?: number } = {},
): World {
  const scenario = options.scenario ?? 'village';
  if (!['village', 'competition', 'progression'].includes(scenario))
    throw new Error(`Unknown scenario: ${scenario}`);
  const seed = (options.seed ?? 1) >>> 0;
  const count = options.population ?? (scenario === 'competition' ? 9 : scenario === 'progression' ? 3 : BALANCE.initialCitizens);
  if (!Number.isInteger(count) || count < 1 || count > 250) throw new Error('Population must be an integer from 1 to 250.');
  const scale = Math.max(1, count / BALANCE.initialCitizens);
  const size = Math.ceil(BALANCE.width * Math.sqrt(scale));
  const world: World = {
    schemaVersion: 1,
    runId: options.runId ?? `run-${seed}-${scenario}`,
    scenario: scenario as World['scenario'],
    seed,
    rngState: seed || 1,
    nextId: 1,
    tick: 0,
    width: size,
    height: size,
    ringCount: RING_COUNT,
    initialGold: 0,
    citizens: {},
    deposits: {},
    buildings: {},
    orders: {},
    loot: {},
    messages: [],
    events: [],
  };
  // Each inward band advances one tier, occasionally yielding the next tier.
  // The rare center tier is not clamped; supported tiers derive from RING_COUNT.
  for (let ring = RING_COUNT - 1; ring >= 0; ring--) {
    for (let resourceIndex = 0; resourceIndex < RESOURCES.length; resourceIndex++) {
      const pool: Point[] = [];
      for (let y = 0; y < world.height; y++)
        for (let x = 0; x < world.width; x++) {
          const angle = Math.atan2(y - (world.height - 1) / 2, x - (world.width - 1) / 2) + Math.PI;
          const sector = Math.min(2, Math.floor(angle / ((2 * Math.PI) / 3)));
          if (ringAt(world, { x, y }) === ring && sector === resourceIndex) pool.push({ x, y });
        }
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random(world) * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      // Sparse groves/fields make access and travel matter. Keep population-
      // proportional supply, but leave most tiles empty rather than covering
      // every sector with interchangeable deposits. Separated seeded anchors
      // provide several local work sites rather than a single compulsory choke.
      const depositCount = Math.ceil(2.4 * (ring + 1) * scale);
      const anchors = pool.length ? [pool[0]] : [];
      const patchCount = Math.min(Math.ceil(depositCount / 5), pool.length);
      while (anchors.length < patchCount) {
        let next = pool[0];
        let farthest = -1;
        for (const point of pool) {
          const separation = Math.min(...anchors.map((anchor) => distance(point, anchor)));
          if (separation > farthest) { farthest = separation; next = point; }
        }
        anchors.push(next);
      }
      pool.sort((a, b) =>
        Math.min(...anchors.map((anchor) => distance(a, anchor))) -
        Math.min(...anchors.map((anchor) => distance(b, anchor))));
      for (let i = 0; i < Math.min(depositCount, pool.length); i++) {
        // Keep one base-tier deposit per sector for reliable barehanded starts.
        const tier = RING_COUNT - ring + (i > 0 && random(world) < 0.05 ? 1 : 0);
        const depositId = id(world, 'deposit');
        world.deposits[depositId] = {
          id: depositId,
          ...pool[i],
          resource: RESOURCES[resourceIndex],
          tier,
          stock: BALANCE.depositCapacity,
          capacity: BALANCE.depositCapacity,
          regrowAt: 0,
        };
      }
    }
  }
  // Small outskirts forage patches let newcomers feed themselves before the
  // cross-sector market develops. The food sector still holds the large fields;
  // putting every edible plant there stranded unfunded wood/fibre workers.
  const outskirts = Object.values(world.deposits).filter((deposit) =>
    deposit.tier === 1 && deposit.resource !== 'food' && ringAt(world, deposit) === RING_COUNT - 1);
  const occupied = new Set(Object.values(world.deposits).map((deposit) => `${deposit.x},${deposit.y}`));
  for (let i = 0; i < outskirts.length; i += 3) {
    const point = neighbors(outskirts[i]).find((candidate) =>
      inBounds(world, candidate) && ringAt(world, candidate) === RING_COUNT - 1 && !occupied.has(`${candidate.x},${candidate.y}`));
    if (!point) continue;
    const depositId = id(world, 'deposit');
    world.deposits[depositId] = { id: depositId, ...point, resource: 'food', tier: 1,
      stock: BALANCE.depositCapacity, capacity: BALANCE.depositCapacity, regrowAt: 0 };
    occupied.add(`${point.x},${point.y}`);
  }
  const names = LEGACY_FIRST_NAMES;
  const colors = [
    '#d66a55',
    '#d0a83d',
    '#5ca476',
    '#508fce',
    '#ad75be',
    '#cf809d',
    '#58a6a6',
    '#a09555',
    '#7c86c9',
  ];
  const spawned = { wood: 0, food: 0, fibre: 0 };
  for (let i = 0; i < count; i++) {
    // One citizen in each resource sector; everyone else starts near food supply.
    const resource = count > 9 ? RESOURCES[i % RESOURCES.length] : i < RESOURCES.length ? RESOURCES[i] : 'food';
    const starts = Object.values(world.deposits).filter(
      (d) => d.resource === resource && d.tier === 1 && ringAt(world, d) === RING_COUNT - 1,
    );
    const index = spawned[resource]++;
    const sectorPopulation = count > 9 ? Math.ceil((count-RESOURCES.indexOf(resource))/3) : resource === 'food' ? Math.max(1,count - 2) : 1;
    const start = starts[Math.floor((index * starts.length) / sectorPopulation)];
    const citizenId = id(world, 'citizen');
    world.citizens[citizenId] = {
      id: citizenId,
      name: allocateCitizenName(world.citizens),
      color: colors[i % colors.length],
      ...startingCharacter(i % names.length),
      x: start.x,
      y: start.y,
      alive: true,
      health: BALANCE.maxHealth,
      fullness: BALANCE.maxFullness,
      gold: BALANCE.startingGold,
      inventory: { 'food:1': BALANCE.startingFood },
      action: null,
      queue: [],
      memories: [],
      knowledge: {},
      lastResult: 'Ready to gather T1 materials.',
      nextReviewTick: 0,
      consent: {},
      reproductionCooldown: 0,
      parents: [],
    };
    world.initialGold += BALANCE.startingGold;
    if (options.autonomy) enableAutonomy(world, world.citizens[citizenId],count>9?{livelihood:RESOURCES[i%RESOURCES.length]}:{});
  }
  // A founder needs two discoverable edible sites: one T1 plant's 40 work +
  // 120 regrowth cycle yields fewer meals than one adult consumes. Do not
  // guarantee ownership, stock after contention, or rich food at every tile.
  const provisionedSites = new Set<string>();
  for (const citizen of Object.values(world.citizens)) {
    const nearbyFood = () => Object.values(world.deposits).filter((deposit) =>
      deposit.resource === 'food' && deposit.tier === 1 && distance(deposit, citizen) <= BALANCE.sightRadius &&
      !provisionedSites.has(deposit.id)).length;
    const reserveSites = () => {
      const sites = Object.values(world.deposits).filter((deposit) => deposit.resource === 'food' &&
        deposit.tier === 1 && distance(deposit, citizen) <= BALANCE.sightRadius && !provisionedSites.has(deposit.id));
      for (const site of sites.slice(0, 2)) provisionedSites.add(site.id);
    };
    if (nearbyFood() >= 2) { reserveSites(); continue; }
    const candidates: Point[] = [];
    for (let dx = -BALANCE.sightRadius; dx <= BALANCE.sightRadius; dx++)
      for (let dy = -BALANCE.sightRadius; dy <= BALANCE.sightRadius; dy++) {
        const point = { x: citizen.x + dx, y: citizen.y + dy };
        if (distance(citizen, point) <= BALANCE.sightRadius && inBounds(world, point) &&
          ringAt(world, point) === RING_COUNT - 1 && !occupied.has(`${point.x},${point.y}`)) candidates.push(point);
      }
    candidates.sort((a, b) => distance(citizen, a) - distance(citizen, b));
    for (const point of candidates) {
      if (nearbyFood() >= 2) break;
      const depositId = id(world, 'deposit');
      world.deposits[depositId] = { id: depositId, ...point, resource: 'food', tier: 1,
        stock: BALANCE.depositCapacity, capacity: BALANCE.depositCapacity, regrowAt: 0 };
      occupied.add(`${point.x},${point.y}`);
    }
    reserveSites();
  }
  ensureTelemetry(world);
  return world;
}

function report(
  world: World,
  citizen: Citizen,
  result: CommandResult,
  directiveRetry = false,
): CommandResult {
  citizen.lastResult = result.message;
  // Retain personal evidence without requesting a model review for executor-owned retries.
  event(world, directiveRetry ? 'directive' : result.ok ? 'command' : 'error', result.message, {
    citizenId: citizen.id,
    audience: [citizen.id],
  });
  return result;
}

/** Returns work inputs exactly once. Harvest stock is claimed by active-action
 * scans, not copied into inventory; cancelling simply releases that claim. */
export function cancelAction(world: World, citizenId: string, clearQueue = true): void {
  releaseAction(world, citizenId, clearQueue);
}

function requirements(world: World, citizen: Citizen, command: Command): CommandResult {
  const otherActions = Object.values(world.citizens)
    .filter((c) => c.alive && c.id !== citizen.id)
    .flatMap((c) => [c.action, c.emergency?.suspendedAction])
    .filter((a): a is Action => !!a);
  switch (command.type) {
    case 'move':
      return inBounds(world, command)
        ? ok('Destination valid.')
        : fail('invalid-destination', 'Choose whole coordinates inside the map.');
    case 'harvest': {
      const deposit = world.deposits[command.depositId];
      if (!deposit) return fail('missing-deposit', 'That deposit no longer exists.');
      const claimed = otherActions.filter(
        (a) => a.command.type === 'harvest' && a.command.depositId === deposit.id,
      ).length;
      if (deposit.stock <= claimed)
        return fail(
          'depleted-deposit',
          'Deposit is depleted or reserved; wait for regrowth or choose another.',
        );
      if (deposit.tier > Math.min(MAX_TIER, toolTier(citizen, deposit.resource) + 1)) {
        return fail(
          'tool-required',
          `Carry a usable matching tool (${MATCHING_TOOL[deposit.resource]}) of at least T${deposit.tier - 1}.`,
        );
      }
      return ok('Deposit available.');
    }
    case 'craft':
      return EQUIPMENT.includes(command.item) && validTier(command.tier)
        ? ok('Recipe valid.')
        : fail('invalid-recipe', `Choose axe, scythe, knife or sword and tier 1 through ${MAX_TIER}.`);
    case 'build': {
      if (!BUILDINGS.includes(command.kind) || !validTier(command.tier))
        return fail('invalid-building', `Choose a station or wall and tier 1 through ${MAX_TIER}.`);
      if (!inBounds(world, command))
        return fail('invalid-destination', 'Build at whole coordinates inside the map.');
      if (
        Object.values(world.buildings).some((b) => sameTile(b, command)) ||
        Object.values(world.deposits).some((d) => sameTile(d, command))
      ) {
        return fail(
          'occupied-site',
          'Buildings cannot cover another building or a resource deposit.',
        );
      }
      if (otherActions.some((a) => a.command.type === 'build' && sameTile(a.command, command)))
        return fail('reserved-site', 'Another construction action has reserved this tile.');
      if (
        command.kind === 'wall' &&
        Object.values(world.citizens).some((c) => c.alive && sameTile(c, command))
      )
        return fail('occupied-site', 'A wall cannot be placed on a citizen.');
      return ok('Site available.');
    }
    case 'refine': {
      const building = world.buildings[command.buildingId];
      if (!building || building.health <= 0)
        return fail('missing-station', 'That station no longer exists.');
      if (!STATION_RESOURCE[building.kind])
        return fail('not-station', 'Walls cannot refine materials.');
      if (building.ownerId !== citizen.id)
        return fail('not-owner', 'Only a station owner can operate it.');
      if (isBuildingListed(world, building.id))
        return fail('listed-station', 'Delist the station before processing.');
      if (!canRefine(building.tier, command.fromTier, command.direction)) {
        return fail(
          'invalid-refining-tier',
          `Use an adjacent tier within T1–T${MAX_TIER}: up inputs or down outputs must not exceed the station tier.`,
        );
      }
      return ok('Station available.');
    }
    default:
      return fail('unsupported-command', 'Not a supported physical action.');
  }
}

function costFor(world: World, command: Command): Inventory {
  if (command.type === 'craft') return equipmentRecipe(command.item, command.tier);
  if (command.type === 'build') return buildingRecipe(command.kind, command.tier);
  if (command.type === 'refine')
    return refinementRecipe(STATION_RESOURCE[world.buildings[command.buildingId].kind]!, command.fromTier, command.direction);
  return {};
}
function durationFor(world: World, citizen: Citizen, command: Command): number {
  switch (command.type) {
    case 'harvest': {
      const deposit = world.deposits[command.depositId];
      return harvestDuration(deposit.tier, toolTier(citizen, deposit.resource));
    }
    case 'craft':
      return BALANCE.craftTicks;
    case 'build':
      return BALANCE.buildTicks;
    case 'refine':
      return BALANCE.refineTicks[world.buildings[command.buildingId].tier];
    default:
      return BALANCE.moveTicks;
  }
}
function routeFor(
  world: World,
  citizen: Citizen,
  command: Command,
): { target: Point; path: Point[] } | null {
  let target: Point = { x: citizen.x, y: citizen.y };
  if (command.type === 'move' || command.type === 'build') target = { x: command.x, y: command.y };
  if (command.type === 'harvest') target = world.deposits[command.depositId];
  if (command.type === 'refine') target = world.buildings[command.buildingId];
  if (command.type === 'build' && command.kind === 'wall') {
    const routes = neighbors(target)
      .map((p) => ({ target: p, path: findPath(world, citizen, p) }))
      .filter((r): r is { target: Point; path: Point[] } => r.path !== null);
    routes.sort((a, b) => a.path.length - b.path.length);
    return routes[0] ?? null;
  }
  const path = findPath(world, citizen, target);
  return path === null ? null : { target: { x: target.x, y: target.y }, path };
}

function startAction(
  world: World,
  citizen: Citizen,
  command: Command,
  replace: boolean,
): CommandResult {
  if (isLifeAction(command)) return startLifeAction(world, citizen, command, replace);
  // Activation (including queued work) must not probe remote site occupants or claims.
  if (
    command.type === 'build' &&
    inBounds(world, command) &&
    distance(citizen, command) > BALANCE.sightRadius
  ) {
    return fail('outside-sight', 'Travel to the site before inspecting or building on it.');
  }
  const validity = requirements(world, citizen, command);
  if (!validity.ok) return validity;
  const route = routeFor(world, citizen, command);
  if (!route) return fail('unreachable', 'No walkable orthogonal route to the destination.');
  const reserved = costFor(world, command);
  const available = { ...citizen.inventory };
  if (replace && citizen.action) addInventory(available, citizen.action.reserved);
  if (replace && citizen.emergency?.suspendedAction)
    addInventory(available, citizen.emergency.suspendedAction.reserved);
  if (!hasInventory(available, reserved))
    return fail(
      'insufficient-materials',
      `Required unreserved materials: ${JSON.stringify(reserved)}. Match every ingredient tier.`,
    );
  // Validate before replacing, so an invalid command preserves unfinished work.
  if (replace) cancelAction(world, citizen.id);
  takeInventory(citizen.inventory, reserved);
  citizen.action = {
    id: id(world, 'action'),
    command: { ...command },
    phase: route.path.length ? 'travel' : 'work',
    startedTick: world.tick,
    elapsed: 0,
    duration: route.path.length ? BALANCE.moveTicks : durationFor(world, citizen, command),
    reserved,
    path: route.path,
    target: route.target,
  };
  return ok(`Started ${command.type}${route.path.length ? ' with travel' : ''}.`);
}

export function dispatch(
  world: World,
  citizenId: string,
  command: Command,
  source: 'external' | 'plan' | 'directive' = 'external',
  options?: WorldControlOptions,
): CommandResult {
  // The runner owns candidate/setup/scheduled external commands. Controllers
  // cannot use plan/directive authority to issue competing strategic commands.
  const strategic = strategyAllowed(citizenId, options);
  if (source !== 'external' && !strategic)
    return fail('evaluation-authority', 'Strategic commands are disabled for this citizen.');
  ensureTelemetry(world);
  const citizen = world.citizens[citizenId];
  if (!citizen?.alive || citizen.health <= 0)
    return fail('unavailable-citizen', 'A living, healthy citizen is required.');
  if (!command || typeof command !== 'object' || typeof command.type !== 'string')
    return report(world, citizen, fail('invalid-command', 'Provide a command object with a type.'));
  if (command.queue !== undefined && command.queue !== 'replace' && command.queue !== 'append')
    return report(world, citizen, fail('invalid-queue', 'Queue mode must be replace or append.'));
  let result: CommandResult;
  if (physical(command)) {
    const shape = isLifeAction(command)
      ? validateLifeCommand(citizen, command)
      : ok('Command valid.');
    if (!shape.ok) return report(world, citizen, shape);
    if (command.queue === 'append' && citizen.action) {
      // Queued inputs are reserved at activation, allowing gather -> craft plans.
      // Prerequisites such as stock/ownership are also rechecked at activation.
      if (citizen.queue.length >= BALANCE.queueLimit)
        result = fail('queue-full', `At most ${BALANCE.queueLimit} queued actions.`);
      else {
        citizen.queue.push({ ...command });
        result = ok(`Queued ${command.type}; inputs will be checked and reserved when it starts.`);
      }
    } else result = startAction(world, citizen, command, source === 'external');
  } else {
    switch (command.type) {
      case 'cancel':
        cancelAction(world, citizen.id);
        result = ok('Cancelled physical work and queue; unused inputs returned.');
        break;
      case 'order':
      case 'cancel-order':
      case 'transfer':
        result = marketCommand(world, citizenId, command);
        break;
      case 'consent':
        result = consentCommand(world, citizen, command);
        break;
      case 'give': {
        const recipient=world.citizens[command.citizenId];
        if(!recipient?.alive||recipient.id===citizen.id)result=fail('invalid-recipient','Choose another living citizen.');
        else if(distance(citizen,recipient)>1)result=fail('not-adjacent','Reach the recipient before giving carried goods.');
        else if(!CARRIED_ITEM_RE.test(command.item)||!Number.isSafeInteger(command.quantity)||command.quantity<1)result=fail('invalid-gift','Give a positive whole quantity of an exact carried item and tier.');
        else if(!hasInventory(citizen.inventory,{[command.item]:command.quantity}))result=fail('insufficient-items','Only unreserved carried goods can be given.');
        else {
          takeInventory(citizen.inventory,{[command.item]:command.quantity});
          addInventory(recipient.inventory,{[command.item]:command.quantity});
          event(world,'help',`${citizen.name} gave ${recipient.name} ${command.quantity} ${command.item}.`,{citizenId:citizen.id,targetId:recipient.id,x:recipient.x,y:recipient.y,audience:[citizen.id,recipient.id]});
          result=ok(`Gave ${command.quantity} ${command.item} to ${recipient.name}.`);
        }
        break;
      }
      case 'message': {
        if (
          typeof command.text !== 'string' ||
          !command.text.trim() ||
          command.text.length > BALANCE.messageLength
        )
          result = fail('invalid-message', `Send 1–${BALANCE.messageLength} characters.`);
        else if (command.to && !world.citizens[command.to]?.alive)
          result = fail(
            'missing-recipient',
            'Choose an existing living recipient or omit to for a public post.',
          );
        else if (
          world.messages.filter(
            (m) => m.from === citizen.id && m.tick > world.tick - BALANCE.messageWindow,
          ).length >= BALANCE.messagesPerWindow
        )
          result = fail(
            'message-rate',
            `At most ${BALANCE.messagesPerWindow} messages per ${BALANCE.messageWindow} ticks.`,
          );
        else {
          world.messages.push({
            id: id(world, 'message'),
            tick: world.tick,
            from: citizen.id,
            ...(command.to ? { to: command.to } : {}),
            text: command.text,
          });
          if (world.messages.length > BALANCE.messageHistory)
            world.messages.splice(0, world.messages.length - BALANCE.messageHistory);
          result = ok('Message sent.');
        }
        break;
      }
      case 'remember':
        if (
          typeof command.text !== 'string' ||
          !command.text.trim() ||
          command.text.length > BALANCE.memoryLength
        )
          result = fail(
            'invalid-memory',
            `Remember 1–${BALANCE.memoryLength} characters per note.`,
          );
        else {
          citizen.memories.push({ tick: world.tick, text: command.text });
          if (citizen.memories.length > BALANCE.memoryLimit) citizen.memories.shift();
          result = ok('Memory saved; oldest notes are evicted when full.');
        }
        break;
      case 'goals':
        if (
          !Array.isArray(command.goals) ||
          command.goals.length > BALANCE.goalLimit ||
          command.goals.some(
            (g) => typeof g !== 'string' || !g.trim() || g.length > BALANCE.goalLength,
          )
        )
          result = fail(
            'invalid-goals',
            `Set up to ${BALANCE.goalLimit} goals, each 1–${BALANCE.goalLength} characters.`,
          );
        else {
          citizen.goals = [...command.goals];
          result = ok('Goals replaced.');
        }
        break;
      default:
        result = fail('unsupported-command', 'Unknown command.');
    }
  }
  if (
    source === 'external' &&
    result.ok &&
    (physical(command) || command.type === 'cancel')
  ) {
    discardPlan(world, citizen, 'Approved plan superseded by an explicit command.');
    if (physical(command) || command.type === 'cancel')
      discardStrategy(world, citizen, 'Strategy superseded by an explicit command.');
  }
  return report(
    world,
    citizen,
    result,
    source === 'directive' && isDirectiveGatherRetry(citizen, command, result),
  );
}

function failAction(world: World, citizen: Citizen, result: CommandResult): void {
  const directiveRetry =
    !!citizen.action &&
    isDirectiveGatherRetry(citizen, citizen.action.command, result, citizen.action.id);
  if (citizen.action) {
    planActionResult(citizen, citizen.action.id, result);
    directiveActionResult(citizen, citizen.action.id, result);
  }
  cancelAction(world, citizen.id, false);
  report(world, citizen, result, directiveRetry);
}
function finishAction(world: World, citizen: Citizen): void {
  const action = citizen.action!;
  const command = action.command;
  switch (command.type) {
    case 'harvest': {
      const deposit = world.deposits[command.depositId];
      deposit.stock--;
      if (deposit.stock < deposit.capacity) deposit.regrowAt = world.tick + BALANCE.regrowTicks;
      addInventory(citizen.inventory, { [itemKey(deposit.resource, deposit.tier)]: 1 });
      witnessHarvest(world, citizen, deposit);
      break;
    }
    case 'craft':
      addInventory(citizen.inventory, { [itemKey(command.item, command.tier)]: 1 });
      break;
    case 'build': {
      const buildingId = id(world, 'building');
      const health = BALANCE.buildingHealth[command.tier];
      const building: Building = {
        id: buildingId,
        kind: command.kind,
        tier: command.tier,
        x: command.x,
        y: command.y,
        ownerId: citizen.id,
        health,
        maxHealth: health,
        materials: { ...action.reserved },
      };
      world.buildings[buildingId] = building;
      break;
    }
    case 'refine': {
      const resource = STATION_RESOURCE[world.buildings[command.buildingId].kind]!;
      addInventory(citizen.inventory, refinementOutput(resource, command.fromTier, command.direction));
      break;
    }
  }
  planActionResult(citizen, action.id, ok(`Completed ${command.type}.`));
  directiveActionResult(citizen, action.id, ok(`Completed ${command.type}.`));
  citizen.action = null; // Inputs consumed here, never also returned by cancellation.
  report(world, citizen, ok(`Completed ${command.type}.`));
  event(world, 'completion', `Completed ${command.type}.`, {
    citizenId: citizen.id,
    x: citizen.x,
    y: citizen.y,
    audience: [citizen.id],
  });
}
function advanceAction(world: World, citizen: Citizen): void {
  const action = citizen.action;
  if (!action) return;
  if (isLifeAction(action.command)) {
    advanceLifeAction(world, citizen);
    return;
  }
  // Detours can take a previously visible site out of sight. Keep the action's
  // claim and inputs, but defer dynamic site checks until sight returns. Work
  // always revalidates, including the tick that atomically commits construction.
  const hiddenBuildTravel =
    action.command.type === 'build' &&
    action.phase === 'travel' &&
    distance(citizen, action.command) > BALANCE.sightRadius;
  if (!hiddenBuildTravel) {
    const validity = requirements(world, citizen, action.command);
    if (!validity.ok) {
      failAction(world, citizen, validity);
      return;
    }
  }
  if (action.phase === 'travel') {
    const next = action.path[0];
    if (next && (!walkable(world, next) || distance(citizen, next) !== 1)) {
      const path = findPath(world, citizen, action.target);
      if (!path) {
        failAction(
          world,
          citizen,
          fail('unreachable', 'Route became blocked; work cancelled and inputs returned.'),
        );
        return;
      }
      action.path = path;
      action.elapsed = 0;
    }
    action.elapsed++;
    if (action.elapsed < BALANCE.moveTicks) return;
    action.elapsed = 0;
    const step = action.path.shift();
    if (step) {
      citizen.x = step.x;
      citizen.y = step.y;
    }
    if (action.path.length) return;
    if (action.command.type === 'move') {
      finishAction(world, citizen);
      return;
    }
    action.phase = 'work';
    action.duration = durationFor(world, citizen, action.command);
    return;
  }
  if (!sameTile(citizen, action.target) || !walkable(world, citizen)) {
    failAction(
      world,
      citizen,
      fail('work-position', 'Work position is no longer valid; inputs returned.'),
    );
    return;
  }
  action.elapsed++;
  if (action.elapsed >= action.duration) finishAction(world, citizen);
}
function startQueued(world: World, citizen: Citizen): void {
  while (!citizen.action && citizen.queue.length) {
    const command = citizen.queue.shift()!;
    // Submission of an appended plan may use dated knowledge. Never inspect
    // live prerequisites until the queued target is actually in current sight.
    const needsTargetSight = ['harvest', 'refine', 'attack', 'loot', 'reproduce'].includes(
      command.type,
    );
    // Build has its own position-based sight guard in startAction; local work
    // and coordinate movement need no entity projection here.
    const gate = needsTargetSight
      ? validateKnownCommand(world, citizen.id, command, 'activation')
      : ok('No entity sight required.');
    const result = gate.ok ? startAction(world, citizen, command, false) : gate;
    report(world, citizen, result);
  }
}
function sustain(world: World, citizen: Citizen): void {
  citizen.fullness = Math.max(0, citizen.fullness - BALANCE.fullnessDrain);
  // Inputs and market escrow are already removed from available inventory.
  for (const tier of TIERS) {
    const key = itemKey('food', tier),
      restored = nutrition(tier);
    if (
      (citizen.inventory[key] ?? 0) > 0 &&
      (BALANCE.maxFullness - citizen.fullness + 1e-9 >= restored || citizen.fullness <= 1e-9)
    ) {
      takeInventory(citizen.inventory, { [key]: 1 });
      citizen.fullness = Math.min(BALANCE.maxFullness, citizen.fullness + restored);
      event(world, 'meal', `Ate T${tier} food.`, { citizenId: citizen.id, audience: [citizen.id] });
      break;
    }
  }
  if (citizen.fullness <= 1e-9) {
    citizen.fullness = 0;
    citizen.health = Math.max(0, citizen.health - BALANCE.starvationDamage);
    if (citizen.health <= 1e-9) citizen.health = 0;
  } else citizen.health = Math.min(BALANCE.maxHealth, citizen.health + BALANCE.healing);
  if (citizen.health <= 0) settleDeath(world, citizen.id);
}

/** Tick order: regrowth, physical actions, meals/starvation, queue/plan advancement.
 * Commands and ticks are synchronous; the runtime owns scheduling/generations. */
export function tickWorld(world: World, count = 1, options?: WorldControlOptions): void {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error('Tick count must be a nonnegative whole safe integer.');
  validateWorldAuthority(world, options);
  ensureTelemetry(world);
  for (let tick = 0; tick < count; tick++) {
    // Snapshot membership, not parents or saved fields: only births produced
    // inside this tick receive the declared newborn authority automatically.
    const existingCitizens = options?.authority ? new Set(Object.keys(world.citizens)) : undefined;
    world.tick++;
    maintainSociety(world);
    for (const deposit of Object.values(world.deposits)) {
      if (
        deposit.stock < deposit.capacity &&
        deposit.regrowAt > 0 &&
        world.tick >= deposit.regrowAt
      ) {
        deposit.stock++;
        deposit.regrowAt = deposit.stock < deposit.capacity ? world.tick + BALANCE.regrowTicks : 0;
      }
    }
    for (const citizen of Object.values(world.citizens)) {
      if (!citizen.alive) continue;
      if (citizen.health <= 0) {
        settleDeath(world, citizen.id);
        continue;
      }
      const strategic = strategyAllowed(citizen.id, options);
      const emergencyActions = {
        command: (command: Command) => dispatch(world, citizen.id, command, 'directive', options),
      };
      const autonomyActions = { ...emergencyActions, cancel: () => cancelAction(world, citizen.id, false) };
      if (strategic) {
        reactAutonomy(world, citizen, autonomyActions, options);
        if (!citizen.autonomy) beginEmergency(world, citizen, emergencyActions);
      }
      advanceAction(world, citizen);
      if (!citizen.alive) continue;
      sustain(world, citizen);
      if (citizen.alive && citizen.health > 0) {
        if (!strategic) {
          // Candidate queues remain physical work; no emergency, plan or
          // directive may select additional actions or cancel accepted work.
          startQueued(world, citizen);
          continue;
        }
        const emergencyOwnedBody = !!citizen.emergency;
        advanceEmergency(world, citizen, emergencyActions);
        if (emergencyOwnedBody || citizen.emergency) continue;
        if (advanceAutonomy(world, citizen, autonomyActions, options)) continue;
        startQueued(world, citizen);
        advancePlan(world, citizen, {
          command: (command) => dispatch(world, citizen.id, command, 'plan', options),
          cancel: () => cancelAction(world, citizen.id, false),
        }, options);
        if (!citizen.plan && !citizen.queue.length)
          advanceDirectives(world, citizen, {
            command: (command) => dispatch(world, citizen.id, command, 'directive', options),
            cancel: () => cancelAction(world, citizen.id, false),
          }, options);
      }
    }
    if (existingCitizens && options?.authority) {
      for (const citizenId of Object.keys(world.citizens)) {
        if (!existingCitizens.has(citizenId))
          options.authority.citizens[citizenId] = options.authority.newbornAuthority ?? 'passive-body';
      }
    }
    sampleTelemetry(world);
  }
}
