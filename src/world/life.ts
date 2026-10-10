import type {
  Action,
  Building,
  Citizen,
  Command,
  CommandResult,
  Inventory,
  Point,
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
  takeInventory,
} from '../shared/utils.ts';
import { BALANCE } from './config.ts';
import { allocateCitizenName } from './names.ts';
import { cancelBuildingOrders, cancelCitizenOrders } from './market.ts';
import { findPath, neighbors, walkable } from './pathfinding.ts';
import { discardPlan, planActionResult } from './plans.ts';
import {
  directiveActionResult,
  directiveJointActionStarted,
  discardStrategy,
} from './directives.ts';
import { cancelEmergency } from './emergency.ts';
import { inheritAutonomy } from './autonomy.ts';
import { highestToolTier } from '../shared/tool-utils.ts';

export const isLifeAction = (command: Command) =>
  ['attack', 'loot', 'reproduce'].includes(command.type);
const point = (p: Point): Point => ({ x: p.x, y: p.y });
const sameTile = (a: Point, b: Point) => distance(a, b) === 0;
const visible = (citizen: Citizen, target: Point) =>
  distance(citizen, target) <= BALANCE.sightRadius;
const living = (citizen: Citizen | undefined): citizen is Citizen =>
  !!citizen?.alive && citizen.health > 0;
const foodCost = (): Inventory => ({
  [itemKey('food', BALANCE.reproductionFoodTier)]: BALANCE.reproductionFood,
});
function attackTarget(world: World, targetId: string): Citizen | Building | undefined {
  return world.citizens[targetId] ?? world.buildings[targetId];
}

function feedback(world: World, citizen: Citizen, result: CommandResult): CommandResult {
  citizen.lastResult = result.message;
  event(world, result.ok ? 'completion' : 'error', result.message, {
    citizenId: citizen.id,
    audience: [citizen.id],
  });
  return result;
}

/** Shared cancellation boundary, including both halves of joint work. No callbacks
 * or ephemeral operation state: reservations and joint IDs survive checkpoints. */
export function releaseAction(world: World, citizenId: string, clearQueue = true): void {
  const citizen = world.citizens[citizenId];
  if (!citizen) return;
  const action = citizen.action;
  if (action) {
    addInventory(citizen.inventory, action.reserved);
    citizen.action = null;
    const partner = action.partnerId ? world.citizens[action.partnerId] : undefined;
    if (partner?.action?.id === action.id && partner.action.partnerId === citizen.id) {
      planActionResult(
        partner,
        action.id,
        fail('joint-cancelled', 'Joint reproduction cancelled.'),
      );
      directiveActionResult(
        partner,
        action.id,
        fail('joint-cancelled', 'Joint reproduction cancelled.'),
      );
      addInventory(partner.inventory, partner.action.reserved);
      partner.action = null;
      feedback(
        world,
        partner,
        fail('joint-cancelled', 'Joint reproduction cancelled; unused food returned.'),
      );
    }
  }
  if (clearQueue) {
    cancelEmergency(
      world,
      citizen,
      citizen.health <= 0
        ? 'Death interrupted emergency'
        : 'Explicit replacement/cancel interrupted emergency',
    );
    discardStrategy(world, citizen, 'Strategy cancelled; unused work inputs returned.');
    citizen.queue = [];
    discardPlan(world, citizen, 'Approved plan cancelled; unused work inputs returned.');
  }
}

/** Called for both attacks and starvation. Escrow and work return BEFORE holdings
 * move; alive=false and emptied holdings guard against duplicate settlement. */
export function settleDeath(world: World, citizenId: string, killerId?: string): void {
  const citizen = world.citizens[citizenId];
  if (!citizen?.alive) return;
  cancelEmergency(world, citizen, 'Death interrupted emergency');
  releaseAction(world, citizenId);
  cancelCitizenOrders(world, citizenId);
  citizen.alive = false;
  citizen.health = 0;
  citizen.consent = {};
  for (const other of Object.values(world.citizens)) delete other.consent[citizenId];
  for (const building of Object.values(world.buildings))
    if (building.ownerId === citizenId) building.ownerId = null;
  const killer = killerId ? world.citizens[killerId] : undefined;
  if (living(killer) && killer.id !== citizenId) {
    killer.gold += citizen.gold;
    addInventory(killer.inventory, citizen.inventory);
  } else {
    const lootId = id(world, 'loot');
    world.loot[lootId] = {
      id: lootId,
      citizenName: citizen.name,
      ...point(citizen),
      gold: citizen.gold,
      inventory: { ...citizen.inventory },
    };
  }
  citizen.gold = 0;
  citizen.inventory = {};
  citizen.lastResult = killer
    ? `Killed by ${killer.name}.`
    : 'Died of starvation; holdings remain at the body.';
  event(world, 'death', citizen.lastResult, {
    citizenId,
    ...(killer ? { targetId: killer.id } : {}),
    ...point(citizen),
    audience: [citizenId, ...(killer ? [killer.id] : [])],
  });
}

