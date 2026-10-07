import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tickWorld, applyPlan, planningContext } from '../lib/world.mjs';
import { createCitizenToolSession, citizenObservation } from '../lib/citizen-tools.mjs';
import { observeWorld, canSee, knownBuildings } from '../lib/knowledge.mjs';
import { resolveBuilding } from '../lib/buildings.mjs';
import { findPath, isWalkable } from '../lib/pathfinding.mjs';

function town() {
  const world = createWorld({ expanded: false }), [owner, attacker] = world.citizens;
  world.citizens = [owner, attacker]; world.nodes = []; world.blocked = [];
  for (const [i, c] of world.citizens.entries()) {
    Object.assign(c, { x: 6 + i, y: 5, food: 30, wood: 300, hunger: 0, energy: 100,
      asyncReview: true, knowledge: { nodes: {}, buildings: {}, people: {}, explored: [] } });
    observeWorld(world, c);
  }
  return { world, owner, attacker };
}
function session(world, actor) {
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id }); tools.refresh(); return tools;
}
function choose(world, actor, tasks, work = null) {
  const tools = session(world, actor), reply = tools.execute('commit_strategy', { tasks, work });
  assert.equal(reply.ok, true, reply.error); applyPlan(world, actor.id, tools.committed.plan); return reply;
}
function ticks(world, amount) { for (let i = 0; i < amount; i++) tickWorld(world); }
function makeWall(world, owner, x = 7, y = 5) {
  assert.equal(resolveBuilding(world, owner, { type: 'build', building: 'wall', x, y }).ok, true);
  observeWorld(world, owner); return world.buildings.at(-1);
}
function resource(world, owner) {
  world.nodes = [{ id: 'crop-anchor', kind: 'crop', x: owner.x, y: owner.y, stock: 1, capacity: 1, yield: 1,
    regrowTicks: 99, regrowIn: 0 }]; observeWorld(world, owner); return world.nodes[0];
}

test('walls block owners and visitors, hide unseen contents, and destruction reopens movement and sight', () => {
  const { world, owner, attacker } = town();
  Object.assign(world, { width: 5, height: 1 }); Object.assign(owner, { x: 1, y: 0 }); Object.assign(attacker, { x: 0, y: 0 });
  const wall = makeWall(world, owner, 2, 0);
  Object.assign(owner, { x: 0, y: 0 });
  world.nodes = [{ id: 'crop-hidden', kind: 'crop', x: 3, y: 0, stock: 1 }];
  observeWorld(world, owner);
  assert.equal(isWalkable(world, 2, 0, owner), false);
  assert.equal(isWalkable(world, 2, 0, attacker), false);
  assert.equal(findPath(world, owner, { x: 4, y: 0 }), null);
  assert.equal(canSee(world, owner, world.nodes[0]), false);
  assert.equal(owner.knowledge.nodes['crop-hidden'], undefined);
  assert.equal(owner.visibleTiles.includes('3,0'), false);
  Object.assign(owner, { x: 1, weapon: true, weaponLevel: 1, weaponDurability: 12 }); wall.health = 18;
  const before = owner.wood;
  assert.equal(resolveBuilding(world, owner, { type: 'attack', target: wall.id }).ok, true);
  assert.equal(owner.wood, before + 9);
  assert.ok(findPath(world, attacker, { x: 4, y: 0 }));
  observeWorld(world, owner);
  assert.equal(canSee(world, owner, world.nodes[0]), true);
  assert.ok(owner.knowledge.nodes['crop-hidden']);
});

test('bakeries also occlude sight while remaining walkable, and remembered stock is not refreshed through them', () => {
  const { world, owner } = town();
  assert.equal(resolveBuilding(world, owner, { type: 'build', building: 'bakery', x: 6, y: 5 }).ok, true);
  const node = { id: 'crop-behind', kind: 'crop', x: 7, y: 5, stock: 1, yield: 1, capacity: 1, regrowTicks: 99 };
  world.nodes = [node]; observeWorld(world, owner);
  const remembered = structuredClone(owner.knowledge.nodes[node.id]);
  Object.assign(owner, { x: 5, y: 5 }); node.stock = 0; world.tick++;
  observeWorld(world, owner);
  assert.equal(canSee(world, owner, node), false);
  assert.deepEqual(owner.knowledge.nodes[node.id], remembered);
  assert.equal(isWalkable(world, 6, 5), true);
  assert.ok(findPath(world, owner, node));
});

