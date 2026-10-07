import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../lib/simulation.mjs';
import { killCitizen } from '../lib/interactions.mjs';
import { applyPlan, tickWorld, createWorld, planningContext, transactCitizenAction } from '../lib/world.mjs';
import { PlanResponseError, PlannerError } from '../lib/planner.mjs';
import { normalizePlan } from '../lib/plans.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';
import { resolveBuilding } from '../lib/buildings.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function validPlan(ticks = 2, { reviewAfter = 180, tasks } = {}) {
  return {
    thought: 'Wait and observe.',
    goals: ['Stay well'],
    memory: 'No urgent change.',
    routine: { food: 4, wood: 3, family: false },
    reviewAfter,
    tasks: tasks ?? [{ type: 'wait', ticks }],
  };
}

function fakeClock(initial = 0) {
  let value = initial;
  return {
    now: () => value,
    set: (next) => { value = next; },
    advance: (milliseconds) => { value += milliseconds; },
  };
}

async function until(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

function mockClient(overrides = {}) {
  return {
    model: 'offline-test-model',
    endpoint: 'http://mock.invalid/v1',
    check: async () => {},
    plan: async () => ({ plan: validPlan(), tokens: 5 }),
    ...overrides,
  };
}

test('a real remote property attack prioritizes its owner ahead of fresh mail and carries the exact alert into review', async () => {
  const clock = fakeClock(100000), pending = deferred(), calls = [];
  const simulation = createSimulation(mockClient({ asynchronousWork: true, maxConcurrentTurns: 1, minStartIntervalMs: 0,
    plan: context => { calls.push(context); return pending.promise; } }), { now: clock.now, worldFactory: () => createWorld({ expanded: false }) });
  const world = simulation.state.world, [owner, attacker, recipient] = world.citizens;
  world.nodes = []; world.blocked = [];
  for (const c of world.citizens) {
    Object.assign(c, { hunger: 0, food: 20, energy: 100, wood: 100 });
    applyPlan(world, c.id, normalizePlan({ tasks: [], work: { type: 'rest' }, reviewAfter: 600 }, planningContext(world, c.id)));
  }
  Object.assign(owner, { x: 2, y: 2 }); Object.assign(attacker, { x: 3, y: 2 });
  assert.equal(resolveBuilding(world, owner, { type: 'build', building: 'bakery', x: 2, y: 2 }).ok, true);
  Object.assign(owner, { x: 12, y: 8 }); world.tick = 1;
  assert.equal(resolveBuilding(world, attacker, { type: 'attack', target: 'bakery-1' }).ok, true);
  assert.equal(transactCitizenAction(world, attacker.id, { type: 'message', target: recipient.id, text: 'Fresh ordinary mail.' }).ok, true);
  await simulation.check(); simulation.control('play');
  assert.equal(calls.length, 1); assert.equal(calls[0].citizen.id, owner.id);
  assert.equal(calls[0].incidents.at(-1).source, 'owner-alert'); assert.equal(calls[0].incidents.at(-1).attackerName, attacker.name);
  assert.ok(calls[0].knownBuildings.some(b => b.id === 'bakery-1' && b.health === 234));
  simulation.control('pause');
  pending.resolve({ plan: normalizePlan({ mode: 'continue' }, calls[0]), reviewContext: calls[0], tokens: 1 });
  await until(() => simulation.state.planner.completed === 1, 'the property review did not finish'); simulation.close();
});

function withClock(client, clock) {
  return createSimulation(client, { now: clock.now, worldFactory: () => createWorld({ expanded: false }) });
}

test('expected queued milestones continue without a model call until a real message requires a decision', async t => {
  const clock = fakeClock(), pending = deferred(), calls = [];
  const simulation = withClock(mockClient({ asynchronousWork: true, plan: context => { calls.push(context); return pending.promise; } }), clock);
  t.after(() => simulation.close());
  const world = simulation.state.world, [actor, peer] = world.citizens;
  world.citizens = [actor, peer];
  for (const c of world.citizens) Object.assign(c, { hunger: 0, food: 20, energy: 100 });
  actor.wood = 30;
  applyPlan(world, actor.id, normalizePlan({ tasks: [{ type: 'craft', item: 'tool' }, { type: 'craft', item: 'shoes' }],
    work: { type: 'gather', resource: 'wood' }, reviewAfter: 600 }, planningContext(world, actor.id)));
  applyPlan(world, peer.id, normalizePlan({ tasks: [], work: { type: 'rest' }, reviewAfter: 600 }, planningContext(world, peer.id)));
  await simulation.check(); simulation.control('play');
  for (let i = 0; i < 80; i++) { clock.advance(1000); simulation.advance(1); }
  assert.ok(actor.tool && actor.shoes, 'both expected milestones actually completed');
  assert.ok(actor.wood > 5, 'the chosen continuation is producing');
  assert.equal(calls.length, 0, 'the planned queue and useful repeating work did not request approval');
  peer.x = actor.x; peer.y = actor.y;
  assert.equal(transactCitizenAction(world, peer.id, { type: 'message', target: actor.id, text: 'I have new terms for you.' }, 'relevant-mail').ok, true);
  simulation.advance(0);
  assert.equal(calls.length, 1, 'new mail still dispatches a reasoning turn immediately');
  assert.equal(calls[0].citizen.id, actor.id);
  assert.equal(calls[0].inbox.at(-1).text, 'I have new terms for you.');
  simulation.control('pause');
  pending.resolve({ plan: normalizePlan({ mode: 'continue' }, calls[0]), reviewContext: calls[0], tokens: 5 });
  await until(() => simulation.state.planner.completed === 1, 'the message review did not finish');
});

test('the native default reduces redundant scheduled reviews while new mail still dispatches immediately', async t => {
  const clock = fakeClock(), pending = deferred(), calls = [];
  const simulation = withClock(mockClient({ asynchronousWork: true, plan: context => { calls.push(context); return pending.promise; } }), clock);
  t.after(() => simulation.close());
  const world = simulation.state.world, [actor, peer] = world.citizens;
  world.citizens = [actor, peer];
  for (const c of world.citizens) {
    c.food = 30; c.hunger = 0;
    const tools = createCitizenToolSession({ getWorld: () => world, citizenId: c.id, planId: `default-${c.id}` });
    tools.refresh();
    assert.equal(tools.execute('commit_strategy', { tasks: [], work: { type: 'gather', resource: 'wood' } }).ok, true);
    applyPlan(world, c.id, tools.committed.plan);
  }
  await simulation.check(); simulation.control('play');
  for (let i = 0; i < 310; i++) { clock.advance(1000); simulation.advance(1); }
  assert.equal(calls.length, 0, 'productive work passed the old 300-tick reflection boundary');
  assert.equal(actor.reviewAt, 600);
  assert.ok(world.stats.harvestedWood > 0, 'physical work actually continued');
  peer.x = actor.x; peer.y = actor.y;
  assert.equal(transactCitizenAction(world, peer.id, { type: 'message', target: actor.id, text: 'Would you supply wood for my bread?' }).ok, true);
  simulation.advance(0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].citizen.id, actor.id);
  simulation.control('pause');
  pending.resolve({ plan: normalizePlan({ mode: 'continue', reviewAfter: 600 }, calls[0]), reviewContext: calls[0], tokens: 5 });
  await until(() => simulation.state.planner.completed === 1, 'the immediate message review did not finish');
});

