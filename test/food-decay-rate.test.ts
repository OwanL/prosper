import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/world/config.ts';
import { createWorld, tickWorld } from '../src/world/core.ts';

describe('food decay rate', () => {
  it('drains fullness at exactly half the previous rate without affecting health', () => {
    const world = createWorld({ seed: 42 });
    const citizen = Object.values(world.citizens)[0]!;
    citizen.inventory = {};
    citizen.fullness = BALANCE.maxFullness;
    const ticks = 200;

    tickWorld(world, ticks);

    expect(BALANCE.fullnessDrain).toBe(0.05);
    expect(citizen.fullness).toBeCloseTo(BALANCE.maxFullness - ticks * 0.05, 10);
    expect(citizen.health).toBe(BALANCE.maxHealth);
    expect(citizen.action).toBeNull();
    expect(citizen.queue).toEqual([]);
    expect(citizen.inventory).toEqual({});
  });
});
