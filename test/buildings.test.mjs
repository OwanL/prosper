import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuilding } from '../lib/buildings.mjs';
import { observeWorld, knownBuildings, knownDeposits, shareBuildings, shareBuildingsWith } from '../lib/knowledge.mjs';

function fixture() {
  const actor = { id: 'owner', name: 'Owner', x: 2, y: 2, alive: true, adult: true,
    health: 100, energy: 100, food: 10, wood: 100, bread: 0, weapon: false, weaponDurability: 0 };
  const other = { ...actor, id: 'other', x: 3 };
  const remote = { ...actor, id: 'remote', x: 9, y: 9 };
  const world = { width: 12, height: 12, tick: 4, citizens: [actor, other, remote],
    buildings: [], nextBuildingId: 1, nodes: [], blocked: [], stats: {} };
  return { world, actor, other, remote };
}
const buildTask = { type: 'build', building: 'bakery', x: 2, y: 2 };
function build(world, actor) {
  assert.deepEqual(resolveBuilding(world, actor, buildTask), { ok: true });
  return world.buildings[0];
}
function refused(world, actor, task, effects) {
  const before = structuredClone(world);
  assert.equal(resolveBuilding(world, actor, task, effects).ok, false);
  assert.deepEqual(world, before, 'refusal must leave all world state unchanged');
}

test('build completion creates durable private property and initializes legacy counters', () => {
  const { world, actor } = fixture();
  delete world.buildings;
  delete world.nextBuildingId;
  const events = [], memories = [];
  assert.equal(resolveBuilding(world, actor, buildTask, {
    event: (...args) => events.push(args), remember: (...args) => memories.push(args),
  }).ok, true);
  assert.deepEqual(world.buildings, [{ id: 'bakery-1', kind: 'bakery', x: 2, y: 2,
    ownerId: actor.id, health: 240, maxHealth: 240, woodCost: 50, destroyed: false }]);
  assert.equal(actor.wood, 50);
  assert.equal(world.nextBuildingId, 2);
  assert.deepEqual(world.stats, { built: 1, baked: 0, buildingAttacks: 0, destroyed: 0 });
  assert.equal(events.length, 1);
  assert.equal(memories[0][0], actor);
});

test('build rejects blocked, deposit, occupied, distant, malformed and unaffordable sites atomically', () => {
  for (const change of [
    ({ world }) => world.blocked.push({ x: 2, y: 2 }),
    ({ world }) => world.nodes.push({ id: 'crop', x: 2, y: 2, stock: 0 }),
    ({ actor }) => { actor.x = 3; },
    ({ actor }) => { actor.wood = 49; },
    ({ actor }) => { actor.wood = NaN; },
    ({ actor }) => { actor.alive = false; },
    ({ world, actor }) => build(world, actor),
  ]) {
    const setup = fixture();
    change(setup);
    refused(setup.world, setup.actor, buildTask);
  }
  const { world, actor } = fixture();
  refused(world, actor, { ...buildTask, x: 1.5 });
  refused(world, actor, { ...buildTask, building: 'castle' });
  refused(world, actor, buildTask, { remember: true });
  // A supplied object cannot spoof the actual actor's location or inventory.
  actor.x = 8;
  refused(world, { ...actor, x: 2 }, buildTask);
});

test('owner bakes one bread from food and wood, repairs capped damage, never operates remotely', () => {
  const { world, actor, other } = fixture();
  const bakery = build(world, actor);
  assert.equal(resolveBuilding(world, actor, { type: 'bake', target: 'own' }).ok, true);
  assert.deepEqual([actor.food, actor.wood, actor.bread, world.stats.baked], [9, 49, 1, 1]);
  refused(world, other, { type: 'bake', target: bakery.id });
  refused(world, other, { type: 'repair', target: bakery.id });
  bakery.health = 235;
  assert.equal(resolveBuilding(world, actor, { type: 'repair', target: bakery.id }).ok, true);
  assert.deepEqual([bakery.health, actor.wood], [240, 47]);
  refused(world, actor, { type: 'repair', target: bakery.id });
  bakery.health = 100;
  assert.equal(resolveBuilding(world, actor, { type: 'repair', target: bakery.id }).ok, true);
  assert.equal(bakery.health, 120);
  actor.x = 9;
  refused(world, actor, { type: 'bake', target: 'own' });
  refused(world, actor, { type: 'repair', target: bakery.id });
});

test('attacks cost energy, wear weapons, never counterattack, and salvage once on destruction', () => {
  const { world, actor, other } = fixture();
  const bakery = build(world, actor);
  const attack = { type: 'attack', target: bakery.id };
  assert.equal(resolveBuilding(world, other, attack).ok, true);
  assert.deepEqual([bakery.health, other.energy, other.health, actor.health], [234, 92, 100, 100]);
  Object.assign(other, { weapon: true, weaponDurability: 1 });
  bakery.health = 18;
  assert.equal(resolveBuilding(world, other, attack).ok, true);
  assert.deepEqual([bakery.health, bakery.destroyed, other.energy, other.weapon, other.weaponDurability], [0, true, 84, false, 0]);
  assert.deepEqual([world.stats.buildingAttacks, world.stats.destroyed, actor.wood, other.wood], [2, 1, 50, 130]);
  assert.deepEqual([bakery.lastAttackerId, bakery.lastAttackTick], [other.id, world.tick]);
  refused(world, other, attack);
  refused(world, actor, { type: 'repair', target: bakery.id });
  // Destroyed footprints can be reused without recycling IDs.
  assert.equal(resolveBuilding(world, actor, buildTask).ok, true);
  assert.equal(world.buildings[1].id, 'bakery-2');
});

