import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyPlan, planningContext, tickWorld } from '../lib/world.mjs';
import { normalizePlan } from '../lib/plans.mjs';
import { citizenObservation, createCitizenToolSession } from '../lib/citizen-tools.mjs';

test('reviews show real net change and continuing resets the comparison without cancelling execution', () => {
  const world = createWorld({ expanded: false }), actor = world.citizens[0];
  applyPlan(world, actor.id, normalizePlan({ tasks: [{ type: 'gather', resource: 'wood', amount: 5 }], work: null }, planningContext(world, actor.id)));
  for (let i = 0; i < 2; i++) tickWorld(world);
  actor.wood += 5; actor.food--; actor.health -= 10;
  const observation = citizenObservation(world, actor.id);
  assert.equal(observation.strategyProgress.elapsedTicks, 2);
  assert.deepEqual(observation.strategyProgress.inventoryChange, { food: -1, wood: 5, bread: 0 });
  assert.equal(observation.strategyProgress.healthChange, -10);
  const order = actor.order;
  applyPlan(world, actor.id, normalizePlan({ mode: 'continue' }, planningContext(world, actor.id)));
  assert.equal(actor.order, order);
  assert.deepEqual(citizenObservation(world, actor.id).strategyProgress.inventoryChange, { food: 0, wood: 0, bread: 0 });
});

test('objective history preserves the citizen assessment, stays bounded and does not invent completion', () => {
  const world = createWorld(), actor = world.citizens[0];
  for (let i = 0; i < 5; i++) {
    applyPlan(world, actor.id, normalizePlan({ undertaking: { objective: `Purpose ${i}`, success: 'A visible result', status: 'active' }, tasks: [], work: null }, planningContext(world, actor.id)));
  }
  assert.equal(actor.undertakingHistory.length, 3);
  assert.ok(actor.undertakingHistory.every(h => h.status === 'active'));
  assert.equal(citizenObservation(world, actor.id).previousUndertaking.objective, 'Purpose 3');
});

test('a real completed milestone can be assessed and followed by a new undertaking in one atomic decision', () => {
  const world = createWorld({ expanded: false }), actor = world.citizens[0];
  world.citizens = [actor]; world.nodes = []; actor.wood = 25; actor.food = 10;
  const original = { objective: 'Own a useful tool', success: 'Level one tool equipped', status: 'active' };
  applyPlan(world, actor.id, normalizePlan({ undertaking: original, tasks: [{ type: 'craft', item: 'tool' }], work: null }, planningContext(world, actor.id)));
  for (let i = 0; i < 25 && !actor.tool; i++) tickWorld(world);
  assert.ok(actor.tool, 'the milestone really executed');
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id, planId: 'next-undertaking' });
  tools.refresh();
  const assessment = { startedAt: actor.undertaking.startedAt, status: 'completed', reason: 'A level one tool is now equipped.' };
  assert.equal(tools.execute('commit_strategy', { assessment,
    undertaking: { objective: 'Improve travel', success: 'Shoes equipped', status: 'active' }, tasks: [{ type: 'craft', item: 'shoes' }], work: null }).ok, true);
  assert.equal(actor.undertaking.status, 'active', 'a decision receipt has not changed the world');
  applyPlan(world, actor.id, tools.committed.plan);
  assert.equal(actor.undertaking.status, 'active');
  assert.equal(actor.undertaking.objective, 'Improve travel');
  assert.equal(actor.undertaking.completedActions, 0, 'new goals do not inherit success counters');
  assert.equal(actor.undertakingHistory.at(-1).status, 'completed');
  assert.equal(actor.undertakingHistory.at(-1).assessment.reason, assessment.reason);
  assert.equal(citizenObservation(world, actor.id).previousUndertaking.status, 'completed');
  for (let i = 0; i < 25 && !actor.shoes; i++) tickWorld(world);
  assert.ok(actor.shoes, 'the successor task really executes');
  assert.equal(actor.wood, 0, 'both crafts use the existing finite inputs');
});

