import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tickWorld, applyPlan } from '../lib/world.mjs';
import { findPath, isWalkable } from '../lib/pathfinding.mjs';
import { areaOf, worldAreas, areaDestination } from '../lib/places.mjs';
import { canSee, observeWorld } from '../lib/knowledge.mjs';
import { resolveBuilding } from '../lib/buildings.mjs';

test('scattered ruins leave an open center, connected walkable terrain and visible starter food', () => {
  const world = createWorld(), actor = world.citizens[0];
  assert.equal(world.buildings.length, 20);
  assert.ok(world.buildings.every(b => b.kind === 'wall' && b.ownerId === null && b.ruin));
  const obstacles = [...world.blocked, ...world.buildings];
  assert.ok(obstacles.every(p => areaOf(world, p) !== 'center'));
  assert.equal(new Set(obstacles.map(p => `${p.x},${p.y}`)).size, obstacles.length);
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    if (isWalkable(world, x, y, actor)) assert.ok(findPath(world, actor, { x, y }), `${x},${y} reachable`);
  }
  for (const node of world.nodes) assert.ok(isWalkable(world, node.x, node.y, actor));
  for (const area of worldAreas(world)) assert.ok(areaDestination(world, actor, area));
  for (const citizen of world.citizens) assert.ok(Object.values(citizen.knowledge.nodes).some(n => n.kind === 'crop'), citizen.name);
});

test('unclaimed ruin walls occlude sight and can actually be demolished for standard salvage', () => {
  const world = createWorld(), actor = world.citizens[0], wall = world.buildings.find(b => b.x === 4 && b.y === 3);
  world.citizens = [actor];
  Object.assign(actor, { x: 4, y: 4, food: 20, wood: 20, hunger: 0, energy: 100, asyncReview: true });
  observeWorld(world, actor);
  assert.equal(actor.knowledge.buildings[wall.id].ruin, true);
  assert.equal(isWalkable(world, wall.x, wall.y, actor), false);
  assert.equal(canSee(world, actor, { x: 4, y: 2 }), false);
  applyPlan(world, actor.id, { thought: 'Clear this passage.', goals: ['Clear a ruin'], memory: '',
    routine: { family: false }, tasks: [{ type: 'attack', target: wall.id }], work: null, reviewAfter: 600 });
  for (let i = 0; i < 60 && wall.health > 0; i++) tickWorld(world);
  assert.equal(wall.health, 0);
  assert.equal(wall.destroyed, true);
  assert.equal(world.stats.buildingAttacks, 10);
  assert.equal(world.stats.attacks, 0, 'ruin demolition is not citizen conflict');
  assert.equal(actor.wood, 29);
  assert.equal(isWalkable(world, wall.x, wall.y, actor), true);
  assert.equal(canSee(world, actor, { x: 4, y: 2 }), true);
  assert.deepEqual(resolveBuilding(world, actor, { type: 'build', building: 'wall', x: 4, y: 5 }), { ok: true });
  assert.equal(world.buildings.at(-1).id, 'wall-21');
  assert.equal(world.buildings.at(-1).ownerId, actor.id);
});
