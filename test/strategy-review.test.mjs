import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, planningContext, applyPlan, tickWorld } from '../lib/world.mjs';
import { normalizePlan } from '../lib/plans.mjs';
import { createPlanner } from '../lib/planner.mjs';

const objective = { objective: 'Understand nearby terrain', success: 'Explore beyond the starting area', status: 'active' };
const response = tasks => ({ tasks, work: null, undertaking: objective });

test('undertaking survives ordinary reviews and records execution without declaring success', () => {
  const world = createWorld();
  const citizen = world.citizens[0];
  const install = raw => applyPlan(world, citizen.id, normalizePlan(raw, planningContext(world, citizen.id)));
  install(response([{ type: 'wait', ticks: 1 }]));
  const started = citizen.undertaking.startedAt;
  for (let i = 0; i < 4; i++) tickWorld(world);
  assert.equal(citizen.undertaking.completedActions, 1);
  assert.equal(citizen.undertaking.status, 'active');
  install({ tasks: [], work: null });
  assert.equal(citizen.undertaking.startedAt, started);
  assert.equal(citizen.undertaking.completedActions, 1);
  install({ tasks: [], work: null, undertaking: { ...objective, status: 'completed' } });
  assert.equal(citizen.undertaking.completedActions, 1);
  install({ tasks: [], work: null, undertaking: { ...objective, objective: 'Another objective' } });
  assert.equal(citizen.undertaking.completedActions, 0);
  install({ tasks: [], work: null, undertaking: null });
  assert.equal(citizen.undertaking, null);
});

test('invalid optional metadata retains prior state; direct invalid plans reject atomically', () => {
  const world = createWorld();
  const citizen = world.citizens[0];
  const context = planningContext(world, citizen.id);
  const before = structuredClone(citizen);
  const invalidMetadata = normalizePlan({ ...response([]), undertaking: { objective: 'x' } }, context);
  assert.equal(Object.hasOwn(invalidMetadata, 'undertaking'), false);
  const valid = normalizePlan({ ...response([]), undertaking: { ...objective, completedActions: 999, familyReady: true } }, context);
  assert.deepEqual(valid.undertaking, objective);
  assert.throws(() => applyPlan(world, citizen.id, { ...valid, undertaking: { objective: 'x' } }), /undertaking/);
  assert.deepEqual(citizen, before);
});

test('strategy review projects self objective and bounded evidence within the real prompt limit', async () => {
  const world = createWorld();
  const citizen = world.citizens[0];
  applyPlan(world, citizen.id, normalizePlan(response([]), planningContext(world, citizen.id)));
  const context = planningContext(world, citizen.id);
  context.citizen.undertaking.secret = 'PRIVATE-EXTRA';
  context.neighbors[0].undertaking = { objective: 'PRIVATE-PEER' };
  let request;
  const planner = createPlanner({ strategyReview: true, fetchImpl: async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response([])) } }] }) };
  } });
  await planner.plan(context);
  assert.match(request.messages[0].content, /STRATEGY REVIEW/);
  const example = JSON.parse(request.messages[0].content.split('\n').at(-1));
  assert.ok(normalizePlan(example, context).undertaking, 'the response example must demonstrate the new field');
  assert.ok(Buffer.byteLength(JSON.stringify(request.messages)) <= 12000);
  const sent = JSON.parse(request.messages[1].content);
  assert.equal(sent.citizen.undertaking.objective, objective.objective);
  assert.equal(sent.citizen.undertaking.completedActions, 0);
  assert.doesNotMatch(request.messages[1].content, /PRIVATE-/);
  assert.equal(citizen.undertaking.secret, undefined);
});