test('HTTP backoff and visible failures survive other citizens succeeding, then retain recovery history', async t => {
  const clock = fakeClock();
  let failFirst = true;
  const simulation = withClock(mockClient({ asynchronousWork: true, plan: async context => {
    if (context.citizen.id === 'citizen-1' && failFirst) {
      failFirst = false;
      throw Object.assign(new PlannerError('HTTP 429'), { httpStatus: 429, retryAfterMs: 120000 });
    }
    return { plan: validPlan(120), tokens: 3 };
  } }), clock);
  t.after(() => simulation.close());
  await simulation.check(); simulation.control('play');
  await until(() => simulation.state.planner.failed === 1, 'failure reported');
  assert.equal(simulation.state.planner.activeErrors[0].httpStatus, 429);
  assert.equal(simulation.state.planner.citizens[0].retryInMs, 120000);
  clock.advance(5000); simulation.advance(1);
  await until(() => simulation.state.planner.completed === 1, 'another citizen succeeds');
  assert.equal(simulation.state.planner.activeErrors.length, 1);
  assert.equal(simulation.state.planner.lastError, 'HTTP 429');
  simulation.state.world.citizens = simulation.state.world.citizens.slice(0, 1);
  clock.set(119999); simulation.advance(1);
  assert.equal(simulation.state.planner.requests, 2, 'Retry-After is honored');
  clock.set(120000); simulation.advance(1);
  await until(() => simulation.state.planner.completed === 2, 'affected citizen recovers');
  assert.equal(simulation.state.planner.activeErrors.length, 0);
  assert.equal(simulation.state.planner.errorHistory.length, 1);
  assert.equal(simulation.state.planner.errorHistory[0].resolvedAt, 120000);
  assert.equal(simulation.state.planner.lastError, null);
});

test('a retired model stops calls for every citizen while selected physical work and other in-flight success continue', async t => {
  const clock = fakeClock(), first = deferred(), second = deferred();
  let calls = 0;
  const simulation = withClock(mockClient({ asynchronousWork: true, maxConcurrentTurns: 2, minStartIntervalMs: 0,
    plan: () => ++calls === 1 ? first.promise : second.promise }), clock);
  t.after(() => simulation.close());
  const world = simulation.state.world, actor = world.citizens[0];
  actor.food = 30; actor.hunger = 0;
  applyPlan(world, actor.id, normalizePlan({ tasks: [{ type: 'craft', item: 'tool' }], work: { type: 'gather', resource: 'wood' } }, planningContext(world, actor.id)));
  actor.wood = 30; actor.reviewAt = 0;
  await simulation.check(); simulation.control('play');
  simulation.advance(0);
  assert.equal(calls, 2);
  const error = Object.assign(new PlannerError('Model retired; configure a supported model.'), { httpStatus: 410, retryable: false });
  first.reject(error);
  await until(() => simulation.state.planner.failed === 1, 'retirement was not reported');
  assert.equal(simulation.state.planner.connection, 'error');
  assert.equal(simulation.state.running, true, 'retirement must not suspend existing physical work');
  assert.equal(simulation.state.planner.activeErrors[0].retryAt, null);
  assert.equal(simulation.state.planner.activeErrors[0].retryable, false);
  second.resolve({ plan: validPlan(120), tokens: 3 });
  await until(() => simulation.state.planner.completed === 1, 'the already pending decision did not finish');
  assert.equal(simulation.state.planner.lastError, error.message, 'another citizen success cannot conceal model retirement');
  for (let i = 0; i < 70; i++) { clock.advance(1000); simulation.advance(1); }
  assert.equal(calls, 2, 'neither initial plans nor later retries send another request');
  assert.equal(actor.tool, true, 'the originally selected craft still completes');
});

test('stock targets trigger a bounded progress review after 120 ticks without a new peak', async t => {
  const clock = fakeClock(20000);
  const simulation = withClock(mockClient({ asynchronousWork: true }), clock);
  t.after(() => simulation.close());
  const world = simulation.state.world, citizen = world.citizens[0];
  world.citizens = [citizen];
  Object.assign(citizen, { planCount: 1, reviewAt: 600, lastPlanTick: 0, replanReason: null, hunger: 0, food: 20,
    order: { task: { type: 'acquire', resource: 'food', quantity: 25 }, startedAt: 0, lastInventoryIncreaseAt: 0 } });
  world.tick = 119;
  assert.equal(simulation.state.planner.citizens[0].eligible, false);
  world.tick = 120;
  assert.equal(simulation.state.planner.citizens[0].reason, 'inventory progress stalled');
  assert.equal(simulation.state.planner.citizens[0].eligible, true);
  await simulation.check(); simulation.control('play');
  await until(() => simulation.state.planner.completed === 1, 'stalled citizen reviewed');
  citizen.order = { task: { type: 'acquire', resource: 'food', quantity: 25 }, startedAt: 0, lastInventoryIncreaseAt: 0 };
  citizen.replanReason = null; citizen.reviewAt = 600;
  clock.advance(60000); world.tick = 239;
  assert.equal(simulation.state.planner.citizens[0].eligible, false, 'same stalled target cannot demand a turn every tick');
  world.tick = 240;
  assert.equal(simulation.state.planner.citizens[0].reason, 'inventory progress stalled');
});

test('hungry food collection without progress requests an early bounded review and preserves the chosen work', async t => {
  const clock = fakeClock(20000);
  const simulation = withClock(mockClient({ asynchronousWork: true, plan: async () => ({
    plan: normalizePlan({ mode: 'continue', goals: ['Get fed'], tasks: [], reviewAfter: 600 }), tokens: 1,
  }) }), clock);
  t.after(() => simulation.close());
  const world = simulation.state.world, actor = world.citizens[0], crop = world.nodes.find(n => n.kind === 'crop');
  world.citizens = [actor];
  actor.food = 0; actor.bread = 0; actor.hunger = 32.5;
  for (const node of world.nodes.filter(n => n.kind === 'crop')) { node.stock = 0; node.regrowIn = 2000; }
  actor.knowledge.nodes[crop.id] = { ...crop, observedAt: 0, source: 'seen' };
  applyPlan(world, actor.id, normalizePlan({ goals: ['Collect food'], tasks: [{ type: 'gather', resource: 'food', amount: 8,
    target: crop.id, camp: true, maxTicks: 400 }], work: null, reviewAfter: 600 }));
  tickWorld(world);
  while (world.tick - actor.order.startedAt < 119) tickWorld(world);
  assert.ok(actor.hunger >= 60 && actor.hunger < 75, 'this is before the existing hunger-distress threshold');
  assert.equal(simulation.state.planner.citizens[0].eligible, false);
  tickWorld(world);
  const ready = simulation.state.planner.citizens[0];
  assert.equal(ready.reason, 'food collection stalled');
  assert.equal(ready.priority, 'distress');
  assert.equal(ready.eligible, true);
  await simulation.check(); simulation.control('play');
  await until(() => simulation.state.planner.completed === 1, 'stalled food reviewed');
  assert.equal(actor.order.task.target, crop.id, 'review itself never cancels or reroutes the chosen camp');
  assert.equal(actor.order.progress, 0);
  crop.stock = 1;
  for (let i = 0; i < 30 && actor.order.progress === 0; i++) tickWorld(world);
  assert.equal(actor.order.progress, 1, 'a real harvest made progress');
  const lastProgress = actor.order.lastProgressAt;
  actor.food = 0; actor.bread = 0; actor.hunger = 65; actor.replanReason = null;
  clock.advance(60000); world.tick = lastProgress + 119;
  assert.equal(simulation.state.planner.citizens[0].eligible, false, 'actual harvesting restarts the bounded stall clock');
  world.tick++;
  assert.equal(simulation.state.planner.citizens[0].reason, 'food collection stalled');
});

