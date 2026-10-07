import { STRUCTURES, structureId, livingStructure, salvageWood } from './structures.mjs';
import { equipmentSpec } from './equipment.mjs';
const REPAIR_COST = 2;
const REPAIR_HEAL = 20;
const COUNTERS = ['built', 'baked', 'buildingAttacks', 'destroyed'];
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const legacyCount = (value) => value === undefined ? 0 : value;
const fail = (reason) => ({ ok: false, reason });
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const live = (building) => building.health > 0 && building.destroyed !== true;
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
function point(world, value) {
  return value && count(value.x) && count(value.y) && value.x < world.width && value.y < world.height;
}
function exactTask(task, keys) {
  return record(task) && Reflect.ownKeys(task).length === keys.length && keys.every((key) => Object.hasOwn(task, key));
}
function notify(effects, actor, text) {
  try { effects.event?.(text, actor.id); } catch { /* reporting cannot undo a committed action */ }
  try { effects.remember?.(actor, text); } catch { /* reporting cannot undo a committed action */ }
}

// Completion only: the parent owns task duration, routes, knowledge gates, and witnesses.
export function resolveBuilding(world, citizen, task, effects = {}) {
  if (!record(effects) || ['event', 'remember'].some((key) => effects[key] !== undefined && typeof effects[key] !== 'function')) {
    return fail('invalid effects');
  }
  if (!record(world) || !count(world.tick) || !count(world.width) || world.width < 1 ||
      !count(world.height) || world.height < 1 || !Array.isArray(world.citizens) || !record(world.stats) ||
      (world.buildings !== undefined && !Array.isArray(world.buildings)) ||
      (world.nodes !== undefined && !Array.isArray(world.nodes)) ||
      (world.blocked !== undefined && !Array.isArray(world.blocked))) return fail('invalid world');
  const buildings = world.buildings ?? [];
  const nextId = world.nextBuildingId === undefined ? 1 : world.nextBuildingId;
  if (!count(nextId) || nextId < 1 || COUNTERS.some((key) => !count(legacyCount(world.stats[key])))) return fail('invalid building counters');
  let highestId = 0;
  const ids = new Set();
  for (const building of buildings) {
    if (!record(building) || !structureId(building.id) ||
        !Object.hasOwn(STRUCTURES, building.kind) || !building.id.startsWith(`${building.kind}-`) ||
        !(typeof building.ownerId === 'string' && building.ownerId || building.ownerId === null && building.kind === 'wall' && building.ruin === true) ||
        !point(world, building) || !count(building.health) || !count(building.maxHealth) ||
        building.maxHealth < 1 || building.health > building.maxHealth ||
        (building.woodCost !== undefined && (!count(building.woodCost) || building.woodCost < 1)) ||
        (building.destroyed !== undefined && (typeof building.destroyed !== 'boolean' || building.destroyed !== (building.health === 0))) ||
        ids.has(building.id)) return fail('invalid building');
    const idNumber = Number(building.id.slice(building.id.lastIndexOf('-') + 1));
    if (!count(idNumber)) return fail('unsafe building ID');
    highestId = Math.max(highestId, idNumber);
    ids.add(building.id);
  }
  if (nextId <= highestId) return fail('building ID counter does not follow history');
  const actorId = typeof citizen === 'string' ? citizen : citizen?.id;
  const actor = world.citizens.find((entry) => entry?.id === actorId);
  if (!record(actor) || typeof actor.id !== 'string' || !actor.id || actor.alive !== true ||
      !Number.isFinite(actor.health) || actor.health <= 0 || !point(world, actor)) return fail('actor is not alive in world');
  if (!record(task)) return fail('invalid task');
  let building;
  let counter;
  let destroyed = false;
  if (task.type === 'build') {
    if (!exactTask(task, ['type', 'building', 'x', 'y']) || !Object.hasOwn(STRUCTURES, task.building) || !point(world, task)) return fail('invalid build task');
    if (task.building === 'wall' ? distance(actor, task) !== 1 : actor.x !== task.x || actor.y !== task.y) return fail('actor is not at site');
    if ((world.blocked ?? []).some((tile) => tile?.x === task.x && tile?.y === task.y) ||
        (world.nodes ?? []).some((node) => node?.x === task.x && node?.y === task.y) ||
        buildings.some((entry) => live(entry) && entry.x === task.x && entry.y === task.y) ||
        (['wall', 'house'].includes(task.building) && world.citizens.some(c => c?.alive && c.x === task.x && c.y === task.y
          && (task.building === 'wall' || c.id !== actor.id)))) return fail('occupied site');
    if (!count(actor.wood) || actor.wood < STRUCTURES[task.building].wood) return fail('needs build wood');
    if (nextId === Number.MAX_SAFE_INTEGER) return fail('building ID would overflow');
    counter = 'built';
    building = { id: `${task.building}-${nextId}`, kind: task.building, x: task.x, y: task.y,
      ownerId: actor.id, health: STRUCTURES[task.building].health, maxHealth: STRUCTURES[task.building].health,
      woodCost: STRUCTURES[task.building].wood, destroyed: false };
  } else {
    if (!['bake', 'repair', 'attack'].includes(task.type) || !exactTask(task, ['type', 'target']) ||
        typeof task.target !== 'string') return fail('invalid building task');
    building = task.type === 'bake' && task.target === 'own'
      ? buildings.find((entry) => entry.kind === 'bakery' && live(entry) && entry.ownerId === actor.id && distance(actor, entry) <= 1)
      : buildings.find((entry) => entry.id === task.target);
    if (!building || !live(building)) return fail('building is not alive');
    if (distance(actor, building) > 1) return fail('building is not adjacent');
    if (task.type !== 'attack' && building.ownerId !== actor.id) return fail('building is not owned by actor');
    if (task.type === 'bake') {
      if (building.kind !== 'bakery') return fail('only a bakery can bake');
      if (!count(actor.food) || actor.food < 1 || !count(actor.wood) || actor.wood < 1 ||
          !count(legacyCount(actor.bread))) return fail('invalid baking inventory');
      if ((actor.bread ?? 0) === Number.MAX_SAFE_INTEGER) return fail('bread would overflow');
      counter = 'baked';
    } else if (task.type === 'repair') {
      if (!count(actor.wood) || actor.wood < REPAIR_COST) return fail('needs repair wood');
      if (building.health === building.maxHealth) return fail('building needs no repair');
    } else {
      if (actor.adult !== true || !Number.isFinite(actor.energy) || actor.energy < 8 || actor.energy > 100 ||
          (actor.weaponLevel !== undefined && (!count(actor.weaponLevel) || actor.weaponLevel > 3 || actor.weapon !== (actor.weaponLevel > 0))) ||
          typeof actor.weapon !== 'boolean' || !count(actor.weaponDurability) || actor.weaponDurability > (equipmentSpec(actor, 'weapon')?.durability ?? 12) ||
          actor.weapon !== (actor.weaponDurability > 0)) return fail('actor cannot attack');
      counter = 'buildingAttacks';
      destroyed = building.health <= (equipmentSpec(actor, 'weapon')?.damage ?? 6);
    }
  }
  if ((counter && (world.stats[counter] ?? 0) === Number.MAX_SAFE_INTEGER) ||
      (destroyed && (world.stats.destroyed ?? 0) === Number.MAX_SAFE_INTEGER)) return fail('building statistic would overflow');
  if (destroyed && (!count(actor.wood) || !Number.isSafeInteger(actor.wood + salvageWood(building)))) return fail('salvage would overflow inventory');

  // Every preflight is complete before any resources, counters, or legacy defaults change.
  world.buildings ??= buildings;
  world.nextBuildingId ??= nextId;
  for (const key of COUNTERS) world.stats[key] ??= 0;
  if (task.type === 'build') {
    actor.wood -= STRUCTURES[task.building].wood;
    buildings.push(building);
    world.nextBuildingId += 1;
  } else if (task.type === 'bake') {
    actor.food -= 1;
    actor.wood -= 1;
    actor.bread = (actor.bread ?? 0) + 1;
  } else if (task.type === 'repair') {
    actor.wood -= REPAIR_COST;
    building.health += Math.min(REPAIR_HEAL, building.maxHealth - building.health);
  } else {
    building.health = Math.max(0, building.health - (equipmentSpec(actor, 'weapon')?.damage ?? 6));
    actor.energy -= 8;
    if (actor.weapon && --actor.weaponDurability === 0) { actor.weapon = false; actor.weaponLevel = 0; }
    building.lastAttackerId = actor.id;
    building.lastAttackerName = actor.name || actor.id;
    building.lastAttackTick = world.tick;
    if (destroyed) { building.destroyed = true; world.stats.destroyed += 1; actor.wood += salvageWood(building); }
  }
  if (counter) world.stats[counter] += 1;
  if (task.type === 'attack') alertOwner(world, actor, building, effects);
  notify(effects, actor, `Tick ${world.tick}: ${actor.name || actor.id} completed ${task.type} at ${building.id}.${destroyed ? ` Recovered ${salvageWood(building)} wood from destruction.` : ''}`);
  return { ok: true };
}

