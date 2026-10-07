import { inArea } from './places.mjs';
import { equipmentLevel } from './equipment.mjs';
const SIGHT_RADIUS = 3;
const DEFAULTS = {
  crop: { capacity: 1, yield: 1, regrowTicks: 99 },
  tree: { capacity: 1, yield: 5, regrowTicks: 120 },
};

function inBounds(x, y, width, height) {
  return Number.isInteger(x) && Number.isInteger(y) &&
    x >= 0 && y >= 0 && x < width && y < height;
}

function boardFor(world, vision = true, citizen) {
  if (!world || !Number.isInteger(world.width) || world.width < 1 ||
      !Number.isInteger(world.height) || world.height < 1) return null;
  const blocked = new Set();
  if (Array.isArray(world.blocked)) {
    for (const tile of world.blocked) {
      if (tile && inBounds(tile.x, tile.y, world.width, world.height)) {
        blocked.add(`${tile.x},${tile.y}`);
      }
    }
  }
  for (const building of Array.isArray(world.buildings) ? world.buildings : []) {
    if ((vision || building?.kind === 'wall' || (building?.kind === 'house' && building.ownerId !== citizen?.id))
      && building?.health > 0 && building.destroyed !== true && inBounds(building.x, building.y, world.width, world.height)) {
      blocked.add(`${building.x},${building.y}`);
    }
  }
  return { width: world.width, height: world.height, blocked };
}

function ensureKnowledge(citizen) {
  if (!citizen || typeof citizen !== 'object') return { nodes: {}, explored: [], people: {}, buildings: {} };
  if (!citizen.knowledge || typeof citizen.knowledge !== 'object' || Array.isArray(citizen.knowledge)) {
    citizen.knowledge = { nodes: {}, explored: [], people: {}, buildings: {} };
  }
  if (!citizen.knowledge.nodes || typeof citizen.knowledge.nodes !== 'object' || Array.isArray(citizen.knowledge.nodes)) {
    citizen.knowledge.nodes = {};
  }
  if (!citizen.knowledge.people || typeof citizen.knowledge.people !== 'object' || Array.isArray(citizen.knowledge.people)) {
    citizen.knowledge.people = {};
  }
  if (!citizen.knowledge.buildings || typeof citizen.knowledge.buildings !== 'object' || Array.isArray(citizen.knowledge.buildings)) {
    citizen.knowledge.buildings = {};
  }
  if (!Array.isArray(citizen.knowledge.explored)) citizen.knowledge.explored = [];
  return citizen.knowledge;
}

function lineIsClear(board, from, to) {
  // Bresenham traversal: an intervening blocked ridge tile hides tiles beyond it,
  // while the ridge tile itself can still be seen.
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - x);
  const dy = Math.abs(to.y - y);
  const sx = x < to.x ? 1 : -1;
  const sy = y < to.y ? 1 : -1;
  let error = dx - dy;

  while (x !== to.x || y !== to.y) {
    const twiceError = 2 * error;
    if (twiceError > -dy) {
      error -= dy;
      x += sx;
    }
    if (twiceError < dx) {
      error += dx;
      y += sy;
    }
    if ((x !== to.x || y !== to.y) && board.blocked.has(`${x},${y}`)) return false;
  }
  return true;
}

export function canSee(world, citizen, point) {
  const board = boardFor(world);
  return pointVisible(board, citizen, point);
}

function pointVisible(board, citizen, point) {
  if (!board || !citizen || !inBounds(citizen.x, citizen.y, board.width, board.height) ||
      !point || !inBounds(point.x, point.y, board.width, board.height)) return false;
  const dx = point.x - citizen.x;
  const dy = point.y - citizen.y;
  if (dx * dx + dy * dy > SIGHT_RADIUS * SIGHT_RADIUS) return false;
  return lineIsClear(board, citizen, point);
}

