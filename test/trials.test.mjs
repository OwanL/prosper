import test from 'node:test';
import assert from 'node:assert/strict';
import { runTrial } from '../lib/trials.mjs';
import { createWorld } from '../lib/world.mjs';
import { normalizePlan } from '../lib/plans.mjs';

test('closed-loop trials preserve input worlds and distinguish executed orders from model intent', async () => {
  const world = createWorld({ expanded: false });
  const before = structuredClone(world);
  const result = await runTrial({ world, ticks: 240, planner: {
    check: async () => {}, model: 'offline',
    plan: async context => ({ tokens: 0, plan: normalizePlan({
      thought: 'I might contact somebody later', tasks: [{ type: 'wait', ticks: 2 }], work: null,
      undertaking: { objective: 'Observe quietly', success: 'Decide what matters', status: 'active' },
    }, context) }),
  } });
  assert.deepEqual(world, before);
  assert.equal(result.endTick, 240);
  assert.equal(result.statsDelta.messages, 0);
  assert.equal(result.distinctTargetedPairs, 0);
  assert.ok(result.completedOrders.wait >= 4);
  assert.ok(result.citizens.every(c => c.undertaking.completedActions >= 1));
  assert.ok(result.citizens.every(c => c.undertaking.status === 'active'));
});
