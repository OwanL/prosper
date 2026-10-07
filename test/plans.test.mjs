import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlan, PlanResponseError } from '../lib/plans.mjs';

const canonical = {
  thought: 'A short observation.',
  goals: ['Keep a reserve'],
  memory: '',
  routine: { family: false },
  work: null,
  reviewAfter: 300,
  tasks: [{ type: 'wait', ticks: 2 }],
};

function context(overrides = {}) {
  return {
    citizen: {
      id: 'citizen-1',
      familyReady: true,
      goals: ['Existing goal', 'Second goal'],
      routine: { food: 17, wood: 30 },
      ...overrides,
    },
  };
}

test('normalization projects metadata, preserves omitted priorities and consent, and ignores root extras', () => {
  const result = normalizePlan({
    thought: `  ${'t'.repeat(450)}  `,
    reviewAfter: 900,
    tasks: [{ type: 'wait', ticks: '60', explanation: 'harmless task metadata' }],
    provider: { private: true },
  }, context());

  assert.deepEqual(result, {
    thought: 't'.repeat(400),
    goals: ['Existing goal', 'Second goal'],
    memory: '',
    routine: { family: true },
    work: null,
    reviewAfter: 600,
    tasks: [{ type: 'wait', ticks: 60 }],
  });
});

test('metadata is bounded and legacy reserve fields are dropped without capping task quantities', () => {
  const result = normalizePlan({
    ...canonical,
    goals: [` ${'g'.repeat(180)} `, '  Keep food  ', '', 'discarded'],
    memory: ` ${'m'.repeat(220)} `,
    routine: { food: '9007199254740991', wood: 0, family: false, note: 'ignored' },
    reviewAfter: '12',
    tasks: [{ type: 'gather', resource: 'wood', amount: '9007199254740991', extra: 1 }],
  }, context());

  assert.deepEqual(result, {
    thought: canonical.thought,
    goals: ['g'.repeat(160), 'Keep food', 'discarded'],
    memory: 'm'.repeat(200),
    routine: { family: false },
    work: null,
    reviewAfter: 180,
    tasks: [{ type: 'gather', resource: 'wood', amount: Number.MAX_SAFE_INTEGER }],
  });
});

test('v3 task additions project to canonical shapes, including targeted zero-price offers and broadcast alias', () => {
  const tasks = [
    { type: 'explore', ticks: '600', note: 'optional description' },
    { type: 'craft', item: 'shoes', modelConfidence: 0.7 },
    {
      type: 'offer', give: 'food', giveAmount: '2', want: 'wood', wantAmount: '0',
      recipient: 'citizen-7', rationale: 'gift',
    },
    { type: 'broadcast', text: '  I found something.  ', share: ['crop-1', 'tree-3'], audience: 'friends' },
  ];
  const result = normalizePlan({ ...canonical, tasks }, context());
  assert.deepEqual(result.tasks, [
    { type: 'explore', ticks: 600 },
    { type: 'craft', item: 'shoes' },
    { type: 'offer', give: 'food', giveAmount: 2, want: 'wood', wantAmount: 0, recipient: 'citizen-7' },
    { type: 'post', text: 'I found something.', share: ['crop-1', 'tree-3'] },
  ]);
});

test('gather camping is explicit and messages project only their canonical fields', () => {
  const result = normalizePlan({
    ...canonical,
    tasks: [
      { type: 'gather', resource: 'food', amount: 20, target: 'crop-8', camp: false, description: 'try first' },
      { type: 'gather', resource: 'wood', amount: 5, target: 'tree-2', camp: true },
      { type: 'post', text: 'Need wood', share: ['tree-1'] },
      {
        type: 'message', target: 'citizen-2', text: '  Can we meet?  ',
        share: ['tree-1'], location: true, private: 'drop me',
      },
    ],
  }, context());
  assert.deepEqual(result.tasks, [
    { type: 'gather', resource: 'food', amount: 20, target: 'crop-8', camp: false },
    { type: 'gather', resource: 'wood', amount: 5, target: 'tree-2', camp: true },
    { type: 'post', text: 'Need wood', share: ['tree-1'] },
    { type: 'message', target: 'citizen-2', text: 'Can we meet?', share: ['tree-1'], location: true },
  ]);
});

