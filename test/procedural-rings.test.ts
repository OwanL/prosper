import { describe, expect, it } from 'vitest';
import { RING_COUNT, MAX_TIER, TIERS } from '../src/shared/tiers.ts';
import { ringAt, regionAt } from '../src/shared/utils.ts';
import { BALANCE, canRefine, equipmentRecipe, buildingRecipe, refinementOutput } from '../src/world/config.ts';
import { createWorld } from '../src/world/core.ts';

 describe('procedural resource bands', () => {
  it('derives band count, dimensions, tier ranges and balance tables from one setting', () => {
    const world = createWorld({ seed: 42 });
    expect(world.ringCount).toBe(RING_COUNT);
    expect(world.width).toBe(6 * RING_COUNT + 1);
    expect(TIERS).toEqual(Array.from({ length: RING_COUNT + 1 }, (_, i) => i + 1));
    for (const tier of TIERS) {
      expect(BALANCE.buildingHealth[tier]).toBe(10 * tier ** 2 + 50 * tier + 40);
      expect(BALANCE.attackDamage[tier]).toBe(6 * tier + 6);
      expect(BALANCE.refineTicks[tier]).toBeGreaterThan(0);
      expect(equipmentRecipe('axe', tier)).toEqual({ [`food:${tier}`]: 3 * 2 ** (tier - 1), [`fibre:${tier}`]: 3 * 2 ** (tier - 1) });
      expect(buildingRecipe('wall', tier)).toEqual({ [`wood:${tier}`]: 4 * 2 ** (tier - 1), [`fibre:${tier}`]: 2 * 2 ** (tier - 1) });
    }
    expect(canRefine(MAX_TIER - 1, MAX_TIER - 1)).toBe(true);
    expect(refinementOutput('wood', MAX_TIER - 1)).toEqual({ [`wood:${MAX_TIER}`]: 1 });
    expect(canRefine(MAX_TIER, MAX_TIER)).toBe(false);
  });

  it('places only base or rare next-tier deposits in every resource band, without clamping the center', () => {
    const totals = Array.from({ length: RING_COUNT }, () => ({ total: 0, rare: 0 }));
    for (let seed = 1; seed <= 50; seed++) {
      const world = createWorld({ seed });
      const deposits = Object.values(world.deposits);
      for (let ring = 0; ring < RING_COUNT; ring++) {
        for (const resource of ['food', 'wood', 'fibre']) {
          const group = deposits.filter((d) => ringAt(world, d) === ring && d.resource === resource);
          if (resource === 'food' && ring === RING_COUNT - 1)
            expect(group.length).toBeGreaterThanOrEqual(Math.ceil(2.4 * (ring + 1)));
          else expect(group).toHaveLength(Math.ceil(2.4 * (ring + 1)));
          const base = RING_COUNT - ring;
          expect(group.every((d) => d.tier === base || d.tier === base + 1)).toBe(true);
          totals[ring].total += group.length;
          totals[ring].rare += group.filter((d) => d.tier === base + 1).length;
        }
      }
      for (const citizen of Object.values(world.citizens)) {
        expect(ringAt(world, citizen)).toBe(RING_COUNT - 1);
        expect(deposits.some((d) => d.x === citizen.x && d.y === citizen.y && d.tier === 1)).toBe(true);
      }
    }
    for (const band of totals) {
      expect(band.rare / band.total).toBeGreaterThan(0.01);
      expect(band.rare / band.total).toBeLessThan(0.09);
    }
    expect(totals[0].rare).toBeGreaterThan(0); // Actual unclamped rare center deposits.
  });

  it('retains historical geometry when a save has no ring metadata', () => {
    const layout = { width: 21, height: 21 };
    expect(regionAt(layout, { x: 10, y: 10 })).toBe('center');
    expect(regionAt(layout, { x: 5, y: 10 })).toBe('ring1');
    expect(regionAt(layout, { x: 0, y: 10 })).toBe('ring2');
    expect(ringAt(layout, { x: 0, y: 10 })).toBe(2);
  });
});
