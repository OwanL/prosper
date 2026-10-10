import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { advanceAutonomy, enableAutonomy, setAutonomyPolicy } from '../src/world/autonomy.ts';
import { updateKnowledge } from '../src/world/observation.ts';
import { findPath } from '../src/world/pathfinding.ts';
import { strategicReviewReason } from '../src/citizen/strategic-review.ts';

describe('overnight review: hard no-go semantics', () => {
  it('lets a citizen escape a newly forbidden area, then keeps the route outside it', () => {
    const world = createWorld({ seed: 41, population: 2 });
    const citizen = Object.values(world.citizens)[0];
    citizen.x = 5;
    citizen.y = 5;
    enableAutonomy(world, citizen, { noGo: [[3, 3, 8, 8]] });

    const path = findPath(world, citizen, { x: 12, y: 5 });

    expect(path).not.toBeNull();
    expect(path!.at(-1)).toEqual({ x: 12, y: 5 });
    const firstSafe = path!.findIndex((point) => point.x < 3 || point.x > 8 || point.y < 3 || point.y > 8);
    expect(firstSafe).toBeGreaterThanOrEqual(0);
    expect(path!.slice(firstSafe).every((point) => point.x < 3 || point.x > 8 || point.y < 3 || point.y > 8)).toBe(true);
    expect(path!.filter((point) => point.x >= 3 && point.x <= 8 && point.y >= 3 && point.y <= 8).length).toBeLessThan(12);
  });

  it('cancels only the route or work site made forbidden by a policy update', () => {
    const world = createWorld({ seed: 43, population: 2 });
    const [citizen, other] = Object.values(world.citizens);
    citizen.x = other.x = 4;
    citizen.y = other.y = 4;
    enableAutonomy(world, citizen, { noGo: [] });
    enableAutonomy(world, other, { noGo: [] });
    expect(dispatch(world, citizen.id, { type: 'move', x: 10, y: 4 }).ok).toBe(true);
    expect(dispatch(world, other.id, { type: 'move', x: 10, y: 4 }).ok).toBe(true);
    expect(setAutonomyPolicy(world, citizen, { noGo: [[6, 3, 6, 5]] }).ok).toBe(true);

    expect(citizen.action).toBeFalsy();
    expect(citizen.lastResult).toContain('no-go policy');
    expect(other.action).toBeDefined();
    tickWorld(world, 8);
    expect(citizen.x === 6 && citizen.y >= 3 && citizen.y <= 5).toBe(false);
  });

  it('cancels newly forbidden work and returns its reserved ingredients', () => {
    const world = createWorld({ seed: 45, population: 2 });
    const citizen = Object.values(world.citizens)[0];
    citizen.x = 4;
    citizen.y = 4;
    citizen.inventory = { 'food:1': 3, 'fibre:1': 3 };
    enableAutonomy(world, citizen, { noGo: [] });
    expect(dispatch(world, citizen.id, { type: 'craft', item: 'axe', tier: 1 }).ok).toBe(true);
    expect(citizen.inventory).toEqual({});

    expect(setAutonomyPolicy(world, citizen, { noGo: [[4, 4, 4, 4]] }).ok).toBe(true);

    expect(citizen.action).toBeFalsy();
    expect(citizen.inventory).toEqual({ 'food:1': 3, 'fibre:1': 3 });
  });

  it('surfaces blocked hunger for policy review without crossing the forbidden food boundary', () => {
    const world = createWorld({ seed: 47, population: 2 });
    world.deposits = {
      blocked_food: { id: 'blocked_food', x: 7, y: 4, resource: 'food', tier: 1, stock: 20, capacity: 20, regrowAt: 0 },
    };
    const citizen = Object.values(world.citizens)[0];
    citizen.x = 4;
    citizen.y = 4;
    citizen.fullness = 0;
    citizen.inventory = {};
    enableAutonomy(world, citizen, { noGo: [[6, 0, 9, 9]], reproduction: 'avoid' });
    updateKnowledge(world);

    for (let i = 0; i < 8; i++) {
      tickWorld(world);
      updateKnowledge(world);
    }

    expect(citizen.autonomy!.evidence.some((entry) => entry.kind === 'survival' && /blocked by no-go policy/i.test(entry.text))).toBe(true);
    expect(citizen.nextReviewTick).toBeLessThanOrEqual(world.tick + 1);
    expect(strategicReviewReason(citizen, world.tick)).toContain('survival blocked');
    expect(citizen.x).toBeLessThan(6);
    expect(citizen.action?.command.type === 'harvest' ? citizen.action.command.depositId : undefined).not.toBe('blocked_food');
  });
});
