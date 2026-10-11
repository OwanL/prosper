import { describe, expect, it, vi } from 'vitest';
import * as directives from '../src/world/directives.ts';
import { createWorld, dispatch, cancelAction, tickWorld } from '../src/world/core.ts';
import { advanceDirectives, commitStrategy } from '../src/world/directives.ts';
import { updateKnowledge } from '../src/world/observation.ts';
import { BALANCE } from '../src/world/config.ts';
import type { Citizen, Command } from '../src/shared/types.ts';

function setup() {
  const world = createWorld({ seed: 2 });
  const [a, b, other] = Object.values(world.citizens);
  world.citizens = Object.fromEntries([a, b, other].map((c) => [c.id, c]));
  world.deposits = {};
  world.buildings = {};
  world.events = [];
  for (const [i, c] of [a, b, other].entries()) {
    c.x = 1 + i;
    c.y = 1;
    c.inventory = { 'food:1': 10 };
    c.fullness = 100;
    c.knowledge = {};
  }
  const actions = (c: Citizen) => ({
    command: (command: Command) => dispatch(world, c.id, command, 'directive'),
    cancel: () => cancelAction(world, c.id),
  });
  const choose = (c: Citizen, partner = c === a ? b : a) => {
    expect(
      commitStrategy(
        world,
        c.id,
        {
          mode: 'replace',
          directives: [
            { type: 'reproduce', partnerId: partner.id, areas: [[0, 0, 10, 3]] },
            { type: 'move', x: c === a ? 5 : 6, y: 1 },
          ],
        },
        actions(c),
      ).ok,
    ).toBe(true);
  };
  const consent = () => {}; // historical fixture helper; no prerequisite
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      tickWorld(world);
      updateKnowledge(world);
    }
  };
  updateKnowledge(world);
  return { world, a, b, other, actions, choose, consent, tick };
}