function nodeSnapshot(node, source = 'seen') {
  const defaults = DEFAULTS[node.kind] ?? { capacity: 1, yield: 1, regrowTicks: 0 };
  const snapshot = {
    id: node.id,
    kind: node.kind,
    x: node.x,
    y: node.y,
    stock: node.stock,
    capacity: node.capacity ?? defaults.capacity,
    yield: node.yield ?? defaults.yield,
    regrowTicks: node.regrowTicks ?? defaults.regrowTicks,
    observedAt: node.observedAt,
    source,
  };
  if (Number.isInteger(node.level) && node.level >= 1 && node.level <= 4) snapshot.level = node.level;
  if (Number.isSafeInteger(node.witnessedDepletionAt) && node.witnessedDepletionAt >= 0 && node.witnessedDepletionAt <= node.observedAt) snapshot.witnessedDepletionAt = node.witnessedDepletionAt;
  if (node.reportedBy !== undefined) snapshot.reportedBy = node.reportedBy;
  if (node.receivedAt !== undefined) snapshot.receivedAt = node.receivedAt;
  return snapshot;
}

function observedNode(node, tick, previous) {
  const snapshot = nodeSnapshot({ ...node, witnessedDepletionAt: undefined, observedAt: tick, source: 'seen' }, 'seen');
  // Only consecutive personal sightings establish a witnessed stock drop.
  // A new empty sighting or an old report does not reveal the harvest time.
  if (node.stock === 0 && previous?.source === 'seen' && previous.observedAt <= tick) {
    const depletedAt = previous.stock > 0
      ? previous.observedAt >= tick - 1 ? tick : undefined
      : previous.witnessedDepletionAt;
    if (Number.isSafeInteger(depletedAt)) snapshot.witnessedDepletionAt = depletedAt;
  }
  return snapshot;
}

function setOwn(record, key, value) {
  Object.defineProperty(record, key, {
    value, writable: true, enumerable: true, configurable: true,
  });
}

const VISIBLE_ACTIVITIES = new Set(['moving', 'harvesting', 'crafting', 'building', 'baking', 'repairing', 'attacking', 'meeting', 'eating', 'resting', 'waiting', 'communicating']);

function activitySnapshot(activity) {
  if (!activity || !VISIBLE_ACTIVITIES.has(activity.type)) return undefined;
  const snapshot = { type: activity.type };
  if (activity.type === 'harvesting' && ['food', 'wood'].includes(activity.resource)) snapshot.resource = activity.resource;
  if (activity.type === 'crafting' && ['tool', 'weapon', 'shoes'].includes(activity.item)) snapshot.item = activity.item;
  if (activity.type === 'building' && ['bakery', 'wall', 'house'].includes(activity.building)) snapshot.building = activity.building;
  if (['harvesting', 'baking', 'repairing', 'attacking', 'meeting'].includes(activity.type) && typeof activity.target === 'string') snapshot.target = activity.target;
  return snapshot;
}

// Observe physical work, never the citizen's order, queue, notes or free-form
// activity text. Moving reveals no destination; a target must also be visible.
function visibleActivity(world, observer, other) {
  const task = other.current?.task;
  if (!task) return undefined;
  const types = { move: 'moving', harvest: 'harvesting', craft: 'crafting', build: 'building', bake: 'baking', repair: 'repairing', attack: 'attacking',
    give: 'meeting', trade: 'meeting', reproduce: 'meeting', eat: 'eating', sleep: 'resting', wait: 'waiting', message: 'communicating', post: 'communicating' };
  const type = types[task.type];
  if (!type) return undefined;
  const target = [...(world.nodes ?? []), ...(world.buildings ?? []), ...(world.citizens ?? [])].find(entry => entry.id === task.target);
  return activitySnapshot({ type, item: task.item, building: task.building,
    ...(target && canSee(world, observer, target) ? { target: target.id, resource: target.kind === 'crop' ? 'food' : target.kind === 'tree' ? 'wood' : undefined } : {}) });
}

function visibleCondition(other) {
  if (!Number.isFinite(other.hunger) || !Number.isFinite(other.health)) return undefined;
  return { nourishment: other.hunger >= 100 ? 'starving' : other.hunger >= 75 ? 'hungry' : 'no visible hunger',
    health: other.health < 30 ? 'badly wounded' : other.health < 80 ? 'injured' : 'well' };
}