test('asynchronous harness allows two fair turns, retains work and respects pause/reset', async t => {
  const clock = fakeClock(), pending = [];
  const simulation = withClock(mockClient({ asynchronousWork: true, plan: async () => {
    const decision = deferred(); pending.push(decision); return decision.promise;
  } }), clock);
  t.after(() => simulation.close());
  await simulation.check();
  simulation.control('play');
  await until(() => pending.length === 1, 'first citizen starts');
  clock.advance(5000); simulation.advance(1);
  await until(() => pending.length === 2, 'second citizen starts while first reasons');
  assert.deepEqual(simulation.state.planner.activeCitizenIds, ['citizen-1', 'citizen-2']);
  clock.advance(5000); simulation.advance(1);
  assert.equal(pending.length, 2, 'bounded to two concurrent turns');
  simulation.control('pause');
  pending[0].resolve({ plan: validPlan(10), tokens: 3 });
  await until(() => simulation.state.planner.completed === 1, 'paused in-flight turn finishes');
  assert.equal(pending.length, 2, 'pause prevents dispatch');
  simulation.control('reset');
  pending[1].resolve({ plan: validPlan(10), tokens: 3 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(simulation.state.world.citizens[1].planCount, 0, 'old response cannot affect reset world');
  assert.deepEqual(simulation.state.planner.activeCitizenIds, []);
});

test('native concurrency and start spacing are configurable without bypassing pause', async t => {
  const clock = fakeClock();
  const simulation = withClock(mockClient({ asynchronousWork: true, maxConcurrentTurns: 4, minStartIntervalMs: 1000,
    plan: () => new Promise(() => {}) }), clock);
  t.after(() => simulation.close());
  await simulation.check(); simulation.control('play');
  clock.set(999); simulation.advance(0);
  assert.equal(simulation.state.planner.activeCitizenIds.length, 1);
  for (let i = 1; i <= 4; i++) { clock.set(i * 1000); simulation.advance(0); }
  assert.equal(simulation.state.planner.activeCitizenIds.length, 4);
  simulation.control('pause');
  clock.set(20000); simulation.advance(0);
  assert.equal(simulation.state.planner.requests, 4);
});

test('8x native reviews scale wall-clock floors while retaining tick and backoff gates', async t => {
  const clock = fakeClock();
  const simulation = withClock(mockClient({ asynchronousWork: true }), clock);
  t.after(() => simulation.close());
  await simulation.check(); simulation.control('play');
  await until(() => simulation.state.planner.completed === 1, 'initial plan');
  simulation.control('pause'); simulation.control('speed', 8);
  const citizen = simulation.state.world.citizens[0];
  Object.assign(citizen, { replanReason: null, work: { type: 'gather', resource: 'wood' }, reviewAt: 180, lastPlanTick: 0 });
  clock.set(22500); simulation.state.world.tick = 179;
  assert.equal(simulation.state.planner.citizens[0].eligible, false);
  simulation.state.world.tick = 180;
  assert.equal(simulation.state.planner.citizens[0].eligible, true, 'does not wait 60 real seconds at 8x');
  assert.equal(simulation.state.planner.minCitizenIntervalSeconds, 7.5);
  assert.equal(simulation.state.planner.eventReviewIntervalSeconds, 5);
});

test('a transient semantic provider failure backs off its citizen without pausing the world', async t => {
  const clock = fakeClock();
  let calls = 0;
  const simulation = withClock(mockClient({ asynchronousWork: true, plan: async () => {
    calls++; throw new PlannerError('Request timed out.');
  } }), clock);
  t.after(() => simulation.close());
  await simulation.check(); simulation.control('play');
  await until(() => simulation.state.planner.failed === 1, 'failed turn handled');
  assert.equal(simulation.state.running, true);
  assert.equal(simulation.state.planner.connection, 'ready');
  assert.equal(calls, 1);
  clock.advance(5000); simulation.advance(1);
  await until(() => calls === 2, 'another citizen can reason');
  assert.equal(simulation.state.world.citizens[0].reviewCalls, 1, 'failure does not retry immediately');
});

test('per-run tool metrics reset with the world without rewriting provider totals', t => {
  const metrics = { modelCalls: 5, toolCalls: 7, toolErrors: 1, requestParts: { tools: 50, observation: 30 } };
  const simulation = createSimulation(mockClient({ asynchronousWork: true, metrics }));
  t.after(() => simulation.close());
  assert.equal(simulation.state.planner.toolHarness.modelCalls, 0);
  metrics.modelCalls += 2;
  metrics.requestParts.tools += 20;
  metrics.requestParts.observation += 10;
  assert.equal(simulation.state.planner.toolHarness.modelCalls, 2);
  assert.deepEqual(simulation.state.planner.toolHarness.requestParts, { tools: 20, observation: 10 });
  simulation.control('reset');
  assert.equal(simulation.state.planner.toolHarness.modelCalls, 0);
  assert.equal(metrics.modelCalls, 7);
  assert.deepEqual(simulation.state.planner.toolHarness.requestParts, { tools: 0, observation: 0 });
  assert.deepEqual(metrics.requestParts, { tools: 70, observation: 40 });
});

test('distress gets priority and unchanged low health does not repeatedly review an active directive', async t => {
  const clock = fakeClock(), seen = [];
  const simulation = withClock(mockClient({ asynchronousWork: true, plan: async context => {
    seen.push(context.citizen.id);
    return { plan: normalizePlan({ tasks: [{ type: 'wait', ticks: 120 }], work: { type: 'rest' }, reviewAfter: 600 }, context), tokens: 1 };
  } }), clock);
  t.after(() => simulation.close());
  const citizens = simulation.state.world.citizens;
  citizens[3].health = 10;
  await simulation.check(); simulation.control('play');
  await until(() => simulation.state.planner.completed === 1, 'distressed turn completes');
  assert.equal(seen[0], 'citizen-4');
  for (const citizen of citizens.slice(0, 3)) {
    citizen.planCount = 1; citizen.reviewAt = 600; citizen.replanReason = null; citizen.work = { type: 'rest' };
  }
  clock.advance(30000); simulation.advance(1);
  assert.equal(seen.length, 1, 'same low health is not a new decision event');
  citizens[3].health = 1;
  clock.advance(15000); simulation.advance(1);
  assert.equal(seen.length, 1, 'small health change remains bounded');
});

test('a continuation cannot release a failed sequence it never observed', async t => {
  const pending = deferred();
  let captured;
  const simulation = withClock(mockClient({ plan: context => { captured = context; return pending.promise; } }), fakeClock());
  t.after(() => simulation.close());
  const world = simulation.state.world, [actor, peer] = world.citizens;
  Object.assign(actor, { food: 10, hunger: 0, energy: 100 });
  Object.assign(peer, { x: 2, y: 3 });
  applyPlan(world, actor.id, validPlan(2, { tasks: [
    { type: 'give', target: peer.id, resource: 'wood', amount: 100 }, { type: 'move', x: 4, y: 2 },
  ] }));
  actor.planCount = 0;
  await simulation.check(); simulation.control('play');
  await until(() => Boolean(captured), 'request was not started');
  simulation.control('pause');
  for (let i = 0; i < 5; i++) tickWorld(world);
  assert.ok(actor.planBlocked);
  pending.resolve({ plan: normalizePlan({ mode: 'continue' }, captured), tokens: 7 });
  await until(() => simulation.state.planner.discarded === 1, 'unseen failure did not discard continuation');
  assert.ok(actor.planBlocked);
  assert.equal(actor.tasks[0].type, 'move');
  assert.equal(simulation.state.planner.totalTokens, 7);
});

test('the application gate preserves execution if a consequential action finishes after the reviewed context', async t => {
  const pending = deferred();
  let captured;
  const simulation = withClock(mockClient({ asynchronousWork: true, plan: context => { captured = context; return pending.promise; } }), fakeClock());
  t.after(() => simulation.close());
  const world = simulation.state.world, [actor, peer] = world.citizens;
  Object.assign(actor, { food: 20, hunger: 0, energy: 100 });
  Object.assign(peer, { x: actor.x, y: actor.y + 1 });
  applyPlan(world, actor.id, validPlan(2, { tasks: [
    { type: 'give', target: peer.id, resource: 'food', amount: 2 }, { type: 'wait', ticks: 100 },
  ] }));
  actor.planCount = 0;
  await simulation.check(); simulation.control('play');
  await until(() => !!captured, 'request was not started');
  simulation.control('pause');
  for (let i = 0; i < 5; i++) tickWorld(world);
  assert.equal(world.stats.transfers, 1);
  const remainder = structuredClone(actor.order);
  pending.resolve({ plan: normalizePlan({ tasks: [{ type: 'give', target: peer.id, resource: 'food', amount: 2 }], work: null }, captured), reviewContext: captured, tokens: 7 });
  await until(() => simulation.state.planner.discarded === 1, 'stale replacement was not discarded');
  assert.deepEqual(actor.order, remainder);
  assert.equal(actor.replanReason, 'completed action requires review');
  assert.equal(simulation.state.planner.totalTokens, 7);
  assert.equal(world.stats.transfers, 1);
});

test('finished work gets a bounded early review and the inspector exposes why it waits', async t => {
  const clock = fakeClock(), calls = [];
  const simulation = withClock(mockClient({ plan: async context => {
    calls.push(context);
    return { plan: validPlan(), tokens: 0 };
  } }), clock);
  t.after(() => simulation.close());
  simulation.state.world.citizens.splice(1);
  await simulation.check(); simulation.control('play');
  await until(() => simulation.state.planner.completed === 1, 'initial plan');
  for (let i = 0; i < 24; i++) simulation.advance(1);
  clock.set(14999); simulation.advance(0);
  assert.equal(calls.length, 1);
  const waiting = simulation.state.planner.citizens[0];
  assert.equal(waiting.reason, 'strategy complete');
  assert.equal(waiting.waitMs, 1);
  clock.set(15000); simulation.advance(0);
  await until(() => calls.length === 2, 'completion review at 15 seconds');
  assert.equal(simulation.state.planner.citizens[0].calls, 2);
});

test('two priority mail reviews cannot starve an eligible ordinary citizen', async t => {
  const clock = fakeClock(), calls = [];
  const simulation = withClock(mockClient({ plan: async context => {
    calls.push(context.citizen.id);
    return { plan: { ...validPlan(), routine: { family: false }, tasks: [], work: { type: 'rest' }, reviewAfter: 600 }, tokens: 0 };
  } }), clock);
  t.after(() => simulation.close());
  const world = simulation.state.world;
  world.citizens.splice(3); world.tick = 200;
  const [a,b,c] = world.citizens;
  for (const citizen of world.citizens) Object.assign(citizen, { planCount: 1, lastPlanTick: 0, reviewAt: 180, replanReason: null, work: { type: 'rest' } });
  a.pendingMessageId = 'mail-a'; b.pendingMessageId = 'mail-b';
  await simulation.check(); simulation.control('play');
  await until(() => simulation.state.planner.completed === 1, 'first urgent');
  clock.set(5000); simulation.advance(0);
  await until(() => simulation.state.planner.completed === 2, 'second urgent');
  a.pendingMessageId = 'mail-a-new';
  clock.set(10000); simulation.advance(0);
  await until(() => calls.length === 3, 'ordinary turn');
  assert.deepEqual(calls, [a.id, b.id, c.id]);
});

test('switching priority classes cannot repeatedly skip a quiet eligible citizen', async t => {
  const clock = fakeClock(), calls = [];
  const simulation = withClock(mockClient({ plan: async context => {
    calls.push(context.citizen.id);
    return { plan: { ...validPlan(), tasks: [], work: { type: 'rest' }, reviewAfter: 600 }, tokens: 0 };
  } }), clock);
  t.after(() => simulation.close());
  const people = simulation.state.world.citizens;
  simulation.state.world.tick = 200;
  for (const c of people) Object.assign(c, { planCount: 1, lastPlanTick: 0, reviewAt: 180, replanReason: null, work: { type: 'rest' } });
  people[0].pendingMessageId = 'mail-a'; people[2].pendingMessageId = 'mail-c';
  await simulation.check(); simulation.control('play');
  await until(() => calls.length === 1, 'first mail');
  clock.set(5000); simulation.advance(0);
  await until(() => calls.length === 2, 'second mail');
  people[0].pendingMessageId = 'mail-a-again';
  clock.set(10000); simulation.advance(0);
  await until(() => calls.length === 3, 'ordinary turn');
  assert.deepEqual(calls, [people[0].id, people[2].id, people[1].id], 'mail rotation must not move ordinary rotation past citizen 2');
});

test('queue age accrues behind occupied slots and outranks fresh mail after 30 seconds', async t => {
  const clock = fakeClock(), pending = [], calls = [];
  const simulation = withClock(mockClient({ asynchronousWork: true, plan: async context => {
    calls.push(context.citizen.id); const turn = deferred(); pending.push(turn); return turn.promise;
  } }), clock);
  t.after(() => simulation.close());
  const people = simulation.state.world.citizens;
  simulation.state.world.tick = 200;
  for (const c of people) Object.assign(c, { planCount: 1, lastPlanTick: 0, reviewAt: 180, replanReason: null, work: { type: 'rest' } });
  people[2].reviewAt = 1000; people[3].reviewAt = 1000;
  await simulation.check(); simulation.control('play');
  clock.set(5000); people[2].pendingMessageId = 'mail-c'; simulation.advance(0);
  assert.equal(calls.length, 2);
  clock.set(35000); people[3].pendingMessageId = 'new-mail'; simulation.advance(0);
  assert.equal(simulation.state.planner.citizens[1].queueWaitMs, 35000);
  pending[0].resolve({ plan: { ...validPlan(), tasks: [], work: { type: 'rest' } }, tokens: 0 });
  await until(() => calls.length === 3, 'released slot serves oldest waiting citizen');
  assert.equal(calls[2], people[1].id);
  assert.equal(simulation.state.planner.citizens[1].queueWaitMs, 0, 'active turn is no longer queued');
  simulation.control('pause');
  assert.equal(simulation.state.planner.citizens[3].queueWaitMs, 0, 'paused time does not accumulate as queue delay');
});

test('a rejected response reaches the next context without immediate repair calls', async t => {
  const clock = fakeClock(), contexts = [];
  const simulation = withClock(mockClient({ plan: async context => {
    contexts.push(context);
    if (contexts.length === 1) throw new PlanResponseError('task amount is required');
    return { plan: validPlan(), tokens: 0 };
  } }), clock);
  t.after(() => simulation.close()); simulation.state.world.citizens.splice(1);
  await simulation.check(); simulation.control('play');
  await until(() => simulation.state.planner.failed === 1, 'rejection');
  clock.set(15000); simulation.advance(0);
  assert.equal(contexts.length, 1);
  clock.set(60000); simulation.advance(0);
  await until(() => contexts.length === 2, 'retry');
  assert.equal(contexts[1].citizen.lastPlanError, 'task amount is required');
});

test('a paused simulation stops ticking and dispatch while its in-flight plan can finish', async () => {
  const pending = deferred();
  const calls = [];
  const clock = fakeClock();
  const simulation = withClock(mockClient({
    plan: (context, signal) => {
      calls.push({ citizenId: context.citizen.id, signal });
      return pending.promise;
    },
  }), clock);
  try {
    await simulation.check();
    simulation.control('play');
    assert.deepEqual(calls.map((call) => call.citizenId), ['citizen-1']);
    assert.equal(simulation.state.planner.activeCitizenId, 'citizen-1');

    simulation.control('pause');
    simulation.advance(8);
    assert.equal(simulation.state.running, false);
    assert.equal(simulation.state.world.tick, 0);

    pending.resolve({ plan: validPlan(), tokens: 23 });
    await until(() => simulation.state.planner.completed === 1, 'the in-flight plan did not finish');
    const citizen = simulation.state.world.citizens[0];
    assert.equal(citizen.status, 'acting');
    assert.deepEqual(citizen.tasks, [{ type: 'wait', ticks: 2 }]);
    assert.equal(citizen.planCount, 1);
    assert.equal(simulation.state.planner.totalTokens, 23);
    assert.equal(simulation.state.planner.activeCitizenId, null);
    assert.equal(calls.length, 1, 'pausing prevents dispatching another citizen');
    simulation.advance(3);
    assert.equal(simulation.state.world.tick, 0);
  } finally {
    simulation.close();
  }
});

for (const readyAt of [0, 5000]) {
  test(`mail arriving during planning discards stale work and respects global spacing (clock ${readyAt})`, async (t) => {
    const calls = [], clock = fakeClock();
    const simulation = withClock(mockClient({ plan: context => {
      const request = deferred(); calls.push({ context, request }); return request.promise;
    } }), clock);
    t.after(() => simulation.close());
    await simulation.check();
    const world = simulation.state.world;
    const [mira, sender] = world.citizens;
    applyPlan(world, sender.id, validPlan(2, { tasks: [{ type: 'message', target: mira.id, text: 'Please meet me by the crops.' }] }));
    simulation.control('play');
    for (let i = 0; i < 10 && !world.messages.length; i++) tickWorld(world);
    const message = world.messages.at(-1);
    assert.ok(message);
    assert.equal(mira.pendingMessageId, message.id);
    world.citizens.splice(1);
    clock.set(5000); simulation.advance(0);
    assert.equal(calls.length, 1, 'a request remains single-flight');
    simulation.control('pause');
    calls[0].request.resolve({ plan: validPlan(120), tokens: 7 });
    await until(() => simulation.state.planner.discarded === 1, 'stale response was not discarded');
    assert.equal(mira.planCount, 0, 'stale tasks were never installed');
    assert.equal(simulation.state.planner.totalTokens, 7, 'paid stale response remains accounted for');
    assert.equal(calls.length, 1, 'paused state never dispatches');
    clock.set(readyAt); simulation.control('play');
    if (readyAt === 0) {
      clock.set(4999); simulation.advance(0);
      assert.equal(calls.length, 1, 'global five-second spacing remains');
      clock.set(5000); simulation.advance(0);
    }
    assert.equal(calls.length, 2);
    assert.ok(world.tick < 180, 'mail does not wait for the tick cooldown');
    assert.deepEqual(calls[1].context.inbox, [message]);
    simulation.control('pause');
    calls[1].request.resolve({ plan: validPlan(), tokens: 3 });
    await until(() => simulation.state.planner.completed === 1, 'fresh response was not applied');
    assert.equal(mira.pendingMessageId, undefined);
    assert.equal(mira.replanReason, null);
    assert.equal(simulation.state.planner.totalTokens, 10);
  });
}

test('private mail interrupts an existing strategy, takes review priority, and still permits eating', async (t) => {
  const calls = [], clock = fakeClock(), review = deferred();
  const simulation = withClock(mockClient({ plan: context => {
    calls.push(context);
    return calls.length === 1 ? Promise.resolve({ plan: validPlan(120, { tasks: [{ type: 'wait', ticks: 120 }, { type: 'craft', item: 'tool' }] }), tokens: 1 }) : review.promise;
  } }), clock);
  t.after(() => simulation.close());
  await simulation.check(); simulation.control('play');
  await until(() => simulation.state.planner.completed === 1, 'initial strategy did not apply');
  const world = simulation.state.world, [mira, sender] = world.citizens;
  applyPlan(world, sender.id, validPlan(2, { tasks: [{ type: 'message', target: mira.id, text: 'Meet me here.', location: true }] }));
  for (let i = 0; i < 10 && !world.messages.length; i++) simulation.advance(1);
  assert.equal(mira.lastPlanTick, 0);
  assert.ok(mira.pendingMessageId);
  const progress = mira.order.progress;
  mira.hunger = 65;
  const food = mira.food;
  simulation.advance(1);
  assert.equal(mira.food, food - 1, 'eating is not blocked by message review');
  for (let i = 0; i < 5; i++) simulation.advance(1);
  assert.equal(mira.order.progress, progress, 'old discretionary work stays interrupted');
  assert.equal(world.stats.crafted, 0);
  clock.set(5000); simulation.advance(0);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].citizen.id, mira.id, 'mail outranks unrelated initial reviews');
  assert.ok(world.tick < 180);
  assert.equal(calls[1].inbox.at(-1).text, 'Meet me here.');
  simulation.control('pause');
  review.resolve({ plan: validPlan(2), tokens: 2 });
  await until(() => simulation.state.planner.completed === 2, 'mail-aware decision did not apply');
  assert.equal(mira.pendingMessageId, undefined);
  assert.equal(mira.tasks.some(task => task.type === 'craft'), false);
});

