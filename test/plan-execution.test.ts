import { describe, expect, it } from 'vitest';
import type { PlanSpec } from '../src/shared/plan-types.ts';
import { createWorld, dispatch, cancelAction, tickWorld } from '../src/world/core.ts';
import { approvePlan } from '../src/world/plans.ts';
import { updateKnowledge } from '../src/world/observation.ts';
import { reviewReason, reviewState } from '../src/citizen/planning.ts';
import { parsePlanSpec } from '../src/citizen/plan-schema.ts';
import { scriptedCommands } from '../src/citizen/scripted.ts';
import { observe } from '../src/world/observation.ts';
import { BALANCE } from '../src/world/config.ts';

function setup() {
  const world = createWorld({ seed: 42 });
  const citizen = Object.values(world.citizens)[0];
  citizen.x = 1;
  citizen.y = 1;
  citizen.inventory = { 'fibre:1': 7, 'food:1': 8 };
  
  citizen.fullness = 100;
  world.deposits = {
    tree: { id: 'tree', resource: 'wood', tier: 1, x: 1, y: 1, stock: 1, capacity: 1, regrowAt: 0 },
  };
  world.buildings = {};
  citizen.knowledge = {};
  updateKnowledge(world);
  const approve = (spec: PlanSpec) =>
    approvePlan(world, citizen.id, parsePlanSpec(spec), {
      cancel: () => cancelAction(world, citizen.id),
    });
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      tickWorld(world);
      updateKnowledge(world);
    }
  };
  const settle = (limit = 2500) => {
    for (let i = 0; i < limit && citizen.plan; i++) tick();
    expect(citizen.plan).toBeUndefined();
  };
  return { world, citizen, approve, tick, settle };
}