export function observeWorld(world, citizen) {
  const knowledge = ensureKnowledge(citizen);
  const board = boardFor(world);
  if (!board || !citizen || !inBounds(citizen.x, citizen.y, board.width, board.height)) return [];

  const explored = new Set(knowledge.explored);
  const visible = [];
  for (let y = 0; y < board.height; y += 1) {
    for (let x = 0; x < board.width; x += 1) {
      const tile = { x, y };
      if (pointVisible(board, citizen, tile)) { explored.add(`${x},${y}`); visible.push(`${x},${y}`); }
    }
  }
  knowledge.explored = [...explored];
  citizen.visibleTiles = visible;

  for (const other of world.citizens ?? []) {
    if (!other || other === citizen || other.id === citizen.id || other.alive === false ||
        typeof other.id !== 'string' || !canSee(world, citizen, other)) continue;
    setOwn(knowledge.people, other.id, {
      ...personSnapshot({ ...other, observedActivity: visibleActivity(world, citizen, other), observedCondition: visibleCondition(other),
        observedEquipment: Object.fromEntries(['tool', 'shoes', 'weapon'].map(item => [`${item}Level`, equipmentLevel(other, item)])) }, 'seen'),
      observedAt: Number.isFinite(world.tick) ? world.tick : 0,
    });
  }

  for (const building of world.buildings ?? []) {
    if (!building || typeof building.id !== 'string' || !canSee(world, citizen, building)) continue;
    setOwn(knowledge.buildings, building.id, buildingSnapshot({
      ...building, observedAt: Number.isFinite(world.tick) ? world.tick : 0,
    }, 'seen'));
  }

  const newlyDiscovered = [];
  const nodes = world.nodes;
  if (!Array.isArray(nodes)) return newlyDiscovered;
  const memories = knowledge.nodes;
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !inBounds(node.x, node.y, board.width, board.height) ||
        !canSee(world, citizen, node)) continue;
    const id = node.id;
    if (!Object.hasOwn(memories, id)) newlyDiscovered.push(id);
    setOwn(memories, id, observedNode(node, Number.isFinite(world.tick) ? world.tick : 0, memories[id]));
  }
  return newlyDiscovered;
}

export function knownDeposits(citizen) {
  const knowledge = ensureKnowledge(citizen);
  return Object.keys(knowledge.nodes)
    .map((id) => knowledge.nodes[id])
    .filter((memory) => memory && typeof memory === 'object')
    .map((memory) => nodeSnapshot(memory, memory.source === 'report' ? 'report' : 'seen'));
}

function personSnapshot(person, source = person.source) {
  const snapshot = {
    id: person.id,
    name: person.name,
    adult: person.adult,
    x: person.x,
    y: person.y,
    observedAt: person.observedAt,
    source,
  };
  if (source === 'report' && person.reportedBy !== undefined) snapshot.reportedBy = person.reportedBy;
  if (source === 'seen' && activitySnapshot(person.observedActivity)) snapshot.observedActivity = activitySnapshot(person.observedActivity);
  if (source === 'seen' && person.observedCondition
      && ['starving', 'hungry', 'no visible hunger'].includes(person.observedCondition.nourishment)
      && ['badly wounded', 'injured', 'well'].includes(person.observedCondition.health)) {
    snapshot.observedCondition = { nourishment: person.observedCondition.nourishment, health: person.observedCondition.health };
  }
  if (source === 'seen' && person.observedEquipment
      && ['toolLevel', 'shoesLevel', 'weaponLevel'].every(key => Number.isInteger(person.observedEquipment[key])
        && person.observedEquipment[key] >= 0 && person.observedEquipment[key] <= 3)) {
    snapshot.observedEquipment = Object.fromEntries(['toolLevel', 'shoesLevel', 'weaponLevel'].map(key => [key, person.observedEquipment[key]]));
  }
  return snapshot;
}

