import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyPlan, tickWorld } from '../lib/world.mjs';
import { createCitizenToolSession, citizenObservation } from '../lib/citizen-tools.mjs';

function setup({ amount = 2, maxTicks = 60, stock = 1 } = {}) {
  const world = createWorld({ expanded: false }), citizen = world.citizens[0], crop = world.nodes.find(n => n.kind === 'crop');
  world.citizens = [citizen]; world.nodes = [crop];
  Object.assign(crop, { stock, capacity: 1, regrowTicks: 999, regrowIn: stock ? 0 : 999 });
  Object.assign(citizen, { x: crop.x, y: crop.y, food: 5, hunger: 0, energy: 100, asyncReview: true });
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: citizen.id, planId: 'collection-test' });
  tools.refresh();
  const result = tools.execute('commit_strategy', { tasks: [{ type: 'collect', resource: 'food', amount, maxTicks }, { type: 'craft', item: 'shoes' }], work: null });
  assert.equal(result.ok, true, JSON.stringify(result));
  citizen.wood = 10;
  applyPlan(world, citizen.id, tools.committed.plan);
  return { world, citizen };
}

test('bounded collection accepts zero or partial progress then executes the next action', () => {
  for (const stock of [0, 1]) {
    const { world, citizen } = setup({ stock, maxTicks: 15 });
    tickWorld(world);
    assert.equal(citizenObservation(world, citizen.id).citizen.order.type, 'collect');
    for (let i = 0; i < 40 && !citizen.shoes; i++) tickWorld(world);
    assert.equal(citizen.shoes, true, 'optional preparation does not indefinitely block crafting');
    const result = citizen.actionResults.find(r => r.task.type === 'gather');
    assert.equal(result.status, 'completed');
    assert.equal(result.collected, stock);
    assert.equal(result.stoppedBy, 'time budget');
  }
});

test('meals do not erase newly collected units and reaching the amount ends early', () => {
  const { world, citizen } = setup({ amount: 1, maxTicks: 100 });
  while (!world.stats.harvestedFood && world.tick < 20) tickWorld(world);
  citizen.hunger = 60;
  for (let i = 0; i < 10 && !citizen.shoes; i++) tickWorld(world);
  const result = citizen.actionResults.find(r => r.task.type === 'gather');
  assert.equal(result.collected, 1);
  assert.equal(result.stoppedBy, 'amount reached');
  assert.equal(citizen.food, 5, 'one harvest and one meal');
  assert.equal(citizen.shoes, true);
  assert.ok(world.tick < 100);
});
