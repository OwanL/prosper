import { describe, expect, it } from 'vitest';
import { cancelAction, createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { beginEmergency } from '../src/world/emergency.ts';
import { settleDeath } from '../src/world/life.ts';
import { updateKnowledge } from '../src/world/observation.ts';
import { id } from '../src/shared/utils.ts';
import { BALANCE } from '../src/world/config.ts';

function fixture() {
  const world = createWorld();
  const citizen = Object.values(world.citizens)[0];
  citizen.x = 2;
  citizen.y = 2;
  citizen.inventory = {};
  citizen.fullness = 0;
  world.deposits = {
    food: { id: 'food', resource: 'food', tier: 1, x: 3, y: 2, stock: 1, capacity: 1, regrowAt: 0 },
    wood: { id: 'wood', resource: 'wood', tier: 1, x: 2, y: 2, stock: 1, capacity: 1, regrowAt: 0 },
  };
  updateKnowledge(world);
  return { world, citizen };
}

function emergencyTripDeadline(world: ReturnType<typeof createWorld>, citizen: (typeof world.citizens)[string]) {
  const food = world.deposits.food;
  const start = citizen.emergency?.suspendedPosition ?? { x: citizen.x, y: citizen.y };
  const travelSteps =
    Math.abs(citizen.x - food.x) +
    Math.abs(citizen.y - food.y) +
    Math.abs(food.x - start.x) +
    Math.abs(food.y - start.y);
  return BALANCE.harvestTicks + travelSteps * BALANCE.moveTicks + 1;
}

describe('starvation-only emergency feeding', () => {
  it('does nothing when hungry but not starving, or when food is not known nearby', () => {
    const { world, citizen } = fixture();
    citizen.fullness = 5;
    tickWorld(world, 2);
    expect(citizen.emergency).toBeUndefined();
    expect(citizen.action).toBeNull();
    citizen.fullness = 0;
    citizen.knowledge = {};
    tickWorld(world);
    expect(citizen.emergency).toBeUndefined();
    expect(citizen.action).toBeNull();
    updateKnowledge(world);
    world.deposits.food.x = 20;
    citizen.knowledge = {};
    updateKnowledge(world);
    tickWorld(world);
    expect(citizen.emergency).toBeUndefined();
  });

  it('takes exactly one known food outside work areas, consumes it, and restores exact parked work', () => {
    const { world, citizen } = fixture();
    citizen.fullness = 50;
    citizen.inventory = { 'wood:1': 3, 'fibre:1': 3 };
    dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 1 });
    tickWorld(world, 2);
    const original = structuredClone(citizen.action!);
    citizen.strategy = {
      id: id(world, 'strategy'),
      approvedTick: world.tick,
      directives: [{ type: 'craft', item: 'knife', tier: 1, areas: [[2, 2, 2, 2]] }],
      index: 0,
      status: 'active',
      reviewTick: 600,
      progress: 0,
      lastProgressTick: world.tick,
      attempted: [],
      pending: { actionId: original.id, purpose: 'work' },
    };
    citizen.fullness = 0;
    citizen.queue = [{ type: 'move', x: 8, y: 8 }];
    tickWorld(world);
    expect(citizen.emergency?.outsideAreas).toBe(true);
    expect(citizen.emergency?.suspendedAction).toEqual(original);
    expect(citizen.inventory['wood:1'] ?? 0).toBe(0);
    expect(citizen.strategy.pending?.result).toBeUndefined();
    for (let n = 0; n < emergencyTripDeadline(world, citizen) && citizen.emergency; n++) tickWorld(world);
    expect(citizen.emergency).toBeUndefined();
    expect(citizen.action).toEqual(original);
    expect(citizen.queue).toHaveLength(1);
    expect(citizen.strategy.pending?.result).toBeUndefined();
    expect(citizen.fullness).toBeGreaterThan(0);
    expect(citizen.inventory['food:1'] ?? 0).toBe(0);
    expect(world.deposits.food.stock).toBe(0);
    expect(
      world.events.filter((e) => e.kind === 'meal' && e.citizenId === citizen.id),
    ).toHaveLength(1);
    expect(
      world.events
        .filter((e) => e.kind === 'emergency' && e.citizenId === citizen.id)
        .map((e) => e.text),
    ).toEqual([
      expect.stringContaining('starving'),
      expect.stringContaining('meal eaten'),
      expect.stringContaining('resumed'),
    ]);
    expect(citizen.memories.every((m) => m.text.length < 600)).toBe(true);
  });

  it('reports blocked resumption and refunds parked inputs when its original position is walled off', () => {
    const { world, citizen } = fixture();
    citizen.x = 2;
    citizen.y = 3;
    citizen.fullness = 50;
    citizen.inventory = { 'wood:1': 3, 'fibre:1': 3 };
    dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 1 });
    citizen.strategy = {
      id: id(world, 'strategy'),
      approvedTick: world.tick,
      directives: [{ type: 'craft', item: 'knife', tier: 1, areas: [[2, 3, 2, 3]] }],
      index: 0,
      status: 'active',
      reviewTick: 600,
      progress: 0,
      lastProgressTick: world.tick,
      attempted: [],
      pending: { actionId: citizen.action!.id, purpose: 'work' },
    };
    citizen.fullness = 0;
    tickWorld(world, 2);
    expect(citizen.emergency).toBeDefined();
    expect({ x: citizen.x, y: citizen.y }).not.toEqual({ x: 2, y: 3 });
    const buildingId = id(world, 'building');
    world.buildings[buildingId] = {
      id: buildingId,
      kind: 'wall',
      tier: 1,
      x: 2,
      y: 3,
      ownerId: null,
      health: 100,
      maxHealth: 100,
      materials: { 'wood:1': 3 },
    };
    for (let n = 0; n < emergencyTripDeadline(world, citizen) && citizen.emergency; n++) tickWorld(world);
    expect(citizen.action).toBeNull();
    expect(citizen.inventory['wood:1']).toBe(3);
    expect(citizen.inventory['fibre:1']).toBe(3);
    expect(citizen.strategy.pending?.result?.ok).toBe(false);
    tickWorld(world);
    expect(citizen.strategy.status).toBe('blocked');
    expect(citizen.directiveReceipts?.at(-1)?.outcome).toBe('blocked');
    expect(citizen.memories.at(-1)?.text).toContain('Cannot resume');
  });

  it('preserves emergency on rejected replacement and refunds once on accepted replacement', () => {
    const { world, citizen } = fixture();
    citizen.inventory = { 'wood:1': 3, 'fibre:1': 3 };
    dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 1 });
    tickWorld(world);
    const before = structuredClone(citizen.emergency);
    expect(dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 3 }).ok).toBe(false);
    expect(citizen.emergency).toEqual(before);
    expect(dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 1 }).ok).toBe(true);
    expect(citizen.emergency).toBeUndefined();
    expect(citizen.action?.reserved).toEqual({ 'wood:1': 3, 'fibre:1': 3 });
    cancelAction(world, citizen.id);
    expect(citizen.inventory).toEqual({ 'wood:1': 3, 'fibre:1': 3 });
  });

  it('preserves a partially elapsed travel segment and path through the detour', () => {
    const { world, citizen } = fixture();
    citizen.fullness = 50;
    dispatch(world, citizen.id, { type: 'move', x: 2, y: 6 });
    tickWorld(world);
    const original = structuredClone(citizen.action!);
    expect(original.elapsed).toBe(1);
    citizen.fullness = 0;
    tickWorld(world);
    for (let n = 0; n < emergencyTripDeadline(world, citizen) && citizen.emergency; n++) tickWorld(world);
    expect(citizen.action).toEqual(original);
    expect({ x: citizen.x, y: citizen.y }).toEqual({ x: 2, y: 2 });
  });

  it.each(['cancel', 'death'] as const)('refunds parked inputs once on %s', (how) => {
    const { world, citizen } = fixture();
    citizen.inventory = { 'wood:1': 3, 'fibre:1': 3 };
    dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 1 });
    tickWorld(world);
    expect(citizen.emergency?.suspendedAction?.reserved).toEqual({ 'wood:1': 3, 'fibre:1': 3 });
    if (how === 'cancel') {
      dispatch(world, citizen.id, { type: 'cancel' });
      cancelAction(world, citizen.id);
      expect(citizen.inventory).toEqual({ 'wood:1': 3, 'fibre:1': 3 });
    } else {
      settleDeath(world, citizen.id);
      settleDeath(world, citizen.id);
      const body = Object.values(world.loot).find((l) => l.citizenName === citizen.name)!;
      expect(body.inventory).toEqual({ 'wood:1': 3, 'fibre:1': 3 });
    }
    expect(citizen.emergency).toBeUndefined();
    expect(citizen.strategy).toBeUndefined();
  });

  it('keeps parked harvest and construction claims unavailable to competitors', () => {
    const { world, citizen } = fixture();
    citizen.fullness = 50;
    dispatch(world, citizen.id, { type: 'harvest', depositId: 'wood' });
    citizen.fullness = 0;
    tickWorld(world);
    expect(citizen.emergency?.suspendedAction?.command.type).toBe('harvest');
    const other = Object.values(world.citizens)[1];
    other.x = 2;
    other.y = 2;
    expect(dispatch(world, other.id, { type: 'harvest', depositId: 'wood' }).code).toBe(
      'depleted-deposit',
    );
    cancelAction(world, citizen.id);
    citizen.fullness = 50;
    citizen.inventory = { 'wood:1': 30, 'fibre:1': 30, 'food:1': 30 };
    expect(
      dispatch(world, citizen.id, { type: 'build', kind: 'lumbermill', tier: 1, x: 2, y: 3 }).ok,
    ).toBe(true);
    citizen.inventory = {};
    citizen.fullness = 0;
    tickWorld(world);
    expect(citizen.emergency?.suspendedAction?.command.type).toBe('build');
    other.inventory = { 'wood:1': 30, 'fibre:1': 30 };
    expect(
      dispatch(world, other.id, { type: 'build', kind: 'lumbermill', tier: 1, x: 2, y: 3 }).code,
    ).toBe('reserved-site');
  });

  it('does not interrupt imminent food refining and eats its one output once', () => {
    const { world, citizen } = fixture();
    delete world.deposits.wood;
    const buildingId = id(world, 'building');
    world.buildings[buildingId] = {
      id: buildingId,
      kind: 'butchery',
      tier: 1,
      x: 2,
      y: 2,
      ownerId: citizen.id,
      health: 100,
      maxHealth: 100,
      materials: {},
    };
    citizen.inventory = { 'food:1': 3 };
    citizen.fullness = 50;
    dispatch(world, citizen.id, { type: 'refine', buildingId, fromTier: 1 });
    tickWorld(world, 2);
    const actionId = citizen.action!.id;
    citizen.fullness = 0;
    tickWorld(world);
    expect(citizen.action!.id).toBe(actionId);
    expect(citizen.emergency).toBeUndefined();
    tickWorld(world, 6);
    expect(citizen.fullness).toBeGreaterThan(0);
    expect(citizen.inventory['food:2'] ?? 0).toBe(0);
    expect(world.deposits.food.stock).toBe(1);
    expect(
      world.events.filter((e) => e.kind === 'meal' && e.citizenId === citizen.id),
    ).toHaveLength(1);
  });

  it('does not pause one parent of joint reproduction', () => {
    const { world, citizen } = fixture();
    const partner = Object.values(world.citizens)[1];
    partner.x = 2;
    partner.y = 2;
    citizen.inventory = { 'food:2': 3 };
    partner.inventory = { 'food:2': 3 };
    dispatch(world, citizen.id, { type: 'consent', partnerId: partner.id, accept: true });
    dispatch(world, partner.id, { type: 'consent', partnerId: citizen.id, accept: true });
    expect(dispatch(world, citizen.id, { type: 'reproduce', partnerId: partner.id }).ok).toBe(true);
    citizen.inventory = {};
    partner.inventory = {};
    tickWorld(world);
    expect(citizen.emergency).toBeUndefined();
    expect(partner.emergency).toBeUndefined();
    expect(citizen.action?.elapsed).toBe(partner.action?.elapsed);
  });

  it('leaves viable food harvest alone and does not probe unknown hidden food', () => {
    const { world, citizen } = fixture();
    dispatch(world, citizen.id, { type: 'harvest', depositId: 'food' });
    const originalId = citizen.action!.id;
    tickWorld(world);
    expect(citizen.action!.id).toBe(originalId);
    expect(citizen.emergency).toBeUndefined();
    cancelAction(world, citizen.id);
    citizen.knowledge = {};
    const inaccessible = new Proxy(world.deposits.food, {
      get() {
        throw new Error('hidden food was probed');
      },
    });
    // Tick regrowth legitimately iterates deposits, so call emergency selection directly below.
    world.deposits.food = inaccessible;
    expect(() =>
      beginEmergency(world, citizen, {
        command: () => {
          throw new Error('unexpected command');
        },
      }),
    ).not.toThrow();
    expect(citizen.emergency).toBeUndefined();
  });
});