test('a long descriptive assessment does not block chosen physical work, and omissions are explicit', () => {
  const world = createWorld({ expanded: false }), actor = world.citizens[0];
  world.citizens = [actor]; world.nodes = []; actor.wood = 15; actor.food = 10;
  applyPlan(world, actor.id, normalizePlan({ undertaking: { objective: 'Find a direction', success: 'A useful method chosen', status: 'active' },
    tasks: [], work: { type: 'rest' } }, planningContext(world, actor.id)));
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id, planId: 'long-description' });
  tools.refresh();
  const assessment = { startedAt: actor.undertaking.startedAt, status: 'abandoned', reason: 'The earlier approach produced little useful progress. '.repeat(5) };
  const original = structuredClone(assessment);
  const invalid = tools.execute('commit_strategy', { assessment: { ...assessment, startedAt: 999 }, tasks: [{ type: 'craft', item: 'tool' }] });
  assert.equal(invalid.ok, false, 'shortening text cannot bypass identity checks');
  assert.equal(tools.committed, null);
  const result = tools.execute('commit_strategy', { assessment, tasks: [{ type: 'craft', item: 'tool' }], work: null });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.noteOmissions[0].field, 'assessment.reason');
  assert.ok(result.noteOmissions[0].omittedCharacters > 0);
  assert.match(result.metadataNote, /ending is omitted/);
  assert.deepEqual(assessment, original, 'the caller input was not rewritten');
  assert.equal(actor.undertaking.status, 'active', 'receipts alone do not apply a strategy');
  applyPlan(world, actor.id, tools.committed.plan);
  assert.equal(actor.undertaking.status, 'abandoned');
  assert.ok(actor.undertaking.assessment.reason.length <= 160);
  assert.ok(actor.undertaking.assessment.reason.endsWith('…'));
  for (let i = 0; i < 25 && !actor.tool; i++) tickWorld(world);
  assert.ok(actor.tool);
  assert.equal(actor.wood, 0, 'the real craft used its finite inputs');
});

test('undertaking assessment validates its identity and status before any strategy effect', () => {
  const world = createWorld(), actor = world.citizens[0];
  applyPlan(world, actor.id, normalizePlan({ undertaking: { objective: 'Learn', success: 'A new place explored', status: 'active' }, tasks: [{ type: 'explore', ticks: 60 }], work: null }, planningContext(world, actor.id)));
  tickWorld(world);
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id, planId: 'assessment-guards' });
  tools.refresh();
  const before = structuredClone(actor), assessment = { startedAt: actor.undertaking.startedAt, status: 'abandoned', reason: 'Another concern takes priority.' };
  assert.match(tools.execute('continue_strategy', { assessment: { ...assessment, startedAt: 999 } }).error, /current undertaking/);
  assert.match(tools.execute('continue_strategy', { assessment: { ...assessment, status: 'active' } }).error, /unknown value/);
  assert.match(tools.execute('continue_strategy', { assessment: { ...assessment, reason: '' } }).error, /reason length must be 1\.\.160/);
  assert.equal(tools.execute('continue_strategy', { assessment: { ...assessment, reason: ' '.repeat(200) } }).ok, false);
  assert.equal(tools.committed, null);
  assert.deepEqual(actor, before);
  const order = actor.order, primitive = actor.current;
  assert.equal(tools.execute('continue_strategy', { assessment }).ok, true);
  applyPlan(world, actor.id, tools.committed.plan);
  assert.equal(actor.undertaking.status, 'abandoned', 'this is the citizen assessment, not engine inference');
  assert.equal(actor.order, order); assert.equal(actor.current, primitive);
  assert.equal(actor.undertakingHistory?.length ?? 0, 0, 'no successor was invented');
  const next = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id, planId: 'successor' });
  next.refresh();
  assert.equal(next.execute('continue_strategy', { assessment, undertaking: { objective: actor.undertaking.objective, success: actor.undertaking.success, status: 'active' } }).ok, true);
  applyPlan(world, actor.id, next.committed.plan);
  assert.equal(actor.undertaking.startedAt, world.tick, 'a repeated batch can start a new instance without inventing different goal wording');
  assert.equal(actor.undertakingHistory.at(-1).status, 'abandoned');
  assert.equal(actor.order, order);
});
