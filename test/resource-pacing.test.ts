import { describe, expect, it } from 'vitest';
import { MAX_TIER, RING_COUNT, TIERS } from '../src/shared/tiers.ts';
import { distance, ringAt } from '../src/shared/utils.ts';
import { BALANCE, harvestDuration, nutrition } from '../src/world/config.ts';
import { cancelAction, createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { enableAutonomy } from '../src/world/autonomy.ts';
import { updateKnowledge } from '../src/world/observation.ts';

describe('resource pacing and viable sparse habitat', () => {
  it('keeps every legal harvest substantial while rewarding matching tools', () => {
    for (const tier of TIERS) {
      expect(harvestDuration(tier, tier - 1)).toBe(40);
      expect(harvestDuration(tier, tier)).toBe(20);
      expect(harvestDuration(tier, MAX_TIER)).toBeGreaterThanOrEqual(12);
    }
    expect(harvestDuration(1, MAX_TIER)).toBe(12);
    expect(harvestDuration(1, 0) * BALANCE.fullnessDrain).toBeLessThan(nutrition(1));
  });

  it('reserves stock throughout long work and releases it without producing on cancellation', () => {
    const world = createWorld({ seed: 7 });
    const [citizen, other] = Object.values(world.citizens);
    const deposit = Object.values(world.deposits).find((entry) => entry.tier === 1 && entry.resource === 'wood')!;
    citizen.x = other.x = deposit.x;
    citizen.y = other.y = deposit.y;
    expect(dispatch(world, citizen.id, { type: 'harvest', depositId: deposit.id }).ok).toBe(true);
    tickWorld(world, 30);
    expect(deposit.stock).toBe(1);
    expect(citizen.inventory['wood:1']).toBeUndefined();
    expect(dispatch(world, other.id, { type: 'harvest', depositId: deposit.id }).code).toBe('depleted-deposit');
    cancelAction(world, citizen.id);
    expect(dispatch(world, other.id, { type: 'harvest', depositId: deposit.id }).ok).toBe(true);
    tickWorld(world, 40);
    expect(other.inventory['wood:1']).toBe(1);
    expect(deposit.stock).toBe(0);
  });

  it('creates deterministic sparse patches and nearby forage across both non-food sectors', () => {
    for (const population of [20, 100]) for (const seed of [1, 7, 42, 927]) {
      const world = createWorld({ seed, population });
      const deposits = Object.values(world.deposits);
      expect(deposits.length / (world.width * world.height)).toBeLessThan(.15);
      expect(new Set(deposits.map((deposit) => `${deposit.x},${deposit.y}`)).size).toBe(deposits.length);
      expect(deposits.every((deposit) => Number.isInteger(deposit.x) && Number.isInteger(deposit.y) &&
        deposit.x >= 0 && deposit.y >= 0 && deposit.x < world.width && deposit.y < world.height)).toBe(true);
      const food = deposits.filter((deposit) => deposit.resource === 'food' && deposit.tier === 1);
      expect(food.length).toBeGreaterThanOrEqual(population * 2);
      for (const citizen of Object.values(world.citizens))
        expect(food.filter((plant) => distance(citizen, plant) <= BALANCE.sightRadius).length).toBeGreaterThanOrEqual(2);
      for (const resource of ['wood', 'fibre']) {
        const sector = deposits.filter((deposit) => deposit.resource === resource && deposit.tier === 1);
        expect(sector.some((deposit) => food.some((plant) => distance(deposit, plant) <= 2))).toBe(true);
      }
      expect(deposits.filter((deposit) => ringAt(world, deposit) === RING_COUNT - 1 && deposit.resource === 'food').length)
        .toBeGreaterThanOrEqual(Math.ceil(2.4 * RING_COUNT * Math.max(1, population / 20)));
      expect(world.deposits).toEqual(createWorld({ seed, population }).deposits);
    }
  });

  it('waits for observed nearby regrowth and eats instead of wandering away hungry', () => {
    const world = createWorld({ seed: 7, population: 1 });
    const citizen = Object.values(world.citizens)[0];
    citizen.x = citizen.y = 4;
    citizen.fullness = 1;
    citizen.inventory = {};
    citizen.knowledge = {};
    world.deposits = { plant: { id: 'plant', x: 4, y: 5, resource: 'food', tier: 1,
      stock: 0, capacity: 1, regrowAt: 20 } };
    enableAutonomy(world, citizen, { reproduction: 'avoid' });
    updateKnowledge(world);
    tickWorld(world, 2);
    expect(citizen.action).toBeNull();
    expect(citizen.autonomy!.intent).toBe('Wait for nearby food regrowth');
    for (let i = 0; i < 70; i++) { tickWorld(world); updateKnowledge(world); }
    expect(citizen.alive).toBe(true);
    expect(citizen.fullness).toBeGreaterThan(0);
    expect(world.events.some((entry) => entry.kind === 'meal' && entry.citizenId === citizen.id)).toBe(true);
  });

  it('uses public food claims as exploration destinations without requiring hidden deposits', () => {
    const world = createWorld({ seed: 7, population: 2 });
    const [citizen, owner] = Object.values(world.citizens);
    citizen.x = citizen.y = 4;
    citizen.fullness = 10;
    citizen.inventory = {};
    citizen.knowledge = {};
    world.deposits = {};
    world.claims = { advertised: { id: 'advertised', ownerId: owner.id, areas: [12, 3, 14, 5],
      resource: 'food', createdTick: 0, expiresTick: 1000, accessPrice: 0, stance: 'open' } };
    enableAutonomy(world, citizen, { reproduction: 'avoid' });
    updateKnowledge(world);
    tickWorld(world, 2);
    expect(citizen.action?.command).toEqual({ type: 'move', x: 13, y: 4 });
    expect(citizen.autonomy!.intent).toBe('Seek publicly advertised food grounds');
    expect(Object.keys(world.deposits)).toHaveLength(0);
  });
});