test('messages queued before dispatch are batched into one decision with the latest inbox', async (t) => {
  const contexts = [], clock = fakeClock();
  const simulation = withClock(mockClient({ plan: async context => { contexts.push(context); return { plan: validPlan(120), tokens: 2 }; } }), clock);
  t.after(() => simulation.close());
  await simulation.check();
  const world = simulation.state.world, [mira, sender] = world.citizens;
  applyPlan(world, mira.id, validPlan(120));
  applyPlan(world, sender.id, validPlan(2, { tasks: [
    { type: 'message', target: mira.id, text: 'First note.' },
    { type: 'message', target: mira.id, text: 'Updated location.', location: true },
  ] }));
  for (let i = 0; i < 10 && world.messages.length < 2; i++) tickWorld(world);
  assert.equal(world.messages.length, 2);
  world.citizens.splice(1);
  simulation.control('play');
  await until(() => simulation.state.planner.completed === 1, 'batch decision did not apply');
  assert.deepEqual(contexts[0].inbox.map(message => message.text), ['First note.', 'Updated location.']);
  assert.equal(mira.pendingMessageId, undefined);
  clock.set(5000); simulation.advance(0);
  assert.equal(contexts.length, 1, 'the same inbox never schedules duplicate urgent reviews');
});

test('a rejected mail review is not retried immediately for the same message', async (t) => {
  let calls = 0;
  const clock = fakeClock();
  const simulation = withClock(mockClient({ plan: async () => { calls++; throw new PlanResponseError('Invalid strategy'); } }), clock);
  t.after(() => simulation.close());
  await simulation.check();
  const world = simulation.state.world, [mira, sender] = world.citizens;
  applyPlan(world, mira.id, validPlan(120));
  applyPlan(world, sender.id, validPlan(2, { tasks: [{ type: 'message', target: mira.id, text: 'Hello.' }] }));
  for (let i = 0; i < 10 && !world.messages.length; i++) tickWorld(world);
  world.citizens.splice(1);
  simulation.control('play');
  await until(() => simulation.state.planner.failed === 1, 'mail review did not run');
  clock.set(5000); simulation.advance(0);
  assert.equal(calls, 1, 'schema failure is not an immediate repair loop');
  assert.equal(mira.pendingMessageId, undefined, 'a rejected reply releases the old message hold');
  const progress = mira.order?.progress ?? 0;
  tickWorld(world);
  assert.ok(mira.order.progress > progress, 'retained physical work resumes during rejection backoff');
});

