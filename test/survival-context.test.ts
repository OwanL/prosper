import { describe, expect, it } from 'vitest';
import { foodRunwayTicks, planningContext } from '../src/citizen/planning.ts';
import { freshContext } from '../src/citizen/prompt.ts';
import { createWorld, dispatch } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { BALANCE, nutrition } from '../src/world/config.ts';

function fixture() {
  const world = createWorld({ seed: 1 });
  const citizen = Object.values(world.citizens)[0];
  updateKnowledge(world);
  return { world, citizen };
}

describe('dated own-state survival context', () => {
  it('separates hunger onset from starvation at current, not maximum, health', () => {
    const { world, citizen } = fixture();
    world.tick = 2592;
    citizen.inventory = {};
    citizen.fullness = 2.2;
    citizen.health = 70.4;
    const food = planningContext(observe(world, citizen.id)).food;
    expect(food.snapshotTick).toBe(2592);
    expect(food.availableFoodRunwayTicks).toBe(22);
    expect(food.hungerOnsetTicks).toBe(22);
    expect(food.starvationDamagePerTick).toBe(BALANCE.starvationDamage);
    expect(food.starvationTicksAtCurrentHealth).toBeCloseTo(352);
    expect(food.approximateUnassistedDeathHorizonTicks).toBeCloseTo(374);
    citizen.fullness = 0;
    citizen.health = 39;
    const starving = planningContext(observe(world, citizen.id)).food;
    expect(starving.hungerOnsetTicks).toBe(0);
    expect(starving.approximateUnassistedDeathHorizonTicks).toBe(195);
  });

  it('counts only unreserved carried food, not work inputs or market escrow', () => {
    const { world, citizen } = fixture();
    citizen.fullness = 10;
    citizen.inventory = { 'food:1': 5, 'food:2': 2, 'food:3': 1, 'fibre:1': 3 };
    expect(
      dispatch(world, citizen.id, {
        type: 'order',
        side: 'sell',
        item: 'food:1',
        quantity: 2,
        price: 100,
      }).ok,
    ).toBe(true);
    expect(dispatch(world, citizen.id, { type: 'craft', item: 'axe', tier: 1 }).ok).toBe(true);
    expect(citizen.action?.reserved['food:1']).toBe(3);
    expect(citizen.inventory['food:1'] ?? 0).toBe(0);
    const runway = Math.floor((10 + 2 * nutrition(2) + nutrition(3)) / BALANCE.fullnessDrain);
    expect(foodRunwayTicks(citizen)).toBe(runway);
    const delivered = JSON.parse(freshContext(observe(world, citizen.id))[1].content!);
    expect(delivered.planning.food.hungerOnsetTicks).toBe(runway);
    expect(delivered.execution.action.reserved['food:1']).toBe(3);
    expect(delivered.ownState.inventory).toEqual(citizen.inventory);
  });

  it('delivers snapshot/inference caveats without predicting harvests or trades', () => {
    const { world, citizen } = fixture();
    citizen.inventory = {};
    citizen.fullness = 0;
    citizen.health = 20;
    const observation = observe(world, citizen.id);
    const before = structuredClone(observation);
    const context = JSON.parse(freshContext(observation)[1].content!);
    expect(context.planning.food.snapshotTick).toBe(context.currentWorld.tick);
    expect(context.planning.food.approximateUnassistedDeathHorizonTicks).toBe(100);
    for (const phrase of [
      'NOT death',
      'CURRENT health',
      'discrete meals/tick thresholds',
      'fed healing',
      'attacks can shorten',
      'market escrow are not edible',
      'Does not predict future harvests, trades or market fills',
      'continue during inference/reasoning',
    ])
      expect(context.planning.food.caveat).toContain(phrase);
    expect(observation).toEqual(before);
  });

  it('does not derive survival estimates or partner readiness from spectator state', () => {
    const { world, citizen } = fixture();
    const observation = observe(world, citizen.id);
    const before = planningContext(observation).food;
    for (const other of Object.values(world.citizens).filter((c) => c.id !== citizen.id)) {
      other.health = 1;
      other.fullness = 0;
      other.inventory = { 'food:3': 100 };
      other.reproductionCooldown = 9999;
    }
    // A fresh citizen observation still cannot expose those private changes.
    const refreshed = observe(world, citizen.id);
    expect(planningContext(refreshed).food).toEqual(before);
    const context = JSON.parse(freshContext(refreshed)[1].content!);
    expect(context.planning.reproduction).not.toHaveProperty('partnerReadiness');
    expect(context.planning.reproduction).not.toHaveProperty('partnerHealth');
    expect(context.planning.food).not.toHaveProperty('futureHarvests');
    expect(context.planning.food).not.toHaveProperty('futureTrades');
  });
});
