import test from 'node:test';
import assert from 'node:assert/strict';
import { behaviorCase, runBehaviorCase } from '../lib/behavior-benchmark.mjs';
import { normalizePlan } from '../lib/plans.mjs';

const planner = reply => ({ plan: async context => ({ plan: normalizePlan(reply(context), context), tokens: 0 }) });

test('prepared continuity benchmark measures progress loss and actual completion without changing its input', async () => {
  const fixture = behaviorCase('interrupted-investment'), before = structuredClone(fixture.world);
  const continued = await runBehaviorCase(fixture, planner(() => ({ mode: 'continue' })));
  assert.deepEqual(fixture.world, before);
  assert.equal(continued.lostInvestedTicks, 0);
  assert.equal(continued.built, 1);
  assert.equal(continued.baked, 2);
  const replaced = await runBehaviorCase(fixture, planner(context => ({
    tasks: [{ type: 'build', building: 'bakery', x: context.citizen.x, y: context.citizen.y }, { type: 'bake', target: 'own', amount: 2 }], work: null,
  })));
  assert.ok(replaced.lostInvestedTicks > 0);
  assert.ok(replaced.firstBuildTick > continued.firstBuildTick);
});

test('benchmark does not confuse respecting pending consent with failing to progress', async () => {
  const result = await runBehaviorCase(behaviorCase('pending-consent'), planner(() => ({ mode: 'continue' })));
  assert.equal(result.unauthorizedReproductionChoices, 0);
  assert.equal(result.finalWorld.stats.births, 0);
  assert.equal(result.finalWorld.familyProposals[0].status, 'pending');
});
