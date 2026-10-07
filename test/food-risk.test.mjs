import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tickWorld, applyPlan } from '../lib/world.mjs';
import { citizenObservation, createCitizenToolSession } from '../lib/citizen-tools.mjs';

test('own empty-food estimate matches actual fatal hunger without meals, healing or other harm', () => {
  const world = createWorld({ expanded: false }), actor = world.citizens[0];
  world.citizens = [actor]; world.nodes = [];
  actor.food = 0; actor.bread = 0; actor.hunger = 90; actor.health = 80;
  actor.knowledge.explored = Array.from({ length: world.width * world.height }, (_, i) => `${i % world.width},${Math.floor(i / world.width)}`);
  const estimate = citizenObservation(world, actor.id).foodUrgency;
  assert.equal(estimate.state, 'no_meal');
  assert.equal(estimate.starvationInTicks, 40);
  let elapsed = 0;
  while (actor.alive && elapsed <= estimate.fatalHungerInTicks + 2) { tickWorld(world); elapsed++; }
  assert.equal(actor.alive, false);
  assert.ok(Math.abs(elapsed - estimate.fatalHungerInTicks) <= 1);
  assert.equal(world.stats.deaths, 1);
});

test('actual food delivery replaces the empty-food clock with present-meal evidence', () => {
  const world = createWorld({ expanded: false }), [actor, donor] = world.citizens;
  world.citizens = [actor, donor]; actor.x = 2; actor.y = 2; donor.x = 3; donor.y = 2;
  actor.food = 0; actor.bread = 0; actor.hunger = 95; actor.health = 70; donor.food = 10;
  assert.equal(citizenObservation(world, actor.id).foodUrgency.state, 'no_meal');
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: donor.id });
  tools.refresh();
  assert.equal(tools.execute('commit_strategy', { tasks: [{ type: 'give', target: actor.id, resource: 'food', amount: 3 }], work: null }).ok, true);
  applyPlan(world, donor.id, tools.committed.plan);
  for (let i = 0; i < 10 && world.stats.transfers === 0; i++) tickWorld(world);
  assert.equal(world.stats.transfers, 1);
  const current = citizenObservation(world, actor.id).foodUrgency;
  assert.equal(current.state, 'meal_available');
  assert.equal(current.fatalHungerInTicks, undefined, 'the old empty-food estimate is no longer presented');
  assert.equal(actor.alive, true);
});