export function validateLifeCommand(citizen: Citizen, command: Command): CommandResult {
  switch (command.type) {
    case 'attack':
      if (
        typeof command.targetId !== 'string' ||
        !command.targetId.trim() ||
        command.targetId === citizen.id
      )
        return fail('invalid-target', 'Choose another citizen or a building ID.');
      break;
    case 'loot':
      if (typeof command.lootId !== 'string' || !command.lootId.trim())
        return fail('invalid-loot', 'Choose a body ID.');
      break;
    case 'reproduce':
    case 'consent':
      if (
        typeof command.partnerId !== 'string' ||
        !command.partnerId.trim() ||
        command.partnerId === citizen.id
      )
        return fail('invalid-partner', 'Choose another living citizen.');
      if (command.type === 'consent' && typeof command.accept !== 'boolean')
        return fail(
          'invalid-consent',
          'Consent accept must be true or false. Messages are not consent.',
        );
      break;
    default:
      return fail('unsupported-command', 'Not a life command.');
  }
  return ok('Life command valid.');
}

export function consentCommand(world: World, citizen: Citizen, command: Command): CommandResult {
  const validity = validateLifeCommand(citizen, command);
  if (!validity.ok) return validity;
  if (command.type !== 'consent') return fail('unsupported-command', 'Not a consent command.');
  const partner = world.citizens[command.partnerId];
  if (!living(partner)) return fail('missing-partner', 'Consent requires another living citizen.');
  if (command.accept) citizen.consent[partner.id] = world.tick + BALANCE.consentTicks;
  else {
    delete citizen.consent[partner.id];
    if (citizen.action?.partnerId === partner.id) releaseAction(world, citizen.id, false);
  }
  return ok(
    command.accept
      ? `Consent to ${partner.name} recorded for ${BALANCE.consentTicks} ticks.`
      : 'Consent withdrawn; any joint work cancelled.',
  );
}

function reproductionRequirements(
  world: World,
  citizen: Citizen,
  partner: Citizen | undefined,
): CommandResult {
  if (!living(citizen) || !living(partner))
    return fail('missing-partner', 'Both parents must be alive.');
  if (distance(citizen, partner) > 1 || !walkable(world, citizen) || !walkable(world, partner))
    return fail('not-adjacent', 'Meet on the same or orthogonally adjacent walkable tiles first.');
  if (!(citizen.consent[partner.id] > world.tick && partner.consent[citizen.id] > world.tick))
    return fail(
      'consent-required',
      'Both parents must explicitly consent to each other; consent may have expired.',
    );
  if (citizen.health < BALANCE.reproductionHealth || partner.health < BALANCE.reproductionHealth)
    return fail(
      'parent-health',
      `Both parents need at least ${BALANCE.reproductionHealth} health.`,
    );
  if (citizen.reproductionCooldown > world.tick || partner.reproductionCooldown > world.tick)
    return fail('parent-cooldown', 'Both parents must be off reproduction cooldown.');
  return ok('Parents ready.');
}

/** Dated knowledge is only an initial destination. Never query an unseen target's
 * live position. Owner buildings have an explicit property-location exception. */
function knownTarget(world: World, citizen: Citizen, targetId: string): Point | null {
  const target = attackTarget(world, targetId);
  if (
    target &&
    (visible(citizen, target) || ('ownerId' in target && target.ownerId === citizen.id))
  )
    return point(target);
  let latest: { tick: number; point: Point } | undefined;
  for (const tile of Object.values(citizen.knowledge)) {
    const sighting =
      tile.citizens.find((c) => c.id === targetId) ?? tile.buildings.find((b) => b.id === targetId);
    if (sighting && (!latest || tile.seenTick > latest.tick))
      latest = { tick: tile.seenTick, point: point(sighting) };
  }
  return latest?.point ?? null;
}
function combatRoute(
  world: World,
  citizen: Citizen,
  destination: Point,
  search = false,
): Point[] | null {
  const destinations = search ? [destination] : [destination, ...neighbors(destination)];
  const routes = destinations
    .filter((p) => walkable(world, p))
    .map((p) => findPath(world, citizen, p))
    .filter((p): p is Point[] => p !== null);
  routes.sort((a, b) => a.length - b.length);
  return routes[0] ?? null;
}
function makeAction(
  world: World,
  command: Command,
  target: Point,
  path: Point[],
  duration: number,
  reserved: Inventory = {},
): Action {
  return {
    id: id(world, 'action'),
    command: { ...command },
    phase: path.length ? 'travel' : 'work',
    startedTick: world.tick,
    elapsed: 0,
    duration: path.length ? BALANCE.moveTicks : duration,
    reserved,
    path,
    target: point(target),
  };
}

