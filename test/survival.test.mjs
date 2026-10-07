import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../lib/simulation.mjs';
import { createWorld, tickWorld, planningContext, applyPlan } from '../lib/world.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';
import { normalizePlan } from '../lib/plans.mjs';
import { killCitizen } from '../lib/interactions.mjs';
import { createAgentPlanner } from '../lib/agent-planner.mjs';
import { survivalDeteriorated } from '../lib/survival.mjs';
import { citizenObservation } from '../lib/citizen-tools.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('a repeated survival race cannot livelock an explicitly chosen immediate food response', async () => {
  for (const strict of [true, false]) {
    const world = createWorld({ expanded: false }), actor = world.citizens[0];
    world.citizens = [actor];
    Object.assign(actor, { food: 0, bread: 0, hunger: 100, health: 100, asyncReview: true });
    const tools = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id });
    let reviewed;
    // Control reproduces the old unconditional stale-survival rejection.
    const session = {
      refresh() { return reviewed = tools.refresh(); },
      pollUpdates() { const update = tools.pollUpdates(); if (update) reviewed = update.context; return update; },
      get committed() { return tools.committed; },
      execute(name, args) {
        if (strict && survivalDeteriorated(reviewed.citizen, citizenObservation(world, actor.id).citizen)) {
          return { ok: false, error: 'Survival changed; reconsider.', context: reviewed = tools.refresh() };
        }
        return tools.execute(name, args);
      },
    };
    let calls = 0;
    const planner = createAgentPlanner({ fetchImpl: async () => {
      actor.health -= 10; calls++;
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{
        id: `call-${calls}`, type: 'function', function: { name: 'commit_strategy',
          arguments: JSON.stringify({ tasks: [{ type: 'collect', resource: 'food', amount: 1 }], work: null }) },
      }] } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }) };
    } });
    const turn = planner.plan(planningContext(world, actor.id), undefined, { toolSession: session });
    if (strict) {
      await assert.rejects(turn, /No strategy committed/);
      assert.equal(calls, 8);
      assert.equal(actor.planCount, 0);
    } else {
      const result = await turn;
      assert.equal(calls, 1);
      assert.deepEqual(result.unreviewedChanges, ['survival']);
      assert.equal(result.reviewContext.citizen.health, 100, 'new vitals are not falsely marked reviewed');
      applyPlan(world, actor.id, result.plan);
      for (let i = 0; i < 12; i++) tickWorld(world);
      assert.ok(actor.alive && actor.hunger < 100, 'the chosen response actually obtains and eats food');
    }
  }
});

test('new mail still blocks a food commitment, while unrelated death does not invalidate independent work', () => {
  const world = createWorld({ expanded: false }), [actor, peer] = world.citizens;
  Object.assign(actor, { food: 0, hunger: 100, health: 100 });
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id }); tools.refresh();
  actor.health = 90;
  world.messages.push({ id: 'new-mail', recipientId: actor.id, senderId: peer.id, text: 'Changed terms', tick: world.tick });
  const rejected = tools.execute('commit_strategy', { tasks: [{ type: 'collect', resource: 'food', amount: 1 }], work: null });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /New private mail/);
  killCitizen(world, peer, null);
  const committed = tools.execute('commit_strategy', { tasks: [{ type: 'collect', resource: 'food', amount: 1 }], work: null });
  assert.equal(committed.ok, true);
  assert.deepEqual(committed.unreviewedChanges, ['death']);
  assert.ok(tools.committed.reviewContext.neighbors.some(p => p.id === peer.id), 'death remains unreviewed');
});