function alertOwner(world, attacker, building, effects) {
  const owner = world.citizens.find(c => c?.id === building.ownerId && c.alive);
  if (!owner || owner.id === attacker.id) return;
  const incident = { tick: world.tick, attackerId: attacker.id, attackerName: attacker.name || attacker.id,
    targetId: building.id, kind: 'building', source: 'owner-alert', x: building.x, y: building.y };
  owner.incidents = [...(owner.incidents ?? []), incident].slice(-8);
  owner.buildingAlerts = [...(owner.buildingAlerts ?? []).filter(a => a.targetId !== building.id || a.attackerId !== attacker.id), { ...incident, buildingKind: building.kind,
    health: building.health, destroyed: !livingStructure(building) }].slice(-6);
  owner.knowledge ??= { nodes: {}, people: {}, explored: [], buildings: {} };
  owner.knowledge.buildings ??= {};
  owner.knowledge.buildings[building.id] = { id: building.id, kind: building.kind, x: building.x, y: building.y,
    ownerId: owner.id, health: building.health, maxHealth: building.maxHealth, woodCost: building.woodCost ?? STRUCTURES[building.kind].wood, observedAt: world.tick,
    source: 'owner-alert', lastAttackerId: attacker.id, lastAttackerName: attacker.name || attacker.id, lastAttackTick: world.tick };
  owner.replanReason = 'property attacked';
  const text = `Tick ${world.tick}: Property alert: ${attacker.name || attacker.id} (${attacker.id}) attacked your ${building.kind} ${building.id}${building.health > 0 ? `; ${building.health}/${building.maxHealth} health remains` : '; destroyed'}. Route to ${building.id} to inspect, repair or defend. This alert does not reveal the attacker's current location.`;
  notify(effects, owner, text);
}