export function startLifeAction(
  world: World,
  citizen: Citizen,
  command: Command,
  replace: boolean,
): CommandResult {
  const validity = validateLifeCommand(citizen, command);
  if (!validity.ok) return validity;
  if (command.type === 'reproduce') {
    const partner = world.citizens[command.partnerId];
    const readiness = reproductionRequirements(world, citizen, partner);
    if (!readiness.ok) return readiness;
    if (partner.action)
      return fail(
        'partner-busy',
        'Partner must finish or cancel physical work before joint reproduction.',
      );
    const cost = foodCost();
    const available = { ...citizen.inventory };
    if (replace && citizen.action) addInventory(available, citizen.action.reserved);
    if (replace && citizen.emergency?.suspendedAction)
      addInventory(available, citizen.emergency.suspendedAction.reserved);
    if (!hasInventory(available, cost) || !hasInventory(partner.inventory, cost))
      return fail(
        'parent-food',
        `Each parent must pay ${BALANCE.reproductionFood} unreserved T${BALANCE.reproductionFoodTier} food.`,
      );
    if (replace) releaseAction(world, citizen.id);
    takeInventory(citizen.inventory, cost);
    takeInventory(partner.inventory, cost);
    const action = makeAction(world, command, citizen, [], BALANCE.reproductionTicks, { ...cost });
    action.partnerId = partner.id;
    citizen.action = action;
    partner.action = {
      ...action,
      command: { type: 'reproduce', partnerId: citizen.id },
      target: point(partner),
      reserved: { ...cost },
      path: [],
      partnerId: citizen.id,
    };
    directiveJointActionStarted(world, citizen);
    directiveJointActionStarted(world, partner);
    partner.lastResult = `Started joint reproduction with ${citizen.name}.`;
    return ok('Started joint reproduction; both parents occupied and food reserved.');
  }
  let target: Point | null = null;
  let path: Point[] | null = null;
  let duration: number;
  if (command.type === 'attack') {
    target = knownTarget(world, citizen, command.targetId);
    if (!target)
      return fail('unknown-target', 'Target is not visible or in dated knowledge; find it first.');
    const liveTarget = attackTarget(world, command.targetId);
    const current = liveTarget && visible(citizen, liveTarget);
    if (current && (!('ownerId' in liveTarget) ? !living(liveTarget) : liveTarget.health <= 0))
      return fail('missing-target', 'That target is dead or destroyed.');
    path = combatRoute(world, citizen, target, !current);
    duration = BALANCE.attackTicks;
  } else if (command.type === 'loot') {
    const body = world.loot[command.lootId];
    if (!body) return fail('missing-loot', 'That body is gone or already collected.');
    // Body positions never move. Pickup still requires timed travel and work.
    target = point(body);
    path = findPath(world, citizen, target);
    duration = BALANCE.lootTicks;
  } else return fail('unsupported-command', 'Not a physical life action.');
  if (!path)
    return fail('unreachable', 'No walkable route to the target; no remote hits or pickup.');
  if (replace) releaseAction(world, citizen.id);
  citizen.action = makeAction(world, command, target!, path, duration);
  return ok(`Started ${command.type}${path.length ? ' with travel' : ''}.`);
}