test('the application gate permits a direct food response to late worsening while retaining a review request', async t => {
  let complete, captured;
  const { sim } = simulation(context => { captured = context; return new Promise(resolve => { complete = resolve; }); });
  t.after(() => sim.close());
  await sim.check(); sim.control('play'); sim.control('pause');
  const actor = sim.state.world.citizens[0];
  Object.assign(actor, { food: 0, hunger: 100, health: 40 });
  complete({ plan: normalizePlan({ tasks: [{ type: 'gather', resource: 'food', amount: 1 }], work: null }, captured),
    reviewContext: captured, tokens: 7 });
  await flush();
  assert.equal(sim.state.planner.completed, 1);
  assert.equal(sim.state.planner.discarded, 0);
  assert.equal(actor.tasks[0].resource, 'food');
  assert.equal(actor.replanReason, 'survival changed after review');
  assert.equal(sim.state.planner.totalTokens, 7);
});
test('adult and child hunger accumulate at the more forgiving rates', () => {
  const world = createWorld({ expanded: false }), [adult, child] = world.citizens;
  world.citizens = [adult, child]; world.nodes = [];
  Object.assign(adult, { hunger: 0, food: 0, bread: 0 });
  Object.assign(child, { adult: false, bornAt: 0, hunger: 0, food: 0, bread: 0, parents: [] });
  for (let i = 0; i < 100; i++) tickWorld(world);
  assert.equal(adult.hunger, 25);
  assert.ok(Math.abs(child.hunger - 15) < 1e-9);
  assert.equal(adult.health, 100);
  assert.equal(child.health, 100);
});
const plan = context => normalizePlan({ tasks: [{ type: 'wait', ticks: 120 }], work: { type: 'rest' }, reviewAfter: 600 }, context);
function simulation(planImpl) {
  let time = 0;
  const sim = createSimulation({ asynchronousWork: true, check: async () => {}, plan: planImpl }, { now: () => time });
  sim.state.world.citizens.splice(1);
  sim.state.world.nodes = [];
  return { sim, advance: seconds => { time += seconds * 1000; sim.advance(seconds); } };
}

test('selected 8x speed remains in effect during starvation and pause still stops time', async t => {
  const { sim, advance } = simulation(() => new Promise(() => {}));
  t.after(() => sim.close());
  const c = sim.state.world.citizens[0];
  Object.assign(c, { food: 0, bread: 0, hunger: 100, health: 100 });
  await sim.check(); sim.control('speed', 8); sim.control('play');
  advance(1);
  assert.equal(sim.state.world.tick, 8);
  assert.equal(sim.state.effectiveSpeed, 8);
  assert.equal(sim.state.speedLimitReason, null);
  assert.equal(c.health, 96);
  sim.control('pause'); advance(1);
  assert.equal(sim.state.world.tick, 8);
});

test('new empty-stock distress bypasses ordinary tick spacing and scales its cooldown with selected speed', async t => {
  let calls = 0;
  const { sim, advance } = simulation(async context => { calls++; return { plan: plan(context), tokens: 1 }; });
  t.after(() => sim.close());
  await sim.check(); sim.control('speed', 8); sim.control('play'); await flush();
  assert.equal(calls, 1);
  const c = sim.state.world.citizens[0];
  Object.assign(c, { food: 0, bread: 0, hunger: 80 });
  for (let i = 0; i < 5; i++) advance(1);
  await flush();
  assert.equal(calls, 2, 'dispatch before the former 15-second / 24-tick emergency gates');
  const requests = sim.state.planner.requests;
  sim.advance(0); await flush();
  assert.equal(sim.state.planner.requests, requests, 'unchanged distress does not flood requests');
});

test('a late survival change rejects a stale strategy while preserving queued work and token accounting', async t => {
  let complete, context;
  const { sim } = simulation(c => { context = c; return new Promise(resolve => { complete = resolve; }); });
  t.after(() => sim.close());
  await sim.check(); sim.control('play');
  sim.control('pause');
  const c = sim.state.world.citizens[0];
  Object.assign(c, { food: 0, hunger: 100, health: 40 });
  const tasks = structuredClone(c.tasks);
  complete({ plan: plan(context), reviewContext: context, tokens: 7 }); await flush();
  assert.equal(sim.state.planner.discarded, 1);
  assert.deepEqual(c.tasks, tasks);
  assert.equal(c.replanReason, 'survival changed after review');
  assert.equal(sim.state.planner.totalTokens, 7);
});