test('camping requires an explicit target and malformed message fields reject the whole plan', () => {
  for (const task of [
    { type: 'gather', resource: 'food', amount: 1, camp: true },
    { type: 'gather', resource: 'food', amount: 1, target: 'crop-1', camp: 'true' },
    { type: 'message', target: 'citizen-2', text: 'hi', location: 'yes' },
    { type: 'message', target: '', text: 'hi' },
    { type: 'message', target: 'citizen-2', text: 'hi', share: [] },
  ]) {
    assert.throws(() => normalizePlan({ ...canonical, tasks: [task] }, context()), PlanResponseError);
  }
});

test('omitted consent uses familyReady exactly and malformed consent is never coerced', () => {
  const plan = normalizePlan({ ...canonical, routine: { food: 4, wood: 10 } }, context({ familyReady: true }));
  assert.equal(plan.routine.family, true);
  assert.throws(
    () => normalizePlan({ ...canonical, routine: { food: 4, wood: 10, family: 'true' } }, context()),
    PlanResponseError,
  );
});

test('invalid or unknown actions and out-of-bound action arrays reject instead of dropping actions', () => {
  for (const tasks of [
    [{ type: 'teleport', x: 1, y: 1 }],
    [{ type: 'gather', resource: 'food', amount: 0 }],
    Array.from({ length: 5 }, () => ({ type: 'wait', ticks: 1 })),
    undefined,
    null,
    {},
  ]) {
    assert.throws(() => normalizePlan({ ...canonical, tasks }, context()), PlanResponseError);
  }
});

test('omitted finite gather quantity has a documented one-unit default; transfers never do', () => {
  const result = normalizePlan({ ...canonical, tasks: [{ type: 'gather', resource: 'food' }, { type: 'gather', resource: 'wood' }] });
  assert.deepEqual(result.tasks.map(t => t.amount), [1, 1]);
  for (const amount of [null, 0, -1, 'many']) {
    assert.throws(() => normalizePlan({ ...canonical, tasks: [{ type: 'gather', resource: 'food', amount }] }), PlanResponseError);
  }
  assert.throws(() => normalizePlan({ ...canonical, tasks: [{ type: 'give', target: 'citizen-2', resource: 'food' }] }), PlanResponseError);
});

test('empty tasks accept explicit work and preserve work-only or deliberate pause strategies', () => {
  for (const work of [{ type: 'explore' }, { type: 'rest' }, { type: 'gather', resource: 'wood' }, null]) {
    const result = normalizePlan({ ...canonical, work, tasks: [], reviewAfter: 0 });
    assert.deepEqual(result.tasks, [], 'no placeholder actions are invented');
    assert.deepEqual(result.work, work);
    assert.equal(result.reviewAfter, 180, 'even deliberate pauses retain a bounded review cooldown');
  }
  for (const citizen of [{}, { work: undefined }, { work: null }]) {
    assert.throws(() => normalizePlan({ tasks: [] }, { citizen }), PlanResponseError,
      'legacy empty tasks without existing work remain invalid');
  }
  assert.throws(() => normalizePlan({ ...canonical, tasks: [], work: {} }), PlanResponseError);
});

test('empty tasks retain valid omitted work with new goals and no placeholder actions', () => {
  for (const work of [
    { type: 'gather', resource: 'wood' },
    { type: 'gather', resource: 'wood', target: 'tree-1', camp: true },
    { type: 'bake', target: 'own' },
    { type: 'guard', target: 'bakery-1' },
    { type: 'explore' },
    { type: 'rest' },
  ]) {
    const result = normalizePlan({ tasks: [], goals: ['Build a wood reserve'] }, context({ work }));
    assert.deepEqual(result.work, work, 'the existing policy is retained');
    assert.deepEqual(result.tasks, [], 'no fake wait or other action is invented');
    assert.deepEqual(result.goals, ['Build a wood reserve']);
  }
});

test('empty tasks cannot approve malformed inherited work', () => {
  for (const work of [false, [], {}, { type: 'teleport' },
    { type: 'gather', resource: 'bread' }, { type: 'gather', resource: 'wood', camp: true },
    { type: 'gather', resource: 'wood', camp: 'yes' }, { type: 'bake' }, { type: 'guard' }]) {
    assert.throws(() => normalizePlan({ tasks: [] }, context({ work })), PlanResponseError);
  }
});