function stop(world: World, citizen: Citizen, result: CommandResult): void {
  if (citizen.action) {
    planActionResult(citizen, citizen.action.id, result);
    directiveActionResult(citizen, citizen.action.id, result);
  }
  releaseAction(world, citizen.id, false);
  feedback(world, citizen, result);
}
function travel(world: World, citizen: Citizen, action: Action, path: Point[]): void {
  // Replanning must not reset the movement clock while following a moving target.
  if (action.path[0] && path[0] && !sameTile(action.path[0], path[0])) action.elapsed = 0;
  if (action.phase !== 'travel') action.elapsed = 0;
  action.path = path;
  action.phase = 'travel';
  action.duration = BALANCE.moveTicks;
  action.elapsed++;
  if (action.elapsed >= BALANCE.moveTicks) {
    const step = action.path.shift();
    if (step && walkable(world, step) && distance(citizen, step) === 1) {
      citizen.x = step.x;
      citizen.y = step.y;
    }
    action.elapsed = 0;
    if (!action.path.length) {
      action.phase = 'work';
      action.duration = action.command.type === 'attack' ? BALANCE.attackTicks : BALANCE.lootTicks;
    }
  }
}
function destroyBuilding(world: World, building: Building, attacker: Citizen): void {
  cancelBuildingOrders(world, building.id);
  // Processing inputs belong to the worker, not construction salvage.
  for (const worker of Object.values(world.citizens)) {
    if (
      worker.action?.command.type === 'refine' &&
      worker.action.command.buildingId === building.id
    )
      stop(
        world,
        worker,
        fail('missing-station', 'Station destroyed; processing inputs returned.'),
      );
  }
  delete world.buildings[building.id];
  addInventory(
    attacker.inventory,
    Object.fromEntries(
      Object.entries(building.materials).map(([key, n]) => [
        key,
        Math.floor(n * BALANCE.salvageFraction),
      ]),
    ),
  );
  event(world, 'destruction', `Destroyed ${building.id}; construction salvage awarded once.`, {
    citizenId: attacker.id,
    targetId: building.id,
    ...point(building),
    audience: [attacker.id, ...(building.ownerId ? [building.ownerId] : [])],
  });
}
function advanceAttack(world: World, citizen: Citizen, action: Action, targetId: string): void {
  const target = attackTarget(world, targetId);
  const current = !!target && visible(citizen, target);
  if (current) {
    if ('ownerId' in target ? target.health <= 0 : !living(target)) {
      stop(world, citizen, fail('missing-target', 'Target is dead or destroyed; attack stopped.'));
      return;
    }
    action.target = point(target);
  }
  const inRange =
    current &&
    distance(citizen, target) <= 1 &&
    walkable(world, citizen) &&
    ('ownerId' in target || walkable(world, target));
  if (!inRange) {
    const path = combatRoute(world, citizen, action.target, !current);
    if (!path) {
      stop(
        world,
        citizen,
        fail('unreachable-target', 'Target route is blocked by walls; attack stopped.'),
      );
      return;
    }
    if (!path.length) {
      stop(
        world,
        citizen,
        fail(
          'lost-target',
          'Reached the last-seen position but target is lost or cannot be struck here.',
        ),
      );
      return;
    }
    travel(world, citizen, action, path);
    return;
  }
  if (action.phase !== 'work') action.elapsed = 0;
  action.phase = 'work';
  action.path = [];
  action.duration = BALANCE.attackTicks;
  action.elapsed++;
  if (action.elapsed < action.duration) return;
  action.elapsed = 0;
  const tier=highestToolTier(citizen,'sword') as keyof typeof BALANCE.attackDamage;
  const damage = BALANCE.attackDamage[tier] * (0.5 + random(world));
  target.health = Math.max(0, target.health - damage);
  const building = 'ownerId' in target;
  const audience = [
    citizen.id,
    ...(building ? (target.ownerId ? [target.ownerId] : []) : [target.id]),
    ...Object.values(world.citizens).filter((witness)=>witness.alive&&distance(witness,target)<=BALANCE.sightRadius).map((witness)=>witness.id),
  ];
  // Property coordinates, never the remote live position of its attacker.
  event(
    world,
    'attack',
    `${citizen.name} (${citizen.id}) attacked ${target.id} at (${target.x}, ${target.y}) for ${damage.toFixed(2)} damage; ${target.health.toFixed(2)} health remains.`,
    { citizenId: citizen.id, targetId, ...point(target), audience },
  );
  if (target.health <= 0) {
    if (building) destroyBuilding(world, target, citizen);
    else settleDeath(world, target.id, citizen.id);
    planActionResult(citizen, action.id, ok(`Defeated ${targetId}.`));
    directiveActionResult(citizen, action.id, ok(`Defeated ${targetId}.`));
    citizen.action = null;
    feedback(
      world,
      citizen,
      ok(`Defeated ${targetId}; holdings or construction salvage collected once.`),
    );
  } else citizen.lastResult = `Hit ${targetId} for ${damage.toFixed(2)} damage; attack continues.`;
}
function advanceReproduction(world: World, citizen: Citizen, action: Action): void {
  const partner = action.partnerId ? world.citizens[action.partnerId] : undefined;
  const validity = reproductionRequirements(world, citizen, partner);
  if (
    !validity.ok ||
    partner?.action?.id !== action.id ||
    partner.action.partnerId !== citizen.id
  ) {
    stop(
      world,
      citizen,
      validity.ok
        ? fail('joint-cancelled', 'Partner is no longer participating; food returned.')
        : validity,
    );
    return;
  }
  if (citizen.id > partner.id) return; // One clock and one completion for the pair.
  action.elapsed++;
  partner.action.elapsed = action.elapsed;
  if (action.elapsed < action.duration) return;
  for (const parent of [citizen, partner]) {
    planActionResult(parent, action.id, ok('Reproduction completed.'));
    directiveActionResult(parent, action.id, ok('Reproduction completed.'));
  }
  citizen.action = null;
  partner.action = null; // Consume both reservations once.
  citizen.reproductionCooldown = partner.reproductionCooldown =
    world.tick + BALANCE.reproductionCooldown;
  for(const parent of [citizen,partner])if(parent.autonomy) {
    delete parent.autonomy.meeting;
    delete parent.autonomy.requestedPartnerId;
    delete parent.autonomy.familyFoodTarget;
    parent.autonomy.signals=parent.autonomy.signals?.filter((signal)=>!['family-offer','family-accept','family-ready'].includes(signal.kind));
    parent.autonomy.intent='Support my family and return to livelihood';
  }
  delete citizen.consent[partner.id];
  delete partner.consent[citizen.id];
  const childId = id(world, 'citizen');
  const disposition = [
    'Curious and independent',
    'Protective and practical',
    'Ambitious and sociable',
  ][Math.floor(random(world) * 3)];
  const color = `hsl(${Math.floor(random(world) * 360)}, 55%, 55%)`;
  world.citizens[childId] = {
    id: childId,
    name: allocateCitizenName(world.citizens),
    ...point(citizen),
    color,
    personality: disposition,
    alive: true,
    health: BALANCE.newbornHealth,
    fullness: BALANCE.newbornFullness,
    gold: 0,
    inventory: {},
    action: null,
    queue: [],
    parents: [citizen.id, partner.id],
    goals: ['Stay fed', 'Discover my own livelihood'],
    memories: [],
    knowledge: {},
    lastResult: 'Born adult-capable; no inherited holdings.',
    nextReviewTick: world.tick,
    consent: {},
    reproductionCooldown: 0,
  };
  inheritAutonomy(world, world.citizens[childId], citizen, partner);
  feedback(world, citizen, ok(`Reproduction completed: ${childId}.`));
  feedback(world, partner, ok(`Reproduction completed: ${childId}.`));
  event(world, 'birth', `${childId} born to ${citizen.id} and ${partner.id}.`, {
    citizenId: childId,
    ...point(citizen),
    audience: [citizen.id, partner.id, childId],
  });
}