describe('approved durable plans', () => {
  it('gathers across regrowth, crafts automatically usable tools, then builds without any reasoning loop', () => {
    const { world, citizen, approve, settle } = setup();
    expect(
      approve({
        mode: 'append',
        steps: [
          { type: 'gather', resource: 'wood', tier: 1, targetQuantity: 12, maxTicks: 2000 },
          { type: 'command', command: { type: 'craft', item: 'knife', tier: 1 } },
          { type: 'command', command: { type: 'build', kind: 'lumbermill', tier: 1, x: 2, y: 1 } },
        ],
      }).ok,
    ).toBe(true);
    settle();
    expect(citizen.inventory['wood:1']).toBe(3);
    expect(citizen.inventory['fibre:1'] ?? 0).toBe(0);
    expect(citizen.inventory['knife:1']).toBe(1);
    expect(Object.values(world.buildings)).toEqual([
      expect.objectContaining({ ownerId: citizen.id, kind: 'lumbermill', x: 2, y: 1 }),
    ]);
    expect(citizen.planReceipts?.map((r) => r.outcome)).toEqual([
      'completed',
      'completed',
      'completed',
    ]);
    expect(citizen.planReceipts?.[0].state.inventory['wood:1']).toBe(12);
    expect(world.tick).toBeGreaterThan(300);
  });

  it('accepts target completion exactly at the gather deadline and continues the approved plan', () => {
    const { citizen, approve, tick } = setup();
    approve({
      mode: 'append',
      steps: [
        { type: 'gather', resource: 'wood', tier: 1, targetQuantity: 1, maxTicks: BALANCE.harvestTicks },
        { type: 'wait', ticks: 1 },
      ],
    });
    tick(BALANCE.harvestTicks + 1);
    expect(citizen.inventory['wood:1']).toBe(1);
    expect(citizen.planReceipts?.[0].outcome).toBe('completed');
    tick(2);
    expect(citizen.planReceipts?.map((r) => r.outcome)).toEqual(['completed', 'completed']);
  });

  it('uses the citizen-selected food condition to leave work and advance to its next step', () => {
    const { citizen, approve, tick } = setup();
    citizen.inventory = {};
    citizen.fullness = 30 * BALANCE.fullnessDrain;
    approve({
      mode: 'append',
      steps: [
        {
          type: 'gather',
          resource: 'wood',
          tier: 1,
          targetQuantity: 100,
          maxTicks: 1000,
          stopWhen: { kind: 'food-runway-below', ticks: 20 },
        },
        { type: 'command', command: { type: 'move', x: 3, y: 1 } },
      ],
    });
    tick(30);
    expect(citizen.plan).toBeUndefined();
    expect(citizen.planReceipts?.map((r) => r.outcome)).toEqual(['condition', 'completed']);
    expect(citizen.x).toBe(3);
    expect(citizen.inventory['wood:1'] ?? 0).toBeLessThan(100);
  });

  it('keeps bounded waits active, acknowledges one early review, and finishes at its chosen deadline', () => {
    const { world, citizen, approve, tick } = setup();
    citizen.review = reviewState(world, citizen);
    approve({ mode: 'append', steps: [{ type: 'wait', ticks: 20 }] });
    tick(10);
    expect(citizen.action).toBeNull();
    expect(scriptedCommands(observe(world, citizen.id))).toEqual([]);
    expect(reviewReason(world, citizen)).toContain('approaching completion');
    citizen.review = reviewState(world, citizen);
    expect(reviewReason(world, citizen)).toBeUndefined();
    tick(11);
    expect(citizen.plan).toBeUndefined();
    expect(reviewReason(world, citizen)).toBe('work queue empty');
  });

  it('preserves existing physical work under append and cancels/refunds only on explicit replace', () => {
    const { world, citizen, approve, tick } = setup();
    citizen.inventory['wood:1'] = 3;
    dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 1 });
    const current = structuredClone(citizen.action);
    approve({ mode: 'append', steps: [{ type: 'wait', ticks: 50 }] });
    tick(2);
    expect(citizen.action?.id).toBe(current?.id);
    expect(citizen.plan?.stepStartedTick).toBeUndefined();
    expect(citizen.inventory['wood:1'] ?? 0).toBe(0);
    expect(approve({ mode: 'replace', steps: [{ type: 'wait', ticks: 2 }] }).ok).toBe(true);
    expect(citizen.action).toBeNull();
    expect(citizen.inventory['wood:1']).toBe(3);
    expect(citizen.inventory['knife:1']).toBeUndefined();
    expect(citizen.planReceipts?.at(-1)?.outcome).toBe('cancelled');
  });

  it('stops on failure by default, or skips only when the citizen chose continue', () => {
    for (const onFailure of ['review', 'continue'] as const) {
      const { citizen, approve, settle } = setup();
      approve({
        mode: 'append',
        steps: [
          { type: 'command', command: { type: 'craft', item: 'sword', tier: 3 }, onFailure },
          { type: 'command', command: { type: 'move', x: 3, y: 1 } },
        ],
      });
      settle();
      expect(citizen.x).toBe(onFailure === 'continue' ? 3 : 1);
      expect(citizen.planReceipts?.[0].outcome).toBe('failed');
    }
  });

  it('bounds depleted gathering rather than making endless rejected harvests', () => {
    const { world, citizen, approve, settle } = setup();
    world.deposits.tree.stock = 0;
    world.deposits.tree.regrowAt = 100;
    approve({
      mode: 'append',
      steps: [{ type: 'gather', resource: 'wood', tier: 1, targetQuantity: 5, maxTicks: 10 }],
    });
    settle();
    expect(world.tick).toBe(11);
    expect(citizen.planReceipts?.at(-1)).toMatchObject({
      outcome: 'failed',
      message: expect.stringContaining('budget exhausted'),
    });
    expect(world.events.filter((e) => e.kind === 'error')).toHaveLength(1);
  });

  it('gathers from dated coordinates without querying unseen stock/existence', () => {
    const { world, citizen, approve, settle } = setup();
    citizen.x = 10;
    updateKnowledge(world);
    delete world.deposits.tree;
    expect(
      approve({
        mode: 'append',
        steps: [{ type: 'gather', resource: 'wood', tier: 1, targetQuantity: 2, maxTicks: 80 }],
      }).ok,
    ).toBe(true);
    settle();
    expect(citizen.x).toBe(1);
    expect(citizen.planReceipts?.at(-1)?.outcome).toBe('failed');
    expect(citizen.inventory['wood:1']).toBeUndefined();
  });

  it('manual cancellation discards future plan work and returns its active reservation once', () => {
    const { world, citizen, approve, tick } = setup();
    citizen.inventory['wood:1'] = 3;
    approve({
      mode: 'append',
      steps: [
        { type: 'command', command: { type: 'craft', item: 'knife', tier: 1 } },
        { type: 'wait', ticks: 10 },
      ],
    });
    tick();
    expect(citizen.inventory['wood:1'] ?? 0).toBe(0);
    dispatch(world, citizen.id, { type: 'cancel' });
    expect(citizen.plan).toBeUndefined();
    expect(citizen.action).toBeNull();
    expect(citizen.inventory['wood:1']).toBe(3);
    tick(30);
    expect(citizen.inventory['knife:1']).toBeUndefined();
  });

  it('approves travel followed by gathering a resource discovered only on arrival', () => {
    const { world, citizen, approve, settle } = setup();
    world.deposits = {
      remote: {
        id: 'remote',
        resource: 'wood',
        tier: 1,
        x: 10,
        y: 1,
        stock: 1,
        capacity: 1,
        regrowAt: 0,
      },
    };
    citizen.knowledge = {};
    updateKnowledge(world);
    expect(
      approve({
        mode: 'append',
        steps: [
          { type: 'command', command: { type: 'move', x: 10, y: 1 } },
          { type: 'gather', resource: 'wood', tier: 1, targetQuantity: 2, maxTicks: 400 },
        ],
      }).ok,
    ).toBe(true);
    expect(citizen.knowledge['10,1']).toBeUndefined();
    settle();
    expect(citizen.x).toBe(10);
    expect(citizen.inventory['wood:1']).toBe(2);
    expect(citizen.planReceipts?.map((r) => r.outcome)).toEqual(['completed', 'completed']);
  });

  it('travels first, then reports no local resource without inventing a hidden target', () => {
    const { world, citizen, approve, settle } = setup();
    world.deposits = {};
    citizen.knowledge = {};
    updateKnowledge(world);
    expect(
      approve({
        mode: 'append',
        steps: [
          { type: 'command', command: { type: 'move', x: 10, y: 1 } },
          { type: 'gather', resource: 'fibre', tier: 1, maxTicks: 100 },
        ],
      }).ok,
    ).toBe(true);
    settle();
    expect(citizen.x).toBe(10);
    expect(citizen.planReceipts?.map((r) => r.outcome)).toEqual(['completed', 'failed']);
  });

  it('keeps gathering without a stock target and completes successfully at its bounded deadline', () => {
    const { world, citizen, approve, settle } = setup();
    expect(
      approve({
        mode: 'append',
        steps: [{ type: 'gather', resource: 'wood', tier: 1, maxTicks: 50 }],
      }).ok,
    ).toBe(true);
    settle();
    expect(world.tick).toBe(51);
    expect(citizen.inventory['wood:1']).toBe(1);
    expect(citizen.planReceipts?.at(-1)?.outcome).toBe('completed');
  });

  it('unrelated social-command failures do not turn successful work into a failed plan step', () => {
    const { world, citizen, approve, settle, tick } = setup();
    approve({
      mode: 'append',
      steps: [{ type: 'command', command: { type: 'harvest', depositId: 'tree' } }],
    });
    tick();
    dispatch(world, citizen.id, { type: 'transfer', citizenId: citizen.id, gold: 99999 });
    settle();
    expect(citizen.planReceipts?.at(-1)?.outcome).toBe('completed');
  });
});