export function knownPeople(citizen) {
  return Object.values(ensureKnowledge(citizen).people)
    .filter((memory) => memory && typeof memory === 'object' && typeof memory.id === 'string')
    .map((memory) => personSnapshot(memory))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function privateRecipientError(world, sender, recipient) {
  const citizens = world?.citizens;
  if (!sender || typeof sender.id !== 'string' || sender.alive === false ||
      !Array.isArray(citizens) || !citizens.includes(sender)) return 'invalid-sender';
  if (!recipient || typeof recipient.id !== 'string' || recipient.alive === false ||
      recipient === sender || recipient.id === sender.id || !citizens.includes(recipient)) return 'invalid-recipient';
  return null;
}

function storeReport(target, report) {
  const existing = Object.hasOwn(target, report.id) ? target[report.id] : undefined;
  const existingTime = Number.isFinite(existing?.observedAt) ? existing.observedAt : -Infinity;
  const incomingTime = Number.isFinite(report.observedAt) ? report.observedAt : -Infinity;
  // Never replace a newer observation; an equally recent local sighting wins ties.
  if (existingTime > incomingTime || (existingTime === incomingTime && existing?.source === 'seen')) return;
  setOwn(target, report.id, { ...report });
}

export function reportLocation(world, sender, recipient) {
  const reason = privateRecipientError(world, sender, recipient);
  if (reason) return { ok: false, reason };
  const board = boardFor(world);
  if (!board || !inBounds(sender.x, sender.y, board.width, board.height)) {
    return { ok: false, reason: 'invalid-location' };
  }
  const location = {
    ...personSnapshot(sender, 'report'),
    observedAt: Number.isFinite(world.tick) ? world.tick : 0,
    reportedBy: sender.id,
  };
  storeReport(ensureKnowledge(recipient).people, location);
  return { ok: true, location };
}

export function shareKnowledgeWith(world, sender, recipient, nodeIds) {
  const reason = privateRecipientError(world, sender, recipient);
  if (reason) return { ok: false, reason };
  const memories = sender?.knowledge?.nodes;
  if (!Array.isArray(nodeIds) || nodeIds.length < 1 || nodeIds.length > 4 ||
      nodeIds.some((id) => typeof id !== 'string') || new Set(nodeIds).size !== nodeIds.length) {
    return { ok: false, reason: 'invalid-node-ids' };
  }
  if (!memories || typeof memories !== 'object' || Array.isArray(memories) ||
      nodeIds.some((id) => !Object.hasOwn(memories, id) || !validMemory(memories[id], id))) {
    return { ok: false, reason: 'unknown-node-id' };
  }
  const target = ensureKnowledge(recipient).nodes;
  for (const id of nodeIds) {
    storeReport(target, {
      ...nodeSnapshot(memories[id], 'report'),
      reportedBy: sender.id,
      receivedAt: Number.isFinite(world?.tick) ? world.tick : 0,
    });
  }
  return { ok: true };
}

function validMemory(memory, id) {
  return !!memory && typeof memory === 'object' && !Array.isArray(memory) &&
    memory.id === id && typeof memory.kind === 'string';
}

export function shareKnowledge(world, sender, nodeIds) {
  const memories = sender?.knowledge?.nodes;
  if (!Array.isArray(nodeIds) || nodeIds.length < 1 || nodeIds.length > 4 ||
      nodeIds.some((id) => typeof id !== 'string') || new Set(nodeIds).size !== nodeIds.length) {
    return { ok: false, reason: 'invalid-node-ids' };
  }
  if (!memories || typeof memories !== 'object' || Array.isArray(memories) ||
      nodeIds.some((id) => !Object.hasOwn(memories, id) || !validMemory(memories[id], id))) {
    return { ok: false, reason: 'unknown-node-id' };
  }

  const tick = Number.isFinite(world?.tick) ? world.tick : 0;
  const reports = nodeIds.map((id) => {
    const report = nodeSnapshot(memories[id], 'report');
    report.source = 'report';
    report.reportedBy = sender.id;
    report.receivedAt = tick;
    return report;
  });

  for (const recipient of world?.citizens ?? []) {
    if (!recipient || recipient === sender || recipient.id === sender?.id || recipient.alive === false) continue;
    const target = ensureKnowledge(recipient).nodes;
    for (const report of reports) {
      const existing = Object.hasOwn(target, report.id) ? target[report.id] : undefined;
      const existingTime = Number.isFinite(existing?.observedAt) ? existing.observedAt : -Infinity;
      const incomingTime = Number.isFinite(report.observedAt) ? report.observedAt : -Infinity;
      // Never replace a newer observation; an equally recent local sighting wins ties.
      if (existingTime > incomingTime || (existingTime === incomingTime && existing?.source === 'seen')) continue;
      setOwn(target, report.id, { ...report });
    }
  }
  return { ok: true };
}

function buildingSnapshot(building, source = building.source) {
  return {
    id: building.id, kind: building.kind, x: building.x, y: building.y,
    ownerId: building.ownerId, health: building.health, maxHealth: building.maxHealth,
    ...(building.ruin === true ? { ruin: true } : {}),
    ...(Number.isSafeInteger(building.woodCost) ? { woodCost: building.woodCost, salvageWood: Math.floor(building.woodCost * 0.6) } : {}),
    observedAt: building.observedAt, source,
    ...(source === 'owner-alert' ? { lastAttackerId: building.lastAttackerId, lastAttackerName: building.lastAttackerName,
      lastAttackTick: building.lastAttackTick } : {}),
    ...(source === 'report' && building.reportedBy !== undefined ? { reportedBy: building.reportedBy } : {}),
  };
}

export function knownBuildings(citizen) {
  return Object.values(ensureKnowledge(citizen).buildings)
    .filter((memory) => memory && typeof memory === 'object' && typeof memory.id === 'string')
    .map((memory) => buildingSnapshot(memory))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function buildingReports(sender, ids) {
  const memories = sender?.knowledge?.buildings;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4 ||
      ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    return { ok: false, reason: 'invalid-building-ids' };
  }
  if (!memories || typeof memories !== 'object' || Array.isArray(memories) ||
      ids.some((id) => !Object.hasOwn(memories, id) || !validMemory(memories[id], id))) {
    return { ok: false, reason: 'unknown-building-id' };
  }
  return { ok: true, reports: ids.map((id) => ({ ...buildingSnapshot(memories[id], 'report'), reportedBy: sender.id })) };
}

export function shareBuildingsWith(world, sender, recipient, ids) {
  const reason = privateRecipientError(world, sender, recipient);
  if (reason) return { ok: false, reason };
  const result = buildingReports(sender, ids);
  if (!result.ok) return result;
  const target = ensureKnowledge(recipient).buildings;
  for (const report of result.reports) storeReport(target, report);
  return { ok: true };
}

export function shareBuildings(world, sender, ids) {
  const result = buildingReports(sender, ids);
  if (!result.ok) return result;
  for (const recipient of world?.citizens ?? []) {
    if (!recipient || recipient === sender || recipient.id === sender?.id || recipient.alive === false) continue;
    const target = ensureKnowledge(recipient).buildings;
    for (const report of result.reports) storeReport(target, report);
  }
  return { ok: true };
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value ?? '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function explorationTarget(world, citizen, area = null) {
  const board = boardFor(world, false, citizen);
  if (!board || !citizen || !inBounds(citizen.x, citizen.y, board.width, board.height)) return null;
  const startKey = `${citizen.x},${citizen.y}`;
  if (board.blocked.has(startKey)) return null;

  const knowledge = ensureKnowledge(citizen);
  const explored = new Set(knowledge.explored);
  const directions = [
    { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
  ];
  const tieSeed = stableHash(citizen.id);
  const orderedDirections = directions
    .map((direction, index) => ({ direction, rank: stableHash(`${tieSeed}:${index}`) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ direction }) => direction);

  const queue = [{ x: citizen.x, y: citizen.y }];
  const visited = new Set([startKey]);
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const key = `${current.x},${current.y}`;
    if (!explored.has(key) && (!area || inArea(world, current, area))) return { x: current.x, y: current.y };

    for (const direction of orderedDirections) {
      const x = current.x + direction.x;
      const y = current.y + direction.y;
      const nextKey = `${x},${y}`;
      if (!inBounds(x, y, board.width, board.height) || board.blocked.has(nextKey) || visited.has(nextKey)) continue;
      visited.add(nextKey);
      queue.push({ x, y });
    }
  }
  return null;
}