test('attacks remotely alert the owner with identity and damage; the selected move reaches that remembered building', () => {
  const { world, owner, attacker } = town();
  const b = makeWall(world, owner, 6, 4);
  Object.assign(owner, { x: 14, y: 8 }); Object.assign(attacker, { x: 7, y: 4 });
  owner.knowledge.people = {}; world.tick++;
  const before = attacker.wood;
  assert.equal(resolveBuilding(world, attacker, { type: 'attack', target: b.id }).ok, true);
  const alert = owner.buildingAlerts.at(-1);
  assert.equal(alert.tick, world.tick); assert.equal(alert.attackerId, attacker.id); assert.equal(alert.attackerName, attacker.name);
  assert.equal(alert.health, 114); assert.equal(alert.targetId, b.id); assert.equal(owner.replanReason, 'property attacked');
  assert.equal(attacker.wood, before, 'nonfatal strikes yield no salvage');
  const remembered = knownBuildings(owner).find(entry => entry.id === b.id);
  assert.equal(remembered.source, 'owner-alert'); assert.equal(remembered.health, b.health);
  assert.equal(owner.knowledge.people[attacker.id], undefined, 'alert does not locate the attacker');
  const observation = citizenObservation(world, owner.id);
  assert.ok(observation.propertyAlerts.some(a => a.attackerId === attacker.id));
  choose(world, owner, [{ type: 'move', target: b.id }]);
  ticks(world, 25);
  assert.equal(Math.abs(owner.x - b.x) + Math.abs(owner.y - b.y), 1);
  assert.equal(owner.planBlocked ?? null, null);
});

test('an enclosure blueprint builds seven real segments, leaves its entrance open and retains progress on continuation', () => {
  const { world, owner, attacker } = town(); Object.assign(attacker, { x: 14, y: 8 });
  const anchor = resource(world, owner), tools = session(world, owner);
  const beforeWood = owner.wood, preview = tools.execute('plan_construction', { target: anchor.id, layout: 'enclosure', size: 'small', openings: ['south'] });
  assert.equal(preview.ok, true, preview.error); assert.equal(preview.segments, 7); assert.equal(preview.wood, 105);
  assert.equal(world.buildings.length, 0, 'planning neither constructs nor escrows materials');
  assert.equal(owner.wood, beforeWood); assert.equal(JSON.stringify(preview).includes('"x"'), false);
  assert.equal(tools.execute('commit_strategy', { tasks: [preview.directive], work: null }).ok, true);
  applyPlan(world, owner.id, tools.committed.plan); ticks(world, 29);
  assert.ok(world.buildings.length > 0 && world.buildings.length < 7);
  const progress = citizenObservation(world, owner.id).construction;
  assert.equal(progress.totalSegments, 7); assert.equal(progress.completedSegments, world.buildings.length);
  assert.equal(progress.remainingWood, (7 - world.buildings.length) * 15);
  const order = owner.order, invested = structuredClone(order.effort);
  const next = session(world, owner); assert.equal(next.execute('continue_strategy', {}).ok, true);
  applyPlan(world, owner.id, next.committed.plan); assert.equal(owner.order, order); assert.deepEqual(owner.order.effort, invested);
  ticks(world, 100);
  assert.equal(world.buildings.filter(b => b.kind === 'wall' && b.health > 0).length, 7);
  assert.equal(owner.wood, beforeWood - 105); assert.equal(owner.planBlocked ?? null, null);
  assert.equal(world.buildings.some(b => b.x === anchor.x && b.y === anchor.y + 1), false);
  assert.ok(findPath(world, { x: anchor.x, y: anchor.y + 2 }, anchor), 'the entrance permits ordinary visitors');
});

