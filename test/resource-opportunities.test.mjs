import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tickWorld, applyPlan } from '../lib/world.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';
import { observeWorld } from '../lib/knowledge.mjs';

function town() {
  const world = createWorld({ expanded: false }), [actor, peer] = world.citizens;
  world.citizens = [actor, peer]; world.blocked = [];
  Object.assign(actor, { x: 2, y: 2, food: 20, wood: 15, hunger: 0, energy: 100, asyncReview: true });
  Object.assign(peer, { x: 3, y: 3 });
  world.nodes = [
    { id: 'crop-near', kind: 'crop', x: 2, y: 2, stock: 0, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 99 },
    { id: 'crop-free', kind: 'crop', x: 4, y: 2, stock: 1, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 0 },
  ];
  actor.knowledge.nodes = {};
  observeWorld(world, actor);
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id }); tools.refresh();
  return { world, actor, peer, tools };
}

test('forage queries put a stocked opportunity before a nearer empty site and the selected route actually yields food', () => {
  const { world, actor, tools } = town();
  const before = structuredClone(world), candidates = tools.execute('find_resources', { resource: 'food' });
  assert.equal(candidates.ranking, 'forage');
  assert.deepEqual(candidates.items.map(n => n.id), ['crop-free', 'crop-near']);
  assert.equal(candidates.items[0].preferenceCostTicks, 8);
  assert.equal(candidates.items[1].recheckDelayTicks, 99);
  assert.deepEqual(tools.execute('find_resources', { resource: 'food', rank: 'distance' }).items.map(n => n.id), ['crop-near', 'crop-free']);
  assert.deepEqual(world, before, 'retrieval did not move, harvest or update knowledge');
  assert.equal(tools.execute('commit_strategy', { tasks: [{ type: 'collect', resource: 'food', amount: 1, target: candidates.items[0].id }], work: null }).ok, true);
  applyPlan(world, actor.id, tools.committed.plan);
  for (let i = 0; i < 20 && actor.food === 20; i++) tickWorld(world);
  assert.equal(actor.food, 21);
  assert.equal(actor.resourceHistory['crop-free'].harvested, 1);
  assert.equal(actor.resourceHistory['crop-near'], undefined);
});

test('competition ranking uses only recent seen work and keeps remote changes private', () => {
  const { world, actor, peer, tools } = town();
  Object.assign(peer, { x: 4, y: 2, current: { task: { type: 'harvest', target: 'crop-free' } } });
  observeWorld(world, actor);
  const before = tools.execute('find_resources', { resource: 'food' });
  assert.deepEqual(before.items.map(n => n.id), ['crop-near', 'crop-free']);
  assert.equal(before.items[1].competitionPenaltyTicks, 99);
  Object.assign(peer, { x: 15, y: 7, food: 987654, weapon: true, weaponLevel: 3, current: { task: { type: 'craft', item: 'weapon' } } });
  world.nodes[1].stock = 0;
  assert.deepEqual(tools.execute('find_resources', { resource: 'food' }), before);
  world.tick = 20;
  const aged = tools.execute('find_resources', { resource: 'food' });
  assert.equal(aged.items[0].id, 'crop-free');
  assert.equal(aged.items[0].competitionPenaltyTicks, 0);
  assert.deepEqual(aged.items[0].lastSeenHarvesters, [{ id: peer.id, ageTicks: 20 }]);
  assert.equal(aged.items[0].observedStock, 1, 'expired competitor evidence does not refresh remote stock');
});

test('unreachable remembered sites sort last and area filters remain exact', () => {
  const { world, tools } = town();
  world.blocked = [{ x: 3, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 1 }, { x: 4, y: 3 }];
  const result = tools.execute('find_resources', { resource: 'food' });
  assert.equal(result.items.at(-1).id, 'crop-free');
  assert.equal(result.items.at(-1).travelTicks, null);
  assert.equal(result.items.at(-1).preferenceCostTicks, null);
  assert.deepEqual(tools.execute('find_resources', { resource: 'food', area: 'south-east' }).items, []);
});
