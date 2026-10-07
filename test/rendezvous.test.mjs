import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tickWorld, applyPlan, transactCitizenAction } from '../lib/world.mjs';
import { observeWorld } from '../lib/knowledge.mjs';
import { createCitizenToolSession, citizenObservation } from '../lib/citizen-tools.mjs';

function fixture() {
  const world = createWorld();
  world.blocked = []; world.nodes = []; world.citizens = world.citizens.slice(0, 2);
  for (const [index, c] of world.citizens.entries()) Object.assign(c, {
    x: 1 + index * 2, y: 1, food: 20, wood: 20, hunger: 0, energy: 100, health: 100,
    knowledge: { nodes: {}, people: {}, buildings: {}, explored: [] }, asyncReview: true,
    current: null, order: null, tasks: [], work: null, path: [],
  });
  return world;
}
function choose(world, c, tasks) {
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: c.id, planId: 'rendezvous-test' });
  tools.refresh();
  const result = tools.execute('commit_strategy', { tasks, work: null });
  assert.equal(result.ok, true, result.error);
  applyPlan(world, c.id, tools.committed.plan);
  return result;
}
function until(world, condition, limit = 160) {
  for (let i = 0; i < limit && !condition(); i++) tickWorld(world);
  assert.ok(condition(), `Condition not reached at tick ${world.tick}`);
}
function agree(world, a, b) {
  const proposal = transactCitizenAction(world, a.id, { type: 'propose_family', target: b.id });
  assert.equal(proposal.ok, true);
  assert.equal(transactCitizenAction(world, b.id, { type: 'accept_family', proposal: proposal.receiptId }).ok, true);
}

test('queued citizen movement follows a moving visible target and then delivers at adjacency', () => {
  const world = fixture(), [a, b] = world.citizens;
  observeWorld(world, a);
  const receipt = choose(world, a, [{ type: 'move', target: b.id }, { type: 'give', target: b.id, resource: 'wood', amount: 2 }]);
  assert.deepEqual(receipt.tasks[0], { type: 'move', target: b.id });
  assert.equal(a.tasks[0].type, 'approach');
  for (let i = 0; i < 8; i++) { b.x = 3 + Math.floor(i / 2); tickWorld(world); }
  until(world, () => world.stats.transfers === 1);
  assert.ok(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1);
  assert.equal(b.wood, 22);
  assert.equal(a.actionResults.find(r => r.task.type === 'approach').status, 'completed');
});

test('global movement finds an unseen citizen despite an obsolete area hint and preserves queued delivery', () => {
  const world = fixture(), [a, b] = world.citizens;
  Object.assign(b, { x: 6, y: 8 });
  observeWorld(world, a);
  assert.equal(a.knowledge.people[b.id], undefined);
  choose(world, a, [{ type: 'move', target: b.id, area: 'north-east' },
    { type: 'give', target: b.id, resource: 'wood', amount: 3 }]);
  tickWorld(world);
  assert.equal(a.knowledge.people[b.id], undefined, 'routing does not invent a remote sighting');
  assert.equal(citizenObservation(world, a.id).citizen.execution.contactSearch, undefined);
  until(world, () => world.stats.transfers === 1);
  assert.equal(world.stats.transfers, 1);
  assert.ok(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1);
});

test('global delivery reroutes when an unseen recipient moves, with no transfer before contact', () => {
  const world = fixture(), [a, b] = world.citizens;
  Object.assign(b, { x: 14, y: 1 });
  choose(world, a, [{ type: 'give', target: b.id, resource: 'wood', amount: 2 }]);
  tickWorld(world);
  assert.equal(world.stats.transfers, 0);
  Object.assign(b, { x: 2, y: 8 });
  assert.equal(a.knowledge.people[b.id], undefined);
  until(world, () => world.stats.transfers === 1);
  assert.ok(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1);
  assert.equal(b.wood, 22);
});

test('trade directly reaches an unseen moving seller and settles the chosen escrow once', () => {
  const world = fixture(), [buyer, seller] = world.citizens;
  Object.assign(seller, { x: 14, y: 8 });
  const offer = transactCitizenAction(world, seller.id, { type: 'offer', give: 'food', giveAmount: 3, want: 'wood', wantAmount: 5 });
  choose(world, buyer, [{ type: 'trade', offer: offer.receiptId }]);
  tickWorld(world);
  assert.equal(world.stats.trades, 0);
  assert.equal(buyer.knowledge.people[seller.id], undefined);
  Object.assign(seller, { x: 12, y: 2 });
  until(world, () => world.stats.trades === 1);
  assert.ok(Math.abs(buyer.x - seller.x) + Math.abs(buyer.y - seller.y) <= 1);
  assert.equal(buyer.wood, 15);
  assert.equal(seller.wood, 25);
  assert.equal(world.offers[0].status, 'filled');
  for (let i = 0; i < 5; i++) tickWorld(world);
  assert.equal(world.stats.trades, 1);
});

