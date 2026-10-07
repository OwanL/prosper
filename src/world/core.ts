import type {
  Action,
  Building,
  Citizen,
  Command,
  CommandResult,
  EquipmentKind,
  Inventory,
  Point,
  Resource,
  Tier,
  World,
} from '../shared/types.ts';
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
  regionAt,
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
} from './config.ts';
import { findPath, inBounds, neighbors, walkable } from './pathfinding.ts';
import { isBuildingListed, marketCommand } from './market.ts';
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
const validTier = (tier: number): tier is Tier => tier === 1 || tier === 2 || tier === 3;
const sameTile = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const physical = (command: Command) => physicalTypes.has(command.type);
const toolTier = (citizen: Citizen, resource: Resource): number => {
  const key = citizen.equipment[MATCHING_TOOL[resource]];
  return key && (citizen.inventory[key] ?? 0) > 0 ? Number(key.split(':')[1]) : 0;
};

/** Seeded, serializable creation. Only this function mints gold. */
export function createWorld(
  options: { seed?: number; scenario?: string; runId?: string } = {},
): World {
  const scenario = options.scenario ?? 'village';
  if (!['village', 'competition', 'progression'].includes(scenario))
    throw new Error(`Unknown scenario: ${scenario}`);
  const seed = (options.seed ?? 1) >>> 0;
  const world: World = {
    schemaVersion: 1,
    runId: options.runId ?? `run-${seed}-${scenario}`,
    seed,
    rngState: seed || 1,
    nextId: 1,
    tick: 0,
    width: BALANCE.width,
    height: BALANCE.height,
    initialGold: 0,
    citizens: {},
    deposits: {},
    buildings: {},
    orders: {},
    loot: {},
    messages: [],
    events: [],
  };
  // Three angular resource areas in each ring, with exact deposit counts. Ring 2
  // has only 3 T2 deposits out of 72 (4.17%); ring 1 is 75% T2.
  for (const region of ['ring2', 'ring1', 'center'] as const) {
    for (let resourceIndex = 0; resourceIndex < RESOURCES.length; resourceIndex++) {
      const pool: Point[] = [];
      for (let y = 0; y < world.height; y++)
        for (let x = 0; x < world.width; x++) {
          const angle = Math.atan2(y - (world.height - 1) / 2, x - (world.width - 1) / 2) + Math.PI;
          const sector = Math.min(2, Math.floor(angle / ((2 * Math.PI) / 3)));
          if (regionAt(world, { x, y }) === region && sector === resourceIndex) pool.push({ x, y });
        }
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random(world) * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const count = region === 'ring2' ? 24 : region === 'ring1' ? 12 : 6;
      for (let i = 0; i < Math.min(count, pool.length); i++) {
        const tier: Tier =
          region === 'center' ? 3 : region === 'ring1' ? (i < 3 ? 1 : 2) : i === 0 ? 2 : 1;
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
  const count =
    scenario === 'competition' ? 9 : scenario === 'progression' ? 3 : BALANCE.initialCitizens;
  const names = ['Ada', 'Bram', 'Cora', 'Dara', 'Eli', 'Faye', 'Galen', 'Hana', 'Ivo'];
  const personalities = [
    'Practical and community-minded',
    'Ambitious and cautious',
    'Independent and curious',
  ];
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
  for (let i = 0; i < count; i++) {
    const resource = RESOURCES[i % RESOURCES.length];
    const starts = Object.values(world.deposits).filter(
      (d) => d.resource === resource && d.tier === 1 && regionAt(world, d) === 'ring2',
    );
    const start = starts[Math.floor(i / RESOURCES.length) * 7];
    const citizenId = id(world, 'citizen');
    world.citizens[citizenId] = {
      id: citizenId,
      name: names[i],
      color: colors[i],
      personality: personalities[i % personalities.length],
      x: start.x,
      y: start.y,
      alive: true,
      health: BALANCE.maxHealth,
      fullness: BALANCE.maxFullness,
      gold: BALANCE.startingGold,
      inventory: { 'food:1': BALANCE.startingFood },
      equipment: {},
      action: null,
      queue: [],
      goals: ['Stay fed', 'Learn a useful trade'],
      memories: [],
      knowledge: {},
      lastResult: 'Ready to gather T1 materials.',
      nextReviewTick: 0,
      consent: {},
      reproductionCooldown: 0,
      parents: [],
    };
    world.initialGold += BALANCE.startingGold;
  }
  return world;
}

function report(world: World, citizen: Citizen, result: CommandResult): CommandResult {
  citizen.lastResult = result.message;
  event(world, result.ok ? 'command' : 'error', result.message, {
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
    .map((c) => c.action)
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
      if (deposit.tier > Math.min(3, toolTier(citizen, deposit.resource) + 1)) {
        return fail(
          'tool-required',
          `Equip a matching ${MATCHING_TOOL[deposit.resource]} of at least T${deposit.tier - 1}.`,
        );
      }
      return ok('Deposit available.');
    }
    case 'craft':
      return EQUIPMENT.includes(command.item) && validTier(command.tier)
        ? ok('Recipe valid.')
        : fail('invalid-recipe', 'Choose axe, scythe, knife or sword and tier 1, 2 or 3.');
    case 'build': {
      if (!BUILDINGS.includes(command.kind) || !validTier(command.tier))
        return fail('invalid-building', 'Choose a station or wall and tier 1, 2 or 3.');
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
      if (
        (command.fromTier !== 1 && command.fromTier !== 2) ||
        (command.fromTier === 2 && building.tier === 1)
      ) {
        return fail(
          'invalid-refining-tier',
          'T1 stations process T1; T2/T3 stations process T1 or T2. No T4 output.',
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
    return {
      [itemKey(STATION_RESOURCE[world.buildings[command.buildingId].kind]!, command.fromTier)]: 3,
    };
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

function equipmentCommand(world: World, citizen: Citizen, command: Command): CommandResult {
  if (command.type !== 'equip' && command.type !== 'unequip')
    return fail('unsupported-command', 'Not an equipment command.');
  const match =
    command.type === 'equip' && typeof command.item === 'string'
      ? /^(axe|scythe|knife|sword):([123])$/.exec(command.item)
      : null;
  const kind =
    command.type === 'unequip' ? command.kind : (match?.[1] as EquipmentKind | undefined);
  if (!kind || !EQUIPMENT.includes(kind))
    return fail('invalid-equipment', 'Choose axe, scythe, knife or sword with an exact tier.');
  const action = citizen.action?.command;
  const deposit = action?.type === 'harvest' ? world.deposits[action.depositId] : undefined;
  if (deposit && MATCHING_TOOL[deposit.resource] === kind)
    return fail('equipment-in-use', 'Cancel harvesting before changing its matching tool.');
  if (action?.type === 'attack' && kind === 'sword')
    return fail('equipment-in-use', 'Cancel attacking before changing its sword.');
  if (command.type === 'equip') {
    if ((citizen.inventory[command.item] ?? 0) < 1)
      return fail('missing-equipment', 'That equipment is not in your unreserved inventory.');
    citizen.equipment[kind] = command.item;
    return ok(`Equipped ${command.item}; it remains one carried unit.`);
  }
  delete citizen.equipment[kind];
  return ok(`Unequipped ${kind}.`);
}

export function dispatch(world: World, citizenId: string, command: Command): CommandResult {
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
    } else result = startAction(world, citizen, command, true);
  } else {
    switch (command.type) {
      case 'cancel':
        cancelAction(world, citizen.id);
        result = ok('Cancelled physical work and queue; unused inputs returned.');
        break;
      case 'equip':
      case 'unequip':
        result = equipmentCommand(world, citizen, command);
        break;
      case 'order':
      case 'cancel-order':
      case 'transfer':
        result = marketCommand(world, citizenId, command);
        break;
      case 'consent':
        result = consentCommand(world, citizen, command);
        break;
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
  return report(world, citizen, result);
}

function failAction(world: World, citizen: Citizen, result: CommandResult): void {
  cancelAction(world, citizen.id, false);
  report(world, citizen, result);
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
      addInventory(citizen.inventory, { [itemKey(resource, command.fromTier + 1)]: 1 });
      break;
    }
  }
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
    const result = startAction(world, citizen, command, false);
    report(world, citizen, result);
  }
}
function sustain(world: World, citizen: Citizen): void {
  citizen.fullness = Math.max(0, citizen.fullness - BALANCE.fullnessDrain);
  // Inputs and market escrow are already removed from available inventory.
  for (const tier of [1, 2, 3] as const) {
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

/** Tick order: regrowth, physical actions, meals/starvation, queued activation.
 * Commands and ticks are synchronous; the runtime owns scheduling/generations. */
export function tickWorld(world: World, count = 1): void {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error('Tick count must be a nonnegative whole safe integer.');
  for (let tick = 0; tick < count; tick++) {
    world.tick++;
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
      advanceAction(world, citizen);
      if (!citizen.alive) continue;
      sustain(world, citizen);
      if (citizen.alive && citizen.health > 0) startQueued(world, citizen);
    }
  }
}