test('work policies are explicit, project metadata, and preserve missing work without inventing it', () => {
  const existing = { type: 'rest' };
  const missing = { ...canonical };
  delete missing.work;
  assert.deepEqual(normalizePlan(missing, context({ work: existing })).work, existing);
  assert.equal(normalizePlan(missing).work, null);
  const known = { ...context(), knownBuildings: [{ id: 'bakery-1' }] };
  for (const work of [
    null, { type: 'rest' }, { type: 'explore' },
    { type: 'gather', resource: 'food' },
    { type: 'gather', resource: 'wood', target: 'tree-1', camp: true },
    { type: 'bake', target: 'own' }, { type: 'bake', target: 'bakery-1' },
    { type: 'guard', target: 'bakery-1' },
  ]) {
    assert.deepEqual(normalizePlan({ ...canonical, work: work && { ...work, note: 'drop', amount: 12 } }, known).work, work);
  }
  for (const work of [undefined, false, [], {}, { type: 'food', amount: 4 },
    { type: 'gather', resource: 'bread' }, { type: 'gather', resource: 'wood', camp: true },
    { type: 'gather', resource: 'food', camp: 'yes' }, { type: 'guard', target: 'unknown' },
    { type: 'bake' }, { type: 'guard', target: 'own' }]) {
    assert.throws(() => normalizePlan({ ...canonical, work }, known), PlanResponseError);
  }
});

test('building tasks and snapshot sharing have strict canonical fields and bounds', () => {
  const known = { ...context(), knownBuildings: [{ id: 'bakery-1' }] };
  const tasks = [
    { type: 'build', building: 'bakery', x: 2, y: 3, cost: 0 },
    { type: 'bake', target: 'own', amount: '2' },
    { type: 'repair', target: 'bakery-1' },
    { type: 'guard', target: 'bakery-1', ticks: '600' },
  ];
  assert.deepEqual(normalizePlan({ ...canonical, tasks }, known).tasks, [
    { type: 'build', building: 'bakery', x: 2, y: 3 },
    { type: 'bake', target: 'own', amount: 2 },
    { type: 'repair', target: 'bakery-1' },
    { type: 'guard', target: 'bakery-1', ticks: 600 },
  ]);
  for (const type of ['post', 'message']) {
    const task = { type, ...(type === 'message' ? { target: 'citizen-2', location: true } : {}), text: 'Bakery here', shareBuildings: ['bakery-1'] };
    assert.deepEqual(normalizePlan({ ...canonical, tasks: [task] }, known).tasks, [task]);
  }
  for (const task of [
    { type: 'build', building: 'castle', x: 2, y: 3 },
    { type: 'build', building: 'bakery', x: '2', y: 3 },
    { type: 'bake', target: 'own', amount: 0 },
    { type: 'repair', target: 'unknown' },
    { type: 'guard', target: 'bakery-1', ticks: 601 },
    { type: 'post', text: 'hi', shareBuildings: [] },
    { type: 'post', text: 'hi', shareBuildings: ['bakery-1', 'bakery-1'] },
    { type: 'post', text: 'hi', shareBuildings: ['unknown'] },
  ]) assert.throws(() => normalizePlan({ ...canonical, tasks: [task] }, known), PlanResponseError);
});

test('bread transfers and building attacks are orders but bread is never gathered', () => {
  const tasks = [
    { type: 'give', target: 'citizen-2', resource: 'bread', amount: 2 },
    { type: 'offer', give: 'bread', giveAmount: 1, want: 'wood', wantAmount: 2 },
    { type: 'attack', target: 'bakery-1' },
  ];
  assert.deepEqual(normalizePlan({ ...canonical, tasks }).tasks, tasks);
  assert.throws(() => normalizePlan({ ...canonical, tasks: [{ type: 'gather', resource: 'bread', amount: 1 }] }), PlanResponseError);
});

test('action quantities reject unsafe, fractional, negative, and non-obvious numeric strings', () => {
  for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1e3', ' 4 ', '01']) {
    assert.throws(() => normalizePlan({
      ...canonical,
      tasks: [{ type: 'gather', resource: 'food', amount }],
    }, context()), PlanResponseError, `amount ${String(amount)} should not normalize`);
  }
  assert.throws(() => normalizePlan({
    ...canonical,
    tasks: [{ type: 'offer', give: 'wood', giveAmount: 1, want: 'wood', wantAmount: 1 }],
  }, context()), PlanResponseError);
});