describe('consent-free joint reproduction directive identity', () => {
  it('reconciles a completed approach pending when the counterpart installs shared work', () => {
    const { world, a, b, actions, choose, consent, tick } = setup();
    b.x = 4;
    updateKnowledge(world);
    choose(a);
    consent();
    advanceDirectives(world, a, actions(a));
    const travelPending = a.strategy!.pending!;
    expect(travelPending.purpose).toBe('travel');
    // Hold the executor at its actual action-completion boundary. The movement
    // and exact result are produced by core; only its next directive pass is deferred.
    const advance = directives.advanceDirectives;
    const deferred = vi.spyOn(directives, 'advanceDirectives').mockImplementation((w, c, api) => {
      if (c.id !== a.id) advance(w, c, api);
    });
    try {
      while (a.action) tick();
    } finally {
      deferred.mockRestore();
    }
    expect(travelPending.result?.ok).toBe(true);
    expect(a.strategy!.pending).toBe(travelPending);
    choose(b);
    advanceDirectives(world, b, actions(b));
    const joint = b.action!.id;
    expect(a.action!.id).toBe(joint);
    advanceDirectives(world, a, actions(a));
    expect(a.strategy?.status).toBe('active');
    expect(a.strategy?.pending).toEqual({ actionId: joint, purpose: 'work' });
    tick(BALANCE.reproductionTicks + 50);
    expect(world.events.filter((e) => e.kind === 'birth')).toHaveLength(1);
    for (const c of [a, b]) {
      expect(c.strategy?.status).toBe('completed');
      expect(c.inventory['food:1']).toBe(9);
      expect(
        c.directiveReceipts?.filter((r) => r.outcome === 'completed' && r.index === 0),
      ).toHaveLength(1);
      expect(c.directiveReceipts?.some((r) => r.outcome === 'blocked')).toBe(false);
    }
    expect(a.x).toBe(5);
    expect(b.x).toBe(6);
  });

  it('replaces an old cancellation receipt with the exact newly installed joint ID', () => {
    const { world, a, b, actions, choose, consent, tick } = setup();
    choose(a);
    choose(b);
    consent();
    advanceDirectives(world, a, actions(a));
    const oldId = a.action!.id;
    // A chosen replacement on B cancels both halves and refunds their inputs.
    choose(b);
    expect(a.strategy!.pending?.result?.code).toBe('joint-cancelled');
    expect(a.inventory['food:1']).toBe(10);
    expect(b.inventory['food:1']).toBe(10);
    advanceDirectives(world, b, actions(b));
    expect(b.action!.id).not.toBe(oldId);
    advanceDirectives(world, a, actions(a));
    expect(a.strategy?.status).toBe('active');
    expect(a.strategy?.pending?.actionId).toBe(b.action!.id);
    directives.directiveActionResult(a, oldId, {
      ok: false,
      code: 'joint-cancelled',
      message: 'Old cancellation.',
    });
    expect(a.strategy?.pending?.result).toBeUndefined();
    tick(BALANCE.reproductionTicks + 50);
    expect(world.events.filter((e) => e.kind === 'birth')).toHaveLength(1);
    expect(a.strategy?.status).toBe('completed');
    expect(b.strategy?.status).toBe('completed');
    expect(a.inventory['food:1']).toBe(9);
    expect(b.inventory['food:1']).toBe(9);
  });

  it('reconciles stale cancellation after the first parent runs before the replacement parent', () => {
    const { world, a, b, choose, consent, tick } = setup();
    choose(a);
    choose(b);
    consent();
    tick();
    const oldId = a.action!.id;
    const strategyId = a.strategy!.id;
    const goals = structuredClone(a.goals);
    choose(b);
    expect(a.strategy!.pending?.result?.code).toBe('joint-cancelled');
    expect(a.inventory['food:1']).toBe(10);
    expect(b.inventory['food:1']).toBe(10);
    // Real core order: A consumes the old receipt before B starts replacement work.
    tick();
    const jointId = b.action!.id;
    expect(jointId).not.toBe(oldId);
    expect(a.action!.id).toBe(jointId);
    expect(a.strategy?.id).toBe(strategyId);
    expect(a.strategy?.status).toBe('active');
    expect(a.strategy?.blockedReason).toBeUndefined();
    expect(a.strategy?.pending).toEqual({ actionId: jointId, purpose: 'work' });
    tick(BALANCE.reproductionTicks + 50);
    expect(world.events.filter((e) => e.kind === 'birth')).toHaveLength(1);
    for (const c of [a, b]) {
      expect(c.strategy?.status).toBe('completed');
      expect(c.inventory['food:1']).toBe(9);
      expect(
        c.directiveReceipts?.filter((r) => r.outcome === 'completed' && r.index === 0),
      ).toHaveLength(1);
    }
    expect(a.x).toBe(5);
    expect(b.x).toBe(6);
    expect(a.goals).toEqual(goals);
  });

  it('finishes both matching strategies when only one parent issues the joint start', () => {
    const { world, a, b, choose, consent, tick } = setup();
    choose(a);
    choose(b);
    consent();
    tick(BALANCE.reproductionTicks + 50);
    expect(world.events.filter((e) => e.kind === 'birth')).toHaveLength(1);
    for (const c of [a, b]) {
      expect(c.strategy?.status).toBe('completed');
      expect(c.inventory['food:1']).toBe(9);
      expect(c.directiveReceipts?.some((r) => r.outcome === 'blocked')).toBe(false);
    }
  });

  it('does not adopt a joint action for an explicitly different partner intent', () => {
    const { a, b, other, world, actions, choose, consent, tick } = setup();
    choose(a, other);
    choose(b);
    consent();
    advanceDirectives(world, b, actions(b));
    expect(a.strategy!.pending).toBeUndefined();
    tick(BALANCE.reproductionTicks + 2);
    expect(a.strategy!.index).toBe(0);
    expect(a.directiveReceipts?.some((r) => r.outcome === 'completed' && r.index === 0)).toBe(
      false,
    );
  });

  it('does not revive a reproduction directive blocked on an unrelated prerequisite', () => {
    const { world, a, b, choose, consent, tick } = setup();
    choose(a);
    a.health = 74;
    tick(); // Health rejection is not an old joint lifecycle receipt.
    expect(a.strategy?.status).toBe('blocked');
    expect(a.strategy?.pending).toBeUndefined();
    const reason = a.strategy?.blockedReason;
    a.health = 100;
    consent();
    choose(b);
    tick(BALANCE.reproductionTicks + 50);
    expect(world.events.filter((e) => e.kind === 'birth')).toHaveLength(1);
    expect(a.strategy?.status).toBe('blocked');
    expect(a.strategy?.blockedReason).toBe(reason);
    expect(a.strategy?.index).toBe(0);
    expect(a.x).toBe(1);
  });

  it.each(['stopped', 'completed', 'discarded'] as const)(
    'does not revive %s intent even with an old joint cancellation receipt',
    (status) => {
      const { world, a, b, choose, consent, tick } = setup();
      choose(a);
      choose(b);
      consent();
      tick();
      choose(b);
      // Checkpoint-style terminal lifecycle fixtures must never be adopted.
      if (status === 'discarded') {
        expect(dispatch(world, a.id, { type: 'cancel' }).ok).toBe(true);
      } else a.strategy!.status = status;
      tick(BALANCE.reproductionTicks + 50);
      expect(world.events.filter((e) => e.kind === 'birth')).toHaveLength(1);
      expect(a.strategy?.status).toBe(status === 'discarded' ? undefined : status);
      expect(a.strategy?.pending?.result?.ok).not.toBe(true);
      expect(a.x).toBe(1);
    },
  );

  it('cancellation returns each reservation once and fails the participating strategies', () => {
    const { a, b, world, actions, choose, consent, tick } = setup();
    choose(a);
    choose(b);
    consent();
    const goals = [structuredClone(a.goals), structuredClone(b.goals)];
    advanceDirectives(world, a, actions(a));
    cancelAction(world, a.id);
    tick(2);
    for (const c of [a, b]) {
      expect(c.inventory['food:1']).toBe(10);
      expect(c.action).toBeNull();
      expect(c.strategy?.status).toBe(c === a ? undefined : 'blocked');
    }
    cancelAction(world, a.id);
    cancelAction(world, b.id);
    expect(a.inventory['food:1']).toBe(10);
    expect(b.inventory['food:1']).toBe(10);
    expect([a.goals, b.goals]).toEqual(goals);
    expect(world.events.filter((e) => e.kind === 'birth')).toHaveLength(0);
  });
});