test('dead ownership persists, and attack eligibility is local and adult-only', () => {
  const { world, actor, other } = fixture();
  const bakery = build(world, actor);
  actor.alive = false;
  refused(world, actor, { type: 'bake', target: 'own' });
  refused(world, other, { type: 'bake', target: bakery.id });
  for (const patch of [{ adult: false }, { energy: 7 }, { x: 8 }, { health: 0 }, { weaponDurability: 1 }]) {
    const saved = structuredClone(other);
    Object.assign(other, patch);
    refused(world, other, { type: 'attack', target: bakery.id });
    Object.assign(other, saved);
  }
  assert.equal(resolveBuilding(world, other, { type: 'attack', target: bakery.id }).ok, true);
  assert.equal(bakery.ownerId, actor.id);
});

test('all numeric overflow and malformed counters refuse before resource charges', () => {
  for (const patch of [{ nextBuildingId: Number.MAX_SAFE_INTEGER }, { nextBuildingId: Infinity },
    { stats: { built: Number.MAX_SAFE_INTEGER } }, { stats: { baked: -1 } },
    { nextBuildingId: null }, { stats: { destroyed: null } }]) {
    const { world, actor } = fixture();
    Object.assign(world, patch);
    refused(world, actor, buildTask);
  }
  for (const change of [
    ({ actor }) => { actor.bread = Number.MAX_SAFE_INTEGER; },
    ({ actor }) => { actor.food = 1.5; },
    ({ actor }) => { actor.bread = null; },
    ({ world }) => { world.stats.baked = Number.MAX_SAFE_INTEGER; },
  ]) {
    const setup = fixture(); build(setup.world, setup.actor); change(setup);
    refused(setup.world, setup.actor, { type: 'bake', target: 'own' });
  }
  for (const counter of ['buildingAttacks', 'destroyed']) {
    const { world, actor, other } = fixture();
    const bakery = build(world, actor); bakery.health = 6;
    world.stats[counter] = Number.MAX_SAFE_INTEGER;
    refused(world, other, { type: 'attack', target: bakery.id });
  }
  const { world, actor } = fixture(); const bakery = build(world, actor);
  bakery.maxHealth = Number.MAX_SAFE_INTEGER; bakery.health = Number.MAX_SAFE_INTEGER - 1;
  assert.equal(resolveBuilding(world, actor, { type: 'repair', target: bakery.id }).ok, true);
  assert.equal(bakery.health, Number.MAX_SAFE_INTEGER);
});

test('building knowledge is visible-only, stale remotely even for owners, and whitelist-cloned', () => {
  const { world, actor, remote } = fixture(); const bakery = build(world, actor);
  world.nodes.push({ id: 'crop', kind: 'crop', x: 2, y: 2, stock: 1 });
  observeWorld(world, actor); observeWorld(world, remote);
  assert.equal(knownBuildings(remote).length, 0);
  assert.equal(knownDeposits(actor).length, 1);
  const snapshot = knownBuildings(actor)[0];
  assert.deepEqual(Object.keys(snapshot), ['id', 'kind', 'x', 'y', 'ownerId', 'health', 'maxHealth', 'woodCost', 'salvageWood', 'observedAt', 'source']);
  actor.x = 9; actor.y = 9; world.tick = 12;
  Object.assign(bakery, { health: 0, destroyed: true, lastAttackerId: 'other', lastAttackTick: 12 });
  observeWorld(world, actor);
  assert.equal(knownBuildings(actor)[0].health, 240);
  snapshot.health = 99;
  assert.equal(knownBuildings(actor)[0].health, 240);
  actor.x = 2; actor.y = 2; observeWorld(world, actor);
  assert.equal(knownBuildings(actor)[0].health, 0);
  assert.equal('lastAttackerId' in knownBuildings(actor)[0], false);
});

test('private building reports preserve original times and local/newer sightings win ties', () => {
  const { world, actor, other, remote } = fixture(); const bakery = build(world, actor);
  observeWorld(world, actor);
  world.tick = 20; bakery.health = 100;
  assert.equal(shareBuildingsWith(world, actor, remote, [bakery.id]).ok, true);
  assert.deepEqual([knownBuildings(remote)[0].health, knownBuildings(remote)[0].observedAt, knownBuildings(remote)[0].source], [240, 4, 'report']);
  assert.deepEqual(knownBuildings(other), []);
  observeWorld(world, other);
  assert.equal(shareBuildingsWith(world, actor, other, [bakery.id]).ok, true);
  assert.deepEqual([knownBuildings(other)[0].health, knownBuildings(other)[0].source], [100, 'seen']);
  world.tick = 20; observeWorld(world, actor); bakery.health = 50;
  assert.equal(shareBuildingsWith(world, actor, other, [bakery.id]).ok, true);
  assert.equal(knownBuildings(other)[0].source, 'seen');
  const before = structuredClone(remote.knowledge);
  for (const ids of [[], ['unknown'], [bakery.id, bakery.id], Array(5).fill(bakery.id)]) {
    assert.equal(shareBuildingsWith(world, actor, remote, ids).ok, false);
    assert.deepEqual(remote.knowledge, before);
  }
  assert.equal(shareBuildingsWith(world, actor, actor, [bakery.id]).ok, false);
  assert.equal(shareBuildings(world, actor, [bakery.id]).ok, true);
  assert.equal(knownBuildings(remote)[0].health, 100);
});