test('vital changes refresh a tool turn and reject an unseen health collapse before commitment', () => {
  const world = createWorld({ expanded: false }), c = world.citizens[0];
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: c.id });
  tools.refresh();
  c.hunger += 1;
  assert.equal(tools.pollUpdates(), null, 'ordinary hunger is not an interruption');
  Object.assign(c, { hunger: 90, food: 0, bread: 0 });
  const update = tools.pollUpdates();
  assert.match(update.changes.join(' '), /survival/);
  assert.equal(update.context.citizen.hunger, 90);
  assert.equal(tools.pollUpdates(), null);
  c.health = 40;
  const stale = tools.execute('continue_strategy', {});
  assert.equal(stale.ok, false);
  assert.equal(stale.context.citizen.health, 40);
  assert.equal(tools.execute('continue_strategy', {}).ok, true, 'explicit reconsideration can retain work');
});

test('dead targets produce actionable errors and a directory update without spending goods', () => {
  const world = createWorld({ expanded: false }), [c, peer] = world.citizens;
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: c.id }); tools.refresh();
  killCitizen(world, peer, null);
  assert.match(tools.pollUpdates().changes.join(' '), /no longer alive/);
  const stock = c.wood;
  for (const [name, args] of [
    ['send_private_message', { to: peer.id, text: 'Hello' }],
    ['send_private_message', { to: peer.name, text: 'Hello' }],
    ['open_offer', { give: 'wood', giveAmount: 1, want: 'food', wantAmount: 1, recipient: peer.id }],
    ['commit_strategy', { tasks: [{ type: 'give', target: peer.id, resource: 'wood', amount: 1 }] }],
  ]) {
    const result = tools.execute(name, args);
    assert.equal(result.ok, false);
    assert.match(result.error, /is dead/);
  }
  assert.equal(c.wood, stock);
  assert.equal(world.offers.length, 0);
});

test('a starving citizen executes chosen food collection in its area and finishes a harvest before eating', () => {
  const world = createWorld({ expanded: false }), c = world.citizens[0];
  world.citizens = [c]; world.blocked = [];
  Object.assign(c, { x: 7, y: 6, food: 0, bread: 0, hunger: 85, energy: 100, asyncReview: true });
  world.nodes = [
    { id: 'crop-near', kind: 'crop', x: 6, y: 6, stock: 1, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 0 },
    { id: 'crop-chosen', kind: 'crop', x: 10, y: 6, stock: 1, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 0 },
  ];
  c.knowledge.nodes = Object.fromEntries(world.nodes.map(n => [n.id, { ...n, source: 'seen', observedAt: 0 }]));
  applyPlan(world, c.id, normalizePlan({ tasks: [{ type: 'acquire', resource: 'food', quantity: 2, area: 'south-east' }], work: null }, planningContext(world, c.id)));
  tickWorld(world);
  assert.equal(c.order.task.area, 'south-east', 'need handling allows the food order to start');
  assert.equal(c.x, 8, 'follows chosen area instead of closer food in another area');
  for (let i = 0; i < 20 && c.hunger >= 60; i++) tickWorld(world);
  assert.ok(c.hunger < 60 && c.alive);
  assert.equal(world.nodes[0].stock, 1);
  assert.equal(c.resourceHistory['crop-chosen'].harvested, 1);
  assert.equal(c.order.task.area, 'south-east', 'meal does not discard the chosen strategy');
});

