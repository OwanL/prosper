import test from 'node:test';
import assert from 'node:assert/strict';
import { unifiedStrategyMenu, unifiedStrategyInstructions } from '../lib/strategy-tool-menu.mjs';
import { createCitizenToolSession, OLLAMA_MODEL_TOOLS } from '../lib/citizen-tools.mjs';
import { createWorld, planningContext, applyPlan, tickWorld } from '../lib/world.mjs';
import { normalizePlan } from '../lib/plans.mjs';
import { createAgentPlanner, AGENT_PROMPT } from '../lib/agent-planner.mjs';

test('the unified transport removes only duplicated strategy metadata, retaining every action schema', () => {
  const before = structuredClone(OLLAMA_MODEL_TOOLS), combined = unifiedStrategyMenu(before);
  const original = before.find(t => t.function.name === 'commit_strategy').function.parameters;
  const replacement = combined.find(t => t.function.name === 'set_strategy').function.parameters;
  const { mode, ...properties } = replacement.properties;
  assert.deepEqual(properties, original.properties);
  assert.deepEqual(replacement.$defs, original.$defs);
  assert.deepEqual(mode.enum, ['continue', 'replace']);
  assert.deepEqual(replacement.required, original.required);
  for (const tool of before.filter(t => !['continue_strategy', 'commit_strategy'].includes(t.function.name))) {
    assert.deepEqual(combined.find(t => t.function.name === tool.function.name), tool);
  }
  assert.deepEqual(before, OLLAMA_MODEL_TOOLS);
  assert.equal(combined.length, before.length - 1);
  assert.ok(Buffer.byteLength(JSON.stringify(combined)) < Buffer.byteLength(JSON.stringify(before)) - 2500);
});

test('a unified decision recovers in finalization, preserves invested craft and actually sends a queued reply', async () => {
  const world = createWorld({ expanded: false }), [actor, peer] = world.citizens;
  world.citizens = [actor, peer]; world.blocked = [];
  Object.assign(actor, { x: 2, y: 2, wood: 15, food: 20, hunger: 0, energy: 100, asyncReview: true });
  Object.assign(peer, { x: 3, y: 2 });
  applyPlan(world, actor.id, normalizePlan({ tasks: [{ type: 'craft', item: 'tool' }], work: { type: 'gather', resource: 'wood' } }, planningContext(world, actor.id)));
  tickWorld(world); tickWorld(world);
  const effort = actor.order.effort.ticks, requests = [];
  assert.ok(effort > 0 && !actor.tool);
  let clock = 0;
  const planner = createAgentPlanner({ toolDefinitions: unifiedStrategyMenu(OLLAMA_MODEL_TOOLS),
    instructions: unifiedStrategyInstructions(AGENT_PROMPT), now: () => clock,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body), step = requests.length;
      requests.push(body); clock += step ? 10000 : 80000;
      if (step) {
        assert.deepEqual(body.tools.map(t => t.function.name), ['set_strategy']);
        assert.match(body.messages[0].content, /set_strategy\(mode:continue\)/);
        assert.match(body.messages.findLast(m => m.role === 'tool').content, /retains the existing physical order/);
      }
      const args = step ? { mode: 'continue', communications: [{ target: peer.id, text: 'I will finish this tool, then gather wood.' }] }
        : { mode: 'continue', tasks: [{ type: 'craft', item: 'shoes' }] };
      return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ id: `decision-${step}`, function: { name: 'set_strategy', arguments: JSON.stringify(args) } }] } }], usage: {} }) };
    },
  });
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id });
  const result = await planner.plan(planningContext(world, actor.id), undefined, { toolSession: tools });
  assert.equal(result.plan.mode, 'continue');
  assert.equal(result.steps, 2);
  assert.equal(actor.order.effort.ticks, effort, 'the malformed choice did not change execution');
  applyPlan(world, actor.id, result.plan);
  for (let i = 0; i < 8 && (!actor.tool || !world.messages.length); i++) tickWorld(world);
  assert.equal(actor.tool, true);
  assert.equal(world.stats.crafted, 1);
  assert.equal(world.messages.length, 1);
  assert.equal(world.messages[0].recipientId, peer.id);
  assert.equal(world.messages[0].costWood, 0);
});

test('a unified replacement actually changes work and rejects malformed executable choices atomically', () => {
  const world = createWorld({ expanded: false }), actor = world.citizens[0];
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id });
  tools.refresh();
  const before = structuredClone(world);
  assert.equal(tools.execute('set_strategy', { mode: 'invented', work: { type: 'gather', resource: 'wood' } }).ok, false);
  const rejected = tools.execute('set_strategy', { mode: 'replace', tasks: [{ type: 'craft', item: 'tool', ticks: 99 }], work: null });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.taskProblems[0].type, 'craft');
  assert.deepEqual(world, before);
  assert.equal(tools.execute('set_strategy', { tasks: [], work: { type: 'gather', resource: 'wood' } }).ok, true);
  assert.equal(tools.committed.plan.mode, 'replace');
  applyPlan(world, actor.id, tools.committed.plan);
  assert.equal(actor.work.resource, 'wood');
  const retained = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id }); retained.refresh();
  assert.equal(retained.execute('set_strategy', { communications: [] }).ok, true);
  assert.equal(retained.committed.plan.mode, 'continue');
  applyPlan(world, actor.id, retained.committed.plan);
  assert.equal(actor.work.resource, 'wood');
});
