import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Runtime } from '../src/server/runtime.ts';
import { createWorld, dispatch } from '../src/world/core.ts';
import { loadCheckpoint, saveCheckpoint, validateCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import type { CitizenMind } from '../src/shared/tree-types.ts';

function checkpoint(composed = false): Checkpoint {
  return { version: 1, savedAt: new Date().toISOString(),
    // Native composed creation mints rest and mind shells; legacy fixtures stay untagged like historical saves.
    world: createWorld({ population: 2, ...(composed ? { controllerMode: 'composed' as const } : {}) }),
    runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } };
}
function isolated(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-composed-runtime-'));
  try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}
describe('composed runtime boundary', () => {
  it('fresh Local AI skips the legacy runner and rejects legacy inference modes', () => isolated((directory) => {
    const runtime = new Runtime({ directory, autoClock: false, population: 2 });
    try {
      expect(runtime.world.controllerMode).toBe('composed');
      const legacy = vi.spyOn(runtime.runner, 'tick');
      runtime.control({ type: 'step', ticks: 2 });
      expect(legacy).not.toHaveBeenCalled();
      expect(() => runtime.control({ type: 'mode', mode: 'live' })).toThrow(/Local AI only/);
      expect(() => runtime.importFixtures([])).toThrow(/Local AI only/);
      const citizen = Object.values(runtime.world.citizens)[0];
      expect(() => runtime.command(citizen.id, { type: 'leave-territory' })).not.toThrow();
    } finally { runtime.close(); }
  }));
  it('restores untagged worlds explicitly as legacy, not composed', () => isolated((directory) => {
    const cp = checkpoint(); // untagged legacy world
    delete cp.world.controllerMode;
    saveCheckpoint(join(directory, 'checkpoint.json'), cp);
    const runtime = new Runtime({ directory, restore: true, autoClock: false });
    try { expect(runtime.world.controllerMode).toBe('legacy'); } finally { runtime.close(); }
  }));
  it('refunds composed legacy building escrow without minting gold and cleans resource-free disabled state', () => {
    const cp = checkpoint(true); const w = cp.world;
    const c = Object.values(w.citizens)[0]; c.gold -= 7;
    w.orders.order = { id: 'order', citizenId: c.id, item: 'building:old', side: 'buy', quantity: 1,
      price: 7, createdTick: 0, sequence: 0, escrowGold: 7, escrowItems: {} };
    w.alliances = { old: { id: 'old', name: 'old', members: [c.id], createdTick: 0, lastActiveTick: 0 } };
    const restored = validateCheckpoint(cp).world;
    expect(restored.orders).toEqual({}); expect(restored.alliances).toEqual({});
    expect(Object.values(restored.citizens).reduce((n, c) => n + c.gold, 0)).toBe(w.initialGold);
  });
  it('fails visibly rather than deleting legacy loot custody or enabling composed live', () => {
    const cp = checkpoint(true);
    cp.runtime.mode = 'live';
    expect(() => validateCheckpoint(cp)).toThrow(/Local AI/);
    cp.runtime.mode = 'scripted';
    cp.world.loot.old = { id: 'old', citizenName: 'old', x: 0, y: 0, gold: 0, inventory: { 'wood:1': 0.25 } };
    expect(() => validateCheckpoint(cp)).toThrow(/loot custody/);
  });
  it('roundtrips fractional active work, receipts, rest and dated memory on disk', () => isolated((directory) => {
    const cp = checkpoint(true); const w = cp.world;
    const c = Object.values(w.citizens)[0];
    // Harvest admission requires a whole unit; retain fractional stock on a supported T1 target.
    const deposit = Object.values(w.deposits).find((d) => d.resource === 'wood' && d.tier === 1)!;
    deposit.capacity = 2;
    deposit.stock = 1.85;
    c.x = deposit.x; c.y = deposit.y;
    expect(dispatch(w, c.id, { type: 'harvest', depositId: deposit.id }).ok).toBe(true);
    c.rest = { value: 42.25 };
    c.mind = { version: 1, dispositions: { ambition: 0.5, morals: 0.5, generosity: 0.5, riskTolerance: 0.5,
      patience: 0.5, sociability: 0.5, vengefulness: 0.5, familyOrientation: 0.5, enterprise: 0.5, economicIndependence: 0.5 },
      memories: [{ id: 'memory', tick: 0, kind: 'work', text: 'observed', location: { x: c.x, y: c.y } }], memoriesOmitted: 0,
      tasks: [{ id: 'task', definitionId: 'get-resource', request: { id: 'request', resource: 'wood', tier: 1,
        quantity: 1.25, allowMarket: true, purpose: 'work', urgency: 'routine' }, ancestry: ['get-resource'],
        phase: 'harvest', status: 'running', startedTick: 0, lastProgressTick: 0, delivered: 0.85,
        receiptIds: ['receipt'], ownedOrderIds: [], actionId: c.action!.id }], activeTaskId: 'task',
      receipts: [{ id: 'receipt', settlementId: 'settlement', tick: 0, citizenId: c.id, item: 'wood:1',
        quantity: 0.85, source: 'harvest', requestId: 'request' }], trace: [], traceOmitted: 0, nextDirectorTick: 2400 } satisfies CitizenMind;
    const path = join(directory, 'roundtrip.json'); saveCheckpoint(path, cp);
    expect(loadCheckpoint(path).world.citizens[c.id]).toEqual(c);
  }));
  it('preserves closed admission votes from former members but rejects duplicate live membership', () => {
    const cp = checkpoint(true); const w = cp.world;
    const [a, b] = Object.values(w.citizens);
    w.territories = { territory: { id: 'territory', ownerId: a.id, createdTick: 0,
      members: { [a.id]: { citizenId: a.id, joinedTick: 0, sequence: 0 } },
      admissions: [{ id: 'admission', applicantId: a.id, requestedTick: 0, expiresTick: 10,
        votes: { [b.id]: true }, status: 'admitted' }] } };
    w.signs = { sign: { id: 'sign', territoryId: 'territory', x: 0, y: 0, woodTier: 1, health: 3.5, maxHealth: 16 } };
    expect(() => validateCheckpoint(cp)).not.toThrow();
    w.territories.territory.members[b.id] = { citizenId: b.id, joinedTick: 0, sequence: 0 };
    expect(() => validateCheckpoint(cp)).toThrow(/membership sequence/);
  });
  it('saves, restores and continues a really ticked world with receipts and tasks', () => isolated((directory) => {
    const runtime = new Runtime({ directory, autoClock: false, population: 2 });
    try {
      runtime.control({ type: 'step', ticks: 100 }); // enough real ticks for allocated deliveries and active tasks
      runtime.checkpoint(false);
      const saved = loadCheckpoint(runtime.checkpointPath);
      const withAllocations = Object.values(saved.world.citizens).filter((c) =>
        c.mind && c.mind.receipts.length > 0 && c.mind.tasks.some((t) => t.receiptIds.length > 0));
      expect(withAllocations.length).toBeGreaterThan(0); // real allocated deliveries, not empty shells
      const restored = new Runtime({ directory, restore: true, autoClock: false });
      try {
        expect(restored.world.citizens).toEqual(saved.world.citizens);
        expect(restored.world.tick).toBe(saved.world.tick);
        restored.control({ type: 'step', ticks: 2 });
        expect(restored.checkpoint(true).world.tick).toBe(saved.world.tick + 2);
        const resumed = loadCheckpoint(restored.checkpointPath);
        expect(resumed.world.tick).toBe(saved.world.tick + 2);
        expect(resumed.world.citizens).toEqual(restored.world.citizens);
      } finally { restored.close(); }
    } finally { runtime.close(); }
  }));
});
