import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyPlan, planningContext, tickWorld, interruptForMessage } from '../lib/world.mjs';
import { normalizePlan } from '../lib/plans.mjs';
import { createPlanner } from '../lib/planner.mjs';

const undertaking = { objective: 'Operate a bakery', success: 'Own a bakery and produce bread', status: 'active' };
const install = (world, citizen, raw) => applyPlan(world, citizen.id, normalizePlan(raw, planningContext(world, citizen.id)));
const build = { type: 'build', building: 'bakery', x: 2, y: 2 };
function builder() {
  const world = createWorld({ expanded: false }), citizen = world.citizens[0];
  Object.assign(citizen, { food: 12, wood: 80, hunger: 0, energy: 100 });
  install(world, citizen, { undertaking, tasks: [build, { type: 'bake', target: 'own', amount: 2 }], work: null });
  for (let i = 0; i < 12; i++) tickWorld(world);
  return { world, citizen };
}

test('continue preserves active progress and queued tasks through repeated reviews', () => {
  const { world, citizen } = builder();
  assert.equal(citizen.order.effort.ticks, 12);
  const current = citizen.current, order = citizen.order, tasks = citizen.tasks;
  install(world, citizen, { mode: 'continue', communications: [] });
  assert.equal(citizen.current, current);
  assert.equal(citizen.order, order);
  assert.equal(citizen.tasks, tasks);
  const echoed = planningContext(world, citizen.id).citizen;
  install(world, citizen, { mode: 'continue', tasks: echoed.tasks });
  assert.equal(citizen.order, order, 'echoing the existing queue never reinstalls it');
  install(world, citizen, { mode: 'continue', tasks: [echoed.order, ...echoed.tasks] });
  assert.equal(citizen.current, current);
  for (let i = 0; i < 37; i++) {
    if (i % 5 === 0) install(world, citizen, { mode: 'continue' });
    tickWorld(world);
  }
  assert.equal(world.stats.built, 1);
  assert.equal(world.stats.baked, 2);
  assert.equal(citizen.wood, 28, 'construction and two bread charged once');
  assert.equal(citizen.undertaking.status, 'active', 'execution does not declare an arbitrary goal complete');
  assert.equal(citizen.undertaking.completedActions, 2);
});

test('mail and hunger interrupt construction without destroying invested work', () => {
  const { world, citizen } = builder();
  interruptForMessage(citizen, 'observed-mail');
  assert.equal(citizen.current, null);
  for (let i = 0; i < 3; i++) tickWorld(world);
  assert.equal(citizen.order.effort.ticks, 12);
  const observation = planningContext(world, citizen.id);
  assert.equal(observation.citizen.execution.interruptedBy, 'private message');
  assert.equal(observation.citizen.execution.investedTicks, 12);
  citizen.hunger = 60;
  install(world, citizen, { mode: 'continue', communications: [{ type: 'message', target: 'citizen-2', text: 'Continuing my work.' }] });
  for (let i = 0; i < 22; i++) tickWorld(world);
  assert.equal(world.stats.built, 1, 'only the remaining 18 construction ticks were needed after eating');
  assert.equal(world.messages.length, 1);
  assert.equal(citizen.wood, 29);
  assert.ok(citizen.food < 12, 'automatic eating still consumed food');
});

test('an in-flight continuation keeps advanced work and its original execution audit', () => {
  const { world, citizen } = builder();
  const records = [];
  Object.defineProperty(world, 'audit', { value: { record: event => records.push(event) } });
  Object.defineProperty(citizen, 'physicalAuditPlanId', { value: 'physical-origin' });
  Object.defineProperty(citizen, 'auditPlanId', { value: 'later-review' });
  const captured = planningContext(world, citizen.id);
  const plan = normalizePlan({ mode: 'continue', tasks: [captured.citizen.order, ...captured.citizen.tasks] }, captured);
  for (let i = 0; i < 22; i++) tickWorld(world);
  assert.equal(world.stats.built, 1);
  assert.equal(citizen.order.task.type, 'bake');
  const current = citizen.current;
  applyPlan(world, citizen.id, plan);
  assert.equal(citizen.current, current, 'never reinstall the completed request-time construction task');
  assert.doesNotMatch(JSON.stringify(citizen), /physical-origin|later-review/);
  for (let i = 0; i < 20; i++) tickWorld(world);
  assert.equal(world.stats.built, 1);
  assert.equal(world.stats.baked, 2);
  assert.equal(records.find(e => e.type === 'action_result' && e.task.type === 'bake').planId, 'physical-origin');
});

test('replacement remains explicit; contradictory continuation rejects atomically', () => {
  const { world, citizen } = builder();
  const before = structuredClone(citizen);
  for (const raw of [{ mode: 'continue', tasks: [build] }, { mode: 'continue', work: { type: 'rest' } }, { mode: null, tasks: [], work: null }]) {
    assert.throws(() => install(world, citizen, raw));
    assert.deepEqual(citizen, before);
  }
  const valid = normalizePlan({ mode: 'continue' }, planningContext(world, citizen.id));
  assert.throws(() => applyPlan(world, citizen.id, { ...valid, tasks: [build] }), /continue cannot replace/);
  assert.deepEqual(citizen, before);
  install(world, citizen, { mode: 'replace', tasks: [{ type: 'wait', ticks: 10 }], work: null, undertaking: { ...undertaking, status: 'abandoned' } });
  for (let i = 0; i < 40; i++) tickWorld(world);
  assert.equal(world.stats.built, 0);
  assert.equal(citizen.wood, 80, 'abandoned construction created no building and spent no resources');
});

test('continued work rechecks changed prerequisites instead of guaranteeing completion', () => {
  const { world, citizen } = builder();
  interruptForMessage(citizen, 'observed-mail');
  citizen.wood = 0;
  install(world, citizen, { mode: 'continue' });
  tickWorld(world);
  assert.equal(world.stats.built, 0);
  assert.notEqual(citizen.current?.task.type, 'build', 'missing resources still require support gathering');
  assert.equal(citizen.order.effort.ticks, 12);
});

test('continuity guidance and mechanical progress are bounded and self-only', async () => {
  const { world, citizen } = builder();
  let request;
  const planner = createPlanner({ projectContinuity: true, fetchImpl: async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"mode":"continue"}' } }] }) };
  } });
  const context = planningContext(world, citizen.id);
  context.citizen.execution.secret = 'PRIVATE-EXTRA';
  context.neighbors[0].execution = { secret: 'PRIVATE-PEER' };
  const result = await planner.plan(context);
  assert.equal(result.plan.mode, 'continue');
  assert.match(request.messages[0].content, /mode:"continue" preserves/);
  assert.ok(Buffer.byteLength(JSON.stringify(request.messages)) <= 12000);
  assert.equal(JSON.parse(request.messages[1].content).citizen.execution.investedTicks, 12);
  assert.doesNotMatch(request.messages[1].content, /PRIVATE-/);
  const example = JSON.parse(request.messages[0].content.split('\n').at(-1));
  assert.equal(normalizePlan(example, context).mode, 'replace');
});