test('construction refuses unobserved, occupied, closed and malformed footprints without side effects', () => {
  const { world, owner } = town(); const anchor = resource(world, owner);
  const tools = session(world, owner);
  for (const input of [
    { target: 'crop-unknown', layout: 'line' },
    { target: anchor.id, layout: 'enclosure', openings: [] },
    { target: anchor.id, layout: 'enclosure', openings: ['south', 'south'] },
    { target: anchor.id, layout: 'enclosure', length: 3 },
    { target: anchor.id, layout: 'enclosure', size: 'large' },
  ]) {
    const before = structuredClone(world); assert.equal(tools.execute('plan_construction', input).ok, false); assert.deepEqual(world, before);
  }
  const before = structuredClone(world);
  assert.equal(tools.execute('commit_strategy', { tasks: [{ type: 'construct', plan: 'made-up' }], work: null }).ok, false);
  assert.deepEqual(world, before);
});

test('a newly occupied wall site stops construction without taking wood or trapping the occupant', () => {
  const { world, owner, attacker } = town();
  const target = { id: 'tree-anchor', kind: 'tree', x: 6, y: 5, stock: 1, capacity: 1, yield: 5, regrowTicks: 120, regrowIn: 0 };
  world.nodes = [target]; observeWorld(world, owner);
  choose(world, owner, [{ type: 'build', building: 'wall', target: target.id, side: 'north' }]);
  Object.assign(attacker, { x: 6, y: 4, food: 30 }); const before = owner.wood;
  ticks(world, 13);
  assert.equal(world.buildings.length, 0); assert.equal(owner.wood, before);
  assert.match(owner.planBlocked, /occupied site/);
  assert.ok(findPath(world, attacker, { x: 6, y: 3 }));
});

test('owners can demolish their own walls, salvage them once, and execute their queued follow-up', () => {
  const { world, owner, attacker } = town(); Object.assign(attacker, { x: 14, y: 8 });
  const b = makeWall(world, owner); b.health = 18;
  Object.assign(owner, { weapon: true, weaponLevel: 1, weaponDurability: 12 });
  world.nodes = [{ id: 'crop-destination', kind: 'crop', x: 8, y: 5, stock: 1, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 0 }];
  // The destination was previously observed; the wall now hides it.
  owner.knowledge.nodes['crop-destination'] = { ...world.nodes[0], observedAt: world.tick, source: 'seen' };
  const before = owner.wood;
  choose(world, owner, [{ type: 'attack', target: b.id }, { type: 'move', target: 'crop-destination' }]);
  ticks(world, 12);
  assert.equal(b.health, 0); assert.equal(world.stats.destroyed, 1); assert.equal(owner.wood, before + 9);
  assert.deepEqual({ x: owner.x, y: owner.y }, { x: 8, y: 5 }); assert.equal(owner.planBlocked ?? null, null);
  const snapshot = structuredClone(world);
  assert.equal(resolveBuilding(world, owner, { type: 'attack', target: b.id }).ok, false); assert.deepEqual(world, snapshot);
});

test('salvage follows recorded construction cost and refuses overflow before a lethal hit changes anything', () => {
  const { world, owner, attacker } = town();
  assert.equal(resolveBuilding(world, owner, { type: 'build', building: 'bakery', x: owner.x, y: owner.y }).ok, true);
  const b = world.buildings[0]; b.health = 6; b.woodCost = 75;
  attacker.wood = Number.MAX_SAFE_INTEGER; const before = structuredClone(world);
  assert.equal(resolveBuilding(world, attacker, { type: 'attack', target: b.id }).ok, false); assert.deepEqual(world, before);
  attacker.wood = 20;
  assert.equal(resolveBuilding(world, attacker, { type: 'attack', target: b.id }).ok, true); assert.equal(attacker.wood, 65);
  assert.equal(owner.buildingAlerts.at(-1).destroyed, true);
});

