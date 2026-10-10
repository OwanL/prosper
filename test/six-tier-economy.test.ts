import { describe, expect, it } from 'vitest';
import { MAX_TIER, RING_COUNT } from '../src/shared/tiers.ts';
import { TIERS, type Building, type Tier } from '../src/shared/types.ts';
import { BALANCE, BUILDINGS, EQUIPMENT, RESOURCES, buildingRecipe, canRefine, equipmentRecipe, nutrition, refinementOutput, refinementRecipe } from '../src/world/config.ts';
import { cancelAction, createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { settleDeath } from '../src/world/life.ts';
import { conditionMet } from '../src/world/plans.ts';

function fixture(tier: Tier = 6) {
  const world = createWorld({ scenario: 'progression', seed: 42 });
  world.deposits = {};
  const [citizen, other] = Object.values(world.citizens);
  citizen.x = 1;
  citizen.y = 1;
  citizen.inventory = {};
  const station: Building = { id: 'station', kind: 'lumbermill', tier, x: 1, y: 1, ownerId: citizen.id, health: 700, maxHealth: 700, materials: buildingRecipe('lumbermill', tier) };
  world.buildings[station.id] = station;
  return { world, citizen, other, station };
}

describe('six-tier economy', () => {
  it('defaults to twenty founders and generates every resource at every base ring tier', () => {
    for (const seed of [1, 42, 927]) for (const scenario of ['village', 'competition', 'progression']) {
      const world = createWorld({ seed, scenario });
      if (scenario === 'village') expect(Object.keys(world.citizens)).toHaveLength(20);
      for (const resource of RESOURCES) for (const tier of TIERS.filter((tier) => tier <= RING_COUNT))
        expect(Object.values(world.deposits).some((d) => d.resource === resource && d.tier === tier)).toBe(true);
    }
  });

  it('charges exponential same-tier equipment and construction ingredients', () => {
    for (const tier of TIERS) {
      for (const kind of EQUIPMENT) {
        const base = equipmentRecipe(kind, 1);
        for (const [key, amount] of Object.entries(equipmentRecipe(kind, tier))) {
          expect(key.endsWith(`:${tier}`)).toBe(true);
          expect(amount).toBe(base[key.replace(/:\d$/, ':1')] * 2 ** (tier - 1));
        }
      }
      for (const kind of BUILDINGS) {
        const base = buildingRecipe(kind, 1);
        for (const [key, amount] of Object.entries(buildingRecipe(kind, tier)))
          expect(amount).toBe(base[key.replace(/:\d$/, ':1')] * 2 ** (tier - 1));
      }
      expect(nutrition(tier)).toBe(tier === 1 ? 100 / 9 : tier === 2 ? 100 / 3 : 100);
      expect(BALANCE.buildingHealth[tier]).toBeGreaterThan(0);
      expect(BALANCE.refineTicks[tier]).toBeGreaterThan(0);
    }
  });

  it('validates all adjacent station boundaries', () => {
    for (const station of TIERS) for (const from of TIERS) {
      expect(canRefine(station, from)).toBe(from < MAX_TIER && from <= station);
      expect(canRefine(station, from, 'down')).toBe(from > 1 && from - 1 <= station);
    }
  });

  it.each(TIERS.filter((tier) => tier < MAX_TIER))('upconverts T%i and downconverts without unit arbitrage', (fromTier) => {
    const { world, citizen, station } = fixture(fromTier);
    citizen.inventory = refinementRecipe('wood', fromTier);
    expect(dispatch(world, citizen.id, { type: 'refine', buildingId: station.id, fromTier }).ok).toBe(true);
    expect(citizen.action?.reserved).toEqual(refinementRecipe('wood', fromTier));
    tickWorld(world, 20);
    expect(citizen.inventory).toEqual(refinementOutput('wood', fromTier));
    const higher = (fromTier + 1) as Tier;
    expect(dispatch(world, citizen.id, { type: 'refine', buildingId: station.id, fromTier: higher, direction: 'down' }).ok).toBe(true);
    tickWorld(world, 20);
    expect(citizen.inventory).toEqual({ [`wood:${fromTier}`]: 2 });
  });

  it.each(['up', 'down'] as const)('refunds exact %s inputs once on cancellation, station loss, and death', (direction) => {
    for (const reason of ['cancel', 'destroy', 'owner', 'death']) {
      const { world, citizen, other, station } = fixture();
      const fromTier = direction === 'up' ? 5 : 6;
      const cost = refinementRecipe('wood', fromTier, direction);
      citizen.inventory = { ...cost };
      expect(dispatch(world, citizen.id, { type: 'refine', buildingId: station.id, fromTier, direction }).ok).toBe(true);
      if (reason === 'cancel') { cancelAction(world, citizen.id); cancelAction(world, citizen.id); }
      if (reason === 'destroy') { delete world.buildings[station.id]; tickWorld(world); }
      if (reason === 'owner') { station.ownerId = other.id; tickWorld(world); }
      if (reason === 'death') {
        settleDeath(world, citizen.id);
        expect(Object.values(world.loot)[0].inventory).toEqual(cost);
        settleDeath(world, citizen.id);
        expect(Object.values(world.loot)).toHaveLength(1);
      } else expect(citizen.inventory).toEqual(cost);
      expect(citizen.action).toBeNull();
    }
  });

  it('enforces T6 harvesting tools and automatic use after crafting', () => {
    const { world, citizen } = fixture();
    world.deposits.high = { id: 'high', x: 1, y: 1, resource: 'wood', tier: 6, stock: 1, capacity: 1, regrowAt: 0 };
    expect(dispatch(world, citizen.id, { type: 'harvest', depositId: 'high' }).code).toBe('tool-required');
    citizen.inventory = equipmentRecipe('axe', 6);
    expect(dispatch(world, citizen.id, { type: 'craft', item: 'axe', tier: 6 }).ok).toBe(true);
    tickWorld(world, 8);
    expect(citizen.inventory['axe:6']).toBe(1);
    expect(dispatch(world, citizen.id, { type: 'harvest', depositId: 'high' }).ok).toBe(true);
    tickWorld(world, citizen.action!.duration);
    expect(citizen.inventory['wood:6']).toBe(1);
  });

  it('trades T6 food remotely, includes it in runway and eats with fullness capped', () => {
    const { world, citizen, other } = fixture();
    other.inventory = { 'food:6': 1 };
    citizen.fullness = 0;
    expect(dispatch(world, other.id, { type: 'order', side: 'sell', item: 'food:6', quantity: 1, price: 7 }).ok).toBe(true);
    expect(dispatch(world, citizen.id, { type: 'order', side: 'buy', item: 'food:6', quantity: 1, price: 7 }).ok).toBe(true);
    expect(citizen.inventory['food:6']).toBe(1);
    expect(conditionMet(citizen, { kind: 'food-runway-below', ticks: 999 })).toBe(false);
    tickWorld(world);
    expect(citizen.fullness).toBe(100);
    expect(citizen.inventory['food:6']).toBeUndefined();
    expect(citizen.gold + other.gold).toBe(200);
  });
});
