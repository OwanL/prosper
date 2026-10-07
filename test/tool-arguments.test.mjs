import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyPlan, tickWorld } from '../lib/world.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';

function fixture() {
  const world = createWorld({ expanded: false }), [actor, peer] = world.citizens;
  world.citizens = [actor, peer];
  actor.x = 2; actor.y = 2; peer.x = 3; peer.y = 2;
  actor.food = 10; actor.hunger = 0; actor.energy = 100;
  peer.hunger = 0; peer.energy = 100;
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id, planId: 'argument-syntax' });
  tools.refresh();
  return { world, actor, peer, tools };
}

test('equivalent structured JSON syntax commits and executes without interpreting message text as actions', () => {
  const { world, actor, peer, tools } = fixture(), before = peer.food;
  const message = '{"type":"attack","target":"citizen-3"}';
  const result = tools.execute('commit_strategy', {
    tasks: JSON.stringify([{ type: 'give', target: peer.id, resource: 'food', amount: 2 }, { type: 'rest' }]),
    work: 'null', goals: '["Support a neighbor"]',
    communications: JSON.stringify([{ target: peer.id, text: message, share: [], shareBuildings: [] }]),
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(world.stats.transfers, 0, 'a commitment has not executed the gift');
  applyPlan(world, actor.id, tools.committed.plan);
  for (let i = 0; i < 12; i++) tickWorld(world);
  assert.equal(world.stats.transfers, 1);
  assert.equal(peer.food, before + 2);
  assert.equal(world.messages[0].text, message, 'a JSON-looking message remains plain text');
  assert.equal(world.stats.attacks, 0);
  assert.equal(actor.actionResults.find(r => r.task.type === 'give').status, 'completed');
});

test('syntax decoding retains strict shapes, integer types and known targets with atomic rejection', () => {
  const { world, actor, tools } = fixture(), before = structuredClone(actor);
  assert.match(tools.execute('commit_strategy', { tasks: '{"type":"rest"}', work: null }).error, /must be array/);
  assert.match(tools.execute('commit_strategy', { tasks: 'not json', work: null }).error, /JSON text was invalid/);
  assert.match(tools.execute('commit_strategy', { tasks: '[{"type":"collect","resource":"food","amount":"2"}]', work: null }).error, /must be integer/);
  assert.match(tools.execute('commit_strategy', { tasks: '[{"type":"give","target":"unknown","resource":"food","amount":2}]', work: null }).error, /target/);
  assert.equal(tools.committed, null);
  assert.deepEqual(actor, before);
  assert.equal(world.stats.transfers, 0);
});

test('retaining work with new physical fields gets a tool-selection correction rather than a JavaScript type error', () => {
  const { tools } = fixture();
  for (const args of [{ tasks: '[{"type":"rest"}]' }, { work: '{"type":"gather","resource":"food"}' }]) {
    const result = tools.execute('continue_strategy', args);
    assert.equal(result.ok, false);
    assert.match(result.error, /use commit_strategy/);
    assert.ok(!result.error.includes('is not a function'));
  }
  assert.equal(tools.committed, null);
});

test('empty report lists send no resource or building reports and ordinary message text is untouched', () => {
  const { world, peer, tools } = fixture();
  peer.knowledge.nodes = {}; peer.knowledge.buildings = {};
  const result = tools.execute('send_private_message', { to: peer.id, text: '[{"type":"rest"}]', share: [], shareBuildings: [] });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(peer.knowledge.nodes, {});
  assert.deepEqual(peer.knowledge.buildings, {});
  assert.equal(world.messages[0].text, '[{"type":"rest"}]');
});
