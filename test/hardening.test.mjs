import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyPlan, tickWorld, planningContext, recordEvent } from '../lib/world.mjs';
import { normalizePlan } from '../lib/plans.mjs';
import { createPlanner, SYSTEM_PROMPT } from '../lib/planner.mjs';
import { resolveInteraction, tickInteractions } from '../lib/interactions.mjs';

const strategy = (tasks, work = null) => ({ thought: '', goals: ['Choose independently'], memory: '', routine: { family: false }, reviewAfter: 300, tasks, work });

async function observation(context) {
  let request;
  const planner = createPlanner({ fetchImpl: async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(strategy([])) } }] }) };
  } });
  await planner.plan(context);
  assert.ok(Buffer.byteLength(JSON.stringify(request.messages)) <= 12000);
  return JSON.parse(request.messages[1].content);
}

test('communication instructions distinguish claims, audiences, escrow and physical exchange', () => {
  assert.match(SYSTEM_PROMPT, /post.*public.*text/i);
  assert.match(SYSTEM_PROMPT, /message.*private/i);
  assert.match(SYSTEM_PROMPT, /adjacent/i);
  assert.match(SYSTEM_PROMPT, /text coordinates do not attach a usable location/i);
  assert.match(SYSTEM_PROMPT, /memories.*claims/i);
});

test('a single rest task is accepted and finishes without replacing later tasks or consent', () => {
  const world = createWorld();
  const citizen = world.citizens[0];
  citizen.energy = 40;
  const plan = normalizePlan(strategy([{ type: 'rest' }, { type: 'wait', ticks: 2 }]), planningContext(world, citizen.id));
  applyPlan(world, citizen.id, plan);
  for (let index = 0; index < 10; index++) tickWorld(world);
  assert.ok(citizen.energy > 60);
  assert.equal(citizen.order, null);
  assert.equal(citizen.tasks.length, 0);
  assert.equal(citizen.familyReady, false);
});

test('offers survive an 8x citizen review and model latency, then expire and refund once', () => {
  const world = createWorld();
  const [maker, taker] = world.citizens;
  maker.food = 4;
  const fx = { event: (text, id) => recordEvent(world, text, id) };
  assert.equal(resolveInteraction(world, maker, { type: 'offer', give: 'food', giveAmount: 2, want: 'wood', wantAmount: 1, recipient: taker.id }, fx).ok, true);
  const offer = world.offers[0];
  world.tick = 8 * (60 + 90) + 60;
  assert.equal(tickInteractions(world, fx).ok, true);
  assert.equal(offer.status, 'open');
  world.tick = offer.expiresAt;
  assert.equal(tickInteractions(world, fx).ok, true);
  assert.equal(offer.status, 'expired');
  assert.equal(maker.food, 4);
  tickInteractions(world, fx);
  assert.equal(maker.food, 4);
});

test('own mechanical trade failure and expired escrow survive noisy narrative and prompt compaction', async () => {
  const world = createWorld();
  const [maker, taker] = world.citizens;
  world.citizens = [maker, taker];
  maker.food = 4;
  resolveInteraction(world, maker, { type: 'offer', give: 'food', giveAmount: 2, want: 'wood', wantAmount: 1, recipient: taker.id });
  // Global navigation still fails for a genuinely unreachable maker.
  maker.x = 14; maker.y = 9;
  taker.x = 0; taker.y = 0;
  world.blocked = Array.from({ length: world.height }, (_, y) => ({ x: 8, y }));
  taker.knowledge.people = {};
  applyPlan(world, taker.id, strategy([{ type: 'trade', offer: world.offers[0].id }]));
  tickWorld(world);
  for (let index = 0; index < 90; index++) recordEvent(world, 'Unrelated gathering observation', taker.id);
  world.tick = world.offers[0].expiresAt;
  tickInteractions(world);
  const context = planningContext(world, taker.id);
  assert.ok(context.citizen.actionResults.some(result => result.task.type === 'trade' && result.status === 'failed'));
  const makerContext = planningContext(world, maker.id);
  assert.equal(makerContext.offerHistory[0].status, 'expired');
  assert.deepEqual(context.offerHistory, [], 'a recipient does not gain remote closed-offer telemetry');
  context.board = Array.from({ length: 4 }, (_, tick) => ({ tick, text: 'old public claim '.repeat(130) }));
  context.deposits = Array.from({ length: 20 }, (_, index) => ({ id: `crop-${index}`, kind: 'crop', x: index % 16, y: 2, stock: 0, observedAt: index, source: 'seen' }));
  const sent = await observation(context);
  assert.ok(sent.citizen.actionResults.some(result => result.status === 'failed' && /reachable/.test(result.reason)));
  assert.doesNotMatch(JSON.stringify(sent.citizen.actionResults), /ask for a location/,
    'mechanical failure feedback must leave the choice of response to the citizen');
  assert.ok(sent.deposits.length < context.deposits.length, 'resource records shrink before important action evidence');
});