function emptyFoodCamp({ health = 10, alternative = 'seen' } = {}) {
  const world = createWorld({ expanded: false }), c = world.citizens[0];
  world.citizens = [c]; world.blocked = [];
  Object.assign(c, { x: 2, y: 4, food: 0, bread: 0, hunger: 100, health, energy: 100, asyncReview: true });
  world.nodes = [
    { id: 'crop-camp', kind: 'crop', x: 2, y: 4, stock: 0, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 99 },
    { id: 'crop-meal', kind: 'crop', x: alternative === 'seen' ? 2 : 7, y: 5, stock: 1, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 0 },
  ];
  c.knowledge = { nodes: {}, people: {}, explored: [] };
  // Only the actor's own records supply the fallback; remote live stock is not
  // observed just because a spectator fixture includes it.
  c.knowledge.nodes['crop-camp'] = { ...world.nodes[0], source: 'seen', observedAt: 0 };
  if (alternative !== 'unknown') c.knowledge.nodes['crop-meal'] = { ...world.nodes[1],
    source: alternative === 'reported' ? 'report' : 'seen', observedAt: alternative === 'stale' ? -13 : 0 };
  applyPlan(world, c.id, normalizePlan({ tasks: [{ type: 'gather', resource: 'food', amount: 4, target: 'crop-camp', camp: true, area: 'north-west' }],
    work: null }, planningContext(world, c.id)));
  return { world, c };
}

test('a fatal empty food camp yields temporarily to a known meal without replacing the strategy', () => {
  const { world, c } = emptyFoodCamp();
  for (let i = 0; i < 15 && c.hunger >= 100; i++) tickWorld(world);
  assert.ok(c.alive && c.hunger < 100);
  assert.equal(world.stats.harvestedFood, 1);
  assert.equal(c.resourceHistory['crop-meal'].harvested, 1);
  assert.equal(world.nodes[0].stock, 0);
  const retained = c.order?.task ?? c.tasks[0];
  assert.equal(retained.target, 'crop-camp');
  assert.equal(retained.area, 'north-west');
  assert.equal(c.order?.progress ?? 0, 0, 'temporary emergency food is not collection progress in the chosen area');
  assert.equal(c.strategyReplacements, 1);
  tickWorld(world);
  assert.equal(c.gatherTarget.nodeId, 'crop-camp', 'after eating, execution resumes the retained choice');
});

test('a food camp whose next known yield fits the survival window keeps its chosen area', () => {
  const { world, c } = emptyFoodCamp({ health: 100 });
  tickWorld(world);
  assert.equal(c.gatherTarget.nodeId, 'crop-camp');
  assert.equal(c.x, 2); assert.equal(c.y, 4);
  assert.equal(world.nodes[1].stock, 1);
});

test('emergency camp escape cannot use unseen live stock, stale reports or a meal too far away', () => {
  for (const alternative of ['unknown', 'reported', 'stale', 'seen']) {
    const { world, c } = emptyFoodCamp({ health: alternative === 'seen' ? 3 : 10, alternative });
    tickWorld(world);
    assert.equal(c.gatherTarget.nodeId, 'crop-camp', alternative);
    assert.equal(world.stats.harvestedFood, 0, alternative);
  }
});

test('an almost finished food harvest is retained when it can still feed the starving citizen', () => {
  const { world, c } = emptyFoodCamp({ health: 4 });
  world.nodes[0].stock = 1; world.nodes[0].regrowIn = 0;
  c.order = { task: c.tasks.shift(), startedAt: world.tick, progress: 0, work: false };
  c.gatherTarget = { resource: 'food', nodeId: 'crop-camp', visited: true };
  c.current = { task: { type: 'harvest', target: 'crop-camp' }, total: 7, remaining: 2, purpose: 'order' };
  for (let i = 0; i < 4 && c.hunger >= 100; i++) tickWorld(world);
  assert.ok(c.alive && c.hunger < 100);
  assert.equal(world.stats.harvestedFood, 1);
  assert.equal(c.order.progress, 1);
  assert.equal(world.nodes[1].stock, 1);
});
