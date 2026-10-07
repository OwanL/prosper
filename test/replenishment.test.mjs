import test from 'node:test';
import assert from 'node:assert/strict';
import { observeWorld, knownDeposits, shareKnowledgeWith } from '../lib/knowledge.mjs';
import { replenishmentEstimate, estimatedRecheckDelay } from '../lib/replenishment.mjs';
import { createWorld, tickWorld, applyPlan } from '../lib/world.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';

function fixture() {
  const world = createWorld({ expanded: false }), actor = world.citizens[0];
  world.citizens = [actor]; world.blocked = []; world.tick = 10; world.asyncReview = true;
  Object.assign(actor, { x: 1, y: 1, hunger: 10, food: 4, bread: 0, energy: 100 });
  world.nodes = [{ id: 'crop-near', kind: 'crop', x: 4, y: 1, stock: 1, capacity: 1, yield: 1, regrowTicks: 12, regrowIn: 0 }];
  actor.knowledge.nodes = {};
  observeWorld(world, actor);
  return { world, actor, crop: world.nodes[0] };
}

test('only a consecutive personally observed stock drop establishes depletion; memories and reports stay dated', () => {
  const { world, actor, crop } = fixture();
  assert.equal(actor.knowledge.nodes[crop.id].witnessedDepletionAt, undefined);
  world.tick = 11; crop.stock = 0; crop.regrowIn = 12;
  observeWorld(world, actor);
  assert.equal(actor.knowledge.nodes[crop.id].witnessedDepletionAt, 11);
  world.tick = 12; observeWorld(world, actor);
  assert.equal(actor.knowledge.nodes[crop.id].witnessedDepletionAt, 11, 'empty sightings do not restart the estimate');
  actor.x = 12; world.tick = 15; crop.regrowIn = 1; observeWorld(world, actor);
  assert.equal(actor.knowledge.nodes[crop.id].observedAt, 12, 'remote growth is not observed');
  assert.equal(replenishmentEstimate(knownDeposits(actor)[0], 15).nominalDueAt, 23);
  actor.x = 1; world.tick = 16; observeWorld(world, actor);
  assert.equal(actor.knowledge.nodes[crop.id].witnessedDepletionAt, 11, 'a still-empty return preserves evidence');
  const peer = structuredClone(actor); peer.id = 'peer'; peer.x = 12; peer.knowledge.nodes = {};
  world.citizens.push(peer);
  assert.equal(shareKnowledgeWith(world, actor, peer, [crop.id]).ok, true);
  assert.equal(peer.knowledge.nodes[crop.id].observedAt, 16);
  assert.equal(peer.knowledge.nodes[crop.id].witnessedDepletionAt, 11);
  assert.equal(peer.knowledge.nodes[crop.id].source, 'report');
  assert.equal('regrowIn' in knownDeposits(peer)[0], false);
  crop.stock = 1; world.tick = 17; observeWorld(world, actor);
  assert.equal(actor.knowledge.nodes[crop.id].witnessedDepletionAt, undefined);
  world.tick = 30; crop.stock = 0; observeWorld(world, actor);
  assert.equal(actor.knowledge.nodes[crop.id].witnessedDepletionAt, undefined, 'a sighting gap cannot establish a new drop');
});

test('an overdue estimate never guarantees available stock and a later empty sighting invalidates it', () => {
  const memory = { kind: 'crop', stock: 0, regrowTicks: 12, observedAt: 12, witnessedDepletionAt: 11 };
  assert.deepEqual(replenishmentEstimate(memory, 20), { witnessedAt: 11, nominalDueAt: 23, ticksUntilNominalGrowth: 3 });
  assert.equal(replenishmentEstimate(memory, 25).ticksUntilNominalGrowth, 0);
  assert.equal(replenishmentEstimate({ ...memory, observedAt: 23 }, 25), null);
  assert.equal(estimatedRecheckDelay({ ...memory, observedAt: 23 }, 25), 10);
  assert.equal(replenishmentEstimate({ ...memory, stock: 1 }, 20), null);
  assert.equal(replenishmentEstimate({ ...memory, witnessedDepletionAt: -1 }, 20), null);
  assert.equal(replenishmentEstimate(memory, 10), null);
  assert.equal(replenishmentEstimate({ ...memory, witnessedDepletionAt: undefined }, 20), null);
});

test('arrival-aware foraging can reach witnessed growth before an otherwise fatal distant route', () => {
  for (const witnessed of [false, true]) {
    const { world, actor, crop } = fixture();
    Object.assign(actor, { hunger: 100, health: 8, food: 0 });
    Object.assign(crop, { stock: 0, regrowIn: 2 });
    actor.knowledge.nodes[crop.id] = { ...actor.knowledge.nodes[crop.id], stock: 0,
      ...(witnessed ? { witnessedDepletionAt: 0 } : {}) };
    const far = { ...crop, id: 'crop-far', x: 14, stock: 1, regrowIn: 0 };
    world.nodes.push(far);
    actor.knowledge.nodes[far.id] = { id: far.id, kind: 'crop', x: far.x, y: far.y, stock: 1, capacity: 1, yield: 1, regrowTicks: 12, observedAt: 10, source: 'seen' };
    tickWorld(world);
    assert.equal(actor.gatherTarget.nodeId, witnessed ? crop.id : far.id);
    for (let i = 0; i < 25; i++) tickWorld(world);
    assert.equal(actor.alive, witnessed, 'the controlled route difference changes actual survival, not just a label');
    if (witnessed) assert.ok(world.stats.harvestedFood > 0);
  }
});

test('bounded native collection can explicitly camp a known site and then execute the next directive', () => {
  const { world, actor, crop } = fixture();
  actor.x = crop.x; crop.stock = 0; crop.regrowIn = 2;
  observeWorld(world, actor);
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id, planId: 'camp-test' });
  tools.refresh();
  assert.match(tools.execute('commit_strategy', { tasks: [{ type: 'collect', resource: 'food', amount: 1, camp: true }], work: null }).error, /requires target/);
  assert.match(tools.execute('commit_strategy', { tasks: [{ type: 'collect', resource: 'food', amount: 1, target: 'unknown' }], work: null }).error, /known matching/);
  assert.match(tools.execute('commit_strategy', { tasks: [{ type: 'collect', resource: 'food', amount: 1, target: crop.id, area: 'south-east-ring-2' }], work: null }).error, /outside/);
  const receipt = tools.execute('commit_strategy', { tasks: [{ type: 'collect', resource: 'food', amount: 1, maxTicks: 40, target: crop.id, camp: true }, { type: 'rest' }], work: null });
  assert.equal(receipt.ok, true);
  assert.deepEqual(tools.committed.plan.tasks[0], { type: 'gather', resource: 'food', amount: 1, maxTicks: 40, target: crop.id, camp: true });
  // Apply the actual compiled directive rather than assuming a commitment executes it.
  applyPlan(world, actor.id, tools.committed.plan);
  for (let i = 0; i < 35; i++) tickWorld(world);
  assert.equal(world.stats.harvestedFood, 1);
  assert.equal(actor.planCount, 1);
  assert.deepEqual(actor.actionResults.find(entry => entry.task.type === 'gather'), {
    tick: actor.actionResults[0].tick, task: tools.committed.plan.tasks[0], status: 'completed', collected: 1, stoppedBy: 'amount reached',
  });
  assert.ok(actor.actionResults.some(entry => entry.task.type === 'rest' && entry.status === 'completed'));
});
