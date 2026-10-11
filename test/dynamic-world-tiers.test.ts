import { describe, expect, it } from 'vitest';
import { MAX_TIER, TIERS } from '../src/shared/tiers.ts';
import { cancelAction, createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { enableAutonomy, foodRunway } from '../src/world/autonomy.ts';
import { beginEmergency } from '../src/world/emergency.ts';
import { approvePlan, conditionMet } from '../src/world/plans.ts';
import { updateKnowledge } from '../src/world/observation.ts';
import { BALANCE, nutrition } from '../src/world/config.ts';

function fixture(resource: 'wood' | 'food' = 'wood') {
  const world = createWorld({ seed: 42, population: 2 });
  const [citizen, other] = Object.values(world.citizens);
  citizen.x = 2;
  citizen.y = 2;
  citizen.inventory = {};
  citizen.knowledge = {};
  world.buildings = {};
  world.deposits = {
    high: { id: 'high', resource, tier: MAX_TIER, x: 2, y: 2, stock: 1, capacity: 1, regrowAt: 0 },
  };
  updateKnowledge(world);
  return { world, citizen, other };
}

const carryPrevious = (citizen: ReturnType<typeof fixture>['citizen'], tool: 'axe' | 'knife') => {
  const item = `${tool}:${MAX_TIER - 1}`;
  citizen.inventory[item] = 1;
};

describe('dynamic world tier consumers', () => {
  it('includes T7 and defaults autonomous progression to the configured maximum', () => {
    expect(TIERS).toContain(7);
    const { world, citizen } = fixture();
    enableAutonomy(world, citizen);
    expect(citizen.autonomy!.policy.targetTier).toBe(MAX_TIER);
    citizen.inventory['food:7'] = 2;
    const ticks = (citizen.fullness + 2 * nutrition(7)) / BALANCE.fullnessDrain;
    expect(foodRunway(citizen)).toBe(ticks);
    expect(conditionMet(citizen, { kind: 'food-runway-below', ticks: ticks - 1 })).toBe(false);
    expect(conditionMet(citizen, { kind: 'food-runway-below', ticks: ticks + 1 })).toBe(true);
  });

  it('settles T7 resources and equipment while rejecting tiers outside the configuration', () => {
    for (const item of ['wood:7', 'sword:7']) {
      const { world, citizen, other } = fixture();
      citizen.inventory[item] = 2;
      expect(dispatch(world, citizen.id, { type: 'order', side: 'sell', item, quantity: 2, price: 4 }).ok).toBe(true);
      const result = dispatch(world, other.id, { type: 'order', side: 'buy', item, quantity: 2, price: 5 });
      expect(result.order?.filledQuantity).toBe(2);
      expect(other.inventory[item]).toBe(2);
      expect(citizen.gold).toBe(108);
      expect(other.gold).toBe(92);
      expect(Object.keys(world.orders)).toHaveLength(0);
      for (const invalid of ['wood:0', `wood:${MAX_TIER + 1}`, 'wood:07', 'stone:7']) {
        expect(dispatch(world, other.id, { type: 'order', side: 'buy', item: invalid, quantity: 1, price: 1 }).code).toBe('invalid-item');
      }
    }
  });

  it('harvests the highest tier with the previous-tier tool and rejects an insufficient tool', () => {
    const { world, citizen } = fixture();
    expect(dispatch(world, citizen.id, { type: 'harvest', depositId: 'high' }).code).toBe('tool-required');
    carryPrevious(citizen, 'axe');
    expect(dispatch(world, citizen.id, { type: 'harvest', depositId: 'high' }).ok).toBe(true);
    tickWorld(world, 70);
    expect(citizen.inventory[`wood:${MAX_TIER}`]).toBe(1);
  });

  it('approves and completes a highest-tier gathering plan without a six-tier ceiling', () => {
    const { world, citizen } = fixture();
    carryPrevious(citizen, 'axe');
    expect(approvePlan(world, citizen.id, {
      mode: 'replace',
      steps: [{ type: 'gather', resource: 'wood', tier: MAX_TIER, targetQuantity: 1, maxTicks: 100 }],
    }, { cancel: () => cancelAction(world, citizen.id) }).ok).toBe(true);
    tickWorld(world, 70);
    expect(citizen.inventory[`wood:${MAX_TIER}`]).toBe(1);
    expect(citizen.plan).toBeUndefined();
    expect(citizen.planReceipts?.at(-1)?.outcome).toBe('completed');
  });

  it('emergency feeding can select highest-tier known food using a previous-tier knife', () => {
    const { world, citizen } = fixture('food');
    citizen.fullness = 0;
    carryPrevious(citizen, 'knife');
    beginEmergency(world, citizen, { command: (command) => dispatch(world, citizen.id, command, 'directive') });
    expect(citizen.emergency?.depositId).toBe('high');
    expect(citizen.action?.command).toEqual({ type: 'harvest', depositId: 'high' });
    tickWorld(world, 70);
    expect(citizen.fullness).toBeGreaterThan(0);
    expect(citizen.emergency).toBeUndefined();
    expect(world.deposits.high.stock).toBe(0);
  });
});
