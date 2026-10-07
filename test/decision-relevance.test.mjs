import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyPlan, planningContext, tickWorld } from '../lib/world.mjs';
import { resolveBuilding } from '../lib/buildings.mjs';
import { normalizePlan } from '../lib/plans.mjs';
import { observeWorld } from '../lib/knowledge.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';
import { createAgentPlanner } from '../lib/agent-planner.mjs';

function assault() {
  const world = createWorld({ expanded: false }), [owner, attacker, newcomer] = world.citizens;
  world.citizens = [owner, attacker, newcomer];
  for (const c of world.citizens) Object.assign(c, { food: 20, hunger: 10, energy: 90, asyncReview: true });
  Object.assign(owner, { x: 13, y: 7, wood: 50, weapon: true, weaponDurability: 12 });
  Object.assign(attacker, { x: 14, y: 7 }); Object.assign(newcomer, { x: 12, y: 7 });
  assert.equal(resolveBuilding(world, owner, { type: 'build', building: 'bakery', x: 13, y: 7 }).ok, true);
  for (const c of world.citizens) observeWorld(world, c);
  const building = world.buildings[0];
  applyPlan(world, owner.id, normalizePlan({ tasks: [], work: { type: 'gather', resource: 'food' } }, planningContext(world, owner.id)));
  applyPlan(world, attacker.id, normalizePlan({ tasks: [{ type: 'attack', target: building.id }], work: null }, planningContext(world, attacker.id)));
  for (let i = 0; i < 3; i++) tickWorld(world);
  assert.ok(owner.incidents.some(i => i.kind === 'building' && i.attackerId === attacker.id));
  return { world, owner, attacker, newcomer, building };
}
const response = (name, args, id) => ({ ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }] } }], usage: {} }) });

test('repeated witnessed strikes allow explicitly chosen immediate defense to execute without a stale-event loop', async () => {
  const { world, owner, building } = assault();
  const planner = createAgentPlanner({ fetchImpl: async () => {
    for (let i = 0; i < 6; i++) tickWorld(world);
    return response('commit_strategy', { tasks: [{ type: 'guard', target: building.id, ticks: 90 }], work: null }, 'defend');
  } });
  const result = await planner.plan(planningContext(world, owner.id), undefined, { toolSession: createCitizenToolSession({ getWorld: () => world, citizenId: owner.id }) });
  assert.equal(result.steps, 1);
  assert.ok(result.unreviewedChanges.includes('violence'), 'later strikes are not falsely marked considered');
  assert.equal(world.stats.attacks, 0, 'the model receipt alone did not start a fight');
  applyPlan(world, owner.id, result.plan);
  for (let i = 0; i < 12; i++) tickWorld(world);
  assert.ok(world.stats.attacks > 0, 'the selected guard actually defended against a witnessed attacker');
  assert.ok(building.health > 0);
});

test('a new attacker still rejects stale defense and requires the fresh observation', async () => {
  const { world, owner, newcomer, building } = assault();
  let calls = 0;
  const before = owner.work;
  const planner = createAgentPlanner({ fetchImpl: async (_url, options) => {
    if (calls++ === 0) {
      applyPlan(world, newcomer.id, normalizePlan({ tasks: [{ type: 'attack', target: building.id }], work: null }, planningContext(world, newcomer.id)));
      for (let i = 0; i < 3; i++) tickWorld(world);
    } else {
      const messages = JSON.parse(options.body).messages;
      const rejection = JSON.parse(messages.findLast(m => m.role === 'tool').content);
      assert.equal(rejection.ok, false); assert.match(rejection.error, /New violence evidence or property attack alert/);
      assert.ok(JSON.parse(messages.at(-1).content).incidents.some(i => i.attackerId === newcomer.id));
      assert.equal(owner.work, before, 'the rejected strategy retained physical execution');
    }
    return response('commit_strategy', { tasks: [{ type: 'guard', target: building.id, ticks: 90 }], work: null }, `guard-${calls}`);
  } });
  const result = await planner.plan(planningContext(world, owner.id), undefined, { toolSession: createCitizenToolSession({ getWorld: () => world, citizenId: owner.id }) });
  assert.equal(result.steps, 2);
  assert.deepEqual(result.unreviewedChanges, []);
});