for (const blockedBy of ['real-time cooldown', 'tick cooldown']) {
  test(`incidents from really executed local attacks survive an in-flight plan and obey the ${blockedBy}`, async () => {
    const calls = [];
    const clock = fakeClock();
    const simulation = withClock(mockClient({
      plan: (context) => {
        const request = deferred();
        calls.push({ context, request });
        return request.promise;
      },
    }), clock);
    try {
      await simulation.check();
      const world = simulation.state.world;
      const [mira, oren, lio, sela] = world.citizens;
      assert.equal(mira.name, 'Mira');
      assert.deepEqual(mira.incidents, []);
      simulation.control('play');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].context.citizen.id, mira.id);
      assert.deepEqual(calls[0].context.incidents, []);

      // Real physical strikes through the executor: no incident is ever pushed manually here.
      // The adjacent Oren executes an attack order against Mira while her request is in flight.
      oren.x = 3;
      oren.y = 2;
      applyPlan(world, oren.id, validPlan(2, { tasks: [{ type: 'attack', target: mira.id }] }));
      for (let tick = 0; tick < 6 && mira.incidents.length === 0; tick += 1) tickWorld(world);
      const citizenIncident = mira.incidents.at(-1);
      assert.ok(citizenIncident, 'the executed strike generated Mira’s incident at the world layer');
      assert.deepEqual(citizenIncident, { tick: world.tick, attackerId: oren.id, targetId: mira.id, kind: 'citizen', x: mira.x, y: mira.y });
      assert.ok(mira.health < 100 && world.stats.attacks > 0, 'the strike really landed on the victim');
      assert.deepEqual(oren.incidents.at(-1), citizenIncident, 'each witness independently records its own strike observation');
      assert.notEqual(oren.incidents.at(-1), citizenIncident, 'incident records are private per witness, never shared telepathy');
      oren.wood = 50;
      applyPlan(world, oren.id, validPlan(2, { tasks: [{ type: 'build', building: 'bakery', x: 4, y: 2 }] }));
      for (let tick = 0; tick < 32 && !world.buildings.some((building) => building.id === 'bakery-1'); tick += 1) tickWorld(world);
      assert.ok(world.buildings.some((building) => building.id === 'bakery-1' && building.ownerId === oren.id), 'the real build order completed the bakery');
      applyPlan(world, oren.id, validPlan(2, { tasks: [{ type: 'attack', target: 'bakery-1' }] }));
      for (let tick = 0; tick < 8 && mira.incidents.length === 1; tick += 1) tickWorld(world);
      const buildingIncident = mira.incidents.at(-1);
      assert.ok(buildingIncident, 'the executed bakery strike generated Mira’s incident at the world layer');
      assert.deepEqual(buildingIncident, { tick: world.tick, attackerId: oren.id, attackerName: oren.name, source: 'seen', targetId: 'bakery-1', kind: 'building', x: 4, y: 2 });
      assert.equal(mira.replanReason, 'witnessed violence');
      assert.deepEqual(mira.incidents, [citizenIncident, buildingIncident]);
      assert.deepEqual(oren.incidents, [citizenIncident, buildingIncident]);
      assert.deepEqual(lio.incidents, [], 'distant citizens learn nothing without a sighting, never telepathy');
      assert.deepEqual(sela.incidents, []);
      world.citizens.splice(1);
      clock.set(5_000);
      simulation.advance(0);
      assert.equal(calls.length, 1, 'pending plans remain single-flight');
      simulation.control('pause');
      calls[0].request.resolve({ plan: validPlan(120, { reviewAfter: 600 }), tokens: 7 });
      await until(() => simulation.state.planner.completed === 1, 'the incident-stale plan did not finish');
      assert.equal(mira.replanReason, 'witnessed violence', 'applying a stale-context plan must preserve newly witnessed violence');
      assert.equal(calls.length, 1);
      const appliedAt = mira.lastPlanTick;
      simulation.control('play');
      assert.equal(calls.length, 1, 'resuming cannot bypass cooldowns');
      clock.set(blockedBy === 'tick cooldown' ? 15_000 : 14_999);
      const elapsedTicks = blockedBy === 'tick cooldown' ? 23 : 24;
      for (let tick = 0; tick < elapsedTicks; tick += 1) simulation.advance(1);
      assert.equal(world.tick, appliedAt + elapsedTicks);
      assert.equal(calls.length, 1, 'the incident cannot bypass either cooldown');
      if (blockedBy === 'tick cooldown') simulation.advance(1);
      else { clock.set(15_000); simulation.advance(0); }
      assert.equal(calls.length, 2, 'violence triggers the next eligible review');
      assert.ok(world.tick < mira.reviewAt);
      assert.deepEqual(calls[0].context.incidents, [], 'the request-time context stays unchanged');
      assert.deepEqual(calls[1].context.incidents, [citizenIncident, buildingIncident], 'the next context contains only this citizen’s witnessed incidents');
      simulation.control('pause');
      calls[1].request.resolve({ plan: validPlan(), tokens: 3 });
      await until(() => simulation.state.planner.completed === 2, 'the incident-aware plan did not finish');
      assert.equal(mira.replanReason, null, 'an already captured incident does not retrigger review');
    } finally {
      simulation.close();
    }
  });
}

