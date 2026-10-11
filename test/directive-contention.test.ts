import { describe, expect, it } from 'vitest';
import { cancelAction, createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { commitStrategy } from '../src/world/directives.ts';
import { updateKnowledge } from '../src/world/observation.ts';
import { reviewReason, reviewState } from '../src/citizen/planning.ts';
import { BALANCE } from '../src/world/config.ts';
import type { Citizen } from '../src/shared/types.ts';

function setup() {
  const world = createWorld({ seed: 2 });
  const [first, second] = Object.values(world.citizens);
  world.citizens = { [first.id]: first, [second.id]: second };
  world.buildings = {};
  world.deposits = {
    wood: { id: 'wood', resource: 'wood', tier: 1, x: 1, y: 1, stock: 1, capacity: 1, regrowAt: 0 },
  };
  world.events = [];
  for (const citizen of [first, second]) {
    citizen.x = 1;
    citizen.y = 1;
    citizen.inventory = { 'food:1': 100 };
    citizen.knowledge = {};
  }
  updateKnowledge(world);
  const commit = (citizen: Citizen) => {
    expect(
      commitStrategy(
        world,
        citizen.id,
        {
          mode: 'replace',
          reviewAfter: 1000,
          directives: [
            { type: 'gather', resource: 'wood', tier: 1, quantity: 1, areas: [[1, 1, 1, 1]] },
          ],
        },
        {
          command: (command) => dispatch(world, citizen.id, command, 'directive'),
          cancel: () => cancelAction(world, citizen.id),
        },
      ).ok,
    ).toBe(true);
    citizen.review = reviewState(world, citizen);
  };
  const tick = (count = 1) => {
    for (let i = 0; i < count; i++) {
      tickWorld(world);
      updateKnowledge(world);
    }
  };
  return { world, first, second, commit, tick };
}

describe('directive deposit contention', () => {
  it('keeps completion-race retries inspectable without waking reviews and progresses after local regrowth', () => {
    const { world, first, second, commit, tick } = setup();
    commit(first);
    commit(second);
    tick();
    expect(first.action?.command).toEqual({ type: 'harvest', depositId: 'wood' });
    expect(second.action?.command).toEqual({ type: 'harvest', depositId: 'wood' });
    expect(world.deposits.wood.stock).toBe(1);
    tick(BALANCE.harvestTicks);
    expect(first.inventory['wood:1']).toBe(1);
    expect(second.inventory['wood:1'] ?? 0).toBe(0);
    expect(world.deposits.wood.stock).toBe(0);
    expect(second.action).toBeNull();
    expect(second.strategy?.wakeTick).toBeGreaterThan(world.tick);
    expect(second.lastResult).toContain('depleted');
    expect(
      world.events.some(
        (e) => e.citizenId === second.id && e.text.includes('depleted'),
      ),
    ).toBe(true);
    expect(reviewReason(world, second)).toBeUndefined();
    for (let i = 0; i < BALANCE.harvestTicks * 2 + BALANCE.regrowTicks + 10; i++) {
      tick();
      expect(reviewReason(world, second)).not.toBe('personal error alert');
      if (second.strategy?.status === 'completed') break;
    }
    expect(first.inventory['wood:1']).toBe(1);
    expect(second.inventory['wood:1']).toBe(1);
    expect(second.strategy?.status).toBe('completed');
    expect(reviewReason(world, second)).toContain('completed');
  });

  it('does not wake for depletion of an already pending directive harvest', () => {
    const { world, first, second, commit, tick } = setup();
    // Starting first lets the competitor finish before the pending directive.
    expect(dispatch(world, second.id, { type: 'harvest', depositId: 'wood' }).ok).toBe(true);
    commit(first);
    tick();
    expect(first.action?.command.type).toBe('harvest');
    tick(BALANCE.harvestTicks);
    expect(second.inventory['wood:1']).toBe(1);
    expect(first.inventory['wood:1'] ?? 0).toBe(0);
    expect(world.deposits.wood.stock).toBe(0);
    expect(first.strategy?.status).toBe('active');
    expect(first.strategy?.wakeTick).toBeGreaterThan(world.tick);
    expect(reviewReason(world, first)).toBeUndefined();
    expect(first.lastResult).toContain('depleted');
    tick(BALANCE.regrowTicks + BALANCE.harvestTicks + BALANCE.moveTicks);
    expect(first.inventory['wood:1']).toBe(1);
    expect(first.strategy?.status).toBe('completed');
  });

  it('still requests review when gathering blocks without a primitive error', () => {
    const { world, first, commit, tick } = setup();
    commit(first);
    first.strategy!.directives = [
      { type: 'gather', resource: 'wood', tier: 2, areas: [[1, 1, 1, 1]] },
    ];
    tick();
    expect(first.strategy?.status).toBe('blocked');
    expect(reviewReason(world, first)).toContain('strategy blocked');
  });

  it('still wakes genuine failures in directive-owned harvesting', () => {
    const { world, first, commit, tick } = setup();
    commit(first);
    tick();
    delete world.deposits.wood;
    tick();
    expect(first.strategy?.status).toBe('blocked');
    expect(reviewReason(world, first)).toBe('personal error alert');
  });

  it('keeps strategy authorization when an active carried tool is sold', () => {
    const { world, first, commit, tick } = setup();
    first.inventory['axe:1'] = 1;
    commit(first);
    const strategy = first.strategy;
    tick();
    expect(first.action?.command.type).toBe('harvest');
    expect(dispatch(world, first.id, { type: 'order', side: 'sell', item: 'axe:1', quantity: 1, price: 10 }).ok).toBe(true);
    expect(first.strategy).toBe(strategy);
    expect(dispatch(world, first.id, { type: 'cancel' }).ok).toBe(true);
    expect(first.strategy).toBeUndefined();
  });

  it.each(['external', 'plan'] as const)(
    'preserves %s primitive depletion errors even with an active strategy',
    (source) => {
      const { world, first, second, commit, tick } = setup();
      commit(first);
      commit(second);
      tick();
      tick(BALANCE.harvestTicks);
      expect(world.deposits.wood.stock).toBe(0);
      expect(second.strategy?.status).toBe('active');
      second.review = reviewState(world, second);
      expect(
        dispatch(world, second.id, { type: 'harvest', depositId: 'wood' }, source),
      ).toMatchObject({ ok: false, code: 'depleted-deposit' });
      expect(reviewReason(world, second)).toBe('personal error alert');
    },
  );
});
