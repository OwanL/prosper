import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, transactCitizenAction, tickWorld, applyPlan } from '../lib/world.mjs';
import { citizenObservation, createCitizenToolSession } from '../lib/citizen-tools.mjs';

function births() {
  const world = createWorld({ expanded: false }), [first, second] = world.citizens;
  world.citizens = [first, second];
  first.x = 2; first.y = 2; second.x = 3; second.y = 2;
  first.food = 100; second.food = 100; first.hunger = 0; second.hunger = 0;
  first.work = null; second.work = null;
  for (let i = 0; i < 8; i++) {
    const proposal = transactCitizenAction(world, first.id, { type: 'propose_family', target: second.id });
    assert.equal(proposal.ok, true, proposal.reason);
    const id = world.familyProposals.at(-1).id;
    assert.equal(transactCitizenAction(world, second.id, { type: 'accept_family', proposal: id }).ok, true);
    const tools = createCitizenToolSession({ getWorld: () => world, citizenId: first.id });
    tools.refresh();
    const result = tools.execute('commit_strategy', { tasks: [{ type: 'reproduce', target: second.id }], work: null });
    assert.equal(result.ok, true, result.error);
    applyPlan(world, first.id, tools.committed.plan);
    for (let tick = 0; tick < 12 && world.stats.births < i + 1; tick++) tickWorld(world);
    assert.equal(world.stats.births, i + 1);
  }
  return world;
}

test('actual births preserve family costs and acquire varied independent motives without prescribed work', () => {
  const world = births(), children = world.citizens.filter(c => !c.adult);
  assert.equal(children.length, 8);
  assert.equal(world.stats.births, 8);
  assert.equal(world.citizens[0].food, 84);
  assert.equal(world.citizens[1].food, 84);
  assert.ok(new Set(children.map(c => c.personality)).size > 1);
  assert.ok(new Set(children.map(c => JSON.stringify(c.aspirations))).size > 1);
  for (const child of children) {
    assert.equal(child.aspirations.length, 2);
    assert.ok(child.aspirations.every(a => typeof a === 'string' && a.length <= 160));
    assert.notDeepEqual(child.aspirations, world.citizens[0].aspirations);
    assert.notDeepEqual(child.aspirations, world.citizens[1].aspirations);
    assert.equal(child.work, null);
    assert.deepEqual(child.tasks, []);
  }
  const repeated = births().citizens.filter(c => !c.adult);
  assert.deepEqual(repeated.map(c => [c.personality, c.aspirations]), children.map(c => [c.personality, c.aspirations]), 'the same birth IDs replay the same character');
});

test('maturation retains the child motives and exposes them to its independent strategic observation', () => {
  const world = births(), child = world.citizens.find(c => !c.adult), aims = [...child.aspirations], personality = child.personality;
  for (let i = 0; i < 300; i++) tickWorld(world);
  assert.equal(child.alive, true);
  assert.equal(child.adult, true);
  assert.deepEqual(child.aspirations, aims);
  assert.equal(child.personality, personality);
  const observation = citizenObservation(world, child.id);
  assert.deepEqual(observation.citizen.aspirations, aims);
  assert.equal(observation.citizen.personality, personality);
});