test('owned buildings are discoverable beyond the first page and private unseen structures remain absent', () => {
  const { world, owner, attacker } = town();
  const records = Array.from({ length: 12 }, (_, i) => ({ id: `bakery-${i + 1}`, kind: 'bakery', x: i, y: 0,
    ownerId: i < 9 ? attacker.id : owner.id, health: 240, maxHealth: 240, observedAt: 0, source: 'report' }));
  owner.knowledge.buildings = Object.fromEntries(records.map(b => [b.id, b]));
  const tools = session(world, owner), first = tools.execute('get_buildings', {});
  assert.ok(first.items.slice(0, 3).every(b => b.ownerId === owner.id));
  const second = tools.execute('get_buildings', { after: first.nextAfter });
  assert.equal(new Set([...first.items, ...second.items].map(b => b.id)).size, 12);
  assert.deepEqual(tools.execute('get_buildings', { owned: true }).items.map(b => b.id), records.slice(9).map(b => b.id));
  assert.equal(citizenObservation(world, owner.id).property.bakeryCount, 3);
  world.buildings.push({ id: 'wall-99', kind: 'wall', ownerId: attacker.id, x: 15, y: 9, health: 120 });
  assert.equal(JSON.stringify(tools.execute('get_buildings', {})).includes('wall-99'), false);
});

test('single-occupant houses admit their owner, improve actual rest by 300%, and reject foreign rest', () => {
  const { world, owner, attacker } = town();
  assert.equal(resolveBuilding(world, owner, { type: 'build', building: 'house', x: owner.x, y: owner.y }).ok, true);
  observeWorld(world, owner); observeWorld(world, attacker); const house = world.buildings[0];
  assert.equal(isWalkable(world, house.x, house.y, owner), true);
  assert.equal(isWalkable(world, house.x, house.y, attacker), false);
  const foreign = session(world, attacker), before = structuredClone(world);
  assert.equal(foreign.execute('commit_strategy', { tasks: [{ type: 'rest', target: house.id }], work: null }).ok, false);
  assert.deepEqual(world, before);
  for (const c of world.citizens) Object.assign(c, { health: 50, energy: 30 });
  choose(world, owner, [{ type: 'rest', target: 'own' }]); choose(world, attacker, [{ type: 'rest' }]); ticks(world, 5);
  assert.equal(owner.energy, 100); assert.ok(attacker.energy > 64 && attacker.energy < 65);
  assert.equal(owner.health - 50, 4 * (attacker.health - 50), 'fed health recovery is four times normal');
});

test('a citizen builds a real house and queues home rest without needing to invent its ID', () => {
  const { world, owner } = town(); owner.wood = 60; owner.health = 50; owner.energy = 70;
  choose(world, owner, [{ type: 'build', building: 'house' }, { type: 'rest', target: 'own' }]); ticks(world, 40);
  const house = world.buildings.find(b => b.kind === 'house'); assert.ok(house); assert.equal(house.health, 180);
  assert.equal(owner.wood, 0); assert.ok(Math.abs(owner.energy - 99.25) < 1e-9); assert.equal(owner.health, 58);
  assert.equal(owner.planBlocked ?? null, null); assert.deepEqual(citizenObservation(world, owner.id).property.houses, [house.id]);
});

test('destroying a house yields 36 wood and removes its rest benefit immediately', () => {
  const { world, owner } = town();
  assert.equal(resolveBuilding(world, owner, { type: 'build', building: 'house', x: owner.x, y: owner.y }).ok, true);
  const house = world.buildings[0]; house.health = 6; const before = owner.wood;
  assert.equal(resolveBuilding(world, owner, { type: 'attack', target: house.id }).ok, true);
  assert.equal(owner.wood, before + 36); Object.assign(owner, { health: 50, energy: 30 });
  choose(world, owner, [{ type: 'rest' }]); ticks(world, 5);
  assert.ok(owner.energy > 64 && owner.energy < 65); assert.equal(owner.health, 52);
});