for (const [messageTick, incidentTick] of [[2, 1], [1, 2], [2, 2]]) {
  test(`in-flight mail at ${messageTick} discards stale work without dropping violence at ${incidentTick}`, async () => {
    const pending = deferred();
    let calls = 0;
    const simulation = withClock(mockClient({ plan: () => { calls += 1; return pending.promise; } }), fakeClock());
    try {
      await simulation.check();
      const world = simulation.state.world;
      const citizen = world.citizens[0];
      citizen.incidents = [{ tick: 0, attackerId: 'old', targetId: citizen.id, kind: 'attack', x: 2, y: 2 }];
      simulation.control('play');
      world.messages.push({ id: 'message-inflight', tick: messageTick, senderId: 'citizen-2', recipientId: citizen.id, text: 'Help.' });
      citizen.incidents.push({ tick: incidentTick, attackerId: 'citizen-2', targetId: 'citizen-3', kind: 'attack', x: 2, y: 2 });
      pending.resolve({ plan: validPlan(), tokens: 1 });
      await until(() => simulation.state.planner.discarded === 1, 'the stale plan was not discarded');
      assert.equal(citizen.pendingMessageId, 'message-inflight');
      assert.equal(citizen.lastPlanTick, null, 'stale work never changes the applied strategy');
      assert.equal(citizen.incidents.at(-1).tick, incidentTick);
      assert.equal(calls, 1, 'global call spacing remains');
    } finally {
      simulation.close();
    }
  });
}

test('captured incidents and new incidents belonging only to others do not preserve a trigger', async () => {
  const pending = deferred();
  const simulation = withClock(mockClient({ plan: () => pending.promise }), fakeClock());
  try {
    await simulation.check();
    const [citizen, other] = simulation.state.world.citizens;
    const incident = { tick: 0, attackerId: other.id, targetId: citizen.id, kind: 'attack', x: 2, y: 2 };
    citizen.incidents = [incident];
    citizen.replanReason = 'witnessed violence';
    simulation.control('play');
    citizen.incidents = [structuredClone(incident)];
    other.incidents = [{ ...incident, tick: 1, targetId: other.id }];
    pending.resolve({ plan: validPlan(), tokens: 1 });
    await until(() => simulation.state.planner.completed === 1, 'the incident-aware plan did not finish');
    assert.equal(citizen.replanReason, null, 'compare stable incident fields, not array identity or other citizens’ knowledge');
  } finally {
    simulation.close();
  }
});