test('global routing cannot cross impassable terrain or trade after escrow expires', () => {
  for (const mode of ['blocked', 'expired']) {
    const world = fixture(), [buyer, seller] = world.citizens;
    Object.assign(seller, { x: 14, y: 8 });
    const offer = transactCitizenAction(world, seller.id, { type: 'offer', give: 'food', giveAmount: 3, want: 'wood', wantAmount: 5 });
    if (mode === 'expired') world.tick = world.offers[0].expiresAt - 2;
    choose(world, buyer, [{ type: 'trade', offer: offer.receiptId }]);
    if (mode === 'blocked') world.blocked = Array.from({ length: world.height }, (_, y) => ({ x: 8, y }));
    else tickWorld(world);
    until(world, () => !!buyer.planBlocked, 10);
    assert.equal(world.stats.trades, 0);
    assert.equal(buyer.wood, 20);
    assert.match(buyer.planBlocked, mode === 'blocked' ? /reachable/ : /offer no longer open/);
  }
});

test('a chosen family action prepares own inputs and vitals, then waits for an actual partner requirement failure', () => {
  const world = fixture(), [a, b] = world.citizens;
  Object.assign(a, { food: 1, wood: 0, energy: 25, health: 48 });
  Object.assign(b, { x: 14, y: 8, food: 1, wood: 0 });
  world.nodes = [{ id: 'test-crop', kind: 'crop', x: 2, y: 1, stock: 1, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 0 }];
  observeWorld(world, a); agree(world, a, b);
  choose(world, a, [{ type: 'reproduce', target: b.id }]);
  until(world, () => a.order?.preparation?.phase === 'retrying_meeting');
  assert.equal(world.stats.births, 0);
  assert.equal(a.food, 2);
  assert.equal(a.wood, 0);
  assert.ok(a.health >= 50);
  assert.equal(b.wood, 0);
  assert.deepEqual(b.tasks, []);
  assert.equal(b.work, null);
  assert.equal(a.planBlocked, undefined);
  b.food = 2;
  until(world, () => world.stats.births === 1);
  assert.equal(world.familyProposals[0].status, 'fulfilled');
  assert.equal(a.wood, 0);
  assert.equal(b.wood, 0);
});

test('cancelling consent stops a waiting family action without changing the partner strategy', () => {
  const world = fixture(), [a, b] = world.citizens;
  b.food = 1; agree(world, a, b);
  choose(world, a, [{ type: 'reproduce', target: b.id }]);
  until(world, () => a.order?.preparation?.phase === 'retrying_meeting');
  assert.equal(transactCitizenAction(world, b.id, { type: 'cancel_family', proposal: world.familyProposals[0].id }).ok, true);
  until(world, () => !!a.planBlocked, 15);
  assert.match(a.planBlocked, /pairing.*no longer active/);
  assert.equal(world.stats.births, 0);
});

test('a chosen trade gathers its missing payment without choosing other offers', () => {
  const world = fixture(), [buyer, seller] = world.citizens;
  buyer.wood = 0;
  world.nodes = [{ id: 'test-tree', kind: 'tree', x: 2, y: 1, stock: 1, capacity: 1, yield: 5, regrowTicks: 120, regrowIn: 0 }];
  observeWorld(world, buyer);
  const offer = transactCitizenAction(world, seller.id, { type: 'offer', give: 'food', giveAmount: 3, want: 'wood', wantAmount: 5 });
  choose(world, buyer, [{ type: 'trade', offer: offer.receiptId }]);
  until(world, () => world.stats.trades === 1);
  assert.equal(world.offers[0].status, 'filled');
  assert.equal(buyer.wood, 0);
  assert.equal(seller.wood, 25);
});

test('a chosen attack routes globally but strikes only after visible adjacent contact', () => {
  const world = fixture(), [a, b] = world.citizens;
  Object.assign(b, { x: 14, y: 8 });
  choose(world, a, [{ type: 'attack', target: b.id }]);
  tickWorld(world);
  assert.equal(world.stats.attacks, 0);
  assert.equal(b.health, 100);
  until(world, () => world.stats.attacks > 0);
  assert.ok(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1);
  assert.ok(b.health < 100);
});
