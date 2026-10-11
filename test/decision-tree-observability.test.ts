import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Runtime, controlSchema } from '../src/server/runtime.ts';
import { createWorld, tickWorld } from '../src/world/core.ts';
import { projectSpectatorWorld } from '../src/server/snapshot.ts';
import { saveCheckpoint, validateCheckpoint } from '../src/server/checkpoint.ts';
import { mindSchema } from '../src/server/autonomy-checkpoint.ts';
import { MIND_LIMITS } from '../src/shared/tree-types.ts';

function temporary(test: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-tree-debug-'));
  try { test(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe('decision-tree spectator observability', () => {
  it('requires a strict boolean only on its own control', () => {
    for (const enabled of [undefined, 0, 1, 'true', null])
      expect(controlSchema.safeParse({ type: 'decision-tree-debug', enabled }).success).toBe(false);
    for (const type of ['play', 'pause', 'step', 'speed', 'scenario', 'mode', 'checkpoint', 'reset'])
      expect(controlSchema.safeParse({ type, enabled: false }).success).toBe(false);
    expect(controlSchema.parse({ type: 'decision-tree-debug', enabled: false }).enabled).toBe(false);
  });

  it('omits full diagnostics by default, labels evictions separately and detaches debug and summary', () => {
    const world = createWorld({ seed: 11, population: 1, controllerMode: 'composed' });
    tickWorld(world, 30);
    const citizen = Object.values(world.citizens)[0];
    const mind = citizen.mind!;
    mind.memories = Array.from({ length: 20 }, (_, i) => ({ id: `memory-${i}`, tick: i, kind: 'work' as const, text: `work ${i}` }));
    mind.memoriesOmitted = 7;
    const before = JSON.stringify(world);
    const off = projectSpectatorWorld(world).citizens[citizen.id];
    expect(off).not.toHaveProperty('treeDebug');
    expect(off.mind).not.toHaveProperty('tasks');
    expect(off.mind).not.toHaveProperty('trace');
    expect(off.mind).not.toHaveProperty('receipts');
    expect(off.mind!.memories).toHaveLength(12);
    expect(off.mind!.memoriesOmitted).toBe(7);
    expect(off.mind!.memoriesPayloadOmitted).toBe(8);
    const on = projectSpectatorWorld(world, true).citizens[citizen.id];
    expect(on.treeDebug).toEqual(mind);
    on.treeDebug!.trace.length = 0;
    on.mind!.memories[0].text = 'changed';
    on.mind!.dispositions.ambition = 999;
    expect(JSON.stringify(world)).toBe(before);
  });

  it('toggles without modifying world, generation or subsequent seeded controller outcomes', () => temporary((directory) => {
    const runtime = new Runtime({ directory, autoClock: false, population: 8 });
    try {
      const baseline = structuredClone(runtime.world);
      const initial = runtime.snapshot();
      expect(initial.status.decisionTreeDebug).toBe(false);
      const enabled = runtime.control({ type: 'decision-tree-debug', enabled: true });
      expect(enabled.status.generation).toBe(initial.status.generation);
      expect(Object.values(enabled.world.citizens).every((c) => c.treeDebug)).toBe(true);
      expect(runtime.world).toEqual(baseline);
      const disabled = runtime.control({ type: 'decision-tree-debug', enabled: false });
      expect(Object.values(disabled.world.citizens).every((c) => !('treeDebug' in c))).toBe(true);
      expect(runtime.world).toEqual(baseline);
      tickWorld(baseline, 80);
      tickWorld(runtime.world, 80);
      expect(runtime.world).toEqual(baseline); // Includes RNG, actions, trace and receipt allocations.
    } finally { runtime.close(); }
  }));

  it('roundtrips metadata and defaults legacy absent metadata to false', () => temporary((directory) => {
    const runtime = new Runtime({ directory, autoClock: false, population: 2 });
    runtime.control({ type: 'decision-tree-debug', enabled: true });
    const cp = runtime.checkpoint(false);
    runtime.close();
    expect(validateCheckpoint(cp).runtime.decisionTreeDebug).toBe(true);
    const restored = new Runtime({ directory, restore: true, autoClock: false });
    expect(restored.snapshot().status.decisionTreeDebug).toBe(true);
    restored.close();
    delete cp.runtime.decisionTreeDebug;
    saveCheckpoint(join(directory, 'checkpoint.json'), cp);
    const legacy = new Runtime({ directory, restore: true, autoClock: false });
    try { expect(legacy.snapshot().status.decisionTreeDebug).toBe(false); }
    finally { legacy.close(); }
  }));

  it('substantially reduces a populated retained-history payload for 100 citizens', () => {
    const world = createWorld({ seed: 7, population: 100, controllerMode: 'composed' });
    // This is a DTO size test, not an autonomous-controller endurance trial.
    // Populate bounded diagnostics directly, with coherent receipt allocation and
    // an active request so the default projection still contains a useful summary.
    for (const citizen of Object.values(world.citizens)) {
      const mind = citizen.mind!;
      const taskId = `${citizen.id}-task`;
      const requestId = `${citizen.id}-request`;
      mind.memories = Array.from({ length: MIND_LIMITS.memories }, (_, i) => ({
        id: `${citizen.id}-memory-${i}`, tick: 0, kind: 'work' as const,
        text: `Harvested food delivery ${i} while preparing the next reserve request.`,
      }));
      mind.receipts = Array.from({ length: MIND_LIMITS.receipts }, (_, i) => ({
        id: `${citizen.id}-receipt-${i}`, settlementId: `${citizen.id}-settlement-${i}`,
        tick: 0, citizenId: citizen.id, item: 'food:1' as const, quantity: 1,
        source: 'harvest' as const, requestId,
      }));
      mind.tasks = [{
        id: taskId, definitionId: 'AcquireResource',
        request: { id: requestId, resource: 'food', tier: 1,
          quantity: MIND_LIMITS.receipts + 1, allowMarket: true,
          purpose: 'Prepare food reserves', urgency: 'routine' },
        ancestry: [], phase: 'acquire', status: 'running', startedTick: 0,
        lastProgressTick: 0, delivered: MIND_LIMITS.receipts,
        receiptIds: mind.receipts.map((receipt) => receipt.id), ownedOrderIds: [],
      }];
      mind.activeTaskId = taskId;
      mind.trace = Array.from({ length: MIND_LIMITS.trace }, () => ({
        tick: 0, invocationId: taskId, definitionId: 'AcquireResource',
        transition: 'wait' as const, reason: 'Awaiting the remaining food delivery for reserves.',
      }));
      expect(mindSchema.safeParse(mind).success).toBe(true);
    }
    const projected = projectSpectatorWorld(world);
    const debug = projectSpectatorWorld(world, true);
    expect(Object.keys(projected.citizens)).toHaveLength(100);
    for (const citizen of Object.values(projected.citizens)) {
      expect(citizen).not.toHaveProperty('treeDebug');
      expect(citizen.mind!.currentTask?.status).toBe('running');
      expect(citizen.mind!.memories).toHaveLength(12);
      expect(citizen.mind!.memoriesPayloadOmitted).toBe(MIND_LIMITS.memories - 12);
      expect(debug.citizens[citizen.id].treeDebug!.trace).toHaveLength(MIND_LIMITS.trace);
      expect(debug.citizens[citizen.id].treeDebug!.receipts).toHaveLength(MIND_LIMITS.receipts);
    }
    const off = JSON.stringify(projected);
    const on = JSON.stringify(debug);
    expect(off.length).toBeLessThan(on.length * 0.8);
  });
});
