import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { updateKnowledge } from '../src/world/observation.ts';
import { id } from '../src/shared/utils.ts';
import { validateCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import { BALANCE } from '../src/world/config.ts';

function fixture(): Checkpoint {
  const world = createWorld();
  const c = Object.values(world.citizens)[0];
  c.x = 2;
  c.y = 2;
  c.fullness = 50;
  c.inventory = { 'wood:1': 3, 'fibre:1': 3 };
  world.deposits = {
    food: { id: 'food', x: 3, y: 2, resource: 'food', tier: 1, stock: 1, capacity: 1, regrowAt: 0 },
  };
  updateKnowledge(world);
  dispatch(world, c.id, { type: 'craft', item: 'knife', tier: 1 });
  tickWorld(world);
  c.strategy = {
    id: id(world, 'strategy'),
    approvedTick: world.tick,
    directives: [{ type: 'craft', item: 'knife', tier: 1, areas: [[2, 2, 2, 2]] }],
    index: 0,
    status: 'active',
    reviewTick: 600,
    progress: 0,
    lastProgressTick: world.tick,
    attempted: [],
    pending: { actionId: c.action!.id, purpose: 'work' },
  };
  c.directiveReceipts = [
    {
      tick: world.tick,
      strategyId: c.strategy.id,
      index: 0,
      outcome: 'accepted',
      message: 'Accepted.',
    },
  ];
  c.fullness = 0;
  tickWorld(world);
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    world,
    runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] },
  };
}

function emergencyTripDeadline(world: Checkpoint['world'], citizen: Checkpoint['world']['citizens'][string]) {
  const food = world.deposits.food;
  const start = citizen.emergency?.suspendedPosition ?? { x: citizen.x, y: citizen.y };
  const travelSteps =
    Math.abs(citizen.x - food.x) +
    Math.abs(citizen.y - food.y) +
    Math.abs(food.x - start.x) +
    Math.abs(food.y - start.y);
  return BALANCE.harvestTicks + travelSteps * BALANCE.moveTicks + 1;
}

describe('directive and emergency checkpoint invariants', () => {
  it('round-trips strategy and active emergency with parked action identity and held inputs', () => {
    const cp = fixture();
    const citizen = Object.values(cp.world.citizens)[0];
    const before = structuredClone(citizen.emergency!.suspendedAction!);
    const restored = validateCheckpoint(JSON.parse(JSON.stringify(cp)));
    const c = restored.world.citizens[citizen.id];
    expect(c.strategy).toEqual(citizen.strategy);
    expect(c.emergency).toEqual(citizen.emergency);
    expect(c.emergency!.suspendedAction!.reserved).toEqual({ 'wood:1': 3, 'fibre:1': 3 });
    for (let n = 0; n < emergencyTripDeadline(restored.world, c) && c.emergency; n++)
      tickWorld(restored.world);
    expect(c.action).toEqual(before);
    expect(c.strategy!.pending!.result).toBeUndefined();
    tickWorld(restored.world, before.duration - before.elapsed);
    expect(c.inventory['knife:1']).toBe(1);
    expect(c.inventory['food:1'] ?? 0).toBe(0);
    expect(c.inventory['wood:1'] ?? 0).toBe(0);
  });

  it('persists the return stage and permits an explicitly empty completed strategy', () => {
    const cp = fixture();
    const c = Object.values(cp.world.citizens)[0];
    while (c.emergency?.stage === 'gather') tickWorld(cp.world);
    expect(c.emergency?.stage).toBe('return');
    expect(c.emergency?.outcome).toBe('meal eaten');
    const restored = validateCheckpoint(JSON.parse(JSON.stringify(cp)));
    expect(restored.world.citizens[c.id].emergency).toEqual(c.emergency);
    while (c.emergency) tickWorld(cp.world);
    c.strategy = {
      id: id(cp.world, 'strategy'),
      approvedTick: cp.world.tick,
      directives: [],
      index: 0,
      status: 'completed',
      reviewTick: cp.world.tick + 600,
      progress: 0,
      lastProgressTick: cp.world.tick,
      attempted: [],
    };
    expect(() => validateCheckpoint(cp)).not.toThrow();
  });

  it('accepts older checkpoints with no strategy/emergency fields', () => {
    const cp = fixture();
    const c = Object.values(cp.world.citizens)[0];
    // Model an old world with just its ordinary active action.
    c.action = c.emergency!.suspendedAction!;
    delete c.emergency;
    delete c.strategy;
    delete c.directiveReceipts;
    expect(() => validateCheckpoint(cp)).not.toThrow();
  });

  it('rejects corrupted strategy, pending IDs, parked paths, duplicate actions and reservations', () => {
    const original = fixture();
    const cid = Object.keys(original.world.citizens)[0];
    const edits = [
      (cp: Checkpoint) => {
        cp.world.citizens[cid].strategy!.pending!.actionId = 'missing';
      },
      (cp: Checkpoint) => {
        cp.world.citizens[cid].strategy!.index = 2;
      },
      (cp: Checkpoint) => {
        cp.world.citizens[cid].strategy!.progress = -1;
      },
      (cp: Checkpoint) => {
        cp.world.citizens[cid].strategy!.directives = [{ type: 'move', x: 999, y: 0 }];
      },
      (cp: Checkpoint) => {
        cp.world.citizens[cid].emergency!.suspendedAction!.elapsed = 999;
      },
      (cp: Checkpoint) => {
        cp.world.citizens[cid].emergency!.suspendedAction!.reserved['wood:1'] = 2;
      },
      (cp: Checkpoint) => {
        cp.world.citizens[cid].action!.id = cp.world.citizens[cid].emergency!.suspendedAction!.id;
      },
      (cp: Checkpoint) => {
        cp.world.citizens[cid].emergency!.suspendedPosition!.x = 999;
      },
    ];
    for (const corrupt of edits) {
      const cp = structuredClone(original);
      corrupt(cp);
      expect(() => validateCheckpoint(cp)).toThrow();
    }
  });
});