export function advanceLifeAction(world: World, citizen: Citizen): void {
  const action = citizen.action;
  if (!action) return;
  const command = action.command;
  if (command.type === 'attack') {
    advanceAttack(world, citizen, action, command.targetId);
    return;
  }
  if (command.type === 'reproduce') {
    advanceReproduction(world, citizen, action);
    return;
  }
  if (command.type !== 'loot') return;
  const body = world.loot[command.lootId];
  if (!body) {
    stop(world, citizen, fail('missing-loot', 'Body already collected; pickup cancelled.'));
    return;
  }
  if (!sameTile(citizen, body)) {
    const path = findPath(world, citizen, body);
    if (!path) {
      stop(
        world,
        citizen,
        fail('unreachable-loot', 'Body route became blocked; pickup cancelled.'),
      );
      return;
    }
    travel(world, citizen, action, path);
    return;
  }
  if (!walkable(world, citizen)) {
    stop(world, citizen, fail('work-position', 'Body tile is blocked; pickup cancelled.'));
    return;
  }
  if (action.phase !== 'work') action.elapsed = 0;
  action.phase = 'work';
  action.duration = BALANCE.lootTicks;
  action.elapsed++;
  if (action.elapsed < action.duration) return;
  citizen.gold += body.gold;
  addInventory(citizen.inventory, body.inventory);
  delete world.loot[body.id];
  if (citizen.action) {
    planActionResult(citizen, citizen.action.id, ok('Collected all body holdings once.'));
    directiveActionResult(citizen, citizen.action.id, ok('Collected all body holdings once.'));
  }
  citizen.action = null;
  feedback(world, citizen, ok('Collected all body holdings once.'));
  event(world, 'loot', 'Body collected.', {
    citizenId: citizen.id,
    targetId: body.id,
    ...point(body),
    audience: [citizen.id],
  });
}