test('reset discards a late planning response, aborts it, and preserves the client budget snapshot', async () => {
  const pending = deferred();
  const budgetSnapshot = {
    limitUsd: 3,
    chargedUsd: 0.25,
    remainingUsd: 2.75,
    inputTokens: 100,
    outputTokens: 20,
    requests: 2,
    settledRequests: 1,
    uncertainRequests: 1,
    initialReserveUsd: 0.1,
    inputPerMillion: 0.15,
    outputPerMillion: 0.5,
  };
  let snapshotCalls = 0;
  let oldSignal;
  const clock = fakeClock();
  const simulation = withClock(mockClient({
    budget: { snapshot: () => { snapshotCalls += 1; return { ...budgetSnapshot }; } },
    plan: (_context, signal) => {
      oldSignal = signal;
      return pending.promise;
    },
  }), clock);
  try {
    await simulation.check();
    assert.deepEqual(simulation.state.planner.budget, budgetSnapshot);
    simulation.control('play');
    const previousWorld = simulation.state.world;
    assert.ok(oldSignal);

    simulation.control('reset');
    const resetWorld = simulation.state.world;
    assert.notEqual(resetWorld, previousWorld);
    await simulation.check();
    assert.equal(simulation.state.planner.connection, 'ready');
    assert.deepEqual(simulation.state.planner.budget, budgetSnapshot, 'reset preserves the client budget snapshot');
    assert.ok(snapshotCalls >= 2, 'the reset planner exposes a fresh snapshot from the same budget');
    assert.equal(oldSignal.aborted, true);

    pending.resolve({ plan: validPlan(), tokens: 99 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(simulation.state.world, resetWorld);
    assert.equal(simulation.state.world.citizens[0].planCount, 0);
    assert.deepEqual(simulation.state.world.citizens[0].tasks, []);
    assert.equal(simulation.state.planner.requests, 0);
    assert.equal(simulation.state.planner.completed, 0);
    assert.equal(simulation.state.planner.totalTokens, 0);
    assert.equal(simulation.state.planner.activeCitizenId, null);
    assert.equal(simulation.state.running, false);
  } finally {
    simulation.close();
  }
});

test('planner failure stops play and retry restores the citizen for another plan', async () => {
  let checks = 0;
  let attempts = 0;
  const pendingRetry = deferred();
  const clock = fakeClock();
  const simulation = withClock(mockClient({
    check: async () => { checks += 1; },
    plan: () => {
      attempts += 1;
      if (attempts === 1) throw new PlannerError('A temporary planner failure.');
      return pendingRetry.promise;
    },
  }), clock);
  try {
    await simulation.check();
    simulation.control('play');
    await until(() => simulation.state.planner.failed === 1, 'the failed request was not recorded');
    assert.equal(simulation.state.running, false);
    assert.equal(simulation.state.planner.connection, 'error');
    assert.match(simulation.state.planner.lastError, /temporary planner failure/);
    assert.equal(simulation.state.world.citizens[0].status, 'error');
    assert.equal(simulation.state.planner.completed, 0);

    simulation.control('retry');
    await simulation.check();
    assert.equal(checks, 2);
    assert.equal(simulation.state.planner.connection, 'ready');
    assert.equal(simulation.state.planner.lastError, null);
    assert.equal(simulation.state.world.citizens[0].status, 'idle');

    clock.advance(60_000);
    simulation.control('play');
    assert.equal(attempts, 2);
    simulation.control('pause');
    pendingRetry.resolve({ plan: validPlan(3), tokens: 8 });
    await until(() => simulation.state.planner.completed === 1, 'the retry response was not applied');
    assert.equal(simulation.state.planner.failed, 1);
    const retriedCitizen = simulation.state.world.citizens[1];
    assert.equal(retriedCitizen.id, 'citizen-2', 'dispatch continues fairly after the failed citizen');
    assert.equal(retriedCitizen.planCount, 1);
    assert.deepEqual(retriedCitizen.tasks, [{ type: 'wait', ticks: 3 }]);
  } finally {
    simulation.close();
  }
});

test('initial calls obey global five-second spacing; reviews require 180 ticks and 60 real seconds per citizen', async () => {
  const calls = [];
  const clock = fakeClock();
  const simulation = withClock(mockClient({
    plan: (context) => {
      const request = deferred();
      calls.push({ citizenId: context.citizen.id, request });
      return request.promise;
    },
  }), clock);
  const answer = async (index) => {
    calls[index].request.resolve({ plan: { ...validPlan(), routine: { family: false }, tasks: [], work: { type: 'rest' } }, tokens: 1 });
    await until(() => simulation.state.planner.completed === index + 1, `plan ${index + 1} did not complete`);
  };
  try {
    await simulation.check();
    simulation.control('play');
    assert.deepEqual(calls.map(({ citizenId }) => citizenId), ['citizen-1'], 'the first plan is immediate');
    await answer(0);

    clock.set(4_999);
    simulation.advance(0);
    assert.equal(calls.length, 1, 'the global interval applies after the initial plan too');
    clock.set(5_000);
    simulation.advance(0);
    await until(() => calls.length === 2, 'the second citizen was not dispatched at five seconds');
    assert.equal(calls[1].citizenId, 'citizen-2');
    await answer(1);

    for (let index = 2; index < 4; index += 1) {
      clock.set(index * 5_000);
      simulation.advance(0);
      await until(() => calls.length === index + 1, `initial plan ${index + 1} was not dispatched`);
      assert.equal(calls[index].citizenId, `citizen-${index + 1}`);
      await answer(index);
    }

    for (let tick = 0; tick < 179; tick += 1) simulation.advance(1);
    assert.equal(simulation.state.world.tick, 179);
    assert.equal(calls.length, 4, 'elapsed wall time cannot replace the 180-tick review interval');
    simulation.advance(1);
    assert.equal(simulation.state.world.tick, 180);
    assert.equal(calls.length, 4, '180 simulation ticks alone cannot replace the 60-second citizen interval');

    clock.set(60_000);
    simulation.advance(0);
    await until(() => calls.length === 5, 'the first due review was not dispatched at 60 seconds');
    assert.equal(calls[4].citizenId, 'citizen-1');
    await answer(4);

    for (let tick = 180; tick < 360; tick += 1) simulation.advance(1);
    assert.equal(simulation.state.world.tick, 360);
    clock.set(65_000);
    simulation.advance(0);
    await until(() => calls.length === 6, 'citizen-2 did not become eligible after its own minute');
    assert.equal(calls[5].citizenId, 'citizen-2');
    await answer(5);
    clock.set(69_000);
    simulation.advance(0);
    assert.equal(calls.length, 6, 'round-robin eligibility does not bypass citizen-specific spacing');

    clock.set(70_000);
    simulation.advance(0);
    await until(() => calls.length === 7, 'citizen-3 did not become eligible');
    assert.equal(calls[6].citizenId, 'citizen-3');
    await answer(6);
    clock.set(75_000);
    simulation.advance(0);
    await until(() => calls.length === 8, 'citizen-4 did not become eligible');
    assert.equal(calls[7].citizenId, 'citizen-4');
    await answer(7);

    clock.set(80_000);
    simulation.advance(0);
    assert.equal(calls.length, 8, 'citizen-1 is not due again until its full minute has elapsed');
    clock.set(120_000);
    simulation.advance(0);
    await until(() => calls.length === 9, 'citizen-1 was not replanned after its full 60 seconds');
    assert.equal(calls[8].citizenId, 'citizen-1');
  } finally {
    simulation.close();
  }
});

test('children are excluded from strategic planning', async () => {
  const calls = [];
  const clock = fakeClock();
  const simulation = withClock(mockClient({
    plan: (context) => {
      const request = deferred();
      calls.push({ citizenId: context.citizen.id, request });
      return request.promise;
    },
  }), clock);
  const answer = async (index) => {
    calls[index].request.resolve({ plan: validPlan(), tokens: 1 });
    await until(() => simulation.state.planner.completed === index + 1, `plan ${index + 1} did not complete`);
  };
  try {
    await simulation.check();
    const child = structuredClone(simulation.state.world.citizens[0]);
    Object.assign(child, { id: 'citizen-child', adult: false, bornAt: 0, planCount: 0, parents: ['citizen-1'] });
    simulation.state.world.citizens.push(child);

    simulation.control('play');
    for (let index = 0; index < 4; index += 1) {
      if (index > 0) {
        clock.set(index * 5_000);
        simulation.advance(0);
      }
      await until(() => calls.length === index + 1, `adult ${index + 1} was not planned`);
      assert.equal(calls[index].citizenId, `citizen-${index + 1}`);
      await answer(index);
    }
    clock.set(20_000);
    simulation.advance(0);
    assert.equal(calls.length, 4);
    assert.equal(child.planCount, 0);
    assert.ok(!calls.some(({ citizenId }) => citizenId === child.id));
  } finally {
    simulation.close();
  }
});

test('a citizen continues executing its existing strategy while a new thought is pending', async () => {
  const pending = deferred();
  const clock = fakeClock();
  const simulation = withClock(mockClient({ plan: () => pending.promise }), clock);
  try {
    await simulation.check();
    const citizen = simulation.state.world.citizens[0];
    applyPlan(simulation.state.world, citizen.id, validPlan(2, {
      tasks: [{ type: 'move', x: 3, y: 2 }],
    }));
    simulation.state.world.tick = 180;
    citizen.replanReason = 'scheduled review';

    simulation.control('play');
    assert.equal(citizen.planning, true);
    simulation.advance(1);
    assert.deepEqual([citizen.x, citizen.y], [3, 2], 'the pre-existing move advances during planner latency');
    assert.equal(citizen.planning, true);
    assert.equal(simulation.state.planner.completed, 0);

    simulation.control('pause');
    pending.resolve({ plan: validPlan(), tokens: 2 });
    await until(() => simulation.state.planner.completed === 1, 'the pending thought did not complete');
  } finally {
    simulation.close();
  }
});

test('completion and failure of queued orders do not trigger an LLM call storm', async () => {
  const pending = deferred();
  const calls = [];
  const clock = fakeClock();
  const simulation = withClock(mockClient({
    plan: (context) => {
      calls.push(context.citizen.id);
      return pending.promise;
    },
  }), clock);
  try {
    await simulation.check();
    simulation.control('play');
    assert.deepEqual(calls, ['citizen-1']);
    pending.resolve({
      plan: validPlan(2, {
        tasks: [
          { type: 'move', x: 3, y: 2 },
          { type: 'give', target: 'citizen-2', resource: 'food', amount: 1 },
        ],
      }),
      tokens: 4,
    });
    await until(() => simulation.state.planner.completed === 1, 'the strategy was not applied');

    simulation.advance(1);
    const citizen = simulation.state.world.citizens[0];
    assert.deepEqual([citizen.x, citizen.y], [3, 2], 'the first queued order completes');
    assert.deepEqual(killCitizen(simulation.state.world, 'citizen-2', null), { ok: true });
    simulation.advance(1);
    simulation.advance(1);
    assert.equal(citizen.order, null);
    assert.deepEqual(citizen.tasks, [], 'the invalidated second order fails and clears the queue');
    assert.match(simulation.state.world.events.at(-1).text, /could not finish/);
    assert.equal(simulation.state.planner.connection, 'ready');
    assert.equal(simulation.state.planner.failed, 0, 'order failure is not a planner failure');
    assert.equal(calls.length, 1, 'neither order completion nor failure immediately asks the model again');
    assert.equal(simulation.state.planner.completed, 1);
  } finally {
    simulation.close();
  }
});

test('a late response after citizen death is accounted for but never resurrects the citizen', async () => {
  const pending = deferred();
  const clock = fakeClock();
  const simulation = withClock(mockClient({ plan: () => pending.promise }), clock);
  try {
    await simulation.check();
    simulation.control('play');
    const victim = simulation.state.world.citizens[0];
    assert.equal(simulation.state.planner.activeCitizenId, victim.id);
    assert.deepEqual(killCitizen(simulation.state.world, victim.id, null), { ok: true });
    assert.ok(simulation.state.world.dead.includes(victim));

    pending.resolve({ plan: validPlan(), tokens: 17 });
    await until(() => simulation.state.planner.discarded === 1, 'the dead citizen response was not discarded');
    assert.ok(!simulation.state.world.citizens.includes(victim));
    assert.equal(victim.planCount, 0);
    assert.deepEqual(victim.tasks, []);
    assert.equal(simulation.state.planner.totalTokens, 17, 'paid tokens are still accounted for');
    assert.equal(simulation.state.planner.completed, 0);
    assert.equal(simulation.state.planner.failed, 0);
    assert.equal(simulation.state.planner.activeCitizenId, null);
  } finally {
    simulation.close();
  }
});

test('death during a tool turn is discarded without a misleading provider failure', async t => {
  const pending = deferred(), clock = fakeClock();
  const simulation = withClock(mockClient({ asynchronousWork: true, plan: () => pending.promise }), clock);
  t.after(() => simulation.close());
  await simulation.check(); simulation.control('play');
  const victim = simulation.state.world.citizens[0];
  killCitizen(simulation.state.world, victim.id, null);
  pending.reject(Object.assign(new Error('Citizen no longer able to act.'), { tokens: 17 }));
  await until(() => simulation.state.planner.discarded === 1, 'dead actor turn discarded');
  assert.equal(simulation.state.planner.failed, 0);
  assert.equal(simulation.state.planner.totalTokens, 17);
  assert.equal(simulation.state.planner.errorHistory.length, 0);
  assert.equal(simulation.state.planner.lastError, null);
  assert.equal(victim.lastError, null);
  assert.equal(simulation.state.planner.activeCitizenId, null);
});

test('an initial PlanResponseError is nonfatal and waits for the citizen cooldown', async () => {
  const clock = fakeClock();
  let attempts = 0;
  const simulation = withClock(mockClient({
    plan: async () => {
      attempts += 1;
      if (attempts === 1) throw new PlanResponseError('The model returned invalid JSON; keeping the existing strategy until the next review.');
      return { plan: validPlan(), tokens: 3 };
    },
  }), clock);
  try {
    await simulation.check();
    const citizen = simulation.state.world.citizens[0];
    simulation.state.world.citizens.splice(1);
    const routine = structuredClone(citizen.routine);
    simulation.control('play');
    await until(() => simulation.state.planner.failed === 1, 'the invalid initial model response was not recorded');

    assert.equal(simulation.state.running, true);
    assert.equal(simulation.state.planner.connection, 'ready');
    assert.match(simulation.state.planner.lastError, /invalid JSON/);
    assert.match(citizen.lastError, /invalid JSON/);
    assert.equal(citizen.planCount, 0);
    assert.deepEqual(citizen.routine, routine, 'an invalid first response leaves the default routine intact');
    assert.equal(simulation.state.planner.completed, 0);
    assert.equal(attempts, 1, 'a rejected response does not cause an immediate repair request');

    clock.set(59_999);
    simulation.advance(0);
    assert.equal(attempts, 1, 'the first plan still observes the normal 60-second citizen interval');
    clock.set(60_000);
    simulation.advance(0);
    await until(() => simulation.state.planner.completed === 1, 'the first plan was not retried after 60 seconds');
    assert.equal(attempts, 2);
    assert.equal(simulation.state.running, true);
    assert.equal(simulation.state.planner.lastError, null, 'successful review clears the stale planner warning');
    assert.equal(citizen.lastError, null);
  } finally {
    simulation.close();
  }
});

test('a schema-rejected review preserves the running strategy until the next eligible review', async () => {
  const clock = fakeClock();
  let attempts = 0;
  const invalidStrategy = { ...validPlan(), tasks: [{ type: 'wait', ticks: 0 }] };
  const simulation = withClock(mockClient({
    plan: async () => {
      attempts += 1;
      if (attempts === 1) return { plan: invalidStrategy, tokens: 7 };
      return { plan: validPlan(), tokens: 5 };
    },
  }), clock);
  try {
    await simulation.check();
    const citizen = simulation.state.world.citizens[0];
    simulation.state.world.citizens.splice(1);
    const previousPlan = validPlan(120, {
      reviewAfter: 180,
      tasks: Array.from({ length: 4 }, () => ({ type: 'wait', ticks: 120 })),
    });
    applyPlan(simulation.state.world, citizen.id, previousPlan);
    const previousGoals = [...citizen.goals];
    const previousRoutine = structuredClone(citizen.routine);

    simulation.control('play');
    for (let tick = 0; tick < 180; tick += 1) simulation.advance(1);
    await until(() => simulation.state.planner.failed === 1, 'the invalid strategy was not rejected');

    assert.equal(simulation.state.running, true, 'a rejected strategy does not pause simulation');
    assert.equal(simulation.state.planner.connection, 'ready');
    assert.match(simulation.state.planner.lastError, /Strategy rejected/);
    assert.match(citizen.lastError, /Strategy rejected/);
    assert.equal(citizen.planCount, 1, 'a rejected strategy does not count as an applied plan');
    assert.deepEqual(citizen.goals, previousGoals);
    assert.deepEqual(citizen.routine, previousRoutine);
    assert.deepEqual(citizen.order.task, { type: 'wait', ticks: 120 }, 'the active old order is retained');
    const remainingAtRejection = citizen.current.remaining;
    assert.ok(remainingAtRejection > 0, 'the retained order is still in progress');
    assert.equal(simulation.state.planner.failed, 1);
    assert.equal(attempts, 1, 'schema rejection does not cause an immediate repair request');

    simulation.advance(1);
    assert.equal(citizen.current.remaining, remainingAtRejection - 1, 'the old order continues to execute');
    clock.set(59_999);
    simulation.advance(0);
    assert.equal(attempts, 1, 'the next review observes the normal 60-second citizen interval');
    clock.set(60_000);
    simulation.advance(0);
    await until(() => attempts === 2, 'the review was not dispatched after the normal cooldown');
    await until(() => simulation.state.planner.completed === 1, 'the next valid review was not applied');
    assert.equal(simulation.state.planner.failed, 1);
    assert.equal(simulation.state.planner.lastError, null);
    assert.equal(citizen.lastError, null);
    assert.equal(simulation.state.running, true);
  } finally {
    simulation.close();
  }
});
